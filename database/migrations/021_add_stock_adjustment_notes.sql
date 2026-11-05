ALTER TABLE stock_movements
    ADD COLUMN note TEXT
    CHECK (
        note IS NULL
        OR (movement_type = 'adjustment' AND length(note) <= 1000)
    );

CREATE INDEX stock_movements_adjustment_created_at_idx
    ON stock_movements (created_at DESC, id DESC)
    WHERE movement_type = 'adjustment';
