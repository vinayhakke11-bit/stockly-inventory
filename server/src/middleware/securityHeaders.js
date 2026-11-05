const helmet = require("helmet");

function createSecurityHeaders({ isProduction = process.env.NODE_ENV === "production" } = {}) {
  const directives = {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    imgSrc: ["'self'", "data:"],
    objectSrc: ["'none'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
  };

  if (isProduction) {
    directives.upgradeInsecureRequests = [];
  }

  return helmet({
    contentSecurityPolicy: { directives },
    frameguard: { action: "deny" },
    hsts: isProduction
      ? { maxAge: 31536000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
}

module.exports = createSecurityHeaders;
