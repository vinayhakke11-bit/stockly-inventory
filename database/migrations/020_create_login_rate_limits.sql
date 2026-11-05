CREATE TABLE login_rate_limits (
    key_hash CHAR(64) PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL,
    attempt_count INTEGER NOT NULL CHECK (attempt_count > 0)
);

CREATE INDEX login_rate_limits_window_started_at_idx
    ON login_rate_limits (window_started_at);
