ALTER TABLE sources ADD COLUMN next_poll_at TEXT;
ALTER TABLE sources ADD COLUMN poll_interval_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE bookmarks ADD COLUMN published_at TEXT;

CREATE INDEX IF NOT EXISTS idx_sources_due_poll
	ON sources(status, next_poll_at)
	WHERE status = 'active' AND poll_url IS NOT NULL;
