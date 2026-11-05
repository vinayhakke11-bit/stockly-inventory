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
        console.error("Could not roll back stock adjustment transaction:", rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

async function createStockAdjustment({
  productId,
  quantityChange,
  reason,
  note,
  performedBy,
}) {
  return withTransaction(async (client) => {
    const productResult = await client.query(
      `SELECT id, name, sku, stock_on_hand::TEXT AS stock_on_hand, is_active
       FROM products
       WHERE id = $1
       FOR UPDATE`,
      [productId]
    );
    const product = productResult.rows[0];

    if (!product) {
      const error = new Error("Product not found.");
      error.code = "STOCK_ADJUSTMENT_PRODUCT_NOT_FOUND";
      throw error;
    }
    if (!product.is_active) {
      const error = new Error("Inactive products cannot be adjusted.");
      error.code = "STOCK_ADJUSTMENT_PRODUCT_INACTIVE";
      throw error;
    }
    await setPerformedBy(client, performedBy);
    const movementResult = await client.query(
      `INSERT INTO stock_movements (
         product_id, created_by, performed_by, movement_type,
         quantity_change, reason, note
       )
       VALUES ($1, $2, $2, 'adjustment', $3, $4, $5)
       RETURNING id, product_id, movement_type,
                 quantity_change::TEXT AS quantity_change, reason, note, created_at`,
      [productId, performedBy, quantityChange, reason, note]
    );
    const stockResult = await client.query(
      `SELECT p.stock_on_hand::TEXT AS stock_on_hand, u.username
       FROM products p
       JOIN users u ON u.id = $2
       WHERE p.id = $1`,
      [productId, performedBy]
    );

    return {
      ...movementResult.rows[0],
      product_name: product.name,
      sku: product.sku,
      stock_on_hand: stockResult.rows[0].stock_on_hand,
      performed_by: performedBy,
      performed_by_username: stockResult.rows[0].username,
    };
  });
}

async function getStockAdjustmentHistory({ productId = null } = {}) {
  const result = await pool.query(
    `SELECT sm.id, sm.product_id, p.name AS product_name, p.sku,
            sm.movement_type, sm.quantity_change::TEXT AS quantity_change,
            sm.reason, sm.note, sm.created_at, sm.performed_by,
            u.username AS performed_by_username
     FROM stock_movements sm
     JOIN products p ON p.id = sm.product_id
     JOIN users u ON u.id = sm.performed_by
     WHERE sm.movement_type = 'adjustment'
       AND ($1::BIGINT IS NULL OR sm.product_id = $1)
     ORDER BY sm.created_at DESC, sm.id DESC`,
    [productId]
  );

  return result.rows;
}

module.exports = {
  createStockAdjustment,
  getStockAdjustmentHistory,
};
