ALTER TABLE stock_movements
    ADD COLUMN performed_by BIGINT REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_performed_by_required
    CHECK (performed_by IS NOT NULL) NOT VALID;

CREATE INDEX stock_movements_performed_by_created_at_idx
    ON stock_movements (performed_by, created_at);

CREATE OR REPLACE FUNCTION create_purchase_stock_movements()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    performer_id BIGINT;
BEGIN
    IF NOT (
        (OLD.status = 'draft' AND NEW.status = 'received')
        OR (OLD.status = 'received' AND NEW.status = 'cancelled')
    ) THEN
        RETURN NEW;
    END IF;

    performer_id := NULLIF(current_setting('stockly.performed_by', true), '')::BIGINT;
    IF performer_id IS NULL THEN
        RAISE EXCEPTION 'Stock movement performer is required';
    END IF;

    IF OLD.status = 'draft' AND NEW.status = 'received' THEN
        INSERT INTO stock_movements (
            product_id, created_by, performed_by, purchase_item_id, movement_type, quantity_change
        )
        SELECT product_id, NEW.created_by, performer_id, id, 'purchase', quantity
        FROM purchase_items
        WHERE purchase_id = NEW.id
        ORDER BY product_id;
    ELSIF OLD.status = 'received' AND NEW.status = 'cancelled' THEN
        INSERT INTO stock_movements (
            product_id, created_by, performed_by, purchase_item_id, movement_type, quantity_change
        )
        SELECT product_id, NEW.created_by, performer_id, id, 'purchase_reversal', -quantity
        FROM purchase_items
        WHERE purchase_id = NEW.id
        ORDER BY product_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION create_sale_stock_movements()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    movement VARCHAR(25);
    quantity_multiplier NUMERIC(2, 1);
    performer_id BIGINT;
BEGIN
    IF OLD.status = 'draft' AND NEW.status = 'completed' THEN
        IF NEW.type = 'sale' THEN
            movement := 'sale';
            quantity_multiplier := -1;
        ELSE
            movement := 'return';
            quantity_multiplier := 1;
        END IF;
    ELSIF OLD.status = 'completed' AND NEW.status = 'cancelled' THEN
        IF NEW.type = 'sale' THEN
            movement := 'sale_reversal';
            quantity_multiplier := 1;
        ELSE
            movement := 'return_reversal';
            quantity_multiplier := -1;
        END IF;
    ELSE
        RETURN NEW;
    END IF;

    performer_id := NULLIF(current_setting('stockly.performed_by', true), '')::BIGINT;
    IF performer_id IS NULL THEN
        RAISE EXCEPTION 'Stock movement performer is required';
    END IF;

    INSERT INTO stock_movements (
        product_id, created_by, performed_by, sale_item_id, movement_type, quantity_change
    )
    SELECT product_id, NEW.created_by, performer_id, id, movement, quantity * quantity_multiplier
    FROM sale_items
    WHERE sale_id = NEW.id
    ORDER BY product_id;

    RETURN NEW;
END;
$$;
