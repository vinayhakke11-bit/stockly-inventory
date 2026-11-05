const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const Module = require("node:module");
const path = require("node:path");

const repositoryPath = path.resolve(__dirname, "../server/src/repositories/returnRepository.js");
const servicePath = path.resolve(__dirname, "../server/src/services/returnService.js");
const controllerPath = path.resolve(__dirname, "../server/src/controllers/returnController.js");
const originalLoad = Module._load;
let pool;
let service;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cents(value) {
  const [whole, fraction = ""] = String(value).split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  return sign * (
    BigInt(whole.replace(/^-/, "")) * 100n +
    BigInt(fraction.padEnd(2, "0").slice(0, 2))
  );
}

function createPool({
  saleStatus = "completed",
  customerId = "22",
  failLedger = false,
  failPayment = false,
  initialPayments = [{ id: "p0", sale_id: "1", direction: "received", amount: "30.00" }],
} = {}) {
  const state = {
    originalSale: {
      id: "1",
      customer_id: customerId,
      created_by: "7",
      type: "sale",
      status: saleStatus,
    },
    users: ["7"],
    originalItems: [{ product_id: "9", quantity: "5.000", unit_price: "10.00" }],
    returns: {},
    nextReturnId: 20,
    nextItemId: 50,
    payments: clone(initialPayments),
    nextPaymentId: 100,
    ledger: [],
    movements: [],
    movementActor: null,
    stock: 3,
    failLedger,
    failPayment,
    rollbackCount: 0,
    queries: [],
  };

  function runQuery(sql, values = []) {
    const query = sql.trim().replace(/\s+/g, " ");
    state.queries.push({ query, values });

    if (query.startsWith("SELECT set_config('stockly.performed_by'")) {
      state.movementActor = values[0];
      return { rows: [{ set_config: values[0] }] };
    }

    if (query.startsWith("SELECT id, customer_id, created_by, type, status FROM sales")) {
      return state.originalSale.id === values[0]
        ? { rows: [clone(state.originalSale)] }
        : { rows: [] };
    }
    if (query === "SELECT id FROM sales WHERE id = $1 AND type = 'sale'") {
      return state.originalSale.id === values[0] && state.originalSale.type === "sale"
        ? { rows: [{ id: values[0] }] }
        : { rows: [] };
    }
    if (query.startsWith("SELECT id, original_sale_id, customer_id, created_by, type, status FROM sales")) {
      const returnRecord = state.returns[values[0]];
      return { rows: returnRecord ? [clone(returnRecord)] : [] };
    }
    if (query === "SELECT id FROM users WHERE id = $1") {
      return { rows: state.users.includes(values[0]) ? [{ id: values[0] }] : [] };
    }
    if (query.startsWith("SELECT product_id, quantity, unit_price FROM sale_items")) {
      const saleId = values[0];
      if (saleId === state.originalSale.id) {
        return { rows: clone(state.originalItems) };
      }
      return { rows: clone(state.returns[saleId]?.items || []) };
    }
    if (query.startsWith("SELECT returned_item.product_id")) {
      const byProduct = new Map();
      for (const record of Object.values(state.returns)) {
        if (
          record.original_sale_id !== values[0] ||
          record.status !== "completed"
        ) continue;
        for (const item of record.items) {
          byProduct.set(
            item.product_id,
            (BigInt(byProduct.get(item.product_id) || "0") + thousandths(item.quantity)).toString()
          );
        }
      }
      return {
        rows: [...byProduct].map(([product_id, quantity]) => ({
          product_id,
          quantity: formatThousandths(BigInt(quantity)),
        })),
      };
    }
    if (query.startsWith("INSERT INTO sales (customer_id, created_by, type, original_sale_id, status)")) {
      const id = String(state.nextReturnId++);
      state.returns[id] = {
        id,
        customer_id: values[0],
        created_by: values[1],
        type: "return",
        original_sale_id: values[2],
        status: "draft",
        items: [],
      };
      return { rows: [{ id }] };
    }
    if (query.startsWith("INSERT INTO sale_items")) {
      const parent = state.returns[values[0]];
      parent.items.push({
        id: String(state.nextItemId++),
        product_id: values[1],
        quantity: values[2],
        unit_price: values[3],
      });
      return { rows: [] };
    }
    if (
      query.startsWith("SELECT r.id, r.original_sale_id, r.customer_id") &&
      query.includes("WHERE r.id = $1 AND r.type = 'return'")
    ) {
      const record = state.returns[values[0]];
      if (!record) return { rows: [] };
      const total = record.items.reduce(
        (sum, item) => sum + cents((thousandths(item.quantity) * cents(item.unit_price) / 1000n).toString()),
        0n
      );
      return {
        rows: [{
          id: record.id,
          original_sale_id: record.original_sale_id,
          customer_id: record.customer_id,
          customer_name: record.customer_id === null ? null : "Customer",
          created_by: record.created_by,
          status: record.status,
          total: `${total / 100n}.${String(total % 100n).padStart(2, "0")}`,
          items: undefined,
        }],
      };
    }
    if (
      query.startsWith("SELECT r.id, r.original_sale_id, r.customer_id") &&
      query.includes("WHERE r.original_sale_id = $1 AND r.type = 'return'")
    ) {
      return {
        rows: Object.values(state.returns)
          .filter((record) => record.original_sale_id === values[0])
          .map((record) => ({ id: record.id })),
      };
    }
    if (
      query.startsWith("SELECT r.id, r.original_sale_id, r.customer_id") &&
      query.includes("WHERE r.type = 'return'")
    ) {
      return { rows: Object.values(state.returns).map((record) => ({ id: record.id })) };
    }
    if (query.startsWith("SELECT si.id, si.product_id, p.sku")) {
      const record = state.returns[values[0]];
      return {
        rows: (record?.items || []).map((item) => ({
          ...item,
          sku: "SKU-9",
          product_name: "Product",
          line_total: "20.00",
        })),
      };
    }
    if (query.startsWith("SELECT COALESCE(SUM(round(quantity * unit_price, 2)), 0)::text AS total")) {
      const record = state.returns[values[0]];
      const total = (record?.items || []).reduce(
        (sum, item) => sum + thousandths(item.quantity) * cents(item.unit_price) / 1000n,
        0n
      );
      return {
        rows: [{
          total: `${total / 100n}.${String(total % 100n).padStart(2, "0")}`,
        }],
      };
    }
    if (query.startsWith("UPDATE sales SET status = 'completed'")) {
      const record = state.returns[values[0]];
      record.status = "completed";
      for (const item of record.items) {
        state.stock += Number(item.quantity);
        state.movements.push({
          created_by: record.created_by,
          performed_by: state.movementActor,
        });
      }
      return { rows: [] };
    }
    if (query.startsWith("INSERT INTO credit_transactions")) {
      if (state.failLedger) throw new Error("simulated credit ledger failure");
      state.ledger.push({
        customer_id: values[0],
        sale_id: query.includes("'return_credit'") ? values[1] : null,
        payment_id: query.includes("'refund'") ? values[1] : null,
        entry_type: query.includes("'return_credit'") ? "return_credit" : "refund",
        direction: query.includes("'return_credit'") ? "credit" : "debit",
        amount: values[2],
        created_by: values[3],
      });
      return { rows: [] };
    }
    if (query.startsWith("SELECT id, sale_id, return_id, created_by, amount, method, reference")) {
      const existing = state.payments.find(
        (payment) => payment.idempotency_key === values[6]
      );
      if (!existing) return { rows: [] };
      return {
        rows: [{
          ...existing,
          same_request:
            existing.sale_id === values[0] &&
            existing.return_id === values[1] &&
            existing.created_by === values[2] &&
            cents(existing.amount) === cents(values[3]) &&
            existing.method === values[4] &&
            existing.reference === values[5] &&
            existing.direction === "refunded",
        }],
      };
    }
    if (query.startsWith("WITH return_total AS")) {
      const record = state.returns[values[0]];
      const returnTotal = record.items.reduce((sum, item) => {
        const lineCents = thousandths(item.quantity) * cents(item.unit_price) / 1000n;
        return sum + lineCents;
      }, 0n);
      const returnRefunds = state.payments
        .filter((payment) => payment.return_id === values[0] && payment.direction === "refunded")
        .reduce((sum, payment) => sum + cents(payment.amount), 0n);
      const received = state.payments
        .filter((payment) => payment.sale_id === values[1] && payment.direction === "received")
        .reduce((sum, payment) => sum + cents(payment.amount), 0n);
      const refunded = state.payments
        .filter((payment) => payment.sale_id === values[1] && payment.direction === "refunded")
        .reduce((sum, payment) => sum + cents(payment.amount), 0n);
      const limit = [returnTotal - returnRefunds, received - refunded].reduce(
        (smallest, amount) => amount < smallest ? amount : smallest
      );
      const sign = limit < 0n ? "-" : "";
      const absolute = limit < 0n ? -limit : limit;
      return {
        rows: [{
          refundable: `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`,
        }],
      };
    }
    if (query.startsWith("INSERT INTO payments")) {
      if (state.failPayment) throw new Error("simulated payment insert failure");
      const payment = {
        id: String(state.nextPaymentId++),
        sale_id: values[0],
        return_id: values[1],
        created_by: values[2],
        direction: "refunded",
        amount: values[3],
        method: values[4],
        reference: values[5],
        idempotency_key: values[6],
      };
      state.payments.push(payment);
      return { rows: [{ ...payment }] };
    }
    if (query.startsWith("SELECT id, sale_id, return_id, created_by, direction, amount, method")) {
      return {
        rows: state.payments.filter(
          (payment) => payment.return_id === values[0] && payment.direction === "refunded"
        ),
      };
    }
    throw new Error(`Unexpected mock SQL: ${query}`);
  }

  return {
    state,
    async connect() {
      let snapshot;
      return {
        async query(sql, values) {
          const query = sql.trim();
          if (query === "BEGIN") {
            snapshot = clone({
              originalSale: state.originalSale,
              returns: state.returns,
              nextReturnId: state.nextReturnId,
              nextItemId: state.nextItemId,
              payments: state.payments,
              nextPaymentId: state.nextPaymentId,
              ledger: state.ledger,
              movements: state.movements,
              stock: state.stock,
            });
            return { rows: [] };
          }
          if (query === "COMMIT") return { rows: [] };
          if (query === "ROLLBACK") {
            Object.assign(state, snapshot);
            state.rollbackCount += 1;
            return { rows: [] };
          }
          return runQuery(sql, values);
        },
        release() {},
      };
    },
    async query(sql, values) {
      return runQuery(sql, values);
    },
  };
}

function thousandths(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}

function formatThousandths(value) {
  return `${value / 1000n}.${String(value % 1000n).padStart(3, "0")}`;
}

function loadService(database) {
  pool = database;
  Module._load = function(request, parent, isMain) {
    if (request === "../config/database" && parent.filename === repositoryPath) {
      return pool;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[repositoryPath];
  delete require.cache[servicePath];
  service = require(servicePath);
}

beforeEach(() => loadService(createPool()));

after(() => {
  Module._load = originalLoad;
  delete require.cache[repositoryPath];
  delete require.cache[servicePath];
});

async function createReturn(quantity = "2", overrides = {}) {
  return service.createReturn("1", {
    items: [{ product_id: "9", quantity, ...overrides }],
  }, "7");
}

async function createRefund(returnId, input) {
  return service.createRefund(returnId, input, "7");
}

async function completeReturn(quantity = "2") {
  const created = await createReturn(quantity);
  return service.completeReturn(created.id, "8");
}

test("creates a partial return at the original sale-item price", async () => {
  const result = await createReturn("2", { unit_price: "0.01" });
  assert.equal(result.status, "draft");
  assert.equal(result.items[0].quantity, "2");
  assert.equal(result.items[0].unit_price, "10.00");
  assert.equal(result.original_sale_id, "1");
  assert.equal(result.created_by, "7");
});

test("completes full eligible quantity, restores stock, and creates customer credit", async () => {
  const result = await completeReturn("5");
  assert.equal(result.status, "completed");
  assert.equal(pool.state.stock, 8);
  assert.equal(pool.state.ledger.length, 1);
  assert.equal(pool.state.ledger[0].entry_type, "return_credit");
  assert.equal(pool.state.ledger[0].direction, "credit");
  assert.equal(pool.state.ledger[0].amount, "50.00");
  assert.deepEqual(pool.state.movements, [{ created_by: "7", performed_by: "8" }]);
});

test("rejects a return quantity greater than the eligible sold quantity", async () => {
  await assert.rejects(createReturn("5.001"), { statusCode: 400 });
  const draft = await createReturn("4");
  await service.completeReturn(draft.id, "8");
  await assert.rejects(createReturn("2"), { statusCode: 400 });
});

test("rejects a product not present in the original sale", async () => {
  await assert.rejects(
    service.createReturn("1", {
      items: [{ product_id: "10", quantity: "1" }],
    }, "7"),
    { statusCode: 400 }
  );
});

test("rejects client-supplied created_by on returns", async () => {
  await assert.rejects(
    service.createReturn("1", {
      created_by: "8",
      items: [{ product_id: "9", quantity: "1" }],
    }, "7"),
    { statusCode: 400 }
  );
});

test("rejects client-supplied created_by on refunds", async () => {
  const created = await createReturn("1");
  await assert.rejects(
    service.createRefund(created.id, {
      amount: "1.00",
      method: "cash",
      created_by: "8",
      idempotency_key: "spoofed-refund",
    }, "7"),
    { statusCode: 400 }
  );
});

test("rejects returns from draft or cancelled original sales", async () => {
  for (const saleStatus of ["draft", "cancelled"]) {
    loadService(createPool({ saleStatus }));
    await assert.rejects(createReturn(), { statusCode: 409 });
  }
});

test("rejects completing the same return twice without another stock movement", async () => {
  const created = await createReturn("1");
  await service.completeReturn(created.id, "8");
  await assert.rejects(service.completeReturn(created.id, "8"), { statusCode: 409 });
  assert.equal(pool.state.stock, 4);
  assert.equal(pool.state.ledger.length, 1);
});

test("creates no customer ledger entry for a walk-in return", async () => {
  loadService(createPool({ customerId: null }));
  await completeReturn("1");
  assert.equal(pool.state.stock, 4);
  assert.equal(pool.state.ledger.length, 0);
});

test("rejects refunds greater than completed return value or net amount received", async () => {
  const created = await createReturn("5");
  await service.completeReturn(created.id, "8");
  await assert.rejects(
    createRefund(created.id, {
      amount: "30.01",
      method: "cash",
      idempotency_key: "refund-too-large",
    }),
    { statusCode: 409 }
  );
});

test("records an eligible refund and exactly one corresponding ledger debit", async () => {
  const created = await createReturn("5");
  await service.completeReturn(created.id, "8");
  const refund = {
    amount: "20.00",
    method: "cash",
    idempotency_key: "refund-001",
  };
  const result = await createRefund(created.id, refund);
  assert.equal(result.replayed, false);
  assert.equal(result.payment.direction, "refunded");
  assert.equal(result.payment.return_id, created.id);
  assert.equal(pool.state.ledger.filter((entry) => entry.entry_type === "refund").length, 1);
  assert.equal(pool.state.ledger[1].amount, "20.00");
  assert.equal(pool.state.ledger[1].created_by, "7");
});

test("replays an identical refund idempotency key and rejects changed requests", async () => {
  const created = await createReturn("5");
  await service.completeReturn(created.id, "8");
  const request = {
    amount: "20.00",
    method: "cash",
    idempotency_key: "refund-repeat",
  };
  const first = await createRefund(created.id, request);
  const replay = await createRefund(created.id, request);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(pool.state.payments.filter((payment) => payment.direction === "refunded").length, 1);
  await assert.rejects(
    createRefund(created.id, { ...request, amount: "10.00" }),
    { statusCode: 409 }
  );
});

test("rolls back return completion and stock when ledger insertion fails", async () => {
  loadService(createPool({ failLedger: true }));
  const created = await createReturn("1");
  await assert.rejects(service.completeReturn(created.id, "8"), /simulated credit ledger failure/);
  assert.equal(pool.state.rollbackCount, 1);
  assert.equal(pool.state.returns[created.id].status, "draft");
  assert.equal(pool.state.stock, 3);
  assert.equal(pool.state.ledger.length, 0);
});

test("rolls back refund payment when its ledger insertion fails", async () => {
  loadService(createPool({ failLedger: true }));
  const created = await createReturn("5");
  await assert.rejects(service.completeReturn(created.id, "8"), /simulated credit ledger failure/);
  pool.state.failLedger = false;
  await service.completeReturn(created.id, "8");
  pool.state.failLedger = true;
  await assert.rejects(
    createRefund(created.id, {
      amount: "10.00",
      method: "cash",
      idempotency_key: "refund-ledger-fail",
    }),
    /simulated credit ledger failure/
  );
  assert.equal(pool.state.rollbackCount, 2);
  assert.equal(pool.state.payments.filter((payment) => payment.direction === "refunded").length, 0);
  assert.equal(pool.state.ledger.length, 1);
});

test("rolls back payment and ledger when refund payment insertion fails", async () => {
  loadService(createPool({ failPayment: true }));
  const created = await createReturn("5");
  await service.completeReturn(created.id, "8");
  await assert.rejects(
    createRefund(created.id, {
      amount: "10.00",
      method: "cash",
      idempotency_key: "refund-payment-fail",
    }),
    /simulated payment insert failure/
  );
  assert.equal(pool.state.rollbackCount, 1);
  assert.equal(pool.state.payments.filter((payment) => payment.direction === "refunded").length, 0);
  assert.equal(pool.state.ledger.length, 1);
});

test("serves return and refund routes with the expected status codes", async (t) => {
  const express = require("express");
  const serviceStub = {
    async createReturn(saleId) { return { id: "20", original_sale_id: saleId }; },
    async getReturnsBySaleId() { return [{ id: "20" }]; },
    async getAllReturns() { return [{ id: "20" }]; },
    async getReturnById(id) { return { id }; },
    async completeReturn(id) { return { id, status: "completed" }; },
    async createRefund(id) { return { replayed: false, payment: { return_id: id } }; },
    async getRefundsByReturnId(id) { return [{ return_id: id }]; },
  };
  Module._load = function(request, parent, isMain) {
    if (request === "../services/returnService" && parent.filename === controllerPath) {
      return serviceStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  delete require.cache[path.resolve(__dirname, "../server/src/routes/returnRoutes.js")];
  const routes = require("../server/src/routes/returnRoutes");
  Module._load = originalLoad;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: "7" };
    next();
  });
  app.use("/api/sales", routes);
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/sales`;

  const createResponse = await fetch(`${baseUrl}/1/returns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items: [{ product_id: "9", quantity: "1" }] }),
  });
  assert.equal(createResponse.status, 201);
  assert.equal((await createResponse.json()).data.original_sale_id, "1");
  assert.equal((await fetch(`${baseUrl}/1/returns`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/returns`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/returns/20`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/returns/20/complete`, { method: "PUT" })).status, 200);
  assert.equal((await fetch(`${baseUrl}/returns/20/refunds`)).status, 200);
  const refundResponse = await fetch(`${baseUrl}/returns/20/refunds`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: "1.00" }),
  });
  assert.equal(refundResponse.status, 201);
});
