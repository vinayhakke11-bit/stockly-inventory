CREATE TABLE sales (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id BIGINT REFERENCES customers(id) ON DELETE RESTRICT,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    type VARCHAR(10) NOT NULL DEFAULT 'sale' CHECK (type IN ('sale', 'return')),
    original_sale_id BIGINT REFERENCES sales(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'completed', 'cancelled')),
    sold_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (type = 'sale' AND original_sale_id IS NULL)
        OR (type = 'return' AND original_sale_id IS NOT NULL)
    )
);

CREATE INDEX sales_customer_sold_at_idx ON sales (customer_id, sold_at);
CREATE INDEX sales_original_sale_id_idx ON sales (original_sale_id);
CREATE INDEX sales_sold_at_idx ON sales (sold_at);
