const pool = require("../config/database");

async function createCustomer({ name, phone, email, address }) {
  const result = await pool.query(
    `INSERT INTO customers (name, phone, email, address)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, email, address, is_active, created_at, updated_at`,
    [name, phone, email, address]
  );

  return result.rows[0];
}

async function getAllCustomers() {
  const result = await pool.query(
    `SELECT id, name, phone, email, address, is_active, created_at, updated_at
     FROM customers
     ORDER BY name ASC, id ASC`
  );

  return result.rows;
}

async function getCustomerById(id) {
  const result = await pool.query(
    `SELECT id, name, phone, email, address, is_active, created_at, updated_at
     FROM customers
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function getCustomerCreditSummary(id) {
  const result = await pool.query(
    `WITH ledger_summary AS (
       SELECT
         COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0.00::numeric) AS total_debit,
         COALESCE(SUM(amount) FILTER (WHERE direction = 'credit'), 0.00::numeric) AS total_credit,
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'sale_charge'), 0.00::numeric) AS total_purchases,
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'payment_received'), 0.00::numeric) AS total_payments
       FROM credit_transactions
       WHERE customer_id = $1
     )
     SELECT
       c.id, c.name, c.phone, c.email, c.address, c.is_active,
       c.created_at, c.updated_at,
       ledger_summary.total_debit::text AS total_debit,
       ledger_summary.total_credit::text AS total_credit,
       (ledger_summary.total_debit - ledger_summary.total_credit)::text AS outstanding_balance,
       ledger_summary.total_purchases::text AS total_purchases,
       ledger_summary.total_payments::text AS total_payments
     FROM customers c
     CROSS JOIN ledger_summary
     WHERE c.id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function getCustomerCreditTransactions(id) {
  const result = await pool.query(
    `SELECT
       ct.id AS transaction_id,
       ct.entry_type,
       ct.direction,
       ct.amount,
       ct.sale_id,
       ct.payment_id,
       ct.created_at AS transaction_date,
       ct.notes,
       s.type AS sale_type,
       s.status AS sale_status,
       s.sold_at,
       p.sale_id AS payment_sale_id,
       p.method AS payment_method,
       p.reference AS payment_reference,
       p.paid_at
     FROM credit_transactions ct
     LEFT JOIN sales s ON s.id = ct.sale_id
     LEFT JOIN payments p ON p.id = ct.payment_id
     WHERE ct.customer_id = $1
     ORDER BY ct.created_at ASC, ct.id ASC`,
    [id]
  );

  return result.rows;
}

async function getDuplicateCustomer(
  { name, phone, email, address },
  excludeId
) {
  const result = await pool.query(
    `SELECT id, name
     FROM customers
     WHERE lower(name) = lower($1)
       AND phone IS NOT DISTINCT FROM $2
       AND lower(COALESCE(email, '')) = lower(COALESCE($3, ''))
       AND address IS NOT DISTINCT FROM $4
       AND ($5::bigint IS NULL OR id <> $5)
     LIMIT 1`,
    [name, phone, email, address, excludeId || null]
  );

  return result.rows[0] || null;
}

async function customerHasHistory(id) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM sales WHERE customer_id = $1
       UNION ALL
       SELECT 1 FROM credit_transactions WHERE customer_id = $1
       UNION ALL
       SELECT 1
       FROM payments p
       JOIN sales s ON s.id = p.sale_id
       WHERE s.customer_id = $1
     ) AS has_history`,
    [id]
  );

  return result.rows[0].has_history;
}

async function updateCustomer(id, { name, phone, email, address }) {
  const result = await pool.query(
    `UPDATE customers
     SET name = $1,
         phone = $2,
         email = $3,
         address = $4,
         updated_at = now()
     WHERE id = $5
     RETURNING id, name, phone, email, address, is_active, created_at, updated_at`,
    [name, phone, email, address, id]
  );

  return result.rows[0] || null;
}

async function deleteCustomer(id) {
  const result = await pool.query(
    `DELETE FROM customers
     WHERE id = $1
     RETURNING id, name, phone, email, address, is_active, created_at, updated_at`,
    [id]
  );

  return result.rows[0] || null;
}

module.exports = {
  createCustomer,
  getAllCustomers,
  getCustomerById,
  getCustomerCreditSummary,
  getCustomerCreditTransactions,
  updateCustomer,
  deleteCustomer,
  getDuplicateCustomer,
  customerHasHistory,
};
