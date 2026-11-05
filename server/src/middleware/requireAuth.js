const authService = require("../services/authService");

function sendUnauthorized(res) {
  return res.status(401).json({
    status: "error",
    message: "Authentication is required.",
  });
}

function requireAuth(req, res, next) {
  const userId = req.session && req.session.userId;
  if (!userId) {
    return sendUnauthorized(res);
  }

  authService
    .getActiveUser(userId)
    .then((user) => {
      if (!user) {
        return req.session.destroy((error) => {
          if (error) return next(error);
          return sendUnauthorized(res);
        });
      }

      req.user = user;
      return next();
    })
    .catch(next);
}

module.exports = requireAuth;
