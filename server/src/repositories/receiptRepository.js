const pool = require("../config/database");

function readShopSnapshot(value) {
  const settings = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const textOrNull = (field) =>
    typeof settings[field] === "string" && settings[field].trim()
      ? settings[field].trim()
      : null;

  return {
    shop_name: textOrNull("name") || "",
    shop_address: textOrNull("address"),
    shop_phone: textOrNull("phone"),
  };
}

function toCents(value) {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
}

async function getShopSnapshot(client) {
  const result = await client.query(
    "SELECT value FROM shop_settings WHERE key = 'shop'"
  );
  return readShopSnapshot(result.rows[0]?.value);
}

async function getReceiptBySaleId(client, saleId) {
  const receiptResult = await client.query(
    `SELECT id, sale_id, receipt_number, issued_at, issued_by, cashier_username,
            customer_name, customer_phone, customer_email, customer_address,
            shop_name, shop_address, shop_phone, subtotal, total, amount_paid,
            outstanding_amount, currency_code, created_at
     FROM receipts
     WHERE sale_id = $1`,
    [saleId]
  );
  const receipt = receiptResult.rows[0];
  if (!receipt) return null;

  const [itemsResult, paymentsResult] = await Promise.all([
    client.query(
      `SELECT id, receipt_id, product_id, product_name, product_sku, quantity,
              unit_price, line_total, created_at
       FROM receipt_items
       WHERE receipt_id = $1
       ORDER BY id`,
      [receipt.id]
    ),
    client.query(
      `SELECT p.id, p.amount, p.method, p.reference, p.paid_at
       FROM payments p
       JOIN receipts r ON r.sale_id = p.sale_id
       WHERE p.sale_id = $1
         AND p.direction = 'received'
         AND p.created_at <= r.issued_at
       ORDER BY p.paid_at, p.id`,
      [receipt.sale_id]
    ),
  ]);

  return {
    ...receipt,
    items: itemsResult.rows,
    payments: paymentsResult.rows,
  };
}

async function createReceipt(client, {
  saleId,
  issuedBy,
  cashierUsername,
  customerId,
}) {
  const customerResult = customerId === null
    ? { rows: [] }
    : await client.query(
      `SELECT name, phone, email, address
       FROM customers
       WHERE id = $1
       FOR SHARE`,
      [customerId]
    );
  const customer = customerResult.rows[0];
  if (customerId !== null && !customer) {
    const error = new Error("Customer not found while creating receipt.");
    error.code = "SALE_CUSTOMER_NOT_FOUND";
    throw error;
  }
  const shop = await getShopSnapshot(client);

  const totalsResult = await client.query(
    `WITH sale_total AS (
       SELECT COALESCE(SUM(round(quantity * unit_price, 2)), 0)::numeric(12, 2) AS total
       FROM sale_items
       WHERE sale_id = $1
     ),
     payment_total AS (
       SELECT COALESCE(
         SUM(CASE WHEN direction = 'received' THEN amount ELSE -amount END),
         0
       )::numeric(12, 2) AS amount_paid
       FROM payments
       WHERE sale_id = $1
     )
     SELECT sale_total.total AS subtotal,
            sale_total.total AS total,
            payment_total.amount_paid,
            (sale_total.total - payment_total.amount_paid)::numeric(12, 2)
              AS outstanding_amount
     FROM sale_total, payment_total`,
    [saleId]
  );
  const totals = totalsResult.rows[0];
  if (toCents(totals.amount_paid) < 0n || toCents(totals.outstanding_amount) < 0n) {
    throw new Error("Receipt payment totals are outside the sale total.");
  }

  let receiptResult;
  try {
    receiptResult = await client.query(
      `INSERT INTO receipts (
         sale_id, issued_by, cashier_username,
         customer_name, customer_phone, customer_email, customer_address,
         shop_name, shop_address, shop_phone,
         subtotal, total, amount_paid, outstanding_amount, currency_code
       )
       VALUES (
         $1, $2, $3,
         $4, $5, $6, $7,
         $8, $9, $10,
         $11, $12, $13, $14, 'INR'
       )
       RETURNING id`,
      [
        saleId,
        issuedBy,
        cashierUsername,
        customer ? customer.name : "Walk-in Customer",
        customer?.phone ?? null,
        customer?.email ?? null,
        customer?.address ?? null,
        shop.shop_name,
        shop.shop_address,
        shop.shop_phone,
        totals.subtotal,
        totals.total,
        totals.amount_paid,
        totals.outstanding_amount,
      ]
    );
  } catch (error) {
    if (error.code === "23505" && error.constraint === "receipts_sale_id_key") {
      error.code = "RECEIPT_ALREADY_EXISTS";
    }
    throw error;
  }
  const receiptId = receiptResult.rows[0].id;

  await client.query(
    `INSERT INTO receipt_items (
       receipt_id, product_id, product_name, product_sku,
       quantity, unit_price, line_total
     )
     SELECT $1, si.product_id, p.name, p.sku, si.quantity, si.unit_price,
            round(si.quantity * si.unit_price, 2)
     FROM sale_items si
     JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = $2
     ORDER BY si.id`,
    [receiptId, saleId]
  );

  return getReceiptBySaleId(client, saleId);
}

async function getReceiptBySale(saleId) {
  const client = await pool.connect();
  try {
    return await getReceiptBySaleId(client, saleId);
  } finally {
    client.release();
  }
}

module.exports = { createReceipt, getReceiptBySale };
