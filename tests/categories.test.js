const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { after, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const servicePath = path.join(root, "server/src/services/categoryService.js");
const repositoryPath = path.join(root, "server/src/repositories/categoryRepository.js");
const routePath = path.join(root, "server/src/routes/categoryRoutes.js");
const controllerPath = path.join(root, "server/src/controllers/categoryController.js");
const originalLoad = Module._load;

function loadService(repository) {
  Module._load = function(request, parent, isMain) {
    if (request === "../repositories/categoryRepository" && parent.filename === servicePath) {
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

test("category service creates trimmed categories and rejects duplicate names", async () => {
  const calls = [];
  const repository = {
    async getCategoryByName(name) {
      calls.push(["find", name]);
      return name === "Groceries" ? { id: "2", name } : null;
    },
    async createCategory(category) {
      calls.push(["create", category]);
      return { id: "4", ...category };
    },
  };
  const service = loadService(repository);

  assert.deepEqual(await service.createCategory({
    name: "  Snacks ",
    description: "  Quick bites ",
  }), {
    id: "4",
    name: "Snacks",
    description: "Quick bites",
  });
  assert.deepEqual(calls, [
    ["find", "Snacks"],
    ["create", { name: "Snacks", description: "Quick bites" }],
  ]);
  await assert.rejects(service.createCategory({ name: "Groceries" }), {
    statusCode: 409,
    message: "A category with this name already exists.",
  });
  await assert.rejects(service.createCategory({ name: " " }), { statusCode: 400 });
  await assert.rejects(service.createCategory({ name: "x".repeat(101) }), { statusCode: 400 });
});

test("category service updates categories and prevents deletion while products use them", async () => {
  let deletionCalled = false;
  const repository = {
    async getCategoryById(id) {
      return id === "8" ? { id, name: "Old name", description: null } : null;
    },
    async getCategoryByName(name) {
      if (name === "Used name") return { id: "9", name };
      return null;
    },
    async updateCategory(id, category) {
      return { id, ...category };
    },
    async categoryHasProducts() {
      return true;
    },
    async deleteCategory() {
      deletionCalled = true;
      return { id: "8" };
    },
  };
  const service = loadService(repository);

  assert.deepEqual(await service.updateCategory("8", {
    name: "Renamed",
    description: "A category description",
  }), {
    id: "8",
    name: "Renamed",
    description: "A category description",
  });
  await assert.rejects(service.updateCategory("8", { name: "Used name" }), {
    statusCode: 409,
    message: "A category with this name already exists.",
  });
  await assert.rejects(service.deleteCategory("8"), {
    statusCode: 409,
    message: "Cannot delete a category that is used by products.",
  });
  assert.equal(deletionCalled, false);
});

test("category list query includes a count of products without changing category data", async () => {
  const calls = [];
  Module._load = function(request, parent, isMain) {
    if (request === "../config/database" && parent.filename === repositoryPath) {
      return {
        async query(sql) {
          calls.push(sql);
          return {
            rows: [{
              id: "4",
              name: "Snacks",
              description: null,
              product_count: "3",
            }],
          };
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

  assert.deepEqual(await repository.getAllCategories(), [{
    id: "4",
    name: "Snacks",
    description: null,
    product_count: "3",
  }]);
  assert.match(calls[0], /SELECT COUNT\(\*\) FROM products p WHERE p\.category_id = c\.id/);
});

test("category routes expose CRUD responses and remain owner-only", async (t) => {
  const express = require("express");
  const requireRole = require("../server/src/middleware/requireRole");
  const calls = [];
  const serviceStub = {
    async getAllCategories() {
      return [{ id: "4", name: "Snacks", product_count: "3" }];
    },
    async getCategoryById(id) {
      calls.push(["get", id]);
      return { id, name: "Snacks", description: null };
    },
    async createCategory(input) {
      calls.push(["create", input]);
      return { id: "4", ...input };
    },
    async updateCategory(id, input) {
      calls.push(["update", id, input]);
      return { id, ...input };
    },
    async deleteCategory(id) {
      calls.push(["delete", id]);
      return { id, name: "Snacks" };
    },
  };
  Module._load = function(request, parent, isMain) {
    if (request === "../services/categoryService" && parent.filename === controllerPath) {
      return serviceStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  delete require.cache[routePath];
  const routes = require(routePath);
  Module._load = originalLoad;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = req.get("x-test-role") ? { role: req.get("x-test-role") } : undefined;
    next();
  });
  app.use("/api/categories", requireRole("owner"), routes);
  app.use((error, req, res, next) => {
    res.status(error.statusCode || 500).json({ status: "error", message: error.message });
  });
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/categories`;

  const unauthenticated = await fetch(baseUrl);
  assert.equal(unauthenticated.status, 401);
  const forbidden = await fetch(baseUrl, { headers: { "x-test-role": "cashier" } });
  assert.equal(forbidden.status, 403);

  const headers = { "Content-Type": "application/json", "x-test-role": "owner" };
  const listResponse = await fetch(baseUrl, { headers });
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json()).data[0].product_count, "3");

  const createResponse = await fetch(baseUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Drinks" }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal((await createResponse.json()).data.name, "Drinks");

  const getResponse = await fetch(`${baseUrl}/4`, { headers });
  assert.equal(getResponse.status, 200);
  assert.equal((await getResponse.json()).data.id, "4");

  const updateResponse = await fetch(`${baseUrl}/4`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ name: "Cold drinks" }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).data.name, "Cold drinks");

  const deleteResponse = await fetch(`${baseUrl}/4`, {
    method: "DELETE",
    headers,
  });
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(calls, [
    ["create", { name: "Drinks" }],
    ["get", "4"],
    ["update", "4", { name: "Cold drinks" }],
    ["delete", "4"],
  ]);
});

after(() => {
  Module._load = originalLoad;
  delete require.cache[servicePath];
  delete require.cache[repositoryPath];
  delete require.cache[routePath];
  delete require.cache[controllerPath];
});
