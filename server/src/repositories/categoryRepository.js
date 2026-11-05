const pool = require("../config/database");

async function createCategory({ name, description }) {
  const result = await pool.query(
    `INSERT INTO categories (name, description)
     VALUES ($1, $2)
     RETURNING *`,
    [name, description]
  );

  return result.rows[0];
}

async function getAllCategories() {
  const result = await pool.query(
    `SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
     FROM categories c
     ORDER BY c.name ASC`
  );

  return result.rows;
}

async function getCategoryById(id) {
  const result = await pool.query(
    `SELECT id, name, description, created_at, updated_at
     FROM categories
     WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function getCategoryByName(name) {
  const result = await pool.query(
    `SELECT id, name
     FROM categories
     WHERE name = $1`,
    [name]
  );

  return result.rows[0] || null;
}

async function categoryHasProducts(id) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM products
       WHERE category_id = $1
     ) AS has_products`,
    [id]
  );

  return result.rows[0].has_products;
}

async function updateCategory(id, { name, description }) {
  const result = await pool.query(
    `UPDATE categories
     SET name = $1, description = $2, updated_at = now()
     WHERE id = $3
     RETURNING id, name, description, created_at, updated_at`,
    [name, description, id]
  );

  return result.rows[0] || null;
}

async function deleteCategory(id) {
  const result = await pool.query(
    `DELETE FROM categories
     WHERE id = $1
     RETURNING id, name, description, created_at, updated_at`,
    [id]
  );

  return result.rows[0] || null;
}

module.exports = {
  createCategory,
  getAllCategories,
  getCategoryById,
  getCategoryByName,
  categoryHasProducts,
  updateCategory,
  deleteCategory,
};
