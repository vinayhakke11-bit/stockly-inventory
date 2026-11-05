const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const Module = require("node:module");
const path = require("node:path");

const repositoryPath = path.resolve(__dirname, "../server/src/repositories/paymentRepository.js");
const servicePath = path.resolve(__dirname, "../server/src/services/paymentService.js");
const controllerPath = path.resolve(__dirname, "../server/src/controllers/paymentController.js");
const originalLoad = Module._load;
let currentPool;
let paymentRepository;
let paymentService;

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
  total = "100.00",
  failLedger = false,
  initialPayments = [],
} = {}) {
  const state = {
    saleStatus,
    customerId,
    total,
    createdBy: "7",
    payments: [...initialPayments],
    ledger: [],
    nextPaymentId: 1,
    failLedger,
    lockTail: Promise.resolve(),
    rollbackCount: 0,
  };

  function createClient() {
    let unlockSale;
    let transactionSnapshot;

    return {
      async query(sql, values = []) {
        const query = sql.trim().replace(/\s+/g, " ");

        if (query === "BEGIN") {
          return { rows: [] };
        }
        if (query === "COMMIT") return { rows: [] };
        if (query === "ROLLBACK") {
          state.payments = transactionSnapshot.payments;
          state.ledger = transactionSnapshot.ledger;
          state.saleStatus = transactionSnapshot.saleStatus;
          state.rollbackCount += 1;
          return { rows: [] };
        }
        if (query.startsWith("SELECT id, customer_id, status, type")) {
          const previous = state.lockTail;
          let release;
          const locked = new Promise((resolve) => { release = resolve; });
          state.lockTail = previous.then(() => locked);
          await previous;
          unlockSale = release;
          transactionSnapshot = {
            payments: [...state.payments],
            ledger: [...state.ledger],
            saleStatus: state.saleStatus,
          };
          return {
            rows: [{
              id: values[0],
              customer_id: state.customerId,
              status: state.saleStatus,
              type: "sale",
            }],
          };
        }
        if (query.startsWith("SELECT id, sale_id, created_by, amount, method, reference")) {
          const existing = state.payments.find(
            (payment) => payment.idempotency_key === values[5]
          );
          if (!existing) return { rows: [] };
          return {
            rows: [{
              ...existing,
              same_request:
                existing.sale_id === values[0] &&
                existing.created_by === values[1] &&
                cents(existing.amount) === cents(values[2]) &&
                existing.method === values[3] &&
                existing.reference === values[4] &&
                existing.direction === "received",
            }],
          };
        }
        if (query === "SELECT id FROM users WHERE id = $1") {
          return { rows: values[0] === state.createdBy ? [{ id: values[0] }] : [] };
        }
        if (query.startsWith("WITH sale_total AS")) {
          const received = state.payments
            .filter((payment) => payment.sale_id === "15" && payment.direction === "received")
            .reduce((sum, payment) => sum + cents(payment.amount), 0n);
          const outstandingCents = cents(state.total) - received;
          const absoluteCents = outstandingCents < 0n ? -outstandingCents : outstandingCents;
          const sign = outstandingCents < 0n ? "-" : "";
          const whole = absoluteCents / 100n;
          const fraction = String(absoluteCents % 100n).padStart(2, "0");
          return { rows: [{ outstanding: `${sign}${whole}.${fraction}` }] };
        }
        if (query.startsWith("INSERT INTO payments")) {
          if (state.payments.some((payment) => payment.idempotency_key === values[5])) {
            const error = new Error("duplicate idempotency key");
            error.code = "23505";
            error.constraint = "payments_idempotency_key_unique_idx";
            throw error;
          }
          const payment = {
            id: String(state.nextPaymentId++),
            sale_id: values[0],
            created_by: values[1],
            direction: "received",
            amount: values[2],
            method: values[3],
            reference: values[4],
            idempotency_key: values[5],
          };
          state.payments.push(payment);
          const { idempotency_key, ...publicPayment } = payment;
          return { rows: [publicPayment] };
        }
        if (query.startsWith("INSERT INTO credit_transactions")) {
          if (state.failLedger) throw new Error("simulated ledger failure");
          state.ledger.push({
            customer_id: values[0],
            payment_id: values[1],
            entry_type: "payment_received",
            direction: "credit",
            amount: values[2],
            created_by: values[3],
          });
          return { rows: [] };
        }
        if (query.startsWith("SELECT EXISTS (SELECT 1 FROM sales")) {
          return { rows: [{ sale_exists: values[0] === "15" }] };
        }
        if (query.startsWith("SELECT id, sale_id, created_by, direction, amount, method")) {
          return {
            rows: state.payments
              .filter((payment) => payment.sale_id === values[0])
              .map(({ idempotency_key, ...payment }) => payment),
          };
        }

        throw new Error(`Unexpected mock SQL: ${query}`);
      },
      release() {
        if (unlockSale) unlockSale();
      },
    };
  }

  return {
    state,
    async connect() {
      return createClient();
    },
    async query(sql, values) {
      const client = createClient();
      try {
        return await client.query(sql, values);
      } finally {
        client.release();
      }
    },
  };
}

function loadPaymentModules(pool) {
  currentPool = pool;
  Module._load = function(request, parent, isMain) {
    if (request === "../config/database" && parent.filename === repositoryPath) {
      return currentPool;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[repositoryPath];
  delete require.cache[servicePath];
  paymentRepository = require(repositoryPath);
  paymentService = require(servicePath);
}

beforeEach(() => {
  loadPaymentModules(createPool());
});

after(() => {
  Module._load = originalLoad;
  delete require.cache[repositoryPath];
  delete require.cache[servicePath];
});

function validPayment(overrides = {}) {
  return {
    amount: "100.00",
    method: "cash",
    idempotency_key: "payment-request-001",
    ...overrides,
  };
}

function createPayment(saleId, input) {
  return paymentService.createPayment(saleId, input, "7");
}

test("records a successful full payment and one customer ledger credit", async () => {
  const result = await createPayment("15", validPayment());
  assert.equal(result.payment.amount, "100.00");
  assert.equal(result.replayed, false);
  assert.equal(currentPool.state.payments.length, 1);
  assert.deepEqual(currentPool.state.ledger, [{
    customer_id: "22",
    payment_id: "1",
    entry_type: "payment_received",
    direction: "credit",
    amount: "100.00",
    created_by: "7",
  }]);
});

test("records a successful partial payment", async () => {
  const result = await createPayment(
    "15",
    validPayment({ amount: "35.25", idempotency_key: "partial-001" })
  );
  assert.equal(result.payment.amount, "35.25");
  assert.equal(currentPool.state.ledger[0].amount, "35.25");
});

test("rejects a payment greater than the outstanding amount", async () => {
  await assert.rejects(
    createPayment("15", validPayment({ amount: "100.01" })),
    { statusCode: 409 }
  );
  assert.equal(currentPool.state.payments.length, 0);
});

test("rejects payment when prior records leave a negative balance", async () => {
  loadPaymentModules(createPool({
    initialPayments: [{
      id: "prior",
      sale_id: "15",
      direction: "received",
      amount: "100.50",
      idempotency_key: "previous-key",
    }],
  }));
  await assert.rejects(
    createPayment(
      "15",
      validPayment({ amount: "0.01", idempotency_key: "new-key" })
    ),
    { statusCode: 409 }
  );
  assert.equal(currentPool.state.payments.length, 1);
});

test("rejects payment on a draft sale", async () => {
  loadPaymentModules(createPool({ saleStatus: "draft" }));
  await assert.rejects(createPayment("15", validPayment()), {
    statusCode: 409,
  });
  assert.equal(currentPool.state.payments.length, 0);
});

test("rejects invalid payment amounts", async () => {
  for (const amount of ["0", "-1.00", "1.001", "invalid"]) {
    await assert.rejects(
      createPayment("15", validPayment({ amount })),
      { statusCode: 400 }
    );
  }
});

test("rejects client-supplied created_by instead of trusting it", async () => {
  await assert.rejects(
    createPayment("15", validPayment({ created_by: "8" })),
    { statusCode: 400 }
  );
  assert.equal(currentPool.state.payments.length, 0);
});

test("records a walk-in payment without a customer credit entry", async () => {
  loadPaymentModules(createPool({ customerId: null }));
  await createPayment("15", validPayment());
  assert.equal(currentPool.state.payments.length, 1);
  assert.equal(currentPool.state.ledger.length, 0);
});

test("replays the same idempotency key without duplicate payment or ledger rows", async () => {
  const request = validPayment({ amount: "40.00" });
  const first = await createPayment("15", request);
  const retry = await createPayment("15", request);
  assert.equal(first.replayed, false);
  assert.equal(retry.replayed, true);
  assert.equal(currentPool.state.payments.length, 1);
  assert.equal(currentPool.state.ledger.length, 1);
});

test("rejects reuse of an idempotency key for different payment data", async () => {
  await createPayment("15", validPayment({ amount: "40.00" }));
  await assert.rejects(
    createPayment(
      "15",
      validPayment({ amount: "30.00", idempotency_key: "payment-request-001" })
    ),
    { statusCode: 409 }
  );
  assert.equal(currentPool.state.payments.length, 1);
});

test("serializes concurrent payments and rejects aggregate overpayment", async () => {
  const results = await Promise.allSettled([
    createPayment(
      "15",
      validPayment({ amount: "60.00", idempotency_key: "concurrent-1" })
    ),
    createPayment(
      "15",
      validPayment({ amount: "60.00", idempotency_key: "concurrent-2" })
    ),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected")[0].reason.statusCode, 409);
  assert.equal(currentPool.state.payments.length, 1);
  assert.equal(currentPool.state.ledger.length, 1);
});

test("rolls back payment when its ledger insert fails", async () => {
  loadPaymentModules(createPool({ failLedger: true }));
  await assert.rejects(
    createPayment("15", validPayment()),
    /simulated ledger failure/
  );
  assert.equal(currentPool.state.rollbackCount, 1);
  assert.equal(currentPool.state.payments.length, 0);
  assert.equal(currentPool.state.ledger.length, 0);
});

test("returns payment history for a sale", async () => {
  await createPayment("15", validPayment());
  const history = await paymentService.getPaymentsBySaleId("15");
  assert.equal(history.length, 1);
  assert.equal(history[0].sale_id, "15");
  assert.equal(history[0].idempotency_key, undefined);
});

test("rejects payment history lookup for a missing sale", async () => {
  await assert.rejects(paymentService.getPaymentsBySaleId("99"), {
    statusCode: 404,
  });
});

test("serves payment creation and history HTTP routes", async (t) => {
  const express = require("express");
  let replayed = false;
  const paymentServiceStub = {
    async createPayment(saleId, body) {
      return {
        replayed,
        payment: { id: "1", sale_id: saleId, amount: body.amount },
      };
    },
    async getPaymentsBySaleId(saleId) {
      return [{ id: "1", sale_id: saleId, amount: "12.00" }];
    },
  };
  Module._load = function(request, parent, isMain) {
    if (request === "../services/paymentService" && parent.filename === controllerPath) {
      return paymentServiceStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  delete require.cache[path.resolve(__dirname, "../server/src/routes/paymentRoutes.js")];
  const paymentRoutes = require("../server/src/routes/paymentRoutes");
  Module._load = originalLoad;

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: "7" };
    next();
  });
  app.use("/api/sales/:saleId/payments", paymentRoutes);
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/sales/15/payments`;

  const createResponse = await fetch(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: "12.00" }),
  });
  assert.equal(createResponse.status, 201);
  assert.deepEqual(await createResponse.json(), {
    status: "success",
    message: "Payment recorded successfully.",
    data: { id: "1", sale_id: "15", amount: "12.00" },
  });

  replayed = true;
  const replayResponse = await fetch(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ amount: "12.00" }),
  });
  assert.equal(replayResponse.status, 200);
  assert.equal(
    (await replayResponse.json()).message,
    "Payment request was already processed."
  );

  const historyResponse = await fetch(baseUrl);
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(await historyResponse.json(), {
    status: "success",
    data: [{ id: "1", sale_id: "15", amount: "12.00" }],
  });
});
