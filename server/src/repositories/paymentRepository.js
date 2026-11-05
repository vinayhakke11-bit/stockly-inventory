const pool = require("../config/database");

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
        console.error("Could not roll back payment transaction:", rollbackError);
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

function toCents(value) {
  const [whole, fraction = ""] = String(value).split(".");
  const sign = whole.startsWith("-") ? -1n : 1n;
  const absoluteWhole = whole.replace(/^-/, "");
  return sign * (
    BigInt(absoluteWhole) * 100n +
    BigInt(fraction.padEnd(2, "0").slice(0, 2))
  );
}

async function createPaymentInTransaction(client, saleId, payment) {
    const saleResult = await client.query(
      `SELECT id, customer_id, status, type
       FROM sales
       WHERE id = $1
       FOR UPDATE`,
      [saleId]
    );
    const sale = saleResult.rows[0];

    if (!sale) {
      throw createRepositoryError("Sale not found.", "PAYMENT_SALE_NOT_FOUND");
    }
    if (sale.type !== "sale") {
      throw createRepositoryError(
        "Payments can only be recorded for sales.",
        "PAYMENT_INVALID_SALE_TYPE"
      );
    }
    if (sale.status !== "completed") {
      throw createRepositoryError(
        "Payments can only be recorded for completed sales.",
        "PAYMENT_SALE_NOT_COMPLETED"
      );
    }

    const existingResult = await client.query(
      `SELECT id, sale_id, created_by, amount, method, reference,
              direction, paid_at, created_at,
              (
                sale_id = $1
                AND created_by = $2
                AND amount = $3::numeric
                AND method = $4
                AND reference IS NOT DISTINCT FROM $5
                AND direction = 'received'
              ) AS same_request
       FROM payments
       WHERE idempotency_key = $6`,
      [
        saleId,
        payment.created_by,
        payment.amount,
        payment.method,
        payment.reference,
        payment.idempotency_key,
      ]
    );

    if (existingResult.rows[0]) {
      if (!existingResult.rows[0].same_request) {
        throw createRepositoryError(
          "This idempotency key was already used for a different payment request.",
          "PAYMENT_IDEMPOTENCY_CONFLICT"
        );
      }

      return { payment: existingResult.rows[0], replayed: true };
    }

    const userResult = await client.query(
      "SELECT id FROM users WHERE id = $1",
      [payment.created_by]
    );
    if (!userResult.rows[0]) {
      throw createRepositoryError("User not found.", "PAYMENT_USER_NOT_FOUND");
    }

    const balanceResult = await client.query(
      `WITH sale_total AS (
         SELECT COALESCE(SUM(round(quantity * unit_price, 2)), 0) AS amount
         FROM sale_items
         WHERE sale_id = $1
       ),
       return_total AS (
         SELECT COALESCE(SUM(round(si.quantity * si.unit_price, 2)), 0) AS amount
         FROM sales return_sale
         JOIN sale_items si ON si.sale_id = return_sale.id
         WHERE return_sale.original_sale_id = $1
           AND return_sale.type = 'return'
           AND return_sale.status = 'completed'
       ),
       payment_total AS (
         SELECT COALESCE(
           SUM(CASE WHEN direction = 'received' THEN amount ELSE -amount END),
           0
         ) AS amount
         FROM payments
         WHERE sale_id = $1
       )
       SELECT (sale_total.amount - return_total.amount - payment_total.amount)::text
         AS outstanding
       FROM sale_total, return_total, payment_total`,
      [saleId]
    );
    const outstanding = balanceResult.rows[0].outstanding;

    if (toCents(outstanding) <= 0n) {
      throw createRepositoryError(
        "This sale has no outstanding balance.",
        "PAYMENT_NO_OUTSTANDING_BALANCE"
      );
    }
    if (toCents(payment.amount) > toCents(outstanding)) {
      throw createRepositoryError(
        "Payment cannot be greater than the outstanding balance.",
        "PAYMENT_EXCEEDS_BALANCE"
      );
    }

    const paymentResult = await client.query(
      `INSERT INTO payments
         (sale_id, created_by, direction, amount, method, reference, idempotency_key)
       VALUES ($1, $2, 'received', $3, $4, $5, $6)
       RETURNING id, sale_id, created_by, direction, amount, method,
                 reference, paid_at, created_at`,
      [
        saleId,
        payment.created_by,
        payment.amount,
        payment.method,
        payment.reference,
        payment.idempotency_key,
      ]
    );
    const savedPayment = paymentResult.rows[0];

    if (sale.customer_id !== null) {
      await client.query(
        `INSERT INTO credit_transactions
           (customer_id, payment_id, entry_type, direction, amount, created_by)
         VALUES ($1, $2, 'payment_received', 'credit', $3, $4)`,
        [sale.customer_id, savedPayment.id, savedPayment.amount, payment.created_by]
      );
    }

    return { payment: savedPayment, replayed: false };
}

async function createPayment(saleId, payment) {
  return withTransaction((client) =>
    createPaymentInTransaction(client, saleId, payment)
  );
}

async function saleExists(saleId) {
  const result = await pool.query(
    "SELECT EXISTS (SELECT 1 FROM sales WHERE id = $1) AS sale_exists",
    [saleId]
  );
  return result.rows[0].sale_exists;
}

async function getPaymentsBySaleId(saleId) {
  const result = await pool.query(
    `SELECT id, sale_id, created_by, direction, amount, method,
            reference, paid_at, created_at
     FROM payments
     WHERE sale_id = $1
     ORDER BY paid_at DESC, id DESC`,
    [saleId]
  );

  return result.rows;
}

async function getAllPayments({ method = null, from = null, to = null } = {}) {
  const result = await pool.query(
    `SELECT p.id, p.sale_id, p.created_by, u.username AS recorded_by,
            p.direction, p.amount::TEXT AS amount, p.method, p.reference,
            p.paid_at, p.created_at,
            s.customer_id, COALESCE(c.name, 'Walk-in Customer') AS customer_name,
            s.status AS sale_status, s.sold_at,
            COALESCE(
              (SELECT SUM(round(si.quantity * si.unit_price, 2))
               FROM sale_items si
               WHERE si.sale_id = s.id),
              0
            )::TEXT AS sale_total
     FROM payments p
     JOIN sales s ON s.id = p.sale_id
     JOIN users u ON u.id = p.created_by
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.type = 'sale'
       AND ($1::TEXT IS NULL OR p.method = $1)
       AND ($2::DATE IS NULL OR
            p.paid_at >= ($2::DATE::TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))
       AND ($3::DATE IS NULL OR
            p.paid_at < (($3::DATE + INTERVAL '1 day')::TIMESTAMP AT TIME ZONE 'Asia/Kolkata'))
     ORDER BY p.paid_at DESC, p.id DESC`,
    [method, from, to]
  );

  return result.rows;
}

module.exports = {
  createPayment,
  createPaymentInTransaction,
  saleExists,
  getPaymentsBySaleId,
  getAllPayments,
};
