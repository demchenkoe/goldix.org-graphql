
const crypto = require('crypto');


/**
 * Вычисляет ключ для кэша на основе объекта с параметрами
 * @param {object}  params              объект с параметрами
 * @param {array}   usedFieldsOfParams  массив параметров, коорые используются для вычисления ключа
 * @returns {string}  MD5 вычисленый на основе параметров
 */

function cacheKey(params, usedFieldsOfParams) {
  let data = '';
  let allFieldNames = Object.keys(params)
    .filter(paramName => Array.isArray(usedFieldsOfParams) && usedFieldsOfParams.indexOf(paramName) !== -1)
    .sort();
  
  allFieldNames.forEach(fieldName => {
    let value = params[fieldName];
    //По идее во вложенных объектах тоже нужно сортировать поля, но пренебрежем этим.
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      value = JSON.stringify(value);
    }
    data += fieldName + ':' + value
  });
  return crypto.createHash('md5').update(data).digest("hex");
}

function createContextCache(context) {
  
  
  context.cacheKey = cacheKey;
  
  /**
   * Вернет Promise для ключа.
   * Если в кэше нет значения для ключа, будет вызван handlerIfNotExists.
   * @param key
   * @param handlerIfNotExists
   * @returns {*}
   */
  
  context.cache = (key, handlerIfNotExists) => {
    context.cacheValues || (context.cacheValues = {});
    if (context.cacheValues[key]) {
      return context.cacheValues[key];
    }
    return context.cacheValues[key] = handlerIfNotExists();
  };
  return context;
}


module.exports = {cacheKey, createContextCache};