require("dotenv").config();

const session = require("express-session");
const connectPgSimple = require("connect-pg-simple");
const pool = require("./database");

const sessionSecret = process.env.SESSION_SECRET;
if (typeof sessionSecret !== "string" || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
}

const sessionMaxAge = Number(process.env.SESSION_MAX_AGE_MS || 28800000);
if (!Number.isSafeInteger(sessionMaxAge) || sessionMaxAge <= 0) {
  throw new Error("SESSION_MAX_AGE_MS must be a positive integer.");
}

const isProduction = process.env.NODE_ENV === "production";
const sessionCookieName = "stockly.sid";
const sessionCookieOptions = {
  path: "/",
  httpOnly: true,
  secure: isProduction || process.env.SESSION_COOKIE_SECURE === "true",
  sameSite: "lax",
  maxAge: sessionMaxAge,
};
const PgSessionStore = connectPgSimple(session);
const store = new PgSessionStore({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: false,
});

const sessionMiddleware = session({
  name: sessionCookieName,
  secret: sessionSecret,
  store,
  resave: false,
  saveUninitialized: false,
  cookie: sessionCookieOptions,
});

module.exports = {
  sessionMiddleware,
  sessionCookieName,
  sessionCookieOptions,
};
