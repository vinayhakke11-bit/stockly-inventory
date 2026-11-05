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
        console.error("Could not roll back return transaction:", rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

function createRepositoryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function getReturnDetails(client, returnId) {
  const result = await client.query(
    `SELECT r.id, r.original_sale_id, r.customer_id, c.name AS customer_name,
            r.created_by, r.status, r.sold_at, r.created_at, r.updated_at,
            COALESCE(SUM(round(ri.quantity * ri.unit_price, 2)), 0)::numeric(20, 2) AS total
     FROM sales r
     LEFT JOIN customers c ON c.id = r.customer_id
     LEFT JOIN sale_items ri ON ri.sale_id = r.id
     WHERE r.id = $1 AND r.type = 'return'
     GROUP BY r.id, c.name`,
    [returnId]
  );
  const returnRecord = result.rows[0];
  if (!returnRecord) return null;

  const itemsResult = await client.query(
    `SELECT si.id, si.product_id, p.sku, p.name AS product_name,
            si.quantity, si.unit_price, round(si.quantity * si.unit_price, 2) AS line_total
     FROM sale_items si
     JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = $1
     ORDER BY si.id`,
    [returnId]
  );

  return { ...returnRecord, items: itemsResult.rows };
}

async function lockOriginalSale(client, saleId) {
  const result = await client.query(
    `SELECT id, customer_id, created_by, type, status
     FROM sales
     WHERE id = $1
     FOR UPDATE`,
    [saleId]
  );
  const originalSale = result.rows[0];

  if (!originalSale || originalSale.type !== "sale") {
    throw createRepositoryError("Original sale not found.", "RETURN_ORIGINAL_NOT_FOUND");
  }
  if (originalSale.status !== "completed") {
    throw createRepositoryError(
      "Only completed sales can be returned.",
      "RETURN_ORIGINAL_NOT_COMPLETED"
    );
  }

  return originalSale;
}

async function validateReturnItems(client, saleId, items) {
  const originalResult = await client.query(
    `SELECT product_id, quantity, unit_price
     FROM sale_items
     WHERE sale_id = $1
     ORDER BY product_id`,
    [saleId]
  );
  const originalItems = new Map(
    originalResult.rows.map((item) => [String(item.product_id), item])
  );

  const returnedResult = await client.query(
    `SELECT returned_item.product_id, COALESCE(SUM(returned_item.quantity), 0)::text AS quantity
     FROM sales returned_sale
     JOIN sale_items returned_item ON returned_item.sale_id = returned_sale.id
     WHERE returned_sale.original_sale_id = $1
       AND returned_sale.type = 'return'
       AND returned_sale.status = 'completed'
     GROUP BY returned_item.product_id`,
    [saleId]
  );
  const returnedQuantities = new Map(
    returnedResult.rows.map((item) => [String(item.product_id), item.quantity])
  );

  if (originalItems.size === 0) {
    throw createRepositoryError("Original sale has no items.", "RETURN_ORIGINAL_EMPTY");
  }

  for (const item of items) {
    const originalItem = originalItems.get(String(item.product_id));
    if (!originalItem) {
      throw createRepositoryError(
        `Product ${item.product_id} was not part of the original sale.`,
        "RETURN_PRODUCT_NOT_SOLD"
      );
    }

    const requested = BigInt(item.quantity_thousandths);
    const sold = toThousandths(originalItem.quantity);
    const returned = toThousandths(returnedQuantities.get(String(item.product_id)) || "0");
    if (returned + requested > sold) {
      throw createRepositoryError(
        `Return quantity exceeds the remaining eligible quantity for product ${item.product_id}.`,
        "RETURN_QUANTITY_EXCEEDED"
      );
    }
  }

  return originalItems;
}

async function createReturn(saleId, returnInput) {
  return withTransaction(async (client) => {
    const originalSale = await lockOriginalSale(client, saleId);
    const userResult = await client.query(
      "SELECT id FROM users WHERE id = $1",
      [returnInput.created_by]
    );
    if (!userResult.rows[0]) {
      throw createRepositoryError("User not found.", "RETURN_USER_NOT_FOUND");
    }

    const originalItems = await validateReturnItems(client, saleId, returnInput.items);
    const returnResult = await client.query(
      `INSERT INTO sales (customer_id, created_by, type, original_sale_id, status)
       VALUES ($1, $2, 'return', $3, 'draft')
       RETURNING id`,
      [originalSale.customer_id, returnInput.created_by, saleId]
    );
    const returnId = returnResult.rows[0].id;

    for (const item of returnInput.items) {
      const originalItem = originalItems.get(String(item.product_id));
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [returnId, item.product_id, item.quantity, originalItem.unit_price]
      );
    }

    return getReturnDetails(client, returnId);
  });
}

async function getReturnsBySaleId(saleId) {
  const saleResult = await pool.query(
    "SELECT id FROM sales WHERE id = $1 AND type = 'sale'",
    [saleId]
  );
  if (!saleResult.rows[0]) {
    return null;
  }

  const result = await pool.query(
    `SELECT r.id, r.original_sale_id, r.customer_id, r.created_by, r.status,
            r.sold_at, r.created_at, r.updated_at,
            COALESCE(SUM(round(ri.quantity * ri.unit_price, 2)), 0)::numeric(20, 2) AS total
     FROM sales r
     LEFT JOIN sale_items ri ON ri.sale_id = r.id
     WHERE r.original_sale_id = $1 AND r.type = 'return'
     GROUP BY r.id
     ORDER BY r.created_at ASC, r.id ASC`,
    [saleId]
  );

  return result.rows;
}

async function getAllReturns() {
  const result = await pool.query(
    `SELECT r.id, r.original_sale_id, r.customer_id, r.created_by, r.status,
            r.sold_at, r.created_at, r.updated_at,
            COALESCE(SUM(round(ri.quantity * ri.unit_price, 2)), 0)::numeric(20, 2) AS total
     FROM sales r
     LEFT JOIN sale_items ri ON ri.sale_id = r.id
     WHERE r.type = 'return'
     GROUP BY r.id
     ORDER BY r.created_at ASC, r.id ASC`
  );

  return result.rows;
}

async function getReturnById(returnId) {
  const client = await pool.connect();
  try {
    return await getReturnDetails(client, returnId);
  } finally {
    client.release();
  }
}

async function completeReturn(returnId, performedBy) {
  return withTransaction(async (client) => {
    const returnResult = await client.query(
      `SELECT id, original_sale_id, customer_id, created_by, type, status
       FROM sales
       WHERE id = $1
       FOR UPDATE`,
      [returnId]
    );
    const returnRecord = returnResult.rows[0];

    if (!returnRecord || returnRecord.type !== "return") {
      throw createRepositoryError("Return not found.", "RETURN_NOT_FOUND");
    }
    if (returnRecord.status !== "draft") {
      throw createRepositoryError(
        returnRecord.status === "completed"
          ? "Return has already been completed."
          : "Only draft returns can be completed.",
        returnRecord.status === "completed"
          ? "RETURN_ALREADY_COMPLETED"
          : "RETURN_NOT_DRAFT"
      );
    }

    await lockOriginalSale(client, returnRecord.original_sale_id);
    const returnItemsResult = await client.query(
      `SELECT product_id, quantity, unit_price
       FROM sale_items
       WHERE sale_id = $1
       ORDER BY product_id`,
      [returnId]
    );
    if (returnItemsResult.rows.length === 0) {
      throw createRepositoryError("A return must contain at least one item.", "RETURN_EMPTY");
    }
    const validationItems = returnItemsResult.rows.map((item) => ({
      product_id: String(item.product_id),
      quantity_thousandths: toThousandths(item.quantity).toString(),
    }));
    await validateReturnItems(client, returnRecord.original_sale_id, validationItems);

    const totalResult = await client.query(
      `SELECT COALESCE(SUM(round(quantity * unit_price, 2)), 0)::text AS total
       FROM sale_items
       WHERE sale_id = $1`,
      [returnId]
    );
    const total = totalResult.rows[0].total;
    if (returnRecord.customer_id !== null && toCents(total) <= 0n) {
      throw createRepositoryError(
        "A customer return must have a positive value to create a credit entry.",
        "RETURN_ZERO_TOTAL"
      );
    }

    await setPerformedBy(client, performedBy);
    await client.query(
      `UPDATE sales
       SET status = 'completed', updated_at = now()
       WHERE id = $1`,
      [returnId]
    );

    if (returnRecord.customer_id !== null) {
      await client.query(
        `INSERT INTO credit_transactions
           (customer_id, sale_id, entry_type, direction, amount, created_by)
         VALUES ($1, $2, 'return_credit', 'credit', $3, $4)`,
        [returnRecord.customer_id, returnId, total, returnRecord.created_by]
      );
    }

    return getReturnDetails(client, returnId);
  });
}

async function createRefund(returnId, refund) {
  return withTransaction(async (client) => {
    const returnResult = await client.query(
      `SELECT id, original_sale_id, customer_id, created_by, type, status
       FROM sales
       WHERE id = $1
       FOR UPDATE`,
      [returnId]
    );
    const returnRecord = returnResult.rows[0];
    if (!returnRecord || returnRecord.type !== "return") {
      throw createRepositoryError("Return not found.", "RETURN_NOT_FOUND");
    }

    await lockOriginalSale(client, returnRecord.original_sale_id);
    if (returnRecord.status !== "completed") {
      throw createRepositoryError(
        "Refunds can only be issued for completed returns.",
        "REFUND_RETURN_NOT_COMPLETED"
      );
    }

    const existingResult = await client.query(
      `SELECT id, sale_id, return_id, created_by, amount, method, reference,
              direction, paid_at, created_at,
              (
                sale_id = $1
                AND return_id = $2
                AND created_by = $3
                AND amount = $4::numeric
                AND method = $5
                AND reference IS NOT DISTINCT FROM $6
                AND direction = 'refunded'
              ) AS same_request
       FROM payments
       WHERE idempotency_key = $7`,
      [
        returnRecord.original_sale_id,
        returnId,
        refund.created_by,
        refund.amount,
        refund.method,
        refund.reference,
        refund.idempotency_key,
      ]
    );
    if (existingResult.rows[0]) {
      if (!existingResult.rows[0].same_request) {
        throw createRepositoryError(
          "This idempotency key was already used for a different request.",
          "REFUND_IDEMPOTENCY_CONFLICT"
        );
      }
      return { payment: existingResult.rows[0], replayed: true };
    }

    const userResult = await client.query(
      "SELECT id FROM users WHERE id = $1",
      [refund.created_by]
    );
    if (!userResult.rows[0]) {
      throw createRepositoryError("User not found.", "REFUND_USER_NOT_FOUND");
    }

    const limitResult = await client.query(
      `WITH return_total AS (
         SELECT COALESCE(SUM(round(quantity * unit_price, 2)), 0) AS amount
         FROM sale_items
         WHERE sale_id = $1
       ),
       return_refunds AS (
         SELECT COALESCE(SUM(amount), 0) AS amount
         FROM payments
         WHERE return_id = $1 AND direction = 'refunded'
       ),
       received_totals AS (
         SELECT
           COALESCE(SUM(amount) FILTER (WHERE direction = 'received'), 0) AS received,
           COALESCE(SUM(amount) FILTER (WHERE direction = 'refunded'), 0) AS refunded
         FROM payments
         WHERE sale_id = $2
       )
       SELECT LEAST(
         return_total.amount - return_refunds.amount,
         received_totals.received - received_totals.refunded
       )::text AS refundable
       FROM return_total, return_refunds, received_totals`,
      [returnId, returnRecord.original_sale_id]
    );
    if (toCents(limitResult.rows[0].refundable) < toCents(refund.amount)) {
      throw createRepositoryError(
        "Refund cannot exceed the remaining return value or net amount received.",
        "REFUND_EXCEEDS_ELIGIBLE_AMOUNT"
      );
    }

    const paymentResult = await client.query(
      `INSERT INTO payments
         (sale_id, return_id, created_by, direction, amount, method, reference, idempotency_key)
       VALUES ($1, $2, $3, 'refunded', $4, $5, $6, $7)
       RETURNING id, sale_id, return_id, created_by, direction, amount, method,
                 reference, paid_at, created_at`,
      [
        returnRecord.original_sale_id,
        returnId,
        refund.created_by,
        refund.amount,
        refund.method,
        refund.reference,
        refund.idempotency_key,
      ]
    );
    const savedPayment = paymentResult.rows[0];

    if (returnRecord.customer_id !== null) {
      await client.query(
        `INSERT INTO credit_transactions
           (customer_id, payment_id, entry_type, direction, amount, created_by)
         VALUES ($1, $2, 'refund', 'debit', $3, $4)`,
        [returnRecord.customer_id, savedPayment.id, savedPayment.amount, refund.created_by]
      );
    }

    return { payment: savedPayment, replayed: false };
  });
}

async function getRefundsByReturnId(returnId) {
  const result = await pool.query(
    `SELECT id, sale_id, return_id, created_by, direction, amount, method,
            reference, paid_at, created_at
     FROM payments
     WHERE return_id = $1 AND direction = 'refunded'
     ORDER BY paid_at ASC, id ASC`,
    [returnId]
  );
  return result.rows;
}

function toThousandths(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0").slice(0, 3));
}

function toCents(value) {
  const [whole, fraction = ""] = String(value).split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  return sign * (
    BigInt(whole.replace(/^-/, "")) * 100n +
    BigInt(fraction.padEnd(2, "0").slice(0, 2))
  );
}

module.exports = {
  createReturn,
  getReturnsBySaleId,
  getAllReturns,
  getReturnById,
  completeReturn,
  createRefund,
  getRefundsByReturnId,
};
