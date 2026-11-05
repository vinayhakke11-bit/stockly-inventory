const assert = require("node:assert/strict");
const express = require("express");
const { test } = require("node:test");
const { rootCertificates } = require("node:tls");
const createSecurityHeaders = require("../server/src/middleware/securityHeaders");
const { parseDatabaseSsl } = require("../server/src/config/databaseOptions");

async function startHeaderServer(t, isProduction) {
  const app = express();
  app.use(createSecurityHeaders({ isProduction }));
  app.get("/", (req, res) => res.status(200).send("ok"));

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("development HTTP responses include safe headers without HSTS", async (t) => {
  const baseUrl = await startHeaderServer(t, false);
  const response = await fetch(baseUrl);

  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(
    response.headers.get("referrer-policy"),
    "strict-origin-when-cross-origin"
  );
  assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal(response.headers.get("strict-transport-security"), null);
});

test("production responses include HSTS and production CSP upgrade policy", async (t) => {
  const baseUrl = await startHeaderServer(t, true);
  const response = await fetch(baseUrl);

  assert.equal(
    response.headers.get("strict-transport-security"),
    "max-age=31536000; includeSubDomains"
  );
  assert.match(
    response.headers.get("content-security-policy"),
    /upgrade-insecure-requests/
  );
});

test("database SSL is disabled for local non-SSL configuration", () => {
  assert.equal(parseDatabaseSsl({ DATABASE_SSL: "false" }), false);
});

test("database SSL verifies certificates using Node's trusted CA chain by default", () => {
  assert.deepEqual(
    parseDatabaseSsl({ NODE_ENV: "production", DATABASE_SSL: "true" }),
    { rejectUnauthorized: true }
  );
});

test("database SSL accepts an escaped PEM CA without disabling certificate checks", () => {
  const certificate = rootCertificates[0];
  assert.ok(certificate);
  assert.deepEqual(
    parseDatabaseSsl({
      DATABASE_SSL: "true",
      DATABASE_SSL_CA: certificate.replace(/\n/g, "\\n"),
    }),
    { rejectUnauthorized: true, ca: certificate }
  );
});

test("database SSL rejects a malformed configured CA", () => {
  assert.throws(
    () => parseDatabaseSsl({ DATABASE_SSL: "true", DATABASE_SSL_CA: "not a PEM certificate" }),
    /DATABASE_SSL_CA must contain one or more PEM certificates/
  );
});

test("database SSL rejects invalid settings and a CA configured without SSL", () => {
  assert.throws(
    () => parseDatabaseSsl({ DATABASE_SSL: "maybe" }),
    /DATABASE_SSL must be set to true or false/
  );
  assert.throws(
    () => parseDatabaseSsl({ DATABASE_SSL: "false", DATABASE_SSL_CA: "CA data" }),
    /DATABASE_SSL_CA can only be used/
  );
  assert.throws(
    () => parseDatabaseSsl({ NODE_ENV: "production", DATABASE_SSL: "false" }),
    /DATABASE_SSL=true is required in production/
  );
});
