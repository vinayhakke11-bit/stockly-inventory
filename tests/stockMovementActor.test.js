const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const originalLoad = Module._load;

function loadService(name, repositoryName, repositoryStub) {
  const servicePath = path.join(root, "server/src/services", `${name}.js`);
  Module._load = function(request, parent, isMain) {
    if (request === repositoryName && parent.filename === servicePath) {
      return repositoryStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[servicePath];
  const service = require(servicePath);
  Module._load = originalLoad;
  return service;
}

function loadController(name, serviceName, serviceStub) {
  const controllerPath = path.join(root, "server/src/controllers", `${name}.js`);
  Module._load = function(request, parent, isMain) {
    if (request === serviceName && parent.filename === controllerPath) {
      return serviceStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return controller;
}

function loadRepository(name, poolStub, dependencyStubs = {}) {
  const repositoryPath = path.join(root, "server/src/repositories", `${name}.js`);
  Module._load = function(request, parent, isMain) {
    if (parent.filename === repositoryPath && dependencyStubs[request]) {
      return dependencyStubs[request];
    }
    if (request === "../config/database" && parent.filename === repositoryPath) {
      return poolStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[repositoryPath];
  const repository = require(repositoryPath);
  Module._load = originalLoad;
  return repository;
}

function createCompletionPool(kind) {
  const state = {
    actorId: null,
    status: "draft",
    movements: [],
  };
  const creatorId = "7";
  const transactionId = kind === "purchase" ? "1" : "2";

  function runQuery(sql, values = []) {
    const query = sql.trim().replace(/\s+/g, " ");
    if (query === "BEGIN" || query === "COMMIT") return { rows: [] };
    if (query.startsWith("SELECT set_config('stockly.performed_by'")) {
      state.actorId = values[0];
      return { rows: [{ set_config: state.actorId }] };
    }
    if (kind === "purchase") {
      if (query === "SELECT id, status FROM purchases WHERE id = $1 FOR UPDATE") {
        return { rows: [{ id: transactionId, status: state.status }] };
      }
      if (query.startsWith("UPDATE purchases SET status = 'received'")) {
        state.status = "received";
        state.movements.push({ created_by: creatorId, performed_by: state.actorId });
        return { rows: [] };
      }
      if (query.startsWith("SELECT p.id, p.supplier_id, s.name AS supplier_name, p.created_by")) {
        return {
          rows: [{
            id: transactionId,
            created_by: creatorId,
            status: state.status,
          }],
        };
      }
      if (query.startsWith("SELECT pi.id, pi.product_id, p.sku, p.name AS product_name")) {
        return {
          rows: [{
            id: "3",
            product_id: "9",
            sku: "SKU-9",
            product_name: "Product",
            quantity: "1.000",
            unit_cost: "1.00",
          }],
        };
      }
    } else {
      if (query === "SELECT id, status, type, customer_id, created_by FROM sales WHERE id = $1 FOR UPDATE") {
        return {
          rows: [{
            id: transactionId,
            status: state.status,
            type: "sale",
            customer_id: null,
            created_by: creatorId,
          }],
        };
      }
      if (query.startsWith("SELECT product_id, quantity, unit_price FROM sale_items")) {
        return { rows: [{ product_id: "9", quantity: "1.000" }] };
      }
      if (query.startsWith("SELECT id, name, sku, is_active, stock_on_hand FROM products")) {
        return {
          rows: [{
            id: "9",
            name: "Product",
            is_active: true,
            stock_on_hand: "2.000",
          }],
        };
      }
      if (query.startsWith("UPDATE sales SET status = 'completed'")) {
        state.status = "completed";
        state.movements.push({ created_by: creatorId, performed_by: state.actorId });
        return { rows: [] };
      }
      if (query.startsWith("SELECT s.id, s.customer_id, c.name AS customer_name, s.created_by")) {
        return {
          rows: [{
            id: transactionId,
            created_by: creatorId,
            status: state.status,
            type: "sale",
          }],
        };
      }
      if (query.startsWith("SELECT si.id, si.product_id, p.sku")) {
        return {
          rows: [{
            id: "4",
            product_id: "9",
            sku: "SKU-9",
            product_name: "Product",
            quantity: "1.000",
            unit_price: "2.00",
            line_total: "2.00",
          }],
        };
      }
    }
    throw new Error(`Unexpected ${kind} repository SQL: ${query}`);
  }

  return {
    state,
    async connect() {
      return {
        query: runQuery,
        release() {},
      };
    },
  };
}

function response() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test("completion services pass the authenticated performer separately from the creator", async () => {
  const calls = [];
  const scenarios = [
    ["purchaseService", "../repositories/purchaseRepository", "receivePurchase", "receivePurchase", "1", "8"],
    ["saleService", "../repositories/saleRepository", "completeSale", "completeSale", "2", { id: "8", username: "user-b" }],
    ["returnService", "../repositories/returnRepository", "completeReturn", "completeReturn", "3", "8"],
  ];

  for (const [serviceName, repositoryName, method, serviceMethod, transactionId, actor] of scenarios) {
    const repositoryStub = {
      async [method](...args) {
        calls.push([method, ...args]);
        return {
          id: transactionId,
          created_by: "7",
          performed_by: method === "completeSale" ? args[1].performedBy : args[1],
        };
      },
    };
    const service = loadService(serviceName, repositoryName, repositoryStub);
    const result = await service[serviceMethod](transactionId, actor);

    assert.equal(result.created_by, "7");
    assert.equal(result.performed_by, "8");
    await assert.rejects(
      service[serviceMethod](transactionId),
      { statusCode: serviceMethod === "completeSale" ? 401 : 400 }
    );
  }

  assert.deepEqual(calls, [
    ["receivePurchase", "1", "8"],
    ["completeSale", "2", {
      performedBy: "8",
      cashierUsername: "user-b",
      initialPayment: null,
    }],
    ["completeReturn", "3", "8"],
  ]);
});

test("completion controllers use req.user.id and ignore a client-supplied actor", async () => {
  const scenarios = [
    ["purchaseController", "../services/purchaseService", "receivePurchase", "receive", "id"],
    ["saleController", "../services/saleService", "completeSale", "complete", "id"],
    ["returnController", "../services/returnService", "completeReturn", "complete", "returnId"],
  ];

  for (const [controllerName, serviceName, serviceMethod, actionName, idName] of scenarios) {
    let receivedArgs;
    const serviceStub = {
      async [serviceMethod](...args) {
        receivedArgs = args;
        return { id: args[0] };
      },
    };
    const controller = loadController(controllerName, serviceName, serviceStub);
    const res = response();
    await controller[actionName]({
      params: { [idName]: "15" },
      body: { performed_by: "99", created_by: "99" },
      user: { id: "8" },
    }, res);

    assert.deepEqual(
      receivedArgs,
      controllerName === "saleController"
        ? ["15", { id: "8" }, undefined]
        : ["15", "8"]
    );
    assert.equal(res.statusCode, 200);
  }
});

test("purchase receipt and sale completion preserve creator and record the authenticated performer", async () => {
  const purchasePool = createCompletionPool("purchase");
  const purchaseRepository = loadRepository("purchaseRepository", purchasePool);
  const purchase = await purchaseRepository.receivePurchase("1", "8");
  assert.equal(purchase.created_by, "7");
  assert.equal(purchase.status, "received");
  assert.deepEqual(purchasePool.state.movements, [{ created_by: "7", performed_by: "8" }]);

  const salePool = createCompletionPool("sale");
  const saleRepository = loadRepository("saleRepository", salePool, {
    "./paymentRepository": { async createPaymentInTransaction() {} },
    "./receiptRepository": { async createReceipt() {} },
  });
  const sale = await saleRepository.completeSale("2", {
    performedBy: "8",
    cashierUsername: "user-b",
    initialPayment: null,
  });
  assert.equal(sale.created_by, "7");
  assert.equal(sale.status, "completed");
  assert.deepEqual(salePool.state.movements, [{ created_by: "7", performed_by: "8" }]);
});

test("migration preserves transaction creator and requires performer for new movements", () => {
  const migration = fs.readFileSync(
    path.join(root, "database/migrations/018_stock_movement_performed_by.sql"),
    "utf8"
  );
  assert.match(migration, /ADD COLUMN performed_by BIGINT REFERENCES users\(id\) ON DELETE RESTRICT/i);
  assert.match(migration, /CHECK \(performed_by IS NOT NULL\) NOT VALID/i);
  assert.equal((migration.match(/current_setting\('stockly\.performed_by', true\)/g) || []).length, 2);
  assert.equal((migration.match(/NEW\.created_by, performer_id/g) || []).length, 3);
  assert.equal((migration.match(/created_by, performed_by/g) || []).length, 3);
});

test("all stock-changing repositories set performer context inside their transaction", () => {
  const repositories = [
    ["purchaseRepository.js", /async function receivePurchase\(id, performedBy\)[\s\S]*?setPerformedBy\(client, performedBy\)[\s\S]*?SET status = 'received'/],
    ["saleRepository.js", /async function completeSale\(id, \{[\s\S]*?setPerformedBy\(client, performedBy\)[\s\S]*?SET status = 'completed'/],
    ["returnRepository.js", /async function completeReturn\(returnId, performedBy\)[\s\S]*?setPerformedBy\(client, performedBy\)[\s\S]*?SET status = 'completed'/],
  ];
  for (const [name, pattern] of repositories) {
    const source = fs.readFileSync(
      path.join(root, "server/src/repositories", name),
      "utf8"
    );
    assert.match(source, pattern, name);
  }

  const helper = fs.readFileSync(
    path.join(root, "server/src/repositories/stockMovementRepository.js"),
    "utf8"
  );
  assert.match(helper, /set_config\('stockly\.performed_by', \$1, true\)/);
});
