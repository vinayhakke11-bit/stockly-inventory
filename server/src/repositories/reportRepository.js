const pool = require("../config/database");

async function getReports({ from = null, to = null } = {}) {
  const result = await pool.query(
    `WITH
    bounds AS (
      SELECT
        CASE WHEN $1::DATE IS NULL THEN NULL
          ELSE $1::DATE::TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
        END AS start_at,
        CASE WHEN $2::DATE IS NULL THEN NULL
          ELSE ($2::DATE + INTERVAL '1 day')::TIMESTAMP AT TIME ZONE 'Asia/Kolkata'
        END AS end_at
    ),
    sale_totals AS (
      SELECT si.sale_id,
             COALESCE(SUM(round(si.quantity * si.unit_price, 2)), 0) AS total
      FROM sale_items si
      GROUP BY si.sale_id
    ),
    completed_sales AS (
      SELECT s.id, s.sold_at, COALESCE(st.total, 0) AS total
      FROM sales s
      LEFT JOIN sale_totals st ON st.sale_id = s.id
      CROSS JOIN bounds b
      WHERE s.type = 'sale'
        AND s.status = 'completed'
        AND (b.start_at IS NULL OR s.sold_at >= b.start_at)
        AND (b.end_at IS NULL OR s.sold_at < b.end_at)
    ),
    completed_returns AS (
      SELECT s.id, s.original_sale_id, s.sold_at,
             COALESCE(SUM(round(si.quantity * si.unit_price, 2)), 0) AS total,
             COALESCE(SUM(si.quantity), 0) AS quantity
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id
      CROSS JOIN bounds b
      WHERE s.type = 'return'
        AND s.status = 'completed'
        AND (b.start_at IS NULL OR s.sold_at >= b.start_at)
        AND (b.end_at IS NULL OR s.sold_at < b.end_at)
      GROUP BY s.id
    ),
    received_purchases AS (
      SELECT p.id,
             COALESCE(SUM(round(pi.quantity * pi.unit_cost, 2)), 0) AS total
      FROM purchases p
      LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
      CROSS JOIN bounds b
      WHERE p.status = 'received'
        AND (b.start_at IS NULL OR p.purchased_at >= b.start_at)
        AND (b.end_at IS NULL OR p.purchased_at < b.end_at)
      GROUP BY p.id
    ),
    filtered_payments AS (
      SELECT p.id, p.direction, p.amount, p.method
      FROM payments p
      JOIN sales s ON s.id = p.sale_id
      CROSS JOIN bounds b
      WHERE s.type = 'sale'
        AND (b.start_at IS NULL OR p.paid_at >= b.start_at)
        AND (b.end_at IS NULL OR p.paid_at < b.end_at)
    ),
    inventory AS (
      SELECT
        COUNT(*)::INTEGER AS product_count,
        COUNT(*) FILTER (WHERE is_active)::INTEGER AS active_product_count,
        COALESCE(SUM(stock_on_hand), 0)::NUMERIC(20, 3)::TEXT AS total_stock_quantity,
        COUNT(*) FILTER (WHERE is_active AND stock_on_hand > 0 AND stock_on_hand <= 10)::INTEGER AS low_stock_count,
        COUNT(*) FILTER (WHERE is_active AND stock_on_hand = 0)::INTEGER AS out_of_stock_count,
        COALESCE(round(SUM(stock_on_hand * selling_price), 2), 0)::NUMERIC(20, 2)::TEXT AS retail_inventory_value
      FROM products
    ),
    credit_balance AS (
      SELECT (
        COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0)
        - COALESCE(SUM(amount) FILTER (WHERE direction = 'credit'), 0)
      )::NUMERIC(20, 2)::TEXT AS outstanding_balance
      FROM credit_transactions
    ),
    sales_summary AS (
      SELECT COUNT(*)::INTEGER AS completed_sale_count,
             COALESCE(SUM(total), 0)::NUMERIC(20, 2)::TEXT AS total_sales
      FROM completed_sales
    ),
    return_summary AS (
      SELECT COUNT(*)::INTEGER AS return_count,
             COALESCE(SUM(quantity), 0)::NUMERIC(20, 3)::TEXT AS returned_quantity,
             COALESCE(SUM(total), 0)::NUMERIC(20, 2)::TEXT AS returned_value
      FROM completed_returns
    ),
    purchase_summary AS (
      SELECT COUNT(*) FILTER (WHERE p.status = 'received')::INTEGER AS received_purchase_count,
             COUNT(*)::INTEGER AS total_purchase_count,
             COALESCE(SUM(rp.total), 0)::NUMERIC(20, 2)::TEXT AS total_purchase_value
      FROM purchases p
      LEFT JOIN received_purchases rp ON rp.id = p.id
      CROSS JOIN bounds b
      WHERE (b.start_at IS NULL OR p.purchased_at >= b.start_at)
        AND (b.end_at IS NULL OR p.purchased_at < b.end_at)
    ),
    payment_summary AS (
      SELECT
        COUNT(*) FILTER (WHERE direction = 'received')::INTEGER AS payment_count,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'received'), 0)::NUMERIC(20, 2)::TEXT AS payments_received,
        COALESCE(SUM(amount) FILTER (WHERE direction = 'refunded'), 0)::NUMERIC(20, 2)::TEXT AS total_refunds
      FROM filtered_payments
    ),
    method_summary AS (
      SELECT method,
             COUNT(*)::INTEGER AS payment_count,
             COALESCE(SUM(amount), 0)::NUMERIC(20, 2)::TEXT AS amount
      FROM filtered_payments
      WHERE direction = 'received'
      GROUP BY method
    ),
    sold_by_product AS (
      SELECT si.product_id, SUM(si.quantity) AS quantity
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      CROSS JOIN bounds b
      WHERE s.type = 'sale'
        AND s.status = 'completed'
        AND (b.start_at IS NULL OR s.sold_at >= b.start_at)
        AND (b.end_at IS NULL OR s.sold_at < b.end_at)
      GROUP BY si.product_id
    ),
    returned_by_product AS (
      SELECT si.product_id, SUM(si.quantity) AS quantity
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      CROSS JOIN bounds b
      WHERE s.type = 'return'
        AND s.status = 'completed'
        AND (b.start_at IS NULL OR s.sold_at >= b.start_at)
        AND (b.end_at IS NULL OR s.sold_at < b.end_at)
      GROUP BY si.product_id
    ),
    top_products AS (
      SELECT p.id::TEXT AS product_id, p.name AS product_name,
             (s.quantity - COALESCE(r.quantity, 0))::NUMERIC(20, 3)::TEXT AS net_quantity_sold
      FROM sold_by_product s
      JOIN products p ON p.id = s.product_id
      LEFT JOIN returned_by_product r ON r.product_id = s.product_id
      WHERE s.quantity - COALESCE(r.quantity, 0) > 0
      ORDER BY s.quantity - COALESCE(r.quantity, 0) DESC, p.name, p.id
      LIMIT 10
    ),
    low_stock_products AS (
      SELECT id::TEXT AS product_id, name AS product_name, sku,
             stock_on_hand::NUMERIC(12, 3)::TEXT AS stock_on_hand
      FROM products
      WHERE is_active AND stock_on_hand > 0 AND stock_on_hand <= 10
      ORDER BY stock_on_hand, name, id
      LIMIT 10
    )
    SELECT jsonb_build_object(
      'sales', jsonb_build_object(
        'total_sales', ss.total_sales,
        'net_sales', (ss.total_sales::NUMERIC - rs.returned_value::NUMERIC)::NUMERIC(20, 2)::TEXT,
        'completed_sale_count', ss.completed_sale_count,
        'payments_received', ps.payments_received,
        'outstanding_customer_credit', cb.outstanding_balance
      ),
      'purchases', jsonb_build_object(
        'total_purchase_count', pus.total_purchase_count,
        'received_purchase_count', pus.received_purchase_count,
        'total_purchase_value', pus.total_purchase_value
      ),
      'payments', jsonb_build_object(
        'payment_count', ps.payment_count,
        'payments_received', ps.payments_received,
        'payment_methods', COALESCE(
          (SELECT jsonb_agg(to_jsonb(ms) ORDER BY ms.method) FROM method_summary ms),
          '[]'::JSONB
        )
      ),
      'returns', jsonb_build_object(
        'return_count', rs.return_count,
        'returned_quantity', rs.returned_quantity,
        'returned_value', rs.returned_value,
        'total_refunds', ps.total_refunds
      ),
      'inventory', jsonb_build_object(
        'product_count', i.product_count,
        'active_product_count', i.active_product_count,
        'total_stock_quantity', i.total_stock_quantity,
        'low_stock_count', i.low_stock_count,
        'out_of_stock_count', i.out_of_stock_count,
        'retail_inventory_value', i.retail_inventory_value,
        'low_stock_products', COALESCE(
          (SELECT jsonb_agg(to_jsonb(lp) ORDER BY lp.stock_on_hand::NUMERIC, lp.product_name)
           FROM low_stock_products lp),
          '[]'::JSONB
        )
      ),
      'top_selling_products', COALESCE(
        (SELECT jsonb_agg(to_jsonb(tp)) FROM top_products tp),
        '[]'::JSONB
      )
    ) AS reports
    FROM inventory i
    CROSS JOIN sales_summary ss
    CROSS JOIN purchase_summary pus
    CROSS JOIN payment_summary ps
    CROSS JOIN return_summary rs
    CROSS JOIN credit_balance cb`,
    [from, to]
  );

  return result.rows[0].reports;
}

module.exports = { getReports };
