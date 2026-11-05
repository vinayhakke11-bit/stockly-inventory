const authService = require("../services/authService");
const { sessionCookieName, sessionCookieOptions } = require("../config/session");

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

async function login(req, res) {
  const body = req.body;
  const username = body && typeof body.username === "string" ? body.username.trim() : "";
  const email = body && typeof body.email === "string" ? body.email.trim() : "";

  if (username && email && username.toLowerCase() !== email.toLowerCase()) {
    return res.status(400).json({
      status: "error",
      message: "Provide either a username or an email address.",
    });
  }

  const identifier = username || email;
  const user = await authService.authenticate(
    identifier,
    body && body.password
  );

  if (!user) {
    return res.status(401).json({
      status: "error",
      message: "Invalid username/email or password.",
    });
  }

  await regenerateSession(req);
  req.session.userId = user.id;
  await saveSession(req);

  return res.status(200).json({
    status: "success",
    data: { user },
  });
}

function getCurrentUser(req, res) {
  return res.status(200).json({
    status: "success",
    data: { user: req.user },
  });
}

function logout(req, res, next) {
  const clearCookieOptions = {
    path: sessionCookieOptions.path,
    httpOnly: sessionCookieOptions.httpOnly,
    secure: sessionCookieOptions.secure,
    sameSite: sessionCookieOptions.sameSite,
  };

  if (!req.session) {
    res.clearCookie(sessionCookieName, clearCookieOptions);
    return res.status(200).json({
      status: "success",
      message: "Logged out successfully.",
    });
  }

  req.session.destroy((error) => {
    if (error) return next(error);

    res.clearCookie(sessionCookieName, clearCookieOptions);
    return res.status(200).json({
      status: "success",
      message: "Logged out successfully.",
    });
  });
}

module.exports = { login, getCurrentUser, logout };
