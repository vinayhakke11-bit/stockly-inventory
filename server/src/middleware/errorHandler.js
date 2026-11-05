function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode =
    Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : Number.isInteger(error.status) && error.status >= 400 && error.status < 600
        ? error.status
        : 500;

  if (statusCode >= 500) {
    console.error(error);
  }

  res.status(statusCode).json({
    status: "error",
    message: statusCode >= 500 ? "Internal server error" : error.message,
  });
}

module.exports = errorHandler;
