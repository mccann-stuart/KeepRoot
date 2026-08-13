ALTER TABLE source_runs ADD COLUMN examined_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN skipped_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN upstream_error_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN upstream_job_id TEXT;
ALTER TABLE source_runs ADD COLUMN upstream_phase TEXT;
ALTER TABLE source_runs ADD COLUMN upstream_cursor TEXT;
ALTER TABLE source_runs ADD COLUMN upstream_started_at TEXT;
ALTER TABLE source_runs ADD COLUMN initial_crawl INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS source_discoveries (
	source_id TEXT NOT NULL,
	url_hash TEXT NOT NULL,
	canonical_url TEXT NOT NULL,
	title TEXT NOT NULL,
	published_at TEXT NOT NULL,
	state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'imported', 'baselined')),
	first_seen_run_id TEXT NOT NULL,
	last_seen_run_id TEXT NOT NULL,
	first_seen_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	imported_at TEXT,
	PRIMARY KEY (source_id, url_hash),
	FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_discoveries_run
	ON source_discoveries(source_id, first_seen_run_id, state, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_discoveries_pending
	ON source_discoveries(source_id, state)
	WHERE state = 'pending';
