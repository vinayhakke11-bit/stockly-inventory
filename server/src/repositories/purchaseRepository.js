const pool = require("../config/database");
const { setPerformedBy } = require("./stockMovementRepository");

async function withTransaction(operation) {
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query("BEGIN");
    transactionStarted = true;

    const result = await operation(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        console.error("Could not roll back purchase transaction:", rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

async function getPurchaseItems(client, purchaseId) {
  const result = await client.query(
    `SELECT pi.id, pi.product_id, p.sku, p.name AS product_name,
            pi.quantity, pi.unit_cost
     FROM purchase_items pi
     JOIN products p ON p.id = pi.product_id
     WHERE pi.purchase_id = $1
     ORDER BY pi.id`,
    [purchaseId]
  );

  return result.rows;
}

async function getPurchaseDetails(client, purchaseId) {
  const purchaseResult = await client.query(
    `SELECT p.id, p.supplier_id, s.name AS supplier_name, p.created_by,
            p.status, p.purchased_at, p.created_at, p.updated_at
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.id = $1`,
    [purchaseId]
  );

  if (!purchaseResult.rows[0]) {
    return null;
  }

  return {
    ...purchaseResult.rows[0],
    items: await getPurchaseItems(client, purchaseId),
  };
}

async function getSupplier(client, supplierId) {
  const result = await client.query(
    "SELECT id FROM suppliers WHERE id = $1",
    [supplierId]
  );
  return result.rows[0] || null;
}

async function getUser(client, userId) {
  const result = await client.query(
    "SELECT id FROM users WHERE id = $1",
    [userId]
  );
  return result.rows[0] || null;
}

async function getProduct(client, productId) {
  const result = await client.query(
    "SELECT id FROM products WHERE id = $1",
    [productId]
  );
  return result.rows[0] || null;
}

async function createPurchase({ supplier_id, created_by, items }) {
  return withTransaction(async (client) => {
    if (!(await getSupplier(client, supplier_id))) {
      const error = new Error("Supplier not found.");
      error.code = "PURCHASE_SUPPLIER_NOT_FOUND";
      throw error;
    }
    if (!(await getUser(client, created_by))) {
      const error = new Error("User not found.");
      error.code = "PURCHASE_USER_NOT_FOUND";
      throw error;
    }

    for (const item of items) {
      if (!(await getProduct(client, item.product_id))) {
        const error = new Error(`Product not found: ${item.product_id}.`);
        error.code = "PURCHASE_PRODUCT_NOT_FOUND";
        throw error;
      }
    }

    const purchaseResult = await client.query(
      `INSERT INTO purchases (supplier_id, created_by, status)
       VALUES ($1, $2, 'draft')
       RETURNING id`,
      [supplier_id, created_by]
    );
    const purchaseId = purchaseResult.rows[0].id;

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost)
         VALUES ($1, $2, $3, $4)`,
        [purchaseId, item.product_id, item.quantity, item.unit_cost]
      );
    }

    return getPurchaseDetails(client, purchaseId);
  });
}

async function getAllPurchases() {
  const result = await pool.query(
    `SELECT p.id, p.supplier_id, s.name AS supplier_name, p.created_by,
            p.status, p.purchased_at, p.created_at, p.updated_at,
            COUNT(pi.id)::INTEGER AS item_count
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
     GROUP BY p.id, s.name
     ORDER BY p.purchased_at DESC, p.id DESC`
  );

  return result.rows;
}

async function getPurchaseById(id) {
  const client = await pool.connect();
  try {
    return await getPurchaseDetails(client, id);
  } finally {
    client.release();
  }
}

async function updatePurchase(id, { supplier_id, items }) {
  return withTransaction(async (client) => {
    const purchaseResult = await client.query(
      "SELECT id, status FROM purchases WHERE id = $1 FOR UPDATE",
      [id]
    );
    const purchase = purchaseResult.rows[0];

    if (!purchase) {
      return null;
    }
    if (purchase.status !== "draft") {
      const error = new Error("Only draft purchases can be edited.");
      error.code = "PURCHASE_NOT_DRAFT";
      throw error;
    }
    if (!(await getSupplier(client, supplier_id))) {
      const error = new Error("Supplier not found.");
      error.code = "PURCHASE_SUPPLIER_NOT_FOUND";
      throw error;
    }
    for (const item of items) {
      if (!(await getProduct(client, item.product_id))) {
        const error = new Error(`Product not found: ${item.product_id}.`);
        error.code = "PURCHASE_PRODUCT_NOT_FOUND";
        throw error;
      }
    }

    await client.query(
      `UPDATE purchases
       SET supplier_id = $1, updated_at = now()
       WHERE id = $2`,
      [supplier_id, id]
    );
    await client.query("DELETE FROM purchase_items WHERE purchase_id = $1", [id]);

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost)
         VALUES ($1, $2, $3, $4)`,
        [id, item.product_id, item.quantity, item.unit_cost]
      );
    }

    return getPurchaseDetails(client, id);
  });
}

async function receivePurchase(id, performedBy) {
  return withTransaction(async (client) => {
    const purchaseResult = await client.query(
      "SELECT id, status FROM purchases WHERE id = $1 FOR UPDATE",
      [id]
    );
    const purchase = purchaseResult.rows[0];

    if (!purchase) {
      return null;
    }
    if (purchase.status !== "draft") {
      const error = new Error(
        purchase.status === "received"
          ? "Purchase has already been received."
          : "Only draft purchases can be received."
      );
      error.code = purchase.status === "received"
        ? "PURCHASE_ALREADY_RECEIVED"
        : "PURCHASE_NOT_DRAFT";
      throw error;
    }

    await setPerformedBy(client, performedBy);
    await client.query(
      `UPDATE purchases
       SET status = 'received', updated_at = now()
       WHERE id = $1`,
      [id]
    );

    return getPurchaseDetails(client, id);
  });
}

async function deletePurchase(id) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE purchases
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING id`,
      [id]
    );

    if (!result.rows[0]) {
      const existing = await client.query(
        "SELECT id, status FROM purchases WHERE id = $1",
        [id]
      );
      if (!existing.rows[0]) {
        return null;
      }

      const error = new Error("Only draft purchases can be cancelled.");
      error.code = "PURCHASE_NOT_DRAFT";
      throw error;
    }

    return getPurchaseDetails(client, id);
  });
}

module.exports = {
  createPurchase,
  getAllPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase,
  receivePurchase,
};
