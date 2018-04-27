

function formatError(error) {
  /*if (error.originalError) {
    let parsedError;
    if (error.originalError instanceof ParsedError) {
      parsedError = error.originalError;
    } else {
      parsedError = new ParsedError(error.originalError)
    }
    
    return {
      ...error.extensions,
      ...parsedError.toJSON(),
      locations: error.locations,
      path: error.path,
    }
  }*/
  
  return {
    ...error.extensions,
    message: error.message || 'An unknown error occurred.',
    locations: error.locations,
    path: error.path,
  };
}
