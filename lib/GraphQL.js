const {makeExecutableSchema, mergeSchemas, addMockFunctionsToSchema} = require('graphql-tools');
const {graphqlExpress, graphiqlExpress} = require('apollo-server-express');
const bodyParser = require('body-parser');
const {cacheKey, createContextCache} = require('../utils/cache');
const {schemaExtends} = require('../utils/schemaExtends');


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
      ...options
    }
  }
  
  executor(context, root, args, gqlContext, info) {
    const action = new context.Action({context});
    return action.validateParams(args, context)
      .then(params => action.exec(params, context));
  }
  
  buildSchema(expressInstance) {
    let schemas = [];
    this.options.controllers.forEach(controller => {
      //if (controller.meta.graphql.endpoint !== this.options.endpoint) return;
      let typeDefs = controller.meta.graphql.typeDefs + schemaExtends.typeDefs;
      let resolvers = {
        ...schemaExtends.resolvers
      };
      
      controller.meta.actions.forEach(Action => {
        let actionResolvers = Action.meta.graphql.resolvers;
        let paths = Object.keys(actionResolvers);
        paths.forEach(path => {
          
          //define resolverWrapper
          
          let resolverWrapper = (root, args, context, info) => {
            let actionContext = {
              Controller: controller,
              Action,
              expressInstance,
              logger: expressInstance.logger,
              user: context.req.user,
              traceId: context.req.traceId,
              params: args,
              graphql: {
                root,
                args,
                context,
                info
              }
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
    
    if (this.options.useMocks) {
      schemas.forEach(schema => addMockFunctionsToSchema({schema}));
    }
    
    return mergeSchemas({schemas});
  }
  
  bind(expressInstance, {uri} = {}) {
    let schema = this.buildSchema(expressInstance);
    expressInstance.app.use(uri || this.options.endpoint, bodyParser.json(), graphqlExpress((req) => {
      let context = {req};
      createContextCache(context);
      return {
        schema,
        formatError,
        tracing: false,
        cacheControl: false,
        context
      }
    }));
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
 * @param {string} options.typeDefs
 */

GraphQL.controller = (Controller, options) => {
  
  Controller.meta = {
    ...Controller.meta,
    graphql: options
  };
};

/**
 *
 * @param Action
 * @param {object} options
 * @param {object} options.resolvers  {<resolver path>: (root, args, context, info) => {} }
 */

GraphQL.action = (Action, options) => {
  Action.meta = {
    ...Action.meta,
    graphql: options
  };
};

module.exports = {GraphQL};
