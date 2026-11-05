const crypto = require("node:crypto");
const pool = require("../config/database");
const LoginRateLimitRepository = require("../repositories/loginRateLimitRepository");

function readPositiveInteger(value, defaultValue, variableName) {
  const parsed = value === undefined || value === "" ? defaultValue : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 2147483646) {
    throw new Error(`${variableName} must be a positive integer.`);
  }
  return parsed;
}

function createLoginRateLimiter({
  store,
  maxAttempts = readPositiveInteger(
    process.env.LOGIN_RATE_LIMIT_MAX,
    10,
    "LOGIN_RATE_LIMIT_MAX"
  ),
  windowMs = readPositiveInteger(
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
    900000,
    "LOGIN_RATE_LIMIT_WINDOW_MS"
  ),
  keySecret = process.env.SESSION_SECRET,
}) {
  if (!store || typeof store.consume !== "function") {
    throw new TypeError("A login rate-limit store is required.");
  }
  if (typeof keySecret !== "string" || keySecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to create login rate-limit keys.");
  }

  return function loginRateLimiter(req, res, next) {
    const address = req.ip || req.socket.remoteAddress || "unknown";
    const key = crypto
      .createHmac("sha256", keySecret)
      .update(address)
      .digest("hex");

    store.consume(key, windowMs, maxAttempts)
      .then((allowed) => {
        if (!allowed) {
          return res.status(429).json({
            status: "error",
            message: "Too many login attempts. Please try again later.",
          });
        }

        return next();
      })
      .catch(next);
  };
}

const defaultStore = new LoginRateLimitRepository(pool);

module.exports = {
  createLoginRateLimiter,
  defaultLoginRateLimiter: createLoginRateLimiter({ store: defaultStore }),
};
