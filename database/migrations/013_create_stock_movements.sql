CREATE TABLE stock_movements (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    purchase_item_id BIGINT REFERENCES purchase_items(id) ON DELETE RESTRICT,
    sale_item_id BIGINT REFERENCES sale_items(id) ON DELETE RESTRICT,
    movement_type VARCHAR(25) NOT NULL
        CHECK (movement_type IN (
            'purchase',
            'sale',
            'return',
            'purchase_reversal',
            'sale_reversal',
            'return_reversal',
            'adjustment'
        )),
    quantity_change NUMERIC(12, 3) NOT NULL CHECK (quantity_change <> 0),
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (movement_type = 'purchase'
            AND purchase_item_id IS NOT NULL AND sale_item_id IS NULL AND quantity_change > 0)
        OR (movement_type = 'purchase_reversal'
            AND purchase_item_id IS NOT NULL AND sale_item_id IS NULL AND quantity_change < 0)
        OR (movement_type = 'sale'
            AND purchase_item_id IS NULL AND sale_item_id IS NOT NULL AND quantity_change < 0)
        OR (movement_type = 'sale_reversal'
            AND purchase_item_id IS NULL AND sale_item_id IS NOT NULL AND quantity_change > 0)
        OR (movement_type = 'return'
            AND purchase_item_id IS NULL AND sale_item_id IS NOT NULL AND quantity_change > 0)
        OR (movement_type = 'return_reversal'
            AND purchase_item_id IS NULL AND sale_item_id IS NOT NULL AND quantity_change < 0)
        OR (movement_type = 'adjustment'
            AND purchase_item_id IS NULL AND sale_item_id IS NULL)
    )
);

CREATE INDEX stock_movements_product_created_at_idx
    ON stock_movements (product_id, created_at);
CREATE INDEX stock_movements_purchase_item_id_idx
    ON stock_movements (purchase_item_id) WHERE purchase_item_id IS NOT NULL;
CREATE INDEX stock_movements_sale_item_id_idx
    ON stock_movements (sale_item_id) WHERE sale_item_id IS NOT NULL;
CREATE UNIQUE INDEX stock_movements_purchase_once_idx
    ON stock_movements (purchase_item_id) WHERE movement_type = 'purchase';
CREATE UNIQUE INDEX stock_movements_purchase_reversal_once_idx
    ON stock_movements (purchase_item_id) WHERE movement_type = 'purchase_reversal';
CREATE UNIQUE INDEX stock_movements_sale_once_idx
    ON stock_movements (sale_item_id) WHERE movement_type = 'sale';
CREATE UNIQUE INDEX stock_movements_sale_reversal_once_idx
    ON stock_movements (sale_item_id) WHERE movement_type = 'sale_reversal';
CREATE UNIQUE INDEX stock_movements_return_once_idx
    ON stock_movements (sale_item_id) WHERE movement_type = 'return';
CREATE UNIQUE INDEX stock_movements_return_reversal_once_idx
    ON stock_movements (sale_item_id) WHERE movement_type = 'return_reversal';

CREATE FUNCTION guard_product_stock_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.stock_on_hand <> 0 THEN
            RAISE EXCEPTION 'New products must start with zero stock; add an adjustment movement instead';
        END IF;
    ELSIF NEW.stock_on_hand IS DISTINCT FROM OLD.stock_on_hand
        AND current_setting('app.stock_update_from_movement', true) IS DISTINCT FROM 'on' THEN
        RAISE EXCEPTION 'Stock can only be changed by inserting a stock movement';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER products_guard_stock_changes
BEFORE INSERT OR UPDATE OF stock_on_hand ON products
FOR EACH ROW EXECUTE FUNCTION guard_product_stock_changes();

CREATE FUNCTION apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    source_product_id BIGINT;
    source_quantity NUMERIC(12, 3);
    source_status VARCHAR(20);
    source_type VARCHAR(10);
    expected_change NUMERIC(12, 3);
    stock_updated BOOLEAN;
BEGIN
    IF NEW.movement_type = 'adjustment' THEN
        IF NEW.purchase_item_id IS NOT NULL OR NEW.sale_item_id IS NOT NULL THEN
            RAISE EXCEPTION 'Adjustment movements cannot reference transaction items';
        END IF;
    ELSIF NEW.purchase_item_id IS NOT NULL THEN
        SELECT pi.product_id, pi.quantity, p.status
        INTO source_product_id, source_quantity, source_status
        FROM purchase_items pi
        JOIN purchases p ON p.id = pi.purchase_id
        WHERE pi.id = NEW.purchase_item_id;

        IF NOT FOUND OR source_product_id <> NEW.product_id THEN
            RAISE EXCEPTION 'Purchase movement must reference an item for the same product';
        END IF;

        IF NEW.movement_type = 'purchase' THEN
            expected_change := source_quantity;
            IF source_status <> 'received' THEN
                RAISE EXCEPTION 'Purchase stock is added only when the purchase is received';
            END IF;
        ELSE
            expected_change := -source_quantity;
            IF source_status <> 'cancelled' THEN
                RAISE EXCEPTION 'Purchase reversal requires a cancelled purchase';
            END IF;
        END IF;

        IF NEW.quantity_change <> expected_change THEN
            RAISE EXCEPTION 'Purchase movement quantity must match its purchase item';
        END IF;
    ELSE
        SELECT si.product_id, si.quantity, s.status, s.type
        INTO source_product_id, source_quantity, source_status, source_type
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE si.id = NEW.sale_item_id;

        IF NOT FOUND OR source_product_id <> NEW.product_id THEN
            RAISE EXCEPTION 'Sale movement must reference an item for the same product';
        END IF;

        IF NEW.movement_type = 'sale' THEN
            expected_change := -source_quantity;
            IF source_type <> 'sale' OR source_status <> 'completed' THEN
                RAISE EXCEPTION 'Sale stock is removed only when the sale is completed';
            END IF;
        ELSIF NEW.movement_type = 'sale_reversal' THEN
            expected_change := source_quantity;
            IF source_type <> 'sale' OR source_status <> 'cancelled' THEN
                RAISE EXCEPTION 'Sale reversal requires a cancelled sale';
            END IF;
        ELSIF NEW.movement_type = 'return' THEN
            expected_change := source_quantity;
            IF source_type <> 'return' OR source_status <> 'completed' THEN
                RAISE EXCEPTION 'Return stock is added only when the return is completed';
            END IF;
        ELSE
            expected_change := -source_quantity;
            IF source_type <> 'return' OR source_status <> 'cancelled' THEN
                RAISE EXCEPTION 'Return reversal requires a cancelled return';
            END IF;
        END IF;

        IF NEW.quantity_change <> expected_change THEN
            RAISE EXCEPTION 'Sale movement quantity must match its sale item';
        END IF;
    END IF;

    PERFORM set_config('app.stock_update_from_movement', 'on', true);

    UPDATE products
    SET stock_on_hand = stock_on_hand + NEW.quantity_change,
        updated_at = now()
    WHERE id = NEW.product_id
      AND stock_on_hand + NEW.quantity_change >= 0;

    stock_updated := FOUND;
    PERFORM set_config('app.stock_update_from_movement', 'off', true);

    IF NOT stock_updated THEN
        RAISE EXCEPTION 'Insufficient stock or product does not exist for product %', NEW.product_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER stock_movements_apply_stock
BEFORE INSERT ON stock_movements
FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

CREATE FUNCTION prevent_stock_movement_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Stock movements are append-only; insert a reversal or adjustment instead';
END;
$$;

CREATE TRIGGER stock_movements_are_immutable
BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION prevent_stock_movement_changes();

CREATE FUNCTION guard_purchase_item_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_id BIGINT;
    parent_status VARCHAR(20);
BEGIN
    IF TG_OP = 'DELETE' THEN
        parent_id := OLD.purchase_id;
    ELSE
        parent_id := NEW.purchase_id;
        IF TG_OP = 'UPDATE' AND NEW.purchase_id <> OLD.purchase_id THEN
            RAISE EXCEPTION 'A purchase item cannot be moved to another purchase';
        END IF;
    END IF;

    SELECT status INTO parent_status FROM purchases WHERE id = parent_id FOR UPDATE;
    IF parent_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'Purchase items can only be changed while the purchase is a draft';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER purchase_items_only_change_while_draft
BEFORE INSERT OR UPDATE OR DELETE ON purchase_items
FOR EACH ROW EXECUTE FUNCTION guard_purchase_item_changes();

CREATE FUNCTION guard_sale_item_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_id BIGINT;
    parent_status VARCHAR(20);
BEGIN
    IF TG_OP = 'DELETE' THEN
        parent_id := OLD.sale_id;
    ELSE
        parent_id := NEW.sale_id;
        IF TG_OP = 'UPDATE' AND NEW.sale_id <> OLD.sale_id THEN
            RAISE EXCEPTION 'A sale item cannot be moved to another sale';
        END IF;
    END IF;

    SELECT status INTO parent_status FROM sales WHERE id = parent_id FOR UPDATE;
    IF parent_status IS DISTINCT FROM 'draft' THEN
        RAISE EXCEPTION 'Sale items can only be changed while the sale is a draft';
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER sale_items_only_change_while_draft
BEFORE INSERT OR UPDATE OR DELETE ON sale_items
FOR EACH ROW EXECUTE FUNCTION guard_sale_item_changes();

CREATE FUNCTION guard_purchase_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' THEN
            RAISE EXCEPTION 'Purchases must be created as drafts';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD.status = 'draft' AND NEW.status IN ('received', 'cancelled'))
        OR (OLD.status = 'received' AND NEW.status = 'cancelled')
    ) THEN
        RAISE EXCEPTION 'Invalid purchase status transition: % to %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'received'
        AND NOT EXISTS (SELECT 1 FROM purchase_items WHERE purchase_id = NEW.id) THEN
        RAISE EXCEPTION 'A purchase must contain items before it can be received';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER purchases_guard_status
BEFORE INSERT OR UPDATE OF status ON purchases
FOR EACH ROW EXECUTE FUNCTION guard_purchase_status_change();

CREATE FUNCTION guard_sale_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    original_status VARCHAR(20);
    original_type VARCHAR(10);
    original_customer_id BIGINT;
    return_item RECORD;
    original_quantity NUMERIC(12, 3);
    returned_quantity NUMERIC(12, 3);
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' THEN
            RAISE EXCEPTION 'Sales and returns must be created as drafts';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.status = OLD.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD.status = 'draft' AND NEW.status IN ('completed', 'cancelled'))
        OR (OLD.status = 'completed' AND NEW.status = 'cancelled')
    ) THEN
        RAISE EXCEPTION 'Invalid sale status transition: % to %', OLD.status, NEW.status;
    END IF;

    IF NEW.status = 'completed'
        AND NOT EXISTS (SELECT 1 FROM sale_items WHERE sale_id = NEW.id) THEN
        RAISE EXCEPTION 'A sale or return must contain items before it can be completed';
    END IF;

    IF NEW.status = 'completed' AND NEW.type = 'return' THEN
        SELECT status, type, customer_id
        INTO original_status, original_type, original_customer_id
        FROM sales
        WHERE id = NEW.original_sale_id
        FOR UPDATE;

        IF NOT FOUND OR original_type <> 'sale' OR original_status <> 'completed' THEN
            RAISE EXCEPTION 'A return must reference a completed original sale';
        END IF;

        IF NEW.customer_id IS DISTINCT FROM original_customer_id THEN
            RAISE EXCEPTION 'A return must have the same customer as its original sale';
        END IF;

        FOR return_item IN
            SELECT product_id, quantity
            FROM sale_items
            WHERE sale_id = NEW.id
        LOOP
            SELECT quantity INTO original_quantity
            FROM sale_items
            WHERE sale_id = NEW.original_sale_id
              AND product_id = return_item.product_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'A return can only contain products from its original sale';
            END IF;

            SELECT COALESCE(SUM(si.quantity), 0)
            INTO returned_quantity
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id
            WHERE s.original_sale_id = NEW.original_sale_id
              AND s.type = 'return'
              AND s.status = 'completed'
              AND si.product_id = return_item.product_id;

            IF returned_quantity + return_item.quantity > original_quantity THEN
                RAISE EXCEPTION 'Returned quantity exceeds the original quantity for product %',
                    return_item.product_id;
            END IF;
        END LOOP;
    END IF;

    IF NEW.status = 'cancelled' AND OLD.type = 'sale'
        AND EXISTS (
            SELECT 1 FROM sales
            WHERE original_sale_id = NEW.id
              AND type = 'return'
              AND status = 'completed'
        ) THEN
        RAISE EXCEPTION 'A sale with completed returns cannot be cancelled';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER sales_guard_status
BEFORE INSERT OR UPDATE OF status ON sales
FOR EACH ROW EXECUTE FUNCTION guard_sale_status_change();

CREATE FUNCTION create_purchase_stock_movements()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'draft' AND NEW.status = 'received' THEN
        INSERT INTO stock_movements (
            product_id, created_by, purchase_item_id, movement_type, quantity_change
        )
        SELECT product_id, NEW.created_by, id, 'purchase', quantity
        FROM purchase_items
        WHERE purchase_id = NEW.id
        ORDER BY product_id;
    ELSIF OLD.status = 'received' AND NEW.status = 'cancelled' THEN
        INSERT INTO stock_movements (
            product_id, created_by, purchase_item_id, movement_type, quantity_change
        )
        SELECT product_id, NEW.created_by, id, 'purchase_reversal', -quantity
        FROM purchase_items
        WHERE purchase_id = NEW.id
        ORDER BY product_id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER purchases_create_stock_movements
AFTER UPDATE OF status ON purchases
FOR EACH ROW EXECUTE FUNCTION create_purchase_stock_movements();

CREATE FUNCTION create_sale_stock_movements()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    movement VARCHAR(25);
    quantity_multiplier NUMERIC(2, 1);
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

    INSERT INTO stock_movements (
        product_id, created_by, sale_item_id, movement_type, quantity_change
    )
    SELECT product_id, NEW.created_by, id, movement, quantity * quantity_multiplier
    FROM sale_items
    WHERE sale_id = NEW.id
    ORDER BY product_id;

    RETURN NEW;
END;
$$;

CREATE TRIGGER sales_create_stock_movements
AFTER UPDATE OF status ON sales
FOR EACH ROW EXECUTE FUNCTION create_sale_stock_movements();
