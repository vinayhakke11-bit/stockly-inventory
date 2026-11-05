CREATE TABLE payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sale_id BIGINT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    direction VARCHAR(10) NOT NULL DEFAULT 'received'
        CHECK (direction IN ('received', 'refunded')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    method VARCHAR(20) NOT NULL
        CHECK (method IN ('cash', 'card', 'bank_transfer', 'mobile_money', 'other')),
    reference VARCHAR(100),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payments_sale_paid_at_idx ON payments (sale_id, paid_at);
