
const GraphQLToolsTypes = require('graphql-tools-types');

const typesExtension = {
  typeDefs: `
    scalar Uuid
    scalar Json
    scalar Date
    `,
  resolvers: {
    Uuid: GraphQLToolsTypes.UUID({name: 'Uuid'}),
    Json: GraphQLToolsTypes.JSON({name: 'Json'}),
    Date: GraphQLToolsTypes.Date({name: 'Date'}),
  }
};


module.exports = {typesExtension, GraphQLToolsTypes};