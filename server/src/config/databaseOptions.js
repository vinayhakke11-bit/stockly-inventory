const { X509Certificate } = require("node:crypto");

function parseDatabaseSsl(env) {
  const setting = env.DATABASE_SSL;
  if (env.NODE_ENV === "production" && setting !== "true") {
    throw new Error("DATABASE_SSL=true is required in production.");
  }
  if (setting && setting !== "true" && setting !== "false") {
    throw new Error("DATABASE_SSL must be set to true or false.");
  }

  const caSetting = env.DATABASE_SSL_CA;
  if (caSetting && setting !== "true") {
    throw new Error("DATABASE_SSL_CA can only be used when DATABASE_SSL=true.");
  }
  if (setting !== "true") {
    return false;
  }

  const ssl = { rejectUnauthorized: true };
  if (!caSetting) {
    return ssl;
  }

  const ca = caSetting.replace(/\\n/g, "\n");
  const certificates = ca.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g
  );
  if (!certificates || certificates.join("").replace(/\s/g, "") !== ca.replace(/\s/g, "")) {
    throw new Error("DATABASE_SSL_CA must contain one or more PEM certificates.");
  }

  try {
    for (const certificate of certificates) {
      new X509Certificate(certificate);
    }
  } catch {
    throw new Error("DATABASE_SSL_CA contains an invalid PEM certificate.");
  }

  ssl.ca = ca;
  return ssl;
}

function createDatabaseOptions(env = process.env) {
  return {
    connectionString: env.DATABASE_URL,
    ssl: parseDatabaseSsl(env),
  };
}

module.exports = { createDatabaseOptions, parseDatabaseSsl };
