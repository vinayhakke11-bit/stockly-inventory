const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const originalLoad = Module._load;

function loadModule(relativePath, dependencyStubs) {
  const modulePath = path.join(root, relativePath);
  Module._load = function(request, parent, isMain) {
    if (parent.filename === modulePath && dependencyStubs[request]) {
      return dependencyStubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[modulePath];
  const loaded = require(modulePath);
  Module._load = originalLoad;
  return loaded;
}

function response() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("sale completion uses payment validation and passes the authenticated cashier", async () => {
  const calls = [];
  const saleRepository = {
    async completeSale(id, options) {
      calls.push({ id, options });
      return { id, status: "completed" };
    },
  };
  const paymentService = {
    normalizePayment(input, userId) {
      calls.push({ input, userId });
      return { ...input, created_by: userId };
    },
    handleRepositoryError(error) {
      throw error;
    },
  };
  const service = loadModule("server/src/services/saleService.js", {
    "../repositories/saleRepository": saleRepository,
    "./paymentService": paymentService,
  });
  const payment = {
    amount: "3.25",
    method: "cash",
    idempotency_key: "checkout-1",
  };
  await service.completeSale("42", { id: "8", username: "cashier-b" }, payment);

  assert.deepEqual(calls, [
    { input: payment, userId: "8" },
    {
      id: "42",
      options: {
        performedBy: "8",
        cashierUsername: "cashier-b",
        initialPayment: { ...payment, created_by: "8" },
      },
    },
  ]);
});

test("sale completion creates stock movement, initial payment, and one receipt in one transaction", async () => {
  const state = { status: "draft", order: [], receipt: null, receiptCount: 0 };
  const client = {
    async query(sql) {
      const query = sql.trim().replace(/\s+/g, " ");
      if (query === "BEGIN") {
        state.order.push("begin");
        return { rows: [] };
      }
      if (query === "COMMIT") {
        state.order.push("commit");
        return { rows: [] };
      }
      if (query === "ROLLBACK") {
        state.order.push("rollback");
        return { rows: [] };
      }
      if (query.startsWith("SELECT id, status, type, customer_id, created_by FROM sales")) {
        return {
          rows: [{
            id: "42",
            status: state.status,
            type: "sale",
            customer_id: null,
            created_by: "7",
          }],
        };
      }
      if (query.startsWith("SELECT product_id, quantity, unit_price FROM sale_items")) {
        return { rows: [{ product_id: "9", quantity: "1.000", unit_price: "3.25" }] };
      }
      if (query.startsWith("SELECT id, name, sku, is_active, stock_on_hand FROM products")) {
        return {
          rows: [{
            id: "9",
            name: "Original product",
            sku: "ORIG-9",
            is_active: true,
            stock_on_hand: "5.000",
          }],
        };
      }
      if (query.startsWith("SELECT set_config('stockly.performed_by'")) {
        return { rows: [] };
      }
      if (query.startsWith("UPDATE sales SET status = 'completed'")) {
        state.status = "completed";
        state.order.push("complete-stock-trigger");
        return { rows: [] };
      }
      if (query.startsWith("SELECT s.id, s.customer_id, c.name AS customer_name")) {
        return {
          rows: [{
            id: "42",
            status: "completed",
            type: "sale",
            created_by: "7",
            total: "3.25",
          }],
        };
      }
      if (query.startsWith("SELECT si.id, si.product_id, p.sku")) {
        return {
          rows: [{
            id: "91",
            product_id: "9",
            product_name: "Current product",
            sku: "CURRENT-9",
            quantity: "1.000",
            unit_price: "3.25",
            line_total: "3.25",
          }],
        };
      }
      throw new Error(`Unexpected SQL in transaction test: ${query}`);
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  const paymentRepository = {
    async createPaymentInTransaction(transactionClient, saleId, payment) {
      assert.equal(transactionClient, client);
      assert.equal(state.status, "completed");
      assert.equal(saleId, "42");
      assert.equal(payment.created_by, "8");
      state.order.push("initial-payment");
    },
  };
  const receiptRepository = {
    async createReceipt(transactionClient, input) {
      assert.equal(transactionClient, client);
      assert.equal(state.status, "completed");
      state.order.push("receipt");
      state.receiptCount += 1;
      state.receipt = input;
    },
  };
  const stockMovementRepository = {
    async setPerformedBy(transactionClient, userId) {
      assert.equal(transactionClient, client);
      assert.equal(userId, "8");
      state.order.push("set-performer");
    },
  };
  const repository = loadModule("server/src/repositories/saleRepository.js", {
    "../config/database": pool,
    "./stockMovementRepository": stockMovementRepository,
    "./paymentRepository": paymentRepository,
    "./receiptRepository": receiptRepository,
  });

  await repository.completeSale("42", {
    performedBy: "8",
    cashierUsername: "cashier-b",
    initialPayment: { amount: "3.25", created_by: "8" },
  });

  assert.deepEqual(state.order, [
    "begin",
    "set-performer",
    "complete-stock-trigger",
    "initial-payment",
    "receipt",
    "commit",
  ]);
  assert.deepEqual(state.receipt, {
    saleId: "42",
    issuedBy: "8",
    cashierUsername: "cashier-b",
    customerId: null,
  });

  await assert.rejects(
    repository.completeSale("42", {
      performedBy: "8",
      cashierUsername: "cashier-b",
      initialPayment: null,
    }),
    { code: "SALE_ALREADY_COMPLETED" }
  );
  assert.equal(state.receiptCount, 1);
});

test("receipt repository snapshots customer, shop, line items, and original tender", async () => {
  const createdReceipt = {
    id: "11",
    sale_id: "42",
    receipt_number: "105",
    issued_at: "2026-11-04T10:00:00.000Z",
    issued_by: "8",
    cashier_username: "cashier-b",
    customer_name: "Customer at checkout",
    customer_phone: "1111111",
    customer_email: "original@example.test",
    customer_address: "Original address",
    shop_name: "Configured shop",
    shop_address: "Shop address",
    shop_phone: "2222222",
    subtotal: "10.00",
    total: "10.00",
    amount_paid: "4.00",
    outstanding_amount: "6.00",
    currency_code: "INR",
  };
  const itemSnapshot = {
    id: "91",
    receipt_id: "11",
    product_id: "9",
    product_name: "Product at checkout",
    product_sku: "SKU-OLD",
    quantity: "2.000",
    unit_price: "5.00",
    line_total: "10.00",
  };
  const initialPayment = {
    id: "301",
    amount: "4.00",
    method: "cash",
    reference: null,
    paid_at: "2026-11-04T10:00:00.000Z",
    created_at: "2026-11-04T10:00:00.000Z",
    direction: "received",
  };
  const laterPayment = {
    id: "302",
    amount: "2.00",
    method: "card",
    reference: null,
    paid_at: "2026-11-04T11:00:00.000Z",
    created_at: "2026-11-04T11:00:00.000Z",
    direction: "received",
  };
  const refund = {
    id: "303",
    amount: "1.00",
    method: "cash",
    reference: null,
    paid_at: "2026-11-04T12:00:00.000Z",
    created_at: "2026-11-04T12:00:00.000Z",
    direction: "refunded",
  };
  const state = { insertValues: null, queries: [], receiptReadQueries: [] };
  const client = {
    async query(sql, values = []) {
      const query = sql.trim().replace(/\s+/g, " ");
      state.queries.push(query);
      if (query.startsWith("SELECT name, phone, email, address FROM customers")) {
        return {
          rows: [{
            name: "Customer at checkout",
            phone: "1111111",
            email: "original@example.test",
            address: "Original address",
          }],
        };
      }
      if (query === "SELECT value FROM shop_settings WHERE key = 'shop'") {
        return {
          rows: [{
            value: {
              name: "Configured shop",
              address: "Shop address",
              phone: "2222222",
            },
          }],
        };
      }
      if (query.startsWith("WITH sale_total AS")) {
        return {
          rows: [{
            subtotal: "10.00",
            total: "10.00",
            amount_paid: "4.00",
            outstanding_amount: "6.00",
          }],
        };
      }
      if (query.startsWith("INSERT INTO receipts")) {
        state.insertValues = values;
        return { rows: [{ id: "11" }] };
      }
      if (query.startsWith("INSERT INTO receipt_items")) {
        assert.match(query, /p\.name, p\.sku/);
        assert.match(query, /round\(si\.quantity \* si\.unit_price, 2\)/);
        return { rows: [] };
      }
      if (query.startsWith("SELECT id, sale_id, receipt_number")) {
        state.receiptReadQueries.push(query);
        return { rows: [createdReceipt] };
      }
      if (query.startsWith("SELECT id, receipt_id, product_id, product_name")) {
        state.receiptReadQueries.push(query);
        return { rows: [itemSnapshot] };
      }
      if (query.startsWith("SELECT p.id, p.amount, p.method, p.reference, p.paid_at FROM payments")) {
        state.receiptReadQueries.push(query);
        assert.match(query, /p\.direction = 'received'/);
        assert.match(query, /p\.created_at <= r\.issued_at/);
        assert.deepEqual(values, [createdReceipt.sale_id]);
        const cutoff = new Date(createdReceipt.issued_at);
        return {
          rows: [initialPayment, laterPayment, refund]
            .filter((payment) =>
              payment.direction === "received" &&
              new Date(payment.created_at) <= cutoff
            )
            .map(({ created_at, direction, ...payment }) => payment),
        };
      }
      throw new Error(`Unexpected SQL in receipt snapshot test: ${query}`);
    },
    release() {},
  };
  const pool = {
    async connect() {
      return client;
    },
  };
  const repository = loadModule("server/src/repositories/receiptRepository.js", {
    "../config/database": pool,
  });

  const receipt = await repository.createReceipt(client, {
    saleId: "42",
    issuedBy: "8",
    cashierUsername: "cashier-b",
    customerId: "21",
  });

  assert.deepEqual(state.insertValues.slice(0, 10), [
    "42",
    "8",
    "cashier-b",
    "Customer at checkout",
    "1111111",
    "original@example.test",
    "Original address",
    "Configured shop",
    "Shop address",
    "2222222",
  ]);
  assert.deepEqual(receipt.items, [itemSnapshot]);
  assert.deepEqual(receipt.payments, [{
    id: "301",
    amount: "4.00",
    method: "cash",
    reference: null,
    paid_at: "2026-11-04T10:00:00.000Z",
  }]);

  const reloaded = await repository.getReceiptBySale("42");
  assert.equal(reloaded.customer_name, "Customer at checkout");
  assert.equal(reloaded.shop_name, "Configured shop");
  assert.equal(reloaded.items[0].product_name, "Product at checkout");
  assert.equal(reloaded.items[0].product_sku, "SKU-OLD");
  assert.equal(reloaded.amount_paid, "4.00");
  assert.equal(reloaded.outstanding_amount, "6.00");
  assert.equal(reloaded.payments.length, 1);
  assert.ok(state.receiptReadQueries.every((query) =>
    !query.includes("JOIN products") &&
    !query.includes("JOIN customers") &&
    !query.includes("shop_settings")
  ));
});

test("walk-in receipt uses the schema-compatible label and empty configured shop name", async () => {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      const query = sql.trim().replace(/\s+/g, " ");
      if (query.startsWith("SELECT value FROM shop_settings")) return { rows: [] };
      if (query.startsWith("WITH sale_total AS")) {
        return {
          rows: [{
            subtotal: "0.00",
            total: "0.00",
            amount_paid: "0.00",
            outstanding_amount: "0.00",
          }],
        };
      }
      if (query.startsWith("INSERT INTO receipts")) {
        calls.push(values);
        return { rows: [{ id: "12" }] };
      }
      if (query.startsWith("INSERT INTO receipt_items")) return { rows: [] };
      if (query.startsWith("SELECT id, sale_id, receipt_number")) {
        return {
          rows: [{
            id: "12",
            sale_id: "43",
            receipt_number: "106",
            issued_at: "2026-11-04T10:00:00.000Z",
            customer_name: "Walk-in Customer",
            shop_name: "",
          }],
        };
      }
      if (query.startsWith("SELECT id, receipt_id, product_id, product_name")) return { rows: [] };
      if (query.startsWith("SELECT p.id, p.amount, p.method, p.reference, p.paid_at FROM payments")) return { rows: [] };
      throw new Error(`Unexpected SQL in walk-in receipt test: ${query}`);
    },
    release() {},
  };
  const repository = loadModule("server/src/repositories/receiptRepository.js", {
    "../config/database": { async connect() { return client; } },
  });

  const receipt = await repository.createReceipt(client, {
    saleId: "43",
    issuedBy: "8",
    cashierUsername: "cashier-b",
    customerId: null,
  });
  assert.equal(calls[0][3], "Walk-in Customer");
  assert.equal(calls[0][4], null);
  assert.equal(calls[0][7], "");
  assert.equal(receipt.customer_name, "Walk-in Customer");
  assert.equal(receipt.shop_name, "");
});

test("unpaid sale snapshots zero paid and the full outstanding amount", async () => {
  let insertedValues;
  const client = {
    async query(sql, values = []) {
      const query = sql.trim().replace(/\s+/g, " ");
      if (query.startsWith("SELECT value FROM shop_settings")) return { rows: [] };
      if (query.startsWith("WITH sale_total AS")) {
        return {
          rows: [{
            subtotal: "8.00",
            total: "8.00",
            amount_paid: "0.00",
            outstanding_amount: "8.00",
          }],
        };
      }
      if (query.startsWith("INSERT INTO receipts")) {
        insertedValues = values;
        return { rows: [{ id: "13" }] };
      }
      if (query.startsWith("INSERT INTO receipt_items")) return { rows: [] };
      if (query.startsWith("SELECT id, sale_id, receipt_number")) {
        return {
          rows: [{
            id: "13",
            sale_id: "44",
            amount_paid: "0.00",
            outstanding_amount: "8.00",
          }],
        };
      }
      if (query.startsWith("SELECT id, receipt_id, product_id, product_name")) return { rows: [] };
      if (query.startsWith("SELECT p.id, p.amount, p.method, p.reference, p.paid_at FROM payments")) return { rows: [] };
      throw new Error(`Unexpected SQL in unpaid receipt test: ${query}`);
    },
    release() {},
  };
  const repository = loadModule("server/src/repositories/receiptRepository.js", {
    "../config/database": { async connect() { return client; } },
  });

  const receipt = await repository.createReceipt(client, {
    saleId: "44",
    issuedBy: "8",
    cashierUsername: "cashier-b",
    customerId: null,
  });
  assert.equal(insertedValues[12], "0.00");
  assert.equal(insertedValues[13], "8.00");
  assert.equal(receipt.amount_paid, "0.00");
  assert.equal(receipt.outstanding_amount, "8.00");
  assert.deepEqual(receipt.payments, []);
});

test("receipt endpoint returns the stored receipt snapshot", async () => {
  const storedReceipt = {
    receipt_number: "105",
    cashier_username: "cashier-b",
    customer_name: "Historical customer",
    shop_name: "Historical shop",
    items: [{ product_name: "Historical product", product_sku: "OLD-SKU" }],
    payments: [],
  };
  const controller = loadModule("server/src/controllers/saleController.js", {
    "../services/saleService": {},
    "../services/receiptService": {
      async getReceiptBySaleId(id) {
        assert.equal(id, "42");
        return storedReceipt;
      },
    },
  });
  const res = response();
  await controller.getReceipt({ params: { saleId: "42" } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.data, storedReceipt);
  assert.equal(res.payload.data.items[0].product_name, "Historical product");
});

test("receipt service validates sale IDs and returns not found when no receipt exists", async () => {
  const receiptService = loadModule("server/src/services/receiptService.js", {
    "../repositories/receiptRepository": {
      async getReceiptBySale(id) {
        if (id === "99") return null;
        return { sale_id: id };
      },
    },
  });

  await assert.rejects(receiptService.getReceiptBySaleId("0"), { statusCode: 400 });
  await assert.rejects(receiptService.getReceiptBySaleId("99"), { statusCode: 404 });
  assert.deepEqual(await receiptService.getReceiptBySaleId("42"), { sale_id: "42" });
});
