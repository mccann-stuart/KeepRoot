ALTER TABLE sources ADD COLUMN validator_url TEXT;
ALTER TABLE sources ADD COLUMN http_etag TEXT;
ALTER TABLE sources ADD COLUMN http_last_modified TEXT;
ALTER TABLE sources ADD COLUMN active_run_id TEXT;
ALTER TABLE sources ADD COLUMN lease_expires_at TEXT;

ALTER TABLE bookmarks ADD COLUMN source_entry_fingerprint TEXT;

ALTER TABLE source_runs ADD COLUMN dispatch_key TEXT;
ALTER TABLE source_runs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN processed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN created_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN refreshed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN unchanged_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN not_modified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN saturated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN queued_at TEXT;
ALTER TABLE source_runs ADD COLUMN lease_expires_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_source_runs_dispatch_key
	ON source_runs(dispatch_key)
	WHERE dispatch_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_source_runs_status_queued_at
	ON source_runs(status, queued_at);

CREATE INDEX IF NOT EXISTS idx_bookmarks_source_fingerprint
	ON bookmarks(source_id, source_entry_id, source_entry_fingerprint)
	WHERE source_id IS NOT NULL AND source_entry_id IS NOT NULL;
