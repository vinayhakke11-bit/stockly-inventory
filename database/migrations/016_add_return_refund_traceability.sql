ALTER TABLE payments
ADD COLUMN return_id BIGINT REFERENCES sales(id) ON DELETE RESTRICT;

CREATE INDEX payments_return_paid_at_idx
ON payments (return_id, paid_at)
WHERE return_id IS NOT NULL;

CREATE FUNCTION validate_payment_return_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    referenced_return RECORD;
BEGIN
    IF NEW.return_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.direction <> 'refunded' THEN
        RAISE EXCEPTION 'A return reference is only valid for a refunded payment';
    END IF;

    SELECT r.type, r.status, r.original_sale_id, original_sale.type AS original_type
    INTO referenced_return
    FROM sales r
    LEFT JOIN sales original_sale ON original_sale.id = r.original_sale_id
    WHERE r.id = NEW.return_id;

    IF NOT FOUND
        OR referenced_return.type <> 'return'
        OR referenced_return.status <> 'completed'
        OR referenced_return.original_type <> 'sale'
        OR referenced_return.original_sale_id <> NEW.sale_id THEN
        RAISE EXCEPTION 'Refund payment must reference a completed return for its original sale';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER payments_validate_return_reference
BEFORE INSERT OR UPDATE OF return_id, sale_id, direction ON payments
FOR EACH ROW EXECUTE FUNCTION validate_payment_return_reference();
