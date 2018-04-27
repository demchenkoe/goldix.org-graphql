const GraphQLToolsTypes = require('graphql-tools-types');

const schemaExtends = {
  typeDefs: `
    scalar Json
    scalar Date`,
  resolvers: {
    Json: GraphQLToolsTypes.JSON({name: 'Json'}),
    Date: GraphQLToolsTypes.Date({name: 'Date'}),
  }
};


module.exports = {schemaExtends};