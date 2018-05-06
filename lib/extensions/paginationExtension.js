
function Deferred() {
  
  this.resolve = null;
  this.reject = null;
  this.promise = new Promise(function (resolve, reject) {
    this.resolve = resolve;
    this.reject = reject;
  }.bind(this));
  
  Object.freeze(this);
}

function pagination(context, key) {
  context.pagination || (context.pagination = {});
  if (context.pagination[key]) {
    return context.pagination[key];
  }
  return context.pagination[key] = new Deferred();
}


const paginationExtension = {
  typeDefs: `
    pagination(key: String): Pagination
    `,
  resolvers: {
    pagination: (root, args, context, info) => {
      if (!args.key) return null;
      return pagination(context, args.key).promise;
    },
  },
  Deferred,
  pagination,
};

module.exports = {paginationExtension};