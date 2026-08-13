CREATE TABLE IF NOT EXISTS source_sitemap_urls (
	source_id TEXT NOT NULL,
	url_hash TEXT NOT NULL,
	canonical_url TEXT NOT NULL,
	last_modified_at TEXT,
	state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'processed', 'baselined')),
	first_seen_run_id TEXT NOT NULL,
	first_seen_at TEXT NOT NULL,
	selected_run_id TEXT,
	processed_at TEXT,
	PRIMARY KEY (source_id, url_hash),
	FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_sitemap_urls_pending
	ON source_sitemap_urls(source_id, state, last_modified_at DESC)
	WHERE state = 'pending';

CREATE INDEX IF NOT EXISTS idx_source_sitemap_urls_selected_run
	ON source_sitemap_urls(source_id, selected_run_id)
	WHERE selected_run_id IS NOT NULL;
