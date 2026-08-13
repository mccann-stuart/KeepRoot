ALTER TABLE source_runs ADD COLUMN upstream_finished_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN upstream_total_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE source_runs ADD COLUMN upstream_browser_seconds REAL NOT NULL DEFAULT 0;
