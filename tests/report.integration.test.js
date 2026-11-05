const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const { after, test } = require("node:test");
const { randomBytes } = require("node:crypto");
const { Pool } = require("pg");

require("dotenv").config();

const root = path.resolve(__dirname, "..");
const repositoryPath = path.join(root, "server/src/repositories/reportRepository.js");
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skipReason = testDatabaseUrl
  ? false
  : "Set TEST_DATABASE_URL to run PostgreSQL report integration tests.";
const originalLoad = Module._load;

let adminPool;
let pool;
let schemaName;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function loadRepository(databasePool) {
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

test("PostgreSQL reports aggregate date-filtered transactions and current inventory", {
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
  schemaName = `stockly_report_it_${process.pid}_${randomBytes(4).toString("hex")}`;
  await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
  pool = new Pool({
    connectionString: testDatabaseUrl,
    max: 1,
    options: `-c search_path=${schemaName},public`,
  });

  try {
    await pool.query(`
      CREATE TABLE products (
        id BIGINT PRIMARY KEY,
        name TEXT NOT NULL,
        sku TEXT NOT NULL,
        is_active BOOLEAN NOT NULL,
        stock_on_hand NUMERIC(12, 3) NOT NULL,
        selling_price NUMERIC(12, 2) NOT NULL
      );
      CREATE TABLE credit_transactions (
        id BIGINT PRIMARY KEY,
        direction TEXT NOT NULL,
        amount NUMERIC(12, 2) NOT NULL
      );
      CREATE TABLE sales (
        id BIGINT PRIMARY KEY,
        customer_id BIGINT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        original_sale_id BIGINT,
        sold_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE sale_items (
        id BIGINT PRIMARY KEY,
        sale_id BIGINT NOT NULL,
        product_id BIGINT NOT NULL,
        quantity NUMERIC(12, 3) NOT NULL,
        unit_price NUMERIC(12, 2) NOT NULL
      );
      CREATE TABLE purchases (
        id BIGINT PRIMARY KEY,
        status TEXT NOT NULL,
        purchased_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE purchase_items (
        id BIGINT PRIMARY KEY,
        purchase_id BIGINT NOT NULL,
        quantity NUMERIC(12, 3) NOT NULL,
        unit_cost NUMERIC(12, 2) NOT NULL
      );
      CREATE TABLE payments (
        id BIGINT PRIMARY KEY,
        sale_id BIGINT NOT NULL,
        direction TEXT NOT NULL,
        amount NUMERIC(12, 2) NOT NULL,
        method TEXT NOT NULL,
        paid_at TIMESTAMPTZ NOT NULL
      );
    `);
    await pool.query(
      `INSERT INTO products
         (id, name, sku, is_active, stock_on_hand, selling_price)
       VALUES (1, 'Tea', 'TEA-1', TRUE, 12, 10),
              (2, 'Rice', 'RICE-1', TRUE, 0, 20),
              (3, 'Archived', 'OLD-1', FALSE, 5, 5)`
    );
    await pool.query(
      `INSERT INTO credit_transactions (id, direction, amount)
       VALUES (1, 'debit', 30), (2, 'credit', 18)`
    );
    await pool.query(
      `INSERT INTO sales (id, customer_id, type, status, original_sale_id, sold_at)
       VALUES
         (10, 4, 'sale', 'completed', NULL, '2026-11-05T05:30:00Z'),
         (11, 4, 'return', 'completed', 10, '2026-11-05T06:30:00Z'),
         (12, NULL, 'sale', 'draft', NULL, '2026-11-05T07:30:00Z'),
         (13, 4, 'sale', 'completed', NULL, '2026-11-04T10:00:00Z')`
    );
    await pool.query(
      `INSERT INTO sale_items (id, sale_id, product_id, quantity, unit_price)
       VALUES
         (1, 10, 1, 3, 10),
         (2, 11, 1, 1, 10),
         (3, 12, 2, 2, 20),
         (4, 13, 2, 1, 20)`
    );
    await pool.query(
      `INSERT INTO purchases (id, status, purchased_at)
       VALUES (20, 'received', '2026-11-05T05:30:00Z'),
              (21, 'draft', '2026-11-05T05:30:00Z'),
              (22, 'received', '2026-11-04T10:00:00Z')`
    );
    await pool.query(
      `INSERT INTO purchase_items (id, purchase_id, quantity, unit_cost)
       VALUES (1, 20, 2, 5), (2, 21, 100, 10), (3, 22, 1, 8)`
    );
    await pool.query(
      `INSERT INTO payments (id, sale_id, direction, amount, method, paid_at)
       VALUES
         (30, 10, 'received', 15, 'cash', '2026-11-05T05:40:00Z'),
         (31, 10, 'refunded', 3, 'cash', '2026-11-05T06:40:00Z'),
         (32, 13, 'received', 20, 'card', '2026-11-04T10:30:00Z')`
    );

    const repository = loadRepository(pool);
    const report = await repository.getReports({
      from: "2026-11-05",
      to: "2026-11-05",
    });

    assert.deepEqual(report.sales, {
      total_sales: "30.00",
      net_sales: "20.00",
      completed_sale_count: 1,
      payments_received: "15.00",
      outstanding_customer_credit: "12.00",
    });
    assert.deepEqual(report.purchases, {
      total_purchase_count: 2,
      received_purchase_count: 1,
      total_purchase_value: "10.00",
    });
    assert.deepEqual(report.payments, {
      payment_count: 1,
      payments_received: "15.00",
      payment_methods: [{ method: "cash", payment_count: 1, amount: "15.00" }],
    });
    assert.deepEqual(report.returns, {
      return_count: 1,
      returned_quantity: "1.000",
      returned_value: "10.00",
      total_refunds: "3.00",
    });
    assert.equal(report.inventory.product_count, 3);
    assert.equal(report.inventory.active_product_count, 2);
    assert.equal(report.inventory.total_stock_quantity, "17.000");
    assert.equal(report.inventory.low_stock_count, 0);
    assert.equal(report.inventory.out_of_stock_count, 1);
    assert.equal(report.inventory.retail_inventory_value, "145.00");
    assert.deepEqual(report.top_selling_products, [{
      product_id: "1",
      product_name: "Tea",
      net_quantity_sold: "2.000",
    }]);

    const allTime = await repository.getReports();
    assert.equal(allTime.sales.total_sales, "50.00");
    assert.equal(allTime.purchases.total_purchase_count, 3);
    assert.equal(allTime.payments.payment_count, 2);
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
