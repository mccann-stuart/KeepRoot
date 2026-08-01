ALTER TABLE api_keys ADD COLUMN expires_at TEXT;

UPDATE api_keys
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+1 year')
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_expiry
	ON api_keys(secret_hash, expires_at);
