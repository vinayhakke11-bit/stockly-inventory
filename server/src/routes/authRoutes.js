const express = require("express");
const authController = require("../controllers/authController");
const requireAuth = require("../middleware/requireAuth");
const { getCsrfToken } = require("../middleware/csrfProtection");
const { defaultLoginRateLimiter } = require("../middleware/loginRateLimiter");

function createAuthRouter(loginRateLimiter = defaultLoginRateLimiter) {
  const router = express.Router();

  router.get("/csrf-token", getCsrfToken);
  router.post("/login", loginRateLimiter, authController.login);
  router.get("/me", requireAuth, authController.getCurrentUser);
  router.post("/logout", authController.logout);

  return router;
}

module.exports = createAuthRouter;
