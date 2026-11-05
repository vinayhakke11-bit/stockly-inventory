const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const { test } = require("node:test");
const path = require("node:path");
const argon2 = require("argon2");
const express = require("express");
const session = require("express-session");
const errorHandler = require("../server/src/middleware/errorHandler");

const root = path.resolve(__dirname, "..");
const authServicePath = path.join(root, "server/src/services/authService.js");
const authControllerPath = path.join(root, "server/src/controllers/authController.js");
const repository = {
  async findByIdentifier() {
    return [];
  },
  async findActiveById() {
    return null;
  },
  async createInitialOwner(user) {
    return { id: "1", username: user.username, email: user.email };
  },
};
const originalLoad = Module._load;

process.env.SESSION_SECRET = "unit-test-session-secret-with-more-than-32-characters";
Module._load = function(request, parent, isMain) {
  if (request === "../repositories/authRepository" && parent.filename === authServicePath) {
    return repository;
  }
  if (request === "../config/session" && parent.filename === authControllerPath) {
    return {
      sessionCookieName: "stockly.sid",
      sessionCookieOptions: {
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { csrfProtection } = require("../server/src/middleware/csrfProtection");
const requireAuth = require("../server/src/middleware/requireAuth");
const requireRole = require("../server/src/middleware/requireRole");
const createAuthRouter = require("../server/src/routes/authRoutes");
const { createLoginRateLimiter } = require("../server/src/middleware/loginRateLimiter");
Module._load = originalLoad;
const authService = require("../server/src/services/authService");

const testUser = {
  id: "7",
  username: "shop-owner",
  email: "owner@example.test",
  password_hash: "",
  is_active: true,
  role: "owner",
};

async function setValidPassword() {
  testUser.password_hash = await argon2.hash("correct-horse-battery-staple", {
    type: argon2.argon2id,
  });
}

function startServer(t, { maxLoginAttempts = 5, windowMs = 60000 } = {}) {
  const app = express();
  const attempts = new Map();
  const loginRateLimiter = createLoginRateLimiter({
    store: {
      async consume(key, _windowMs, maxAttempts) {
        const attemptCount = (attempts.get(key) || 0) + 1;
        attempts.set(key, attemptCount);
        return attemptCount <= maxAttempts;
      },
    },
    maxAttempts: maxLoginAttempts,
    windowMs,
    keySecret: process.env.SESSION_SECRET,
  });
  app.use(express.json());
  app.use(session({
    name: "stockly.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 60_000 },
  }));
  app.use(csrfProtection);
  app.use("/api/auth", createAuthRouter(loginRateLimiter));
  app.get(
    "/api/protected",
    requireAuth,
    requireRole("owner"),
    (req, res) => res.status(200).json({ userId: req.user.id })
  );
  app.get(
    "/api/manager-only",
    requireAuth,
    requireRole("manager"),
    (req, res) => res.status(200).json({ userId: req.user.id })
  );
  app.use(errorHandler);

  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return new Promise((resolve) => {
    server.once("listening", () => {
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

async function requestCsrfToken(baseUrl, cookie = "") {
  const response = await fetch(`${baseUrl}/api/auth/csrf-token`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const payload = await response.json();
  return {
    token: payload.data.csrfToken,
    cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie,
  };
}

async function login(baseUrl, identifier = { username: testUser.username }, password = "correct-horse-battery-staple") {
  const csrf = await requestCsrfToken(baseUrl);
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf.token,
      Cookie: csrf.cookie,
    },
    body: JSON.stringify({ ...identifier, password }),
  });
  return {
    response,
    payload: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0] || csrf.cookie,
    preLoginCookie: csrf.cookie,
  };
}

async function prepareUser({ active = true, role = "owner" } = {}) {
  await setValidPassword();
  testUser.is_active = active;
  testUser.role = role;
  repository.findByIdentifier = async (identifier) =>
    [testUser].filter((user) =>
      user.username === identifier || user.email.toLowerCase() === identifier.toLowerCase()
    );
  repository.findActiveById = async (id) =>
    String(id) === testUser.id && testUser.is_active
      ? {
          id: testUser.id,
          username: testUser.username,
          email: testUser.email,
          role: testUser.role,
        }
      : null;
}

test("logs in with a username or email and returns only safe user fields", async (t) => {
  await prepareUser();
  const { baseUrl } = await startServer(t);

  for (const identifier of [
    { username: testUser.username },
    { email: testUser.email },
  ]) {
    const result = await login(baseUrl, identifier);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.payload.data.user, {
      id: testUser.id,
      username: testUser.username,
      email: testUser.email,
      role: "owner",
    });
    assert.equal(JSON.stringify(result.payload).includes("password_hash"), false);
    assert.ok(result.cookie.startsWith("stockly.sid="));
    assert.notEqual(result.cookie, result.preLoginCookie);
  }
});

test("hashes the bootstrap owner's password using Argon2id", async () => {
  let insertedUser;
  repository.createInitialOwner = async (user) => {
    insertedUser = user;
    return { id: "8", username: user.username, email: user.email };
  };

  await authService.createInitialOwner({
    username: "new-owner",
    email: "new-owner@example.test",
    password: "a-strong-local-password",
  });

  assert.match(insertedUser.passwordHash, /^\$argon2id\$/);
  assert.equal(insertedUser.passwordHash.includes("a-strong-local-password"), false);
  assert.equal(
    await argon2.verify(insertedUser.passwordHash, "a-strong-local-password"),
    true
  );
});

test("uses one generic authentication failure for unknown users, bad passwords, and inactive users", async (t) => {
  await prepareUser();
  const { baseUrl } = await startServer(t);

  const badPassword = await login(baseUrl, { username: testUser.username }, "wrong-password");
  assert.equal(badPassword.response.status, 401);
  assert.equal(badPassword.payload.message, "Invalid username/email or password.");

  const unknownUser = await login(baseUrl, { email: "missing@example.test" });
  assert.equal(unknownUser.response.status, 401);
  assert.equal(unknownUser.payload.message, badPassword.payload.message);

  const unknownUsername = await login(baseUrl, { username: "missing-user" });
  assert.equal(unknownUsername.response.status, 401);
  assert.equal(unknownUsername.payload.message, badPassword.payload.message);

  await prepareUser({ active: false });
  const inactive = await login(baseUrl);
  assert.equal(inactive.response.status, 401);
  assert.equal(inactive.payload.message, badPassword.payload.message);
});

test("limits repeated failed login attempts with a deterministic threshold", async (t) => {
  await prepareUser();
  const { baseUrl } = await startServer(t, { maxLoginAttempts: 2 });

  const firstFailure = await login(baseUrl, { username: testUser.username }, "wrong-password");
  const secondFailure = await login(baseUrl, { username: "missing-user" }, "wrong-password");
  const limitedAttempt = await login(baseUrl, { username: testUser.username }, "wrong-password");

  assert.equal(firstFailure.response.status, 401);
  assert.equal(secondFailure.response.status, 401);
  assert.equal(limitedAttempt.response.status, 429);
  assert.equal(
    limitedAttempt.payload.message,
    "Too many login attempts. Please try again later."
  );
  assert.equal(JSON.stringify(limitedAttempt.payload).includes(testUser.username), false);
});

test("successful login remains available after a failed attempt below the limit", async (t) => {
  await prepareUser();
  const { baseUrl } = await startServer(t, { maxLoginAttempts: 2 });

  const failed = await login(baseUrl, { username: testUser.username }, "wrong-password");
  const successful = await login(baseUrl);

  assert.equal(failed.response.status, 401);
  assert.equal(successful.response.status, 200);
  assert.equal(successful.payload.data.user.id, testUser.id);
});

test("returns 401 for unauthenticated current-user and protected API requests", async (t) => {
  const { baseUrl } = await startServer(t);
  assert.equal((await fetch(`${baseUrl}/api/auth/me`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/protected`)).status, 401);
});

test("keeps the authenticated session valid across requests and logout invalidates it", async (t) => {
  await prepareUser();
  const { baseUrl } = await startServer(t);
  const result = await login(baseUrl);
  assert.notEqual(result.cookie, result.preLoginCookie);
  assert.equal(
    (await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: result.preLoginCookie },
    })).status,
    401
  );

  const currentUserResponse = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: result.cookie },
  });
  assert.equal(currentUserResponse.status, 200);
  assert.deepEqual((await currentUserResponse.json()).data.user, {
    id: testUser.id,
    username: testUser.username,
    email: testUser.email,
    role: "owner",
  });

  const protectedResponse = await fetch(`${baseUrl}/api/protected`, {
    headers: { Cookie: result.cookie },
  });
  assert.equal(protectedResponse.status, 200);
  assert.deepEqual(await protectedResponse.json(), { userId: testUser.id });

  const csrf = await requestCsrfToken(baseUrl, result.cookie);
  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: result.cookie, "X-CSRF-Token": csrf.token },
  });
  assert.equal(logoutResponse.status, 200);
  assert.equal((await logoutResponse.json()).message, "Logged out successfully.");
  assert.equal(
    (await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: result.cookie },
    })).status,
    401
  );
});

test("rejects state-changing requests without a valid session CSRF token", async (t) => {
  await prepareUser();
  const { baseUrl } = await startServer(t);
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: testUser.username,
      password: "correct-horse-battery-staple",
    }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).message, "CSRF token is missing or invalid.");
});

test("returns 403 when an authenticated user lacks the required role", async (t) => {
  await prepareUser({ role: "cashier" });
  const { baseUrl } = await startServer(t);
  const result = await login(baseUrl);
  const response = await fetch(`${baseUrl}/api/protected`, {
    headers: { Cookie: result.cookie },
  });
  assert.equal(response.status, 403);
});

test("protects business APIs after public health and authentication routes", () => {
  const appSource = fs.readFileSync(path.join(root, "server/src/app.js"), "utf8");
  assert.match(
    appSource,
    /app\.use\(["']\/api\/health["'],\s*healthRoutes\);[\s\S]*app\.use\(["']\/api\/auth["'],\s*createAuthRouter\(\)\);[\s\S]*app\.use\(["']\/api["'],\s*requireAuth,\s*requireRole\("owner"\)\)/
  );
});

test("transaction controllers pass the authenticated user ID as the actor", async () => {
  const calls = [];
  const controllerModules = [
    {
      file: "purchaseController.js",
      request: "../services/purchaseService",
      methods: { createPurchase: async (...args) => { calls.push(["purchase", ...args]); return {}; } },
      action: (controller) => controller.create(
        { body: { supplier_id: "1", items: [] }, user: { id: "7" } },
        { status() { return this; }, json() {} }
      ),
    },
    {
      file: "saleController.js",
      request: "../services/saleService",
      methods: { createSale: async (...args) => { calls.push(["sale", ...args]); return {}; } },
      action: (controller) => controller.create(
        { body: { items: [] }, user: { id: "7" } },
        { status() { return this; }, json() {} }
      ),
    },
    {
      file: "paymentController.js",
      request: "../services/paymentService",
      methods: { createPayment: async (...args) => { calls.push(["payment", ...args]); return { payment: {} }; } },
      action: (controller) => controller.create(
        { params: { saleId: "2" }, body: { amount: "1.00" }, user: { id: "7" } },
        { status() { return this; }, json() {} }
      ),
    },
    {
      file: "returnController.js",
      request: "../services/returnService",
      methods: {
        createReturn: async (...args) => { calls.push(["return", ...args]); return {}; },
        createRefund: async (...args) => { calls.push(["refund", ...args]); return { payment: {} }; },
      },
      actions: (controller) => Promise.all([
        controller.create(
          { params: { saleId: "2" }, body: { items: [] }, user: { id: "7" } },
          { status() { return this; }, json() {} }
        ),
        controller.refund(
          { params: { returnId: "3" }, body: { amount: "1.00" }, user: { id: "7" } },
          { status() { return this; }, json() {} }
        ),
      ]),
    },
  ];

  for (const item of controllerModules) {
    const controllerPath = path.join(root, "server/src/controllers", item.file);
    Module._load = function(request, parent, isMain) {
      if (request === item.request && parent.filename === controllerPath) return item.methods;
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[controllerPath];
    const controller = require(controllerPath);
    Module._load = originalLoad;
    if (item.actions) await item.actions(controller);
    else await item.action(controller);
  }

  assert.deepEqual(calls.map(([type, ...args]) => [type, args.at(-1)]), [
    ["purchase", "7"],
    ["sale", "7"],
    ["payment", "7"],
    ["return", "7"],
    ["refund", "7"],
  ]);
});

test("purchase and sale services reject client-supplied created_by", async () => {
  const services = [
    {
      name: "purchaseService",
      repositoryName: "../repositories/purchaseRepository",
      method: "createPurchase",
      repositoryMethod: "createPurchase",
      input: {
        supplier_id: "1",
        items: [{ product_id: "2", quantity: "1", unit_cost: "2.00" }],
      },
      spoofedInput: {
        supplier_id: "1",
        items: [],
        created_by: "8",
      },
    },
    {
      name: "saleService",
      repositoryName: "../repositories/saleRepository",
      method: "createSale",
      repositoryMethod: "createSale",
      input: {
        items: [{ product_id: "2", quantity: "1", unit_price: "2.00" }],
      },
      spoofedInput: { items: [], created_by: "8" },
    },
  ];

  for (const item of services) {
    const servicePath = path.join(root, "server/src/services", `${item.name}.js`);
    const repositoryStub = {
      async [item.repositoryMethod](input) {
        return input;
      },
    };
    Module._load = function(request, parent, isMain) {
      if (request === item.repositoryName && parent.filename === servicePath) {
        return repositoryStub;
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    delete require.cache[servicePath];
    const service = require(servicePath);
    Module._load = originalLoad;

    const result = await service[item.method](item.input, "7");
    assert.equal(result.created_by, "7");

    await assert.rejects(service[item.method](item.spoofedInput, "7"), {
      statusCode: 400,
      message: "created_by is assigned by the server and must not be provided.",
    });
  }
});
