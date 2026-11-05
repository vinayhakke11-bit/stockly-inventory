INSERT INTO roles (name, description)
VALUES ('owner', 'Full access to this Stockly shop.')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE user_sessions (
    sid VARCHAR NOT NULL PRIMARY KEY,
    sess JSON NOT NULL,
    expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX user_sessions_expire_idx ON user_sessions (expire);
