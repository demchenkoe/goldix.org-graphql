
const {GraphQL} = require('./lib/GraphQL');
const {paginationExtension} = require('./lib/extensions/paginationExtension');
const {typesExtension} = require('./lib/extensions/typesExtension');

module.exports = {GraphQL, paginationExtension, typesExtension};