const crypto = require("node:crypto");

function getCsrfToken(req, res) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString("hex");
  }

  res.set("Cache-Control", "no-store");
  res.status(200).json({
    status: "success",
    data: { csrfToken: req.session.csrfToken },
  });
}

function csrfProtection(req, res, next) {
  if (!req.path.startsWith("/api/") && req.path !== "/api") {
    return next();
  }

  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  const sessionToken = req.session && req.session.csrfToken;
  const requestToken = req.get("X-CSRF-Token");

  if (
    typeof sessionToken !== "string" ||
    typeof requestToken !== "string" ||
    !/^[a-f0-9]{64}$/i.test(sessionToken) ||
    !/^[a-f0-9]{64}$/i.test(requestToken) ||
    !crypto.timingSafeEqual(
      Buffer.from(sessionToken, "hex"),
      Buffer.from(requestToken, "hex")
    )
  ) {
    const error = new Error("CSRF token is missing or invalid.");
    error.statusCode = 403;
    return next(error);
  }

  return next();
}

module.exports = { csrfProtection, getCsrfToken };
