ALTER TABLE payments
ADD COLUMN idempotency_key VARCHAR(100);

CREATE UNIQUE INDEX payments_idempotency_key_unique_idx
ON payments (idempotency_key)
WHERE idempotency_key IS NOT NULL;
