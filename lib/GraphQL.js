const {HttpLink} = require('apollo-link-http');
const fetch = require('node-fetch');
const {makeExecutableSchema, mergeSchemas, addMockFunctionsToSchema, makeRemoteExecutableSchema, introspectSchema} = require('graphql-tools');
const {graphqlExpress, graphiqlExpress} = require('apollo-server-express');
const bodyParser = require('body-parser');
const {cacheKey, createContextCache} = require('../utils/cache');


function getOriginalErrors(error, parent) {
  if(error && error.constructor && error.constructor.name === 'ActionError') {
    return {error, parent};
  }
  if(error.originalError) {
    if(Array.isArray(error.originalError)) {
      return error.originalError.map(err => getOriginalErrors(err, error.originalError))
    }
    return getOriginalErrors(error.originalError, error);
  }
  if(Array.isArray(error.errors)) {
    return error.errors.map(error => getOriginalErrors(error, error));
  }
  return {error, parent};
}

function getFirstError(error) {
  if(Array.isArray(error)) {
    return !error.length ? null : getFirstError(error[0]);
  }
  return error;
}

class GraphQL {
  /**
   *
   * @param {object}  options
   * @param {object}  options.endpoint
   * @param {boolean} options.useMocks
   * @param {array}   options.controllers
   */
  constructor(options) {
    this.options = {
      endpoint: '/graphql',
      controllers: [],
      extensions: [],   //@see ./extensions/typesExtension.js for example of extension
      ...options
    }
  }
  
  parseError(err, context) {
    let result = err && err.hash ? err : {
      hash: undefined,
      code: undefined,
      message: typeof err === 'string' ? err : (err.message || 'INTERNAL_SERVER_ERROR'),
      details: undefined
    };
    
    if(err && err.constructor && err.constructor.name === 'ActionError') {
      let { errorOptions, details } = err.payload  || {};
      result.hash = err.payload.hash;
      if(errorOptions.message) {
        result.message = errorOptions.message;
      }
      details && (result.details = details);
      errorOptions.code && (result.code = errorOptions.code);
      !result.details && errorOptions.details && (result.details = errorOptions.details);
    } else {
      
      if (/[A-Z_\d]{10}/.test(result.message) && result.message.indexOf('_') !== -1) {
        result.hash = result.message;
      }
    }
    
    if(result.hash) {
      if(context && context.i18n) {
        result.message = context.i18n._(result.hash)
      }
      result.message || (result.message = result.hash);
    }
    
    return result;
  }
  
  formatError(error, { req, gqlContext }) {
    let originalError = null;
    if(error.originalError) {
      let orig = getOriginalErrors(error);
      if (orig) {
        if (!Array.isArray(orig)) {
          orig = [orig];
        }
        originalError = orig.map(
          (error) => this.parseError(Array.isArray(error) ? getFirstError(error).error : error.error, {context: req.context}));
      }
    }
    
    return {
      ...error.extensions,
      message: error.message || 'An unknown error occurred.',
      originalError,
      locations: error.locations,
      path: error.path,
    };
  }
  
  executor(context, root, args, gqlContext, info) {
    const action = new context.Action({context});
    return action.exec(args);
  }
  
  /**
   *
   * @param remoteGraphQLUri
   * @returns {Promise<void>}
   */
  
  async buildRemoteSchema({link, fetcher, remoteGraphQLUri, }) {
    if(!link && !fetcher) {
      if(typeof remoteGraphQLUri !== 'string') {
        throw new Error('option remoteGraphQLUri is required.');
      }
      link = new HttpLink({uri: remoteGraphQLUri, fetch});
    }
    
    return await makeRemoteExecutableSchema({
      schema: await introspectSchema(link || fetcher),
      link,
      fetcher
    });
  }
  
  
  async buildSchema(expressInstance) {
    let logger = expressInstance.logger.get('GraphQL', { method: 'buildSchema'} );
    let loggerPrefix = `GraphQL${this.options.id ? ' "' + this.options.id + '"' : ''}:`;
    let schemas = [];
    let remoteSchemaPromises= [];
    
    this.options.extensions.forEach(extension => {
      let {typeDefs, resolvers} = extension;
      schemas.push(
        makeExecutableSchema({typeDefs, resolvers})
      );
    });
    
    this.options.controllers.forEach(Controller => {
      
      if(Controller.meta.graphql.isRemote) {
        remoteSchemaPromises.push(
          this.buildRemoteSchema({...this.options.remoteSchemaOptions, ...Controller.meta.graphql})
        );
        return;
      }
      
      let typeDefs = Controller.meta.graphql.typeDefs;
      let resolvers = Controller.meta.graphql.resolvers || {};
      
      logger.info(`${loggerPrefix} Controller "${Controller.meta.id}" is applying...`);
      
      Controller.meta.actions.forEach(Action => {
        let actionResolvers = Action.meta.graphql.resolvers;
        let paths = Object.keys(actionResolvers);
        paths.forEach(path => {
          
          logger.info(` + resolver ${path} (${Controller.meta.id}/${Action.meta.id})`);
          
          //define resolverWrapper
          
          let resolverWrapper = (root, args, context, info) => {
            let actionContext = {
              Controller,
              Action,
              expressInstance,
              logger: expressInstance.logger,
              user: context.req.user,
              authInfo: context.req.authInfo,
              traceId: context.req.traceId,
              params: args,
              transportName: 'GraphQL',
              transport: this,
              graphql: {
                root,
                args,
                context,
                info
              },
              originalExecutor: this.executor.bind(this)
            };
            let resolverOptions = actionResolvers[path];
            if (resolverOptions.executor) {
              return resolverOptions.executor(actionContext, root, args, context, info)
            }
            return this.executor(actionContext, root, args, context, info);
          };
          
          //bind resolverWrapper to resolvers structure
          
          let resolverContainer = resolvers;
          let pathChunks = path.split('.');
          pathChunks.forEach((pathChunk, index) => {
            if (pathChunks.length === index + 1) {
              resolverContainer[pathChunk] = resolverWrapper;
            } else {
              resolverContainer = resolverContainer[pathChunk] || (resolverContainer[pathChunk] = {});
            }
          });
        });
      });
      
      schemas.push(
        makeExecutableSchema({typeDefs, resolvers})
      );
    });
    
    await Promise.all(remoteSchemaPromises).then(remoteSchemas => {
      remoteSchemas.forEach(schema => schemas.push(schema));
    });
    
    if (this.options.useMocks) {
      schemas.forEach(schema => addMockFunctionsToSchema({schema}));
    }
    
    return mergeSchemas({schemas});
  }
  
  async bind(expressInstance, {uri, middleware} = {}) {
    let schema;
    expressInstance.app.use(uri || this.options.endpoint, middleware || bodyParser.json(), graphqlExpress((req) => {
      let context = {req};
      createContextCache(context);
      return {
        schema,
        formatError: (error) => this.formatError(error, { req, gqlContext: context }),
        tracing: false,
        cacheControl: false,
        context
      }
    }));
    this.buildSchema(expressInstance).then(s => schema = s);
  }
  
  bindUI(expressInstance, {uri, uiUri} = {}) {
    let endpointURL = uri || this.options.endpoint;
    if (!uiUri) {
      uiUri = '/ui' + endpointURL;
    }
    expressInstance.app.use(uiUri, graphiqlExpress({endpointURL}));
  }
}


/**
 *
 * @param Controller
 * @param {object} options
 * @param {string} options.remoteGraphQLUri
 */

GraphQL.remote = (Controller, options) => {
  
  Controller.meta = {
    ...Controller.meta,
    graphql: {...remoteOptionsSugar(options), isRemote: true}
  };
};

function remoteOptionsSugar(options) {
  if(typeof options === 'string') {
    return {
      remoteGraphQLUri: options
    }
  }
  return options;
}

/**
 *
 * @param Controller
 * @param {object} options
 * @param {string} options.typeDefs
 * @param {string} options.resolvers
 */

GraphQL.controller = (Controller, options, resolvers) => {
  
  Controller.meta = {
    ...Controller.meta,
    graphql: controllerOptionsSugar(options, resolvers)
  };
};

function controllerOptionsSugar(options, resolvers) {
  if(typeof options === 'string') {
    let filename = null;
    if(options.indexOf('/') === 0) {
      filename = options;
    } else if(options.indexOf('file://') === '0') {
      filename = options.substr(7);
    }
    if(filename) {
      return {
        typeDefs: require('fs').readFileSync(filename).toString(),
        resolvers
      }
    } else {
      return {
        typeDefs: options,
        resolvers
      }
    }
  }
  return options;
}

/**
 *
 * @param Action
 * @param {object} options
 * @param {object} options.resolvers  {<resolver path>: (root, args, context, info) => {} }
 */

GraphQL.action = (Action, options) => {
  Action.meta = {
    ...Action.meta,
    graphql: actionOptionsSugar(options)
  };
};

function actionOptionsSugar(options) {
  if(typeof options === 'string') {
    return {
      resolvers: {
        [options]: true
      }
    }
  }
  if(Array.isArray(options)) {
    let resolvers = {};
    options.forEach(path => {
      resolvers[path] = true;
    });
    return { resolvers };
  }
  return options;
}

module.exports = {GraphQL};
