CREATE SEQUENCE receipt_number_seq
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    NO CYCLE;

CREATE TABLE receipts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    sale_id BIGINT NOT NULL UNIQUE
        REFERENCES sales(id) ON DELETE RESTRICT,
    receipt_number BIGINT NOT NULL DEFAULT nextval('receipt_number_seq')
        CONSTRAINT receipts_receipt_number_unique UNIQUE,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    issued_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    cashier_username VARCHAR(50) NOT NULL,
    customer_name VARCHAR(150) NOT NULL,
    customer_phone VARCHAR(30),
    customer_email VARCHAR(255),
    customer_address TEXT,
    shop_name VARCHAR(150) NOT NULL,
    shop_address TEXT,
    shop_phone VARCHAR(30),
    subtotal NUMERIC(12, 2) NOT NULL CHECK (subtotal >= 0),
    total NUMERIC(12, 2) NOT NULL CHECK (total >= 0),
    amount_paid NUMERIC(12, 2) NOT NULL CHECK (amount_paid >= 0),
    outstanding_amount NUMERIC(12, 2) NOT NULL CHECK (outstanding_amount >= 0),
    currency_code CHAR(3) NOT NULL
        CHECK (currency_code ~ '^[A-Z]{3}$'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT receipts_total_matches_subtotal CHECK (total = subtotal),
    CONSTRAINT receipts_balance_matches_total
        CHECK (amount_paid + outstanding_amount = total)
);

ALTER SEQUENCE receipt_number_seq OWNED BY receipts.receipt_number;

CREATE INDEX receipts_issued_at_idx ON receipts (issued_at);
CREATE INDEX receipts_issued_by_idx ON receipts (issued_by);

CREATE TABLE receipt_items (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    receipt_id BIGINT NOT NULL REFERENCES receipts(id) ON DELETE RESTRICT,
    product_id BIGINT REFERENCES products(id) ON DELETE RESTRICT,
    product_name VARCHAR(150) NOT NULL,
    product_sku VARCHAR(60) NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    line_total NUMERIC(12, 2) NOT NULL CHECK (line_total >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT receipt_items_line_total_matches_quantity
        CHECK (line_total = round(quantity * unit_price, 2))
);

CREATE INDEX receipt_items_receipt_id_idx ON receipt_items (receipt_id);

CREATE FUNCTION validate_receipt_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM sales
        WHERE id = NEW.sale_id
          AND type = 'sale'
          AND status = 'completed'
    ) THEN
        RAISE EXCEPTION 'A receipt can only be issued for a completed sale';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER receipts_require_completed_sale
BEFORE INSERT OR UPDATE OF sale_id ON receipts
FOR EACH ROW EXECUTE FUNCTION validate_receipt_sale();

CREATE FUNCTION prevent_receipt_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Receipt records are immutable';
END;
$$;

CREATE TRIGGER receipts_are_immutable
BEFORE UPDATE OR DELETE ON receipts
FOR EACH ROW EXECUTE FUNCTION prevent_receipt_mutation();

CREATE TRIGGER receipt_items_are_immutable
BEFORE UPDATE OR DELETE ON receipt_items
FOR EACH ROW EXECUTE FUNCTION prevent_receipt_mutation();
