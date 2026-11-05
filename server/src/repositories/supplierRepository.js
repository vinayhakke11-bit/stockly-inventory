const pool = require("../config/database");

async function createSupplier({ name, phone, email, address }) {
  const result = await pool.query(
    `INSERT INTO suppliers (name, phone, email, address)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, email, address, is_active, created_at, updated_at`,
    [name, phone, email, address]
  );

  return result.rows[0];
}

async function getAllSuppliers() {
  const result = await pool.query(
    `SELECT id, name, phone, email, address, is_active, created_at, updated_at
     FROM suppliers
     ORDER BY name ASC, id ASC`
  );

  return result.rows;
}

async function getSupplierById(id) {
  const result = await pool.query(
    `SELECT id, name, phone, email, address, is_active, created_at, updated_at
     FROM suppliers
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function getSupplierByName(name) {
  const result = await pool.query(
    `SELECT id, name
     FROM suppliers
     WHERE lower(name) = lower($1)
     LIMIT 1`,
    [name]
  );

  return result.rows[0] || null;
}

async function supplierHasPurchases(id) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM purchases
       WHERE supplier_id = $1
     ) AS has_purchases`,
    [id]
  );

  return result.rows[0].has_purchases;
}

async function updateSupplier(id, { name, phone, email, address }) {
  const result = await pool.query(
    `UPDATE suppliers
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

async function deleteSupplier(id) {
  const result = await pool.query(
    `DELETE FROM suppliers
     WHERE id = $1
     RETURNING id, name, phone, email, address, is_active, created_at, updated_at`,
    [id]
  );

  return result.rows[0] || null;
}

module.exports = {
  createSupplier,
  getAllSuppliers,
  getSupplierById,
  updateSupplier,
  deleteSupplier,
  getSupplierByName,
  supplierHasPurchases,
};
