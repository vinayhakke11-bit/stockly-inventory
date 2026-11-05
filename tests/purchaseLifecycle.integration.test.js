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
  : "Set TEST_DATABASE_URL to run the PostgreSQL purchase lifecycle integration tests.";
const originalLoad = Module._load;

let adminPool;
let pool;
let schemaName;
let userA;
let userB;
let supplierA;
let supplierB;
let categoryId;
let purchaseService;
let purchaseController;

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function loadPurchaseModules(databasePool) {
  const repositoryPath = path.join(root, "server", "src", "repositories", "purchaseRepository.js");
  const servicePath = path.join(root, "server", "src", "services", "purchaseService.js");
  const controllerPath = path.join(root, "server", "src", "controllers", "purchaseController.js");

  Module._load = function(request, parent, isMain) {
    if (request === "../config/database" && parent.filename === repositoryPath) {
      return databasePool;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[repositoryPath];
    delete require.cache[servicePath];
    delete require.cache[controllerPath];
    purchaseService = require(servicePath);
    purchaseController = require(controllerPath);
  } finally {
    Module._load = originalLoad;
  }
}

async function createProduct({ initialStock = "0.000" } = {}) {
  const suffix = randomBytes(6).toString("hex");
  const result = await pool.query(
    `INSERT INTO products (category_id, sku, name, selling_price)
     VALUES ($1, $2, $3, 10.00)
     RETURNING id`,
    [categoryId, `PI-${suffix}`, `Purchase integration ${suffix}`]
  );
  const productId = result.rows[0].id;

  if (initialStock !== "0.000") {
    await pool.query(
      `INSERT INTO stock_movements (
         product_id, created_by, performed_by, movement_type, quantity_change, reason
       )
       VALUES ($1, $2, $2, 'adjustment', $3, 'Purchase lifecycle test starting stock')`,
      [productId, userA, initialStock]
    );
  }

  return productId;
}

async function createDraft(items, createdBy = userA, supplierId = supplierA) {
  return purchaseService.createPurchase({
    supplier_id: String(supplierId),
    items: items.map((item) => ({
      product_id: String(item.product_id),
      quantity: item.quantity,
      unit_cost: item.unit_cost ?? "1.00",
    })),
  }, String(createdBy));
}

async function getStock(productId) {
  const result = await pool.query(
    "SELECT stock_on_hand::TEXT AS stock_on_hand FROM products WHERE id = $1",
    [productId]
  );
  return result.rows[0].stock_on_hand;
}

async function getPurchase(purchaseId) {
  const result = await pool.query(
    "SELECT id, supplier_id, created_by, status FROM purchases WHERE id = $1",
    [purchaseId]
  );
  return result.rows[0];
}

async function getPurchaseItems(purchaseId) {
  const result = await pool.query(
    `SELECT id, product_id, quantity::TEXT AS quantity, unit_cost::TEXT AS unit_cost
     FROM purchase_items
     WHERE purchase_id = $1
     ORDER BY id`,
    [purchaseId]
  );
  return result.rows;
}

async function getPurchaseMovements(purchaseId) {
  const result = await pool.query(
    `SELECT sm.id, sm.purchase_item_id, sm.product_id,
            sm.quantity_change::TEXT AS quantity_change,
            sm.created_by, sm.performed_by
     FROM stock_movements sm
     JOIN purchase_items pi ON pi.id = sm.purchase_item_id
     WHERE pi.purchase_id = $1
       AND sm.movement_type = 'purchase'
     ORDER BY sm.id`,
    [purchaseId]
  );
  return result.rows;
}

async function getPurchaseMovementCount(purchaseId) {
  const result = await pool.query(
    `SELECT COUNT(*)::INTEGER AS count
     FROM stock_movements sm
     JOIN purchase_items pi ON pi.id = sm.purchase_item_id
     WHERE pi.purchase_id = $1`,
    [purchaseId]
  );
  return result.rows[0].count;
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

describe("PostgreSQL purchase lifecycle integration", () => {
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
    schemaName = `stockly_purchase_it_${process.pid}_${randomBytes(4).toString("hex")}`;
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
    const userAResult = await pool.query(
      `INSERT INTO users (role_id, username, email, password_hash)
       VALUES ($1, $2, $3, 'integration-test-hash')
       RETURNING id`,
      [roleId, `purchase-test-a-${randomBytes(4).toString("hex")}`, `purchase-a-${randomBytes(4).toString("hex")}@example.test`]
    );
    const userBResult = await pool.query(
      `INSERT INTO users (role_id, username, email, password_hash)
       VALUES ($1, $2, $3, 'integration-test-hash')
       RETURNING id`,
      [roleId, `purchase-test-b-${randomBytes(4).toString("hex")}`, `purchase-b-${randomBytes(4).toString("hex")}@example.test`]
    );
    userA = userAResult.rows[0].id;
    userB = userBResult.rows[0].id;

    const categoryResult = await pool.query(
      "INSERT INTO categories (name) VALUES ($1) RETURNING id",
      [`Purchase integration ${randomBytes(4).toString("hex")}`]
    );
    categoryId = categoryResult.rows[0].id;

    const supplierAResult = await pool.query(
      "INSERT INTO suppliers (name) VALUES ($1) RETURNING id",
      [`Purchase supplier A ${randomBytes(4).toString("hex")}`]
    );
    const supplierBResult = await pool.query(
      "INSERT INTO suppliers (name) VALUES ($1) RETURNING id",
      [`Purchase supplier B ${randomBytes(4).toString("hex")}`]
    );
    supplierA = supplierAResult.rows[0].id;
    supplierB = supplierBResult.rows[0].id;

    loadPurchaseModules(pool);
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

  test("draft creation leaves stock unchanged and creates no purchase movements", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "4.500" });
    const startingStock = await getStock(productId);
    const purchase = await createDraft([{
      product_id: productId,
      quantity: "2.250",
      unit_cost: "3.00",
    }]);

    assert.equal(purchase.status, "draft");
    assert.equal(await getStock(productId), startingStock);
    assert.equal(await getPurchaseMovementCount(purchase.id), 0);
  });

  test("receiving increases stock once and records one positive movement", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "2.000" });
    const purchase = await createDraft([{
      product_id: productId,
      quantity: "3.125",
      unit_cost: "4.50",
    }]);
    const startingStock = await getStock(productId);

    await purchaseService.receivePurchase(String(purchase.id), String(userB));

    assert.equal((await getPurchase(purchase.id)).status, "received");
    assert.equal(await getStock(productId), "5.125");
    const movements = await getPurchaseMovements(purchase.id);
    assert.equal(movements.length, 1);
    assert.equal(movements[0].quantity_change, "3.125");
    assert.ok(Number(movements[0].quantity_change) > 0);
    assert.equal(startingStock, "2.000");
  });

  test("a second receive is rejected without changing stock or adding movements", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "1.000" });
    const purchase = await createDraft([{
      product_id: productId,
      quantity: "2.000",
      unit_cost: "2.00",
    }]);
    await purchaseService.receivePurchase(String(purchase.id), String(userB));
    const stockAfterFirstReceive = await getStock(productId);

    await assert.rejects(
      purchaseService.receivePurchase(String(purchase.id), String(userB)),
      { statusCode: 409, message: "Purchase has already been received." }
    );

    assert.equal((await getPurchase(purchase.id)).status, "received");
    assert.equal(await getStock(productId), stockAfterFirstReceive);
    assert.equal((await getPurchaseMovements(purchase.id)).length, 1);
  });

  test("editing a draft changes its saved data but not stock or movements", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "7.250" });
    const startingStock = await getStock(productId);
    const purchase = await createDraft([{
      product_id: productId,
      quantity: "1.000",
      unit_cost: "2.00",
    }]);

    const updated = await purchaseService.updatePurchase(String(purchase.id), {
      supplier_id: String(supplierB),
      items: [{
        product_id: String(productId),
        quantity: "4.125",
        unit_cost: "5.75",
      }],
    });

    assert.equal(updated.status, "draft");
    assert.equal(String(updated.supplier_id), String(supplierB));
    assert.equal(await getStock(productId), startingStock);
    assert.equal(await getPurchaseMovementCount(purchase.id), 0);
    const updatedItems = await getPurchaseItems(purchase.id);
    assert.equal(updatedItems.length, 1);
    assert.deepEqual({
      product_id: updatedItems[0].product_id,
      quantity: updatedItems[0].quantity,
      unit_cost: updatedItems[0].unit_cost,
    }, {
      product_id: String(productId),
      quantity: "4.125",
      unit_cost: "5.75",
    });
  });

  test("purchase creator and authenticated receiver are attributed separately", { skip: skipReason }, async () => {
    const productId = await createProduct();
    const purchase = await createDraft([{
      product_id: productId,
      quantity: "2.500",
      unit_cost: "1.00",
    }], userA);

    await purchaseService.receivePurchase(String(purchase.id), String(userB));

    assert.equal(String((await getPurchase(purchase.id)).created_by), String(userA));
    const movements = await getPurchaseMovements(purchase.id);
    assert.equal(movements.length, 1);
    assert.equal(String(movements[0].created_by), String(userA));
    assert.equal(String(movements[0].performed_by), String(userB));
  });

  test("client-supplied performed_by cannot override the authenticated receiver", { skip: skipReason }, async () => {
    const productId = await createProduct();
    const purchase = await createDraft([{
      product_id: productId,
      quantity: "1.500",
      unit_cost: "1.00",
    }], userA);
    const response = createResponse();

    await purchaseController.receive({
      params: { id: String(purchase.id) },
      body: { performed_by: String(userA) },
      user: { id: String(userB) },
    }, response);

    assert.equal(response.statusCode, 200);
    const movements = await getPurchaseMovements(purchase.id);
    assert.equal(movements.length, 1);
    assert.equal(String(movements[0].created_by), String(userA));
    assert.equal(String(movements[0].performed_by), String(userB));
  });

  test("received purchases cannot be edited", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "2.000" });
    const purchase = await createDraft([{
      product_id: productId,
      quantity: "3.000",
      unit_cost: "4.00",
    }]);
    await purchaseService.receivePurchase(String(purchase.id), String(userB));
    const beforePurchase = await getPurchase(purchase.id);
    const beforeItems = await getPurchaseItems(purchase.id);
    const beforeStock = await getStock(productId);
    const beforeMovementCount = await getPurchaseMovementCount(purchase.id);

    await assert.rejects(
      purchaseService.updatePurchase(String(purchase.id), {
        supplier_id: String(supplierB),
        items: [{
          product_id: String(productId),
          quantity: "9.000",
          unit_cost: "99.00",
        }],
      }),
      { statusCode: 409, message: "Only draft purchases can be edited." }
    );

    assert.deepEqual(await getPurchase(purchase.id), beforePurchase);
    assert.deepEqual(await getPurchaseItems(purchase.id), beforeItems);
    assert.equal(await getStock(productId), beforeStock);
    assert.equal(await getPurchaseMovementCount(purchase.id), beforeMovementCount);
  });

  test("received purchases cannot be cancelled", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "5.000" });
    const purchase = await createDraft([{
      product_id: productId,
      quantity: "2.000",
      unit_cost: "4.00",
    }]);
    await purchaseService.receivePurchase(String(purchase.id), String(userB));
    const beforeStock = await getStock(productId);
    const beforeMovements = await getPurchaseMovements(purchase.id);

    await assert.rejects(
      purchaseService.deletePurchase(String(purchase.id)),
      { statusCode: 409, message: "Only draft purchases can be cancelled." }
    );

    assert.equal((await getPurchase(purchase.id)).status, "received");
    assert.equal(await getStock(productId), beforeStock);
    assert.deepEqual(await getPurchaseMovements(purchase.id), beforeMovements);
  });

  test("a failed receive rolls back status, stock, movements, and local performer state", { skip: skipReason }, async () => {
    const productId = await createProduct({ initialStock: "999999999.999" });
    const purchase = await createDraft([{
      product_id: productId,
      quantity: "0.001",
      unit_cost: "1.00",
    }]);

    await assert.rejects(
      purchaseService.receivePurchase(String(purchase.id), String(userB)),
      { code: "22003" }
    );

    assert.equal((await getPurchase(purchase.id)).status, "draft");
    assert.equal(await getStock(productId), "999999999.999");
    assert.equal(await getPurchaseMovementCount(purchase.id), 0);

    const client = await pool.connect();
    try {
      const setting = await client.query(
        "SELECT current_setting('stockly.performed_by', true) AS performed_by"
      );
      assert.ok(
        setting.rows[0].performed_by === null ||
        setting.rows[0].performed_by === "",
        "transaction-local performer must not remain set after rollback"
      );
    } finally {
      client.release();
    }
  });

  test("receiving a multi-item purchase creates one correctly attributed movement per item", { skip: skipReason }, async () => {
    const firstProductId = await createProduct({ initialStock: "1.000" });
    const secondProductId = await createProduct({ initialStock: "8.500" });
    const purchase = await createDraft([
      { product_id: firstProductId, quantity: "2.250", unit_cost: "2.00" },
      { product_id: secondProductId, quantity: "0.750", unit_cost: "3.00" },
    ], userA);
    const itemsBeforeReceive = await getPurchaseItems(purchase.id);

    await purchaseService.receivePurchase(String(purchase.id), String(userB));

    assert.equal((await getPurchase(purchase.id)).status, "received");
    assert.equal(await getStock(firstProductId), "3.250");
    assert.equal(await getStock(secondProductId), "9.250");
    const movements = await getPurchaseMovements(purchase.id);
    assert.equal(movements.length, 2);
    assert.deepEqual(
      movements.map((movement) => ({
        purchase_item_id: String(movement.purchase_item_id),
        product_id: String(movement.product_id),
        quantity_change: movement.quantity_change,
        created_by: String(movement.created_by),
        performed_by: String(movement.performed_by),
      })),
      itemsBeforeReceive.map((item) => ({
        purchase_item_id: String(item.id),
        product_id: String(item.product_id),
        quantity_change: item.quantity,
        created_by: String(userA),
        performed_by: String(userB),
      }))
    );
  });
});
