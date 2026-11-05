const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { after, test } = require("node:test");
const { Pool } = require("pg");

require("dotenv").config();

const root = path.resolve(__dirname, "..");
const repositoryPath = path.join(root, "server/src/repositories/paymentRepository.js");
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skipReason = testDatabaseUrl
  ? false
  : "Set TEST_DATABASE_URL to run PostgreSQL payment history integration tests.";
const originalLoad = Module._load;

let adminPool;
let pool;
let schemaName;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function loadPaymentRepository(databasePool) {
  Module._load = function(request, parent, isMain) {
    if (request === "../config/database" && parent.filename === repositoryPath) {
      return databasePool;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[repositoryPath];
  try {
    return require(repositoryPath);
  } finally {
    Module._load = originalLoad;
  }
}

test("PostgreSQL payment history joins sales and honors method/date filters", {
  skip: skipReason,
}, async () => {
  let databaseName;
  try {
    databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!/test/i.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL must target a database with 'test' in its name.");
  }

  adminPool = new Pool({ connectionString: testDatabaseUrl, max: 1 });
  schemaName = `stockly_payment_history_it_${process.pid}_${randomBytes(4).toString("hex")}`;
  await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
  pool = new Pool({
    connectionString: testDatabaseUrl,
    max: 1,
    options: `-c search_path=${schemaName},public`,
  });

  try {
    await pool.query(`
      CREATE TABLE users (id BIGINT PRIMARY KEY, username TEXT NOT NULL);
      CREATE TABLE customers (id BIGINT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE sales (
        id BIGINT PRIMARY KEY,
        customer_id BIGINT REFERENCES customers(id),
        type VARCHAR(10) NOT NULL,
        status VARCHAR(20) NOT NULL,
        sold_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE sale_items (
        id BIGINT PRIMARY KEY,
        sale_id BIGINT NOT NULL REFERENCES sales(id),
        quantity NUMERIC(12, 3) NOT NULL,
        unit_price NUMERIC(12, 2) NOT NULL
      );
      CREATE TABLE payments (
        id BIGINT PRIMARY KEY,
        sale_id BIGINT NOT NULL REFERENCES sales(id),
        created_by BIGINT NOT NULL REFERENCES users(id),
        direction VARCHAR(10) NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        method VARCHAR(20) NOT NULL,
        reference VARCHAR(100),
        paid_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
      );
    `);
    await pool.query("INSERT INTO users (id, username) VALUES (7, 'owner')");
    await pool.query("INSERT INTO customers (id, name) VALUES (3, 'Test customer')");
    await pool.query(
      `INSERT INTO sales (id, customer_id, type, status, sold_at)
       VALUES
         (10, 3, 'sale', 'completed', '2026-11-05T05:00:00Z'),
         (11, NULL, 'sale', 'completed', '2026-11-05T05:00:00Z'),
         (12, 3, 'return', 'completed', '2026-11-05T05:00:00Z')`
    );
    await pool.query(
      `INSERT INTO sale_items (id, sale_id, quantity, unit_price)
       VALUES (1, 10, 2, 15.00), (2, 10, 1, 5.00)`
    );
    await pool.query(
      `INSERT INTO payments
         (id, sale_id, created_by, direction, amount, method, reference, paid_at, created_at)
       VALUES
         (20, 10, 7, 'received', 10.00, 'cash', 'drawer-1', '2026-11-05T05:30:00Z', '2026-11-05T05:30:00Z'),
         (21, 10, 7, 'refunded', 2.00, 'cash', 'refund-1', '2026-11-05T06:30:00Z', '2026-11-05T06:30:00Z'),
         (22, 11, 7, 'received', 8.00, 'card', NULL, '2026-11-05T06:30:00Z', '2026-11-05T06:30:00Z'),
         (23, 12, 7, 'refunded', 3.00, 'cash', 'return-refund', '2026-11-05T06:30:00Z', '2026-11-05T06:30:00Z'),
         (24, 10, 7, 'received', 4.00, 'cash', 'previous-day', '2026-11-04T10:00:00Z', '2026-11-04T10:00:00Z')`
    );

    const repository = loadPaymentRepository(pool);
    const payments = await repository.getAllPayments({
      method: "cash",
      from: "2026-11-05",
      to: "2026-11-05",
    });

    assert.deepEqual(payments.map((payment) => String(payment.id)), ["21", "20"]);
    assert.equal(payments[0].direction, "refunded");
    assert.equal(payments[0].reference, "refund-1");
    assert.equal(payments[0].recorded_by, "owner");
    assert.equal(payments[0].customer_name, "Test customer");
    assert.equal(Number(payments[0].sale_total), 35);

    const walkIn = await repository.getAllPayments({ method: "card" });
    assert.equal(walkIn.length, 1);
    assert.equal(walkIn[0].customer_name, "Walk-in Customer");
    assert.equal(String(walkIn[0].sale_id), "11");
  } finally {
    await pool.end();
    pool = null;
    await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
    await adminPool.end();
    adminPool = null;
  }
});

after(async () => {
  Module._load = originalLoad;
  delete require.cache[repositoryPath];
  if (pool) await pool.end();
  if (adminPool) {
    try {
      if (schemaName) {
        await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      }
    } finally {
      await adminPool.end();
    }
  }
});
