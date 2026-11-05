const pool = require("../config/database");
const { setPerformedBy } = require("./stockMovementRepository");
const paymentRepository = require("./paymentRepository");
const receiptRepository = require("./receiptRepository");

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
        console.error("Could not roll back sale transaction:", rollbackError);
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

async function getSaleItems(client, saleId) {
  const result = await client.query(
    `SELECT si.id, si.product_id, p.sku, p.name AS product_name,
            si.quantity, si.unit_price,
            round(si.quantity * si.unit_price, 2) AS line_total
     FROM sale_items si
     JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = $1
     ORDER BY si.id`,
    [saleId]
  );

  return result.rows;
}

async function getSaleDetails(client, saleId) {
  const saleResult = await client.query(
    `SELECT s.id, s.customer_id, c.name AS customer_name, s.created_by,
            s.type, s.status, s.sold_at, s.created_at, s.updated_at,
            COALESCE(
              sum(round(si.quantity * si.unit_price, 2)),
              0
            )::numeric(20, 2) AS total
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN sale_items si ON si.sale_id = s.id
     WHERE s.id = $1
     GROUP BY s.id, c.name`,
    [saleId]
  );

  if (!saleResult.rows[0]) {
    return null;
  }

  return {
    ...saleResult.rows[0],
    items: await getSaleItems(client, saleId),
  };
}

async function validateReferences(client, { customer_id, created_by, items }) {
  const userResult = await client.query(
    "SELECT id FROM users WHERE id = $1",
    [created_by]
  );
  if (!userResult.rows[0]) {
    const error = new Error("User not found.");
    error.code = "SALE_USER_NOT_FOUND";
    throw error;
  }

  if (customer_id !== null) {
    const customerResult = await client.query(
      "SELECT id FROM customers WHERE id = $1",
      [customer_id]
    );
    if (!customerResult.rows[0]) {
      const error = new Error("Customer not found.");
      error.code = "SALE_CUSTOMER_NOT_FOUND";
      throw error;
    }
  }

  const productIds = items.map((item) => item.product_id);
  const productsResult = await client.query(
    `SELECT id, is_active
     FROM products
     WHERE id = ANY($1::bigint[])
     ORDER BY id`,
    [productIds]
  );
  const productsById = new Map(
    productsResult.rows.map((product) => [String(product.id), product])
  );

  for (const productId of productIds) {
    const product = productsById.get(String(productId));
    if (!product) {
      const error = new Error(`Product not found: ${productId}.`);
      error.code = "SALE_PRODUCT_NOT_FOUND";
      throw error;
    }
    if (!product.is_active) {
      const error = new Error(`Product ${productId} is inactive.`);
      error.code = "SALE_PRODUCT_INACTIVE";
      throw error;
    }
  }
}

async function insertSaleItems(client, saleId, items) {
  for (const item of items) {
    await client.query(
      `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price)
       VALUES ($1, $2, $3, $4)`,
      [saleId, item.product_id, item.quantity, item.unit_price]
    );
  }
}

async function createSale({ customer_id, created_by, items }) {
  return withTransaction(async (client) => {
    await validateReferences(client, { customer_id, created_by, items });

    const result = await client.query(
      `INSERT INTO sales (customer_id, created_by, type, status)
       VALUES ($1, $2, 'sale', 'draft')
       RETURNING id`,
      [customer_id, created_by]
    );
    const saleId = result.rows[0].id;

    await insertSaleItems(client, saleId, items);
    return getSaleDetails(client, saleId);
  });
}

async function getAllSales() {
  const result = await pool.query(
    `SELECT s.id, s.customer_id, c.name AS customer_name, s.created_by,
            s.type, s.status, s.sold_at, s.created_at, s.updated_at,
            COUNT(si.id)::INTEGER AS item_count,
            COALESCE(
              sum(round(si.quantity * si.unit_price, 2)),
              0
            )::numeric(20, 2) AS total
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN sale_items si ON si.sale_id = s.id
     WHERE s.type = 'sale'
     GROUP BY s.id, c.name
     ORDER BY s.sold_at DESC, s.id DESC`
  );

  return result.rows;
}

async function getSaleById(id) {
  const client = await pool.connect();
  try {
    const sale = await getSaleDetails(client, id);
    return sale?.status && sale.type === "return" ? null : sale;
  } finally {
    client.release();
  }
}

async function updateSale(id, { customer_id, items }) {
  return withTransaction(async (client) => {
    const saleResult = await client.query(
      "SELECT id, status, type, created_by FROM sales WHERE id = $1 FOR UPDATE",
      [id]
    );
    const sale = saleResult.rows[0];

    if (!sale || sale.type !== "sale") {
      return null;
    }
    if (sale.status !== "draft") {
      const error = new Error("Only draft sales can be edited.");
      error.code = "SALE_NOT_DRAFT";
      throw error;
    }

    await validateReferences(client, {
      customer_id,
      created_by: sale.created_by,
      items,
    });

    await client.query(
      `UPDATE sales
       SET customer_id = $1, updated_at = now()
       WHERE id = $2`,
      [customer_id, id]
    );
    await client.query("DELETE FROM sale_items WHERE sale_id = $1", [id]);
    await insertSaleItems(client, id, items);

    return getSaleDetails(client, id);
  });
}

async function completeSale(id, {
  performedBy,
  cashierUsername,
  initialPayment,
}) {
  return withTransaction(async (client) => {
    const saleResult = await client.query(
      "SELECT id, status, type, customer_id, created_by FROM sales WHERE id = $1 FOR UPDATE",
      [id]
    );
    const sale = saleResult.rows[0];

    if (!sale || sale.type !== "sale") {
      return null;
    }
    if (sale.status !== "draft") {
      const error = new Error(
        sale.status === "completed"
          ? "Sale has already been completed."
          : "Only draft sales can be completed."
      );
      error.code = sale.status === "completed"
        ? "SALE_ALREADY_COMPLETED"
        : "SALE_NOT_DRAFT";
      throw error;
    }

    const itemsResult = await client.query(
      `SELECT product_id, quantity, unit_price
       FROM sale_items
       WHERE sale_id = $1
       ORDER BY product_id`,
      [id]
    );
    if (itemsResult.rows.length === 0) {
      const error = new Error("A sale must contain items before it can be completed.");
      error.code = "SALE_HAS_NO_ITEMS";
      throw error;
    }

    let saleTotal;
    if (sale.customer_id !== null) {
      const totalResult = await client.query(
        `SELECT COALESCE(SUM(round(quantity * unit_price, 2)), 0)::text AS total
         FROM sale_items
         WHERE sale_id = $1`,
        [id]
      );
      saleTotal = totalResult.rows[0].total;

      if (toCents(saleTotal) <= 0n) {
        const error = new Error(
          "A customer-linked sale must have a total greater than zero to create a credit entry."
        );
        error.code = "SALE_ZERO_TOTAL";
        throw error;
      }
    }

    const productIds = itemsResult.rows.map((item) => item.product_id);
    const productsResult = await client.query(
      `SELECT id, name, sku, is_active, stock_on_hand
       FROM products
       WHERE id = ANY($1::bigint[])
       ORDER BY id
       FOR UPDATE`,
      [productIds]
    );
    const productsById = new Map(
      productsResult.rows.map((product) => [String(product.id), product])
    );

    for (const item of itemsResult.rows) {
      const product = productsById.get(String(item.product_id));
      if (!product) {
        const error = new Error(`Product not found: ${item.product_id}.`);
        error.code = "SALE_PRODUCT_NOT_FOUND";
        throw error;
      }
      if (!product.is_active) {
        const error = new Error(`Product ${item.product_id} is inactive.`);
        error.code = "SALE_PRODUCT_INACTIVE";
        throw error;
      }
      if (toThousandths(product.stock_on_hand) < toThousandths(item.quantity)) {
        const error = new Error(
          `Insufficient stock for product ${item.product_id} (${product.name}).`
        );
        error.code = "SALE_INSUFFICIENT_STOCK";
        throw error;
      }
    }

    await setPerformedBy(client, performedBy);
    await client.query(
      `UPDATE sales
       SET status = 'completed', updated_at = now()
       WHERE id = $1`,
      [id]
    );

    if (sale.customer_id !== null) {
      try {
        await client.query(
          `INSERT INTO credit_transactions
             (customer_id, sale_id, entry_type, direction, amount, created_by)
           VALUES ($1, $2, 'sale_charge', 'debit', $3, $4)`,
          [sale.customer_id, sale.id, saleTotal, sale.created_by]
        );
      } catch (error) {
        if (
          error.code === "23505" &&
          error.constraint === "credit_transactions_sale_id_unique_idx"
        ) {
          error.code = "SALE_CREDIT_ENTRY_EXISTS";
        }
        throw error;
      }
    }

    if (initialPayment) {
      await paymentRepository.createPaymentInTransaction(client, id, initialPayment);
    }

    await receiptRepository.createReceipt(client, {
      saleId: id,
      issuedBy: performedBy,
      cashierUsername,
      customerId: sale.customer_id,
    });

    return getSaleDetails(client, id);
  });
}

async function deleteSale(id) {
  return withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE sales
       SET status = 'cancelled', updated_at = now()
       WHERE id = $1 AND type = 'sale' AND status = 'draft'
       RETURNING id`,
      [id]
    );

    if (!result.rows[0]) {
      const existingResult = await client.query(
        "SELECT id, status, type FROM sales WHERE id = $1",
        [id]
      );
      const sale = existingResult.rows[0];

      if (!sale || sale.type !== "sale") {
        return null;
      }

      const error = new Error("Only draft sales can be cancelled.");
      error.code = "SALE_NOT_DRAFT";
      throw error;
    }

    return getSaleDetails(client, id);
  });
}

function toThousandths(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0").slice(0, 3));
}

function toCents(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

module.exports = {
  createSale,
  getAllSales,
  getSaleById,
  updateSale,
  deleteSale,
  completeSale,
};
