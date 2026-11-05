CREATE TABLE credit_transactions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    sale_id BIGINT REFERENCES sales(id) ON DELETE RESTRICT,
    payment_id BIGINT REFERENCES payments(id) ON DELETE RESTRICT,
    entry_type VARCHAR(25) NOT NULL
        CHECK (entry_type IN (
            'sale_charge',
            'return_credit',
            'payment_received',
            'refund',
            'adjustment',
            'opening_balance'
        )),
    direction VARCHAR(6) NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    notes TEXT,
    CHECK (
        (entry_type = 'sale_charge'
            AND sale_id IS NOT NULL AND payment_id IS NULL AND direction = 'debit')
        OR (entry_type = 'return_credit'
            AND sale_id IS NOT NULL AND payment_id IS NULL AND direction = 'credit')
        OR (entry_type = 'payment_received'
            AND sale_id IS NULL AND payment_id IS NOT NULL AND direction = 'credit')
        OR (entry_type = 'refund'
            AND sale_id IS NULL AND payment_id IS NOT NULL AND direction = 'debit')
        OR (entry_type IN ('adjustment', 'opening_balance')
            AND sale_id IS NULL AND payment_id IS NULL)
    )
);

CREATE UNIQUE INDEX credit_transactions_sale_id_unique_idx
    ON credit_transactions (sale_id) WHERE sale_id IS NOT NULL;
CREATE UNIQUE INDEX credit_transactions_payment_id_unique_idx
    ON credit_transactions (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX credit_transactions_customer_created_at_idx
    ON credit_transactions (customer_id, created_at);
