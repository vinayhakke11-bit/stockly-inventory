const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { after, before, describe, test } = require("node:test");
const { randomBytes } = require("node:crypto");
const { Pool } = require("pg");

require("dotenv").config();

const root = path.resolve(__dirname, "..");
const migrationsDirectory = path.join(root, "database", "migrations");
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const skipReason = testDatabaseUrl
  ? false
  : "Set TEST_DATABASE_URL to run the PostgreSQL stock adjustment integration tests.";
const originalLoad = Module._load;

let adminPool;
let pool;
let schemaName;
let userA;
let userB;
let categoryId;
let stockAdjustmentService;
let stockAdjustmentController;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function loadStockAdjustmentModules(databasePool) {
  const repositoryPath = path.join(root, "server", "src", "repositories", "stockAdjustmentRepository.js");
  const productRepositoryPath = path.join(root, "server", "src", "repositories", "productRepository.js");
  const servicePath = path.join(root, "server", "src", "services", "stockAdjustmentService.js");
  const controllerPath = path.join(root, "server", "src", "controllers", "stockAdjustmentController.js");

  Module._load = function(request, parent, isMain) {
    if (request === "../config/database" &&
        [repositoryPath, productRepositoryPath].includes(parent.filename)) {
      return databasePool;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    for (const modulePath of [
      repositoryPath,
      productRepositoryPath,
      servicePath,
      controllerPath,
    ]) {
      delete require.cache[modulePath];
    }
    stockAdjustmentService = require(servicePath);
    stockAdjustmentController = require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

async function createProduct({ initialStock = "0.000", isActive = true } = {}) {
  const suffix = randomBytes(6).toString("hex");
  const result = await pool.query(
    `INSERT INTO products (category_id, sku, name, selling_price, is_active)
     VALUES ($1, $2, $3, 10.00, $4)
     RETURNING id`,
    [categoryId, `SA-${suffix}`, `Stock adjustment ${suffix}`, isActive]
  );
  const productId = result.rows[0].id;

  if (initialStock !== "0.000") {
    await pool.query(
      `INSERT INTO stock_movements (
         product_id, created_by, performed_by, movement_type, quantity_change, reason
       )
       VALUES ($1, $2, $2, 'adjustment', $3, 'integration_test_opening_stock')`,
      [productId, userA, initialStock]
    );
  }

  return productId;
}

async function getStock(productId) {
  const result = await pool.query(
    "SELECT stock_on_hand::TEXT AS stock_on_hand FROM products WHERE id = $1",
    [productId]
  );
  return result.rows[0]?.stock_on_hand ?? null;
}

async function getMovements(productId) {
  const result = await pool.query(
    `SELECT id, product_id, created_by, performed_by, movement_type,
            quantity_change::TEXT AS quantity_change, reason, note
     FROM stock_movements
     WHERE product_id = $1 AND movement_type = 'adjustment'
     ORDER BY id`,
    [productId]
  );
  return result.rows;
}

function adjustment(productId, values = {}) {
  return {
    product_id: String(productId),
    adjustment_type: "increase",
    quantity: "2.500",
    reason: "physical_count",
    ...values,
  };
}

function createResponse() {
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

describe("PostgreSQL stock adjustment integration", () => {
  before(async () => {
    if (!testDatabaseUrl) return;
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
    schemaName = `stockly_adjustment_it_${process.pid}_${randomBytes(4).toString("hex")}`;
    await adminPool.query(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    pool = new Pool({
      connectionString: testDatabaseUrl,
      max: 1,
      options: `-c search_path=${schemaName},public`,
    });

    const migrations = fs.readdirSync(migrationsDirectory)
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/i.test(name))
      .sort((left, right) => Number.parseInt(left, 10) - Number.parseInt(right, 10));
    for (const migration of migrations) {
      await pool.query(fs.readFileSync(path.join(migrationsDirectory, migration), "utf8"));
    }

    const roleResult = await pool.query("SELECT id FROM roles WHERE name = 'owner'");
    const roleId = roleResult.rows[0].id;
    const users = [];
    for (const label of ["a", "b"]) {
      const suffix = randomBytes(4).toString("hex");
      const userResult = await pool.query(
        `INSERT INTO users (role_id, username, email, password_hash)
         VALUES ($1, $2, $3, 'integration-test-hash')
         RETURNING id`,
        [roleId, `adjustment-test-${label}-${suffix}`, `adjustment-${label}-${suffix}@example.test`]
      );
      users.push(userResult.rows[0].id);
    }
    [userA, userB] = users;

    const categoryResult = await pool.query(
      "INSERT INTO categories (name) VALUES ($1) RETURNING id",
      [`Stock adjustment ${randomBytes(4).toString("hex")}`]
    );
    categoryId = categoryResult.rows[0].id;
    loadStockAdjustmentModules(pool);
  });

  after(async () => {
    try {
      if (pool) await pool.end();
    } finally {
      if (adminPool) {
        try {
          if (schemaName) {
            await adminPool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
          }
        } finally {
          await adminPool.end();
        }
      }
    }
  });

  test("increase adds stock through one positive adjustment movement", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "4.000" });
    const result = await stockAdjustmentService.createStockAdjustment(
      adjustment(productId, { quantity: "2.125" }),
      String(userA)
    );

    assert.equal(result.stock_on_hand, "6.125");
    assert.equal(await getStock(productId), "6.125");
    const movements = await getMovements(productId);
    assert.equal(movements.length, 2);
    assert.equal(movements[1].quantity_change, "2.125");
    assert.equal(movements[1].movement_type, "adjustment");
  });

  test("decrease subtracts stock through one negative adjustment movement", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "8.000" });
    await stockAdjustmentService.createStockAdjustment(
      adjustment(productId, {
        adjustment_type: "decrease",
        quantity: "3.250",
        reason: "damaged_goods",
      }),
      String(userA)
    );

    assert.equal(await getStock(productId), "4.750");
    const movements = await getMovements(productId);
    assert.equal(movements.at(-1).quantity_change, "-3.250");
  });

  test("decrease cannot reduce stock below zero", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "1.000" });
    const before = await getMovements(productId);

    await assert.rejects(
      stockAdjustmentService.createStockAdjustment(
        adjustment(productId, { adjustment_type: "decrease", quantity: "1.001" }),
        String(userA)
      ),
      { statusCode: 409 }
    );

    assert.equal(await getStock(productId), "1.000");
    assert.deepEqual(await getMovements(productId), before);
  });

  test("zero quantity is rejected", { skip: skipReason }, async () => {
    const productId = await createProduct();
    await assert.rejects(
      stockAdjustmentService.createStockAdjustment(
        adjustment(productId, { quantity: "0" }),
        String(userA)
      ),
      { statusCode: 400 }
    );
    assert.equal((await getMovements(productId)).length, 0);
  });

  test("negative quantity is rejected", { skip: skipReason }, async () => {
    const productId = await createProduct();
    await assert.rejects(
      stockAdjustmentService.createStockAdjustment(
        adjustment(productId, { quantity: "-1" }),
        String(userA)
      ),
      { statusCode: 400 }
    );
    assert.equal((await getMovements(productId)).length, 0);
  });

  test("invalid adjustment type is rejected", { skip: skipReason }, async () => {
    const productId = await createProduct();
    await assert.rejects(
      stockAdjustmentService.createStockAdjustment(
        adjustment(productId, { adjustment_type: "correction" }),
        String(userA)
      ),
      { statusCode: 400 }
    );
    assert.equal((await getMovements(productId)).length, 0);
  });

  test("invalid adjustment reason is rejected", { skip: skipReason }, async () => {
    const productId = await createProduct();
    await assert.rejects(
      stockAdjustmentService.createStockAdjustment(
        adjustment(productId, { reason: "made_up_reason" }),
        String(userA)
      ),
      { statusCode: 400 }
    );
    assert.equal((await getMovements(productId)).length, 0);
  });

  test("a nonexistent product is rejected", { skip: skipReason }, async () => {
    await assert.rejects(
      stockAdjustmentService.createStockAdjustment(adjustment("9223372036854775807"), String(userA)),
      { statusCode: 404 }
    );
  });

  test("inactive products are rejected without stock or movement changes", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "4.000", isActive: false });
    const beforeMovements = await getMovements(productId);
    await assert.rejects(
      stockAdjustmentService.createStockAdjustment(adjustment(productId), String(userA)),
      { statusCode: 409 }
    );
    assert.equal(await getStock(productId), "4.000");
    assert.deepEqual(await getMovements(productId), beforeMovements);
  });

  test("a missing reason is rejected", { skip: skipReason }, async () => {
    const productId = await createProduct();
    const input = adjustment(productId);
    delete input.reason;
    await assert.rejects(
      stockAdjustmentService.createStockAdjustment(input, String(userA)),
      { statusCode: 400 }
    );
    assert.equal((await getMovements(productId)).length, 0);
  });

  test("authenticated user is recorded as performer", { skip: skipReason }, async () => {
    const productId = await createProduct();
    await stockAdjustmentService.createStockAdjustment(adjustment(productId), String(userB));
    const movements = await getMovements(productId);

    assert.equal(String(movements[0].created_by), String(userB));
    assert.equal(String(movements[0].performed_by), String(userB));
  });

  test("client-supplied performed_by cannot override the authenticated user", { skip: skipReason }, async () => {
    const productId = await createProduct();
    const response = createResponse();
    await stockAdjustmentController.create({
      body: adjustment(productId, { performed_by: String(userA), created_by: String(userA) }),
      user: { id: String(userB) },
    }, response);

    assert.equal(response.statusCode, 201);
    const movements = await getMovements(productId);
    assert.equal(String(movements[0].created_by), String(userB));
    assert.equal(String(movements[0].performed_by), String(userB));
  });

  test("failed insert rolls back movement and performer state does not leak", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "3.000" });
    const beforeMovements = await getMovements(productId);
    const nonexistentUserId = "9223372036854775807";

    await assert.rejects(
      stockAdjustmentService.createStockAdjustment(adjustment(productId), nonexistentUserId),
      { statusCode: 404 }
    );
    assert.equal(await getStock(productId), "3.000");
    assert.deepEqual(await getMovements(productId), beforeMovements);

    await stockAdjustmentService.createStockAdjustment(adjustment(productId), String(userB));
    const movements = await getMovements(productId);
    assert.equal(movements.length, beforeMovements.length + 1);
    assert.equal(String(movements.at(-1).performed_by), String(userB));
  });

  test("history returns adjustment reason, note, and performer", { skip: skipReason }, async () => {
    const productId = await createProduct();
    await stockAdjustmentService.createStockAdjustment(
      adjustment(productId, { note: "Counted 12 units on the shelf." }),
      String(userA)
    );

    const history = await stockAdjustmentService.getStockAdjustmentHistory(String(productId));
    assert.equal(history.length, 1);
    assert.equal(String(history[0].product_id), String(productId));
    assert.equal(history[0].movement_type, "adjustment");
    assert.equal(history[0].quantity_change, "2.500");
    assert.equal(history[0].reason, "physical_count");
    assert.equal(history[0].note, "Counted 12 units on the shelf.");
    assert.match(history[0].performed_by_username, /^adjustment-test-a-/);
  });
});
