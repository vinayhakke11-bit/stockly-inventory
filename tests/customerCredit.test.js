const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const Module = require("node:module");
const path = require("node:path");

const repositoryPath = path.resolve(__dirname, "../server/src/repositories/customerRepository.js");
const servicePath = path.resolve(__dirname, "../server/src/services/customerService.js");
const controllerPath = path.resolve(__dirname, "../server/src/controllers/customerController.js");
const originalLoad = Module._load;
let pool;
let repository;
let service;

const customer = {
  id: "12",
  name: "Rina Patel",
  phone: null,
  email: null,
  address: null,
  is_active: true,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
};

const ledger = [
  { entry_type: "sale_charge", direction: "debit", amount: "100.00" },
  { entry_type: "return_credit", direction: "credit", amount: "20.00" },
  { entry_type: "payment_received", direction: "credit", amount: "30.00" },
  { entry_type: "refund", direction: "debit", amount: "5.00" },
];

function sumAmounts(entries) {
  return entries.reduce((sum, entry) => {
    const [whole, fraction = ""] = entry.amount.split(".");
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }, 0n);
}

function formatCents(amount) {
  return `${amount / 100n}.${String(amount % 100n).padStart(2, "0")}`;
}

function createPool({ customers = [customer], entries = ledger } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, values = []) {
      queries.push({ sql, values });
      const normalizedSql = sql.trim().replace(/\s+/g, " ");

      if (normalizedSql.includes("WITH ledger_summary AS")) {
        const foundCustomer = customers.find((item) => item.id === values[0]);
        if (!foundCustomer) return { rows: [] };
        const customerLedger = entries;
        const totalDebit = sumAmounts(
          customerLedger.filter((entry) => entry.direction === "debit")
        );
        const totalCredit = sumAmounts(
          customerLedger.filter((entry) => entry.direction === "credit")
        );
        const totalPurchases = sumAmounts(
          customerLedger.filter((entry) => entry.entry_type === "sale_charge")
        );
        const totalPayments = sumAmounts(
          customerLedger.filter((entry) => entry.entry_type === "payment_received")
        );
        return {
          rows: [{
            ...foundCustomer,
            total_debit: formatCents(totalDebit),
            total_credit: formatCents(totalCredit),
            outstanding_balance: formatCents(totalDebit - totalCredit),
            total_purchases: formatCents(totalPurchases),
            total_payments: formatCents(totalPayments),
          }],
        };
      }

      if (normalizedSql.includes("FROM customers") && normalizedSql.includes("WHERE id = $1")) {
        return {
          rows: customers.filter((item) => item.id === values[0]),
        };
      }

      if (normalizedSql.includes("FROM credit_transactions ct")) {
        return { rows: entries };
      }

      throw new Error(`Unexpected query: ${normalizedSql}`);
    },
  };
}

function loadModules(database) {
  pool = database;
  Module._load = function(request, parent, isMain) {
    if (request === "../config/database" && parent.filename === repositoryPath) {
      return pool;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[repositoryPath];
  delete require.cache[servicePath];
  repository = require(repositoryPath);
  service = require(servicePath);
}

beforeEach(() => loadModules(createPool()));

after(() => {
  Module._load = originalLoad;
  delete require.cache[repositoryPath];
  delete require.cache[servicePath];
});

test("calculates debit, credit, outstanding, purchases, and payment totals from ledger", async () => {
  const result = await service.getCustomerCreditSummary("12");
  assert.equal(result.id, "12");
  assert.equal(result.total_debit, "105.00");
  assert.equal(result.total_credit, "50.00");
  assert.equal(result.outstanding_balance, "55.00");
  assert.equal(result.total_purchases, "100.00");
  assert.equal(result.total_payments, "30.00");

  const query = pool.queries[0];
  assert.deepEqual(query.values, ["12"]);
  assert.match(query.sql, /credit_transactions/);
  assert.match(query.sql, /entry_type = 'sale_charge'/);
  assert.match(query.sql, /entry_type = 'payment_received'/);
  assert.doesNotMatch(query.sql, /\bJOIN\s+payments\b/i);
});

test("returns zero amounts for a customer with no ledger entries", async () => {
  loadModules(createPool({ entries: [] }));
  const result = await service.getCustomerCreditSummary("12");
  assert.equal(result.total_debit, "0.00");
  assert.equal(result.total_credit, "0.00");
  assert.equal(result.outstanding_balance, "0.00");
  assert.equal(result.total_purchases, "0.00");
  assert.equal(result.total_payments, "0.00");
});

test("rejects invalid customer IDs before querying the repository", async () => {
  for (const id of ["0", "-2", "12x", "9223372036854775808"]) {
    await assert.rejects(service.getCustomerCreditSummary(id), {
      statusCode: 400,
    });
  }
  assert.equal(pool.queries.length, 0);
});

test("returns not found for a nonexistent customer", async () => {
  await assert.rejects(service.getCustomerCreditSummary("999"), {
    statusCode: 404,
  });
  assert.deepEqual(pool.queries[0].values, ["999"]);
});

test("returns full chronological history with optional sale and payment references", async () => {
  const entries = [
    {
      transaction_id: "1",
      entry_type: "sale_charge",
      direction: "debit",
      amount: "100.00",
      sale_id: "21",
      payment_id: null,
      transaction_date: "2026-10-01T10:00:00Z",
      notes: null,
      sale_type: "sale",
      sale_status: "completed",
      sold_at: "2026-10-01T09:59:00Z",
      payment_sale_id: null,
      payment_method: null,
      payment_reference: null,
      paid_at: null,
    },
    {
      transaction_id: "2",
      entry_type: "payment_received",
      direction: "credit",
      amount: "30.00",
      sale_id: null,
      payment_id: "45",
      transaction_date: "2026-10-02T10:00:00Z",
      notes: "Cash received",
      sale_type: null,
      sale_status: null,
      sold_at: null,
      payment_sale_id: "21",
      payment_method: "cash",
      payment_reference: "receipt-45",
      paid_at: "2026-10-02T09:59:00Z",
    },
  ];
  loadModules(createPool({ entries }));

  const result = await service.getCustomerCreditTransactions("12");
  assert.deepEqual(result, entries);
  assert.deepEqual(pool.queries.map((query) => query.values), [["12"], ["12"]]);
  const historyQuery = pool.queries[1].sql;
  assert.match(historyQuery, /LEFT JOIN sales/);
  assert.match(historyQuery, /LEFT JOIN payments/);
  assert.match(historyQuery, /ORDER BY ct\.created_at ASC, ct\.id ASC/);
  assert.doesNotMatch(historyQuery, /INNER JOIN/i);
});

test("distinguishes return credits and refund debits without double-counting payments", async () => {
  const result = await service.getCustomerCreditSummary("12");
  assert.equal(result.total_debit, "105.00");
  assert.equal(result.total_credit, "50.00");
  assert.equal(result.outstanding_balance, "55.00");
  assert.equal(result.total_purchases, "100.00");
  assert.equal(result.total_payments, "30.00");
  assert.equal(pool.queries.length, 1);
});

test("returns not found for history requested on a nonexistent customer", async () => {
  loadModules(createPool({ customers: [] }));
  await assert.rejects(service.getCustomerCreditTransactions("999"), {
    statusCode: 404,
  });
  assert.equal(pool.queries.length, 1);
});

test("serves both customer credit HTTP endpoints", async (t) => {
  const express = require("express");
  const summary = { customer: { id: "12" }, outstanding_balance: "55.00" };
  const transactions = [{ transaction_id: "1", amount: "100.00" }];
  const serviceStub = {
    async getCustomerCreditSummary(id) {
      return { ...summary, requestedCustomerId: id };
    },
    async getCustomerCreditTransactions(id) {
      return [{ ...transactions[0], requestedCustomerId: id }];
    },
  };
  Module._load = function(request, parent, isMain) {
    if (request === "../services/customerService" && parent.filename === controllerPath) {
      return serviceStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  delete require.cache[path.resolve(__dirname, "../server/src/routes/customerRoutes.js")];
  const routes = require("../server/src/routes/customerRoutes");
  Module._load = originalLoad;

  const app = express();
  app.use("/api/customers", routes);
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/customers/12`;

  const summaryResponse = await fetch(`${baseUrl}/credit`);
  assert.equal(summaryResponse.status, 200);
  assert.deepEqual(await summaryResponse.json(), {
    status: "success",
    data: { ...summary, requestedCustomerId: "12" },
  });

  const historyResponse = await fetch(`${baseUrl}/credit-transactions`);
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(await historyResponse.json(), {
    status: "success",
    data: [{ ...transactions[0], requestedCustomerId: "12" }],
  });
});
