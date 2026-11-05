const assert = require("node:assert/strict");
const fs = require("node:fs");
const { after, beforeEach, test } = require("node:test");
const Module = require("node:module");
const path = require("node:path");

const repositoryPath = path.resolve(__dirname, "../server/src/repositories/dashboardRepository.js");
const controllerPath = path.resolve(__dirname, "../server/src/controllers/dashboardController.js");
const originalLoad = Module._load;
let capturedQuery;
let dashboardRepository;

const dashboardData = {
  inventory: {
    product_count: 12,
    active_product_count: 10,
    total_stock_quantity: "135.500",
    low_stock_count: 2,
    out_of_stock_count: 1,
    retail_inventory_value: "2500.75",
  },
  today: {
    gross_sales: "500.00",
    returns: "50.00",
    net_sales: "450.00",
    purchases: "200.00",
    payments_received: "300.00",
    refunds: "25.00",
  },
  customer_credit: { outstanding_balance: "175.00" },
  recent_sales: [{ id: "14", type: "sale", status: "completed", total_amount: "50.00" }],
  recent_stock_movements: [{
    id: "42",
    product_name: "Rice",
    movement_type: "purchase",
    quantity_change: "5.000",
    reason: null,
  }],
  top_selling_products: [{ product_id: "8", net_quantity_sold: "20.000" }],
};

function loadRepository(resultDashboard = dashboardData) {
  capturedQuery = null;
  const mockedPool = {
    async query(sql, values) {
      capturedQuery = { sql, values };
      return { rows: [{ dashboard: resultDashboard }] };
    },
  };
  Module._load = function(request, parent, isMain) {
    if (request === "../config/database" && parent.filename === repositoryPath) {
      return mockedPool;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[repositoryPath];
  dashboardRepository = require(repositoryPath);
}

beforeEach(() => loadRepository());

after(() => {
  Module._load = originalLoad;
  delete require.cache[repositoryPath];
  delete require.cache[controllerPath];
});

test("returns the complete dashboard structure with monetary/quantity strings intact", async () => {
  const result = await dashboardRepository.getDashboard();
  assert.deepEqual(result, dashboardData);
  assert.equal(result.inventory.total_stock_quantity, "135.500");
  assert.equal(result.today.net_sales, "450.00");
  assert.equal(result.customer_credit.outstanding_balance, "175.00");
});

test("uses Kolkata day bounds with half-open timestamp filters", async () => {
  await dashboardRepository.getDashboard();
  assert.match(capturedQuery.sql, /Asia\/Kolkata/);
  assert.match(capturedQuery.sql, /sold_at >= day_bounds\.start_at/);
  assert.match(capturedQuery.sql, /sold_at < day_bounds\.end_at/);
  assert.match(capturedQuery.sql, /purchased_at >= day_bounds\.start_at/);
  assert.match(capturedQuery.sql, /purchased_at < day_bounds\.end_at/);
  assert.match(capturedQuery.sql, /paid_at >= day_bounds\.start_at/);
  assert.match(capturedQuery.sql, /paid_at < day_bounds\.end_at/);
  assert.doesNotMatch(capturedQuery.sql, /\bBETWEEN\b/i);
});

test("keeps independent aggregates separate and filters dashboard business events", async () => {
  await dashboardRepository.getDashboard();
  const sql = capturedQuery.sql;
  assert.match(sql, /inventory_summary AS/);
  assert.match(sql, /today_sales AS/);
  assert.match(sql, /today_purchases AS/);
  assert.match(sql, /today_payment_totals AS/);
  assert.match(sql, /customer_credit AS/);
  assert.match(sql, /s\.status = 'completed'/);
  assert.match(sql, /p\.status = 'received'/);
  assert.match(sql, /direction = 'received'/);
  assert.match(sql, /direction = 'refunded'/);
  assert.match(sql, /entry_type|direction = 'debit'/);
  assert.doesNotMatch(sql, /customer_credit[\s\S]*?JOIN payments/i);
});

test("excludes cancelled and draft quantities from net top sellers and returns", async () => {
  await dashboardRepository.getDashboard();
  const sql = capturedQuery.sql;
  assert.match(sql, /s\.type = 'sale' AND s\.status = 'completed'/);
  assert.match(sql, /r\.type = 'return' AND r\.status = 'completed'/);
  assert.match(sql, /sold_quantities\.quantity - COALESCE\(returned_quantities\.quantity, 0\)/);
});

test("makes one database query without interpolated request values", async () => {
  await dashboardRepository.getDashboard();
  assert.equal(capturedQuery.values, undefined);
  assert.equal(typeof capturedQuery.sql, "string");
});

test("serves GET /api/dashboard in the existing response envelope", async (t) => {
  const express = require("express");
  const serviceStub = {
    async getDashboard() {
      return dashboardData;
    },
  };
  Module._load = function(request, parent, isMain) {
    if (request === "../services/dashboardService" && parent.filename === controllerPath) {
      return serviceStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  delete require.cache[path.resolve(__dirname, "../server/src/routes/dashboardRoutes.js")];
  const routes = require("../server/src/routes/dashboardRoutes");
  Module._load = originalLoad;

  const app = express();
  app.use("/api/dashboard", routes);
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once("listening", resolve));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/dashboard`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "success",
    data: dashboardData,
  });
});

test("registers dashboard routes in the main Express application", () => {
  const appSource = fs.readFileSync(path.resolve(__dirname, "../server/src/app.js"), "utf8");
  assert.match(appSource, /require\(["']\.\/routes\/dashboardRoutes["']\)/);
  assert.match(appSource, /app\.use\(["']\/api\/dashboard["'],\s*dashboardRoutes\)/);
});
