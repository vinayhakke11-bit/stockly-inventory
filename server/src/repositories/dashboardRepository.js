const pool = require("../config/database");

async function getDashboard() {
  const result = await pool.query(`
    WITH
    shop_day AS (
      SELECT date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AS day_start
    ),
    day_bounds AS (
      SELECT
        day_start AT TIME ZONE 'Asia/Kolkata' AS start_at,
        (day_start + interval '1 day') AT TIME ZONE 'Asia/Kolkata' AS end_at
      FROM shop_day
    ),
    inventory_summary AS (
      SELECT
        COUNT(*)::integer AS product_count,
        COUNT(*) FILTER (WHERE is_active)::integer AS active_product_count,
        COALESCE(SUM(stock_on_hand), 0)::numeric(20, 3)::text AS total_stock_quantity,
        COUNT(*) FILTER (
          WHERE is_active AND stock_on_hand = 0
        )::integer AS out_of_stock_count,
        COUNT(*) FILTER (
          WHERE is_active AND stock_on_hand > 0 AND stock_on_hand <= 10
        )::integer AS low_stock_count,
        COALESCE(
          round(SUM(stock_on_hand * selling_price), 2),
          0
        )::numeric(20, 2)::text AS retail_inventory_value
      FROM products
    ),
    sale_totals AS (
      SELECT
        sale_id,
        SUM(round(quantity * unit_price, 2)) AS total
      FROM sale_items
      GROUP BY sale_id
    ),
    today_sales AS (
      SELECT
        COALESCE(SUM(sale_totals.total) FILTER (WHERE s.type = 'sale'), 0)::numeric(20, 2)::text AS gross_sales,
        COALESCE(SUM(sale_totals.total) FILTER (WHERE s.type = 'return'), 0)::numeric(20, 2)::text AS returns
      FROM sales s
      LEFT JOIN sale_totals ON sale_totals.sale_id = s.id
      CROSS JOIN day_bounds
      WHERE s.status = 'completed'
        AND s.type IN ('sale', 'return')
        AND s.sold_at >= day_bounds.start_at
        AND s.sold_at < day_bounds.end_at
    ),
    purchase_totals AS (
      SELECT
        purchase_id,
        SUM(round(quantity * unit_cost, 2)) AS total
      FROM purchase_items
      GROUP BY purchase_id
    ),
    today_purchases AS (
      SELECT COALESCE(SUM(purchase_totals.total), 0)::numeric(20, 2)::text AS purchases
      FROM purchases p
      LEFT JOIN purchase_totals ON purchase_totals.purchase_id = p.id
      CROSS JOIN day_bounds
      WHERE p.status = 'received'
        AND p.purchased_at >= day_bounds.start_at
        AND p.purchased_at < day_bounds.end_at
    ),
    today_payment_totals AS (
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE direction = 'received'), 0)::numeric(20, 2)::text AS payments_received,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'refunded'), 0)::numeric(20, 2)::text AS refunds
      FROM payments
      CROSS JOIN day_bounds
      WHERE paid_at >= day_bounds.start_at
        AND paid_at < day_bounds.end_at
    ),
    customer_credit AS (
      SELECT COALESCE(
        COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0)
        - COALESCE(SUM(amount) FILTER (WHERE direction = 'credit'), 0),
        0
      )::numeric(20, 2)::text AS outstanding_balance
      FROM credit_transactions
    ),
    recent_sales AS (
      SELECT
        s.id::text AS id,
        s.customer_id::text AS customer_id,
        c.name AS customer_name,
        s.type,
        s.status,
        COALESCE(sale_totals.total, 0)::numeric(20, 2)::text AS total_amount,
        s.created_at
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN sale_totals ON sale_totals.sale_id = s.id
      WHERE s.type = 'sale'
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT 5
    ),
    recent_stock_movements AS (
      SELECT
        sm.id::text AS id,
        sm.product_id::text AS product_id,
        p.name AS product_name,
        sm.movement_type,
        sm.quantity_change::numeric(12, 3)::text AS quantity_change,
        sm.reason,
        sm.created_at
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      ORDER BY sm.created_at DESC, sm.id DESC
      LIMIT 5
    ),
    sold_quantities AS (
      SELECT si.product_id, SUM(si.quantity) AS quantity
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE s.type = 'sale' AND s.status = 'completed'
      GROUP BY si.product_id
    ),
    returned_quantities AS (
      SELECT si.product_id, SUM(si.quantity) AS quantity
      FROM sale_items si
      JOIN sales r ON r.id = si.sale_id
      WHERE r.type = 'return' AND r.status = 'completed'
      GROUP BY si.product_id
    ),
    top_selling_products AS (
      SELECT
        p.id::text AS product_id,
        p.name AS product_name,
        (sold_quantities.quantity - COALESCE(returned_quantities.quantity, 0))
          ::numeric(12, 3)::text AS net_quantity_sold
      FROM sold_quantities
      JOIN products p ON p.id = sold_quantities.product_id
      LEFT JOIN returned_quantities ON returned_quantities.product_id = p.id
      WHERE sold_quantities.quantity - COALESCE(returned_quantities.quantity, 0) > 0
      ORDER BY sold_quantities.quantity - COALESCE(returned_quantities.quantity, 0) DESC,
               p.name ASC, p.id ASC
      LIMIT 5
    )
    SELECT jsonb_build_object(
      'inventory', jsonb_build_object(
        'product_count', inventory_summary.product_count,
        'active_product_count', inventory_summary.active_product_count,
        'total_stock_quantity', inventory_summary.total_stock_quantity,
        'low_stock_count', inventory_summary.low_stock_count,
        'out_of_stock_count', inventory_summary.out_of_stock_count,
        'retail_inventory_value', inventory_summary.retail_inventory_value
      ),
      'today', jsonb_build_object(
        'gross_sales', today_sales.gross_sales,
        'returns', today_sales.returns,
        'net_sales', (today_sales.gross_sales::numeric - today_sales.returns::numeric)::numeric(20, 2)::text,
        'purchases', today_purchases.purchases,
        'payments_received', today_payment_totals.payments_received,
        'refunds', today_payment_totals.refunds
      ),
      'customer_credit', jsonb_build_object(
        'outstanding_balance', customer_credit.outstanding_balance
      ),
      'recent_sales', COALESCE(
        (SELECT jsonb_agg(to_jsonb(recent_sales)) FROM recent_sales),
        '[]'::jsonb
      ),
      'recent_stock_movements', COALESCE(
        (SELECT jsonb_agg(to_jsonb(recent_stock_movements)) FROM recent_stock_movements),
        '[]'::jsonb
      ),
      'top_selling_products', COALESCE(
        (SELECT jsonb_agg(to_jsonb(top_selling_products)) FROM top_selling_products),
        '[]'::jsonb
      )
    ) AS dashboard
    FROM inventory_summary
    CROSS JOIN today_sales
    CROSS JOIN today_purchases
    CROSS JOIN today_payment_totals
    CROSS JOIN customer_credit
  `);

  return result.rows[0].dashboard;
}

module.exports = { getDashboard };
