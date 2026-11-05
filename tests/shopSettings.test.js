const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { after, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const servicePath = path.join(root, "server/src/services/shopSettingsService.js");
const repositoryPath = path.join(root, "server/src/repositories/shopSettingsRepository.js");
const routePath = path.join(root, "server/src/routes/shopSettingsRoutes.js");
const controllerPath = path.join(root, "server/src/controllers/shopSettingsController.js");
const originalLoad = Module._load;

function loadService(repository) {
  Module._load = function(request, parent, isMain) {
    if (request === "../repositories/shopSettingsRepository" && parent.filename === servicePath) {
      return repository;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  try {
    return require(servicePath);
  } finally {
    Module._load = originalLoad;
  }
}

test("shop settings service validates and saves only supported receipt fields", async () => {
  const calls = [];
  const service = loadService({
    async updateShopSettings(settings) {
      calls.push(settings);
      return settings;
    },
  });

  const settings = await service.updateShopSettings({
    name: "  Main Street Shop ",
    address: "  15 Market Road ",
    phone: " +91 98765 43210 ",
  });

  assert.deepEqual(settings, {
    name: "Main Street Shop",
    address: "15 Market Road",
    phone: "+91 98765 43210",
  });
  assert.deepEqual(calls, [settings]);
});

test("shop settings service rejects missing, invalid, oversized, and unsupported fields", async () => {
  const service = loadService({
    async updateShopSettings() {
      throw new Error("The repository should not be called for invalid settings.");
    },
  });

  await assert.rejects(service.updateShopSettings({ address: "No name" }), { statusCode: 400 });
  await assert.rejects(service.updateShopSettings({ name: " " }), { statusCode: 400 });
  await assert.rejects(service.updateShopSettings({ name: 7 }), { statusCode: 400 });
  await assert.rejects(service.updateShopSettings({ name: "Shop", email: "x@example.com" }), { statusCode: 400 });
  await assert.rejects(service.updateShopSettings({ name: "Shop", performed_by: 999 }), { statusCode: 400 });
  await assert.rejects(service.updateShopSettings({ name: "Shop", phone: "x".repeat(31) }), { statusCode: 400 });
  await assert.rejects(service.updateShopSettings({ name: "Shop", address: "x".repeat(2001) }), { statusCode: 400 });
  await assert.rejects(service.updateShopSettings(null), { statusCode: 400 });
});

test("shop settings repository upserts the shop JSON without replacing unrelated stored keys", async () => {
  const calls = [];
  const repositoryPath = path.join(root, "server/src/repositories/shopSettingsRepository.js");
  Module._load = function(request, parent, isMain) {
    if (request === "../config/database" && parent.filename === repositoryPath) {
      return {
        async query(...args) {
          calls.push(args);
          return { rows: [{ value: { ...JSON.parse(args[1][0]), legacy: "preserved" } }] };
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[repositoryPath];
  let repository;
  try {
    repository = require(repositoryPath);
  } finally {
    Module._load = originalLoad;
  }

  const result = await repository.updateShopSettings({
    name: "Stockly Shop",
    address: "1 Main Street",
    phone: "555-0100",
  });

  assert.deepEqual(result, {
    name: "Stockly Shop",
    address: "1 Main Street",
    phone: "555-0100",
  });
  assert.match(calls[0][0], /ON CONFLICT \(key\) DO UPDATE/);
  assert.match(calls[0][0], /shop_settings\.value \|\| EXCLUDED\.value/);
  assert.deepEqual(JSON.parse(calls[0][1][0]), {
    name: "Stockly Shop",
    address: "1 Main Street",
    phone: "555-0100",
  });
});

test("GET and PUT settings routes require the owner role", async (t) => {
  const express = require("express");
  const requireRole = require("../server/src/middleware/requireRole");
  const serviceStub = {
    async getShopSettings() {
      return { name: "Shop", address: "", phone: "" };
    },
    async updateShopSettings(settings) {
      return settings;
    },
  };
  Module._load = function(request, parent, isMain) {
    if (request === "../services/shopSettingsService" && parent.filename === controllerPath) {
      return serviceStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[routePath];
  delete require.cache[controllerPath];
  delete require.cache[servicePath];
  let settingsRoutes;
  try {
    settingsRoutes = require(routePath);
  } finally {
    Module._load = originalLoad;
  }

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = req.get("x-test-role") ? { role: req.get("x-test-role") } : undefined;
    next();
  });
  app.use("/api/settings/shop", requireRole("owner"), settingsRoutes);
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({ status: "error", message: error.message });
  });
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/settings/shop`;

  const unauthenticated = await fetch(baseUrl);
  assert.equal(unauthenticated.status, 401);
  const ownerRead = await fetch(baseUrl, { headers: { "x-test-role": "owner" } });
  assert.equal(ownerRead.status, 200);
  assert.deepEqual((await ownerRead.json()).data, { name: "Shop", address: "", phone: "" });
  const forbidden = await fetch(baseUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-test-role": "cashier" },
    body: JSON.stringify({ name: "Not allowed" }),
  });
  assert.equal(forbidden.status, 403);
  const ownerUpdate = await fetch(baseUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-test-role": "owner" },
    body: JSON.stringify({ name: "Owner shop" }),
  });
  assert.equal(ownerUpdate.status, 200);
  assert.deepEqual((await ownerUpdate.json()).data, { name: "Owner shop" });
});

after(() => {
  Module._load = originalLoad;
  delete require.cache[servicePath];
  delete require.cache[repositoryPath];
  delete require.cache[routePath];
  delete require.cache[controllerPath];
});
