const pool = require("../config/database");

const productSelection = `
  SELECT p.id, p.category_id, c.name AS category_name, p.sku, p.barcode,
         p.name, p.description, p.selling_price, p.stock_on_hand,
         p.is_active, p.created_at, p.updated_at
  FROM products p
  JOIN categories c ON c.id = p.category_id
`;

async function createProduct({
  category_id,
  sku,
  barcode,
  name,
  description,
  selling_price,
}) {
  const result = await pool.query(
    `WITH created_product AS (
       INSERT INTO products
         (category_id, sku, barcode, name, description, selling_price)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *
     )
     SELECT p.id, p.category_id, c.name AS category_name, p.sku, p.barcode,
            p.name, p.description, p.selling_price, p.stock_on_hand,
            p.is_active, p.created_at, p.updated_at
     FROM created_product p
     JOIN categories c ON c.id = p.category_id`,
    [category_id, sku, barcode, name, description, selling_price]
  );

  return result.rows[0];
}

async function getAllProducts() {
  const result = await pool.query(
    `${productSelection}
     ORDER BY p.name ASC, p.id ASC`
  );

  return result.rows;
}

async function getProductById(id) {
  const result = await pool.query(
    `${productSelection}
     WHERE p.id = $1`,
    [id]
  );

  return result.rows[0] || null;
}

async function getProductBySku(sku) {
  const result = await pool.query(
    `SELECT id, sku
     FROM products
     WHERE sku = $1`,
    [sku]
  );

  return result.rows[0] || null;
}

async function checkCategoryExists(categoryId) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM categories
       WHERE id = $1
     ) AS category_exists`,
    [categoryId]
  );

  return result.rows[0].category_exists;
}

async function productHasTransactionHistory(id) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM purchase_items
       WHERE product_id = $1
       UNION ALL
       SELECT 1
       FROM sale_items
       WHERE product_id = $1
     ) AS has_history`,
    [id]
  );

  return result.rows[0].has_history;
}

async function updateProduct(
  id,
  { category_id, sku, barcode, name, description, selling_price }
) {
  const result = await pool.query(
    `WITH updated_product AS (
       UPDATE products
       SET category_id = $1,
           sku = $2,
           barcode = $3,
           name = $4,
           description = $5,
           selling_price = $6,
           updated_at = now()
       WHERE id = $7
       RETURNING *
     )
     SELECT p.id, p.category_id, c.name AS category_name, p.sku, p.barcode,
            p.name, p.description, p.selling_price, p.stock_on_hand,
            p.is_active, p.created_at, p.updated_at
     FROM updated_product p
     JOIN categories c ON c.id = p.category_id`,
    [category_id, sku, barcode, name, description, selling_price, id]
  );

  return result.rows[0] || null;
}

async function deleteProduct(id) {
  const result = await pool.query(
    `DELETE FROM products
     WHERE id = $1
     RETURNING id, category_id, sku, barcode, name, description,
               selling_price, stock_on_hand, is_active, created_at, updated_at`,
    [id]
  );

  return result.rows[0] || null;
}

module.exports = {
  createProduct,
  getAllProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getProductBySku,
  checkCategoryExists,
  productHasTransactionHistory,
};
