const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { after, test } = require("node:test");

const root = path.resolve(__dirname, "..");
const servicePath = path.join(root, "server/src/services/paymentService.js");
const routePath = path.join(root, "server/src/routes/paymentHistoryRoutes.js");
const controllerPath = path.join(root, "server/src/controllers/paymentController.js");
const originalLoad = Module._load;

function loadPaymentService(repository) {
  Module._load = function(request, parent, isMain) {
    if (request === "../repositories/paymentRepository" && parent.filename === servicePath) {
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

test("payment history passes validated method and date filters to the repository", async () => {
  const calls = [];
  const service = loadPaymentService({
    async getAllPayments(filters) {
      calls.push(filters);
      return [{ id: "19", sale_id: "8", direction: "received" }];
    },
  });

  const result = await service.getAllPayments({
    method: "card",
    from: "2026-11-01",
    to: "2026-11-05",
  });

  assert.deepEqual(result, [{ id: "19", sale_id: "8", direction: "received" }]);
  assert.deepEqual(calls, [{
    method: "card",
    from: "2026-11-01",
    to: "2026-11-05",
  }]);
});

test("payment history rejects unsupported methods and invalid dates", async () => {
  const service = loadPaymentService({
    async getAllPayments() {
      throw new Error("The repository should not be called for invalid filters.");
    },
  });

  await assert.rejects(service.getAllPayments({ method: "cheque" }), { statusCode: 400 });
  await assert.rejects(service.getAllPayments({ from: "2026-13-01" }), { statusCode: 400 });
  await assert.rejects(service.getAllPayments({ from: "2026-02-29" }), { statusCode: 400 });
  await assert.rejects(
    service.getAllPayments({ from: "2026-11-06", to: "2026-11-05" }),
    { statusCode: 400 }
  );
});

test("GET /api/payments returns payment history from the service", async (t) => {
  const express = require("express");
  const paymentRows = [{
    id: "19",
    sale_id: "8",
    customer_name: "Customer",
    amount: "20.00",
    method: "cash",
    direction: "received",
    recorded_by: "owner",
  }];
  const serviceStub = {
    async getAll(req, res) {
      const filters = req.query;
      assert.equal(filters.method, "cash");
      assert.equal(filters.from, "2026-11-01");
      assert.equal(filters.to, undefined);
      res.status(200).json({ status: "success", data: paymentRows });
    },
  };

  Module._load = function(request, parent, isMain) {
    if (request === "../controllers/paymentController" && parent.filename === routePath) {
      return serviceStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[routePath];
  delete require.cache[controllerPath];
  let paymentHistoryRoutes;
  try {
    paymentHistoryRoutes = require(routePath);
  } finally {
    Module._load = originalLoad;
  }

  const app = express();
  app.use("/api/payments", paymentHistoryRoutes);
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/payments?method=cash&from=2026-11-01`
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "success", data: paymentRows });
});

after(() => {
  Module._load = originalLoad;
  delete require.cache[servicePath];
  delete require.cache[routePath];
  delete require.cache[controllerPath];
});
