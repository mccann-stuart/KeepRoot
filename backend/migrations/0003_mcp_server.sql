CREATE TABLE IF NOT EXISTS account_settings (
	user_id TEXT PRIMARY KEY,
	plan_code TEXT NOT NULL DEFAULT 'self_hosted',
	display_name TEXT,
	limits_json TEXT NOT NULL DEFAULT '{}',
	features_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sources (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	name TEXT NOT NULL,
	normalized_identifier TEXT NOT NULL,
	poll_url TEXT,
	email_alias TEXT,
	status TEXT NOT NULL DEFAULT 'active',
	config_json TEXT NOT NULL DEFAULT '{}',
	last_polled_at TEXT,
	last_success_at TEXT,
	last_error TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	UNIQUE (user_id, kind, normalized_identifier)
);

CREATE TABLE IF NOT EXISTS source_runs (
	id TEXT PRIMARY KEY,
	source_id TEXT NOT NULL,
	run_type TEXT NOT NULL,
	status TEXT NOT NULL,
	discovered_count INTEGER NOT NULL DEFAULT 0,
	saved_count INTEGER NOT NULL DEFAULT 0,
	error_count INTEGER NOT NULL DEFAULT 0,
	started_at TEXT NOT NULL,
	finished_at TEXT,
	error_text TEXT,
	FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inbox_entries (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	bookmark_id TEXT NOT NULL,
	source_id TEXT,
	state TEXT NOT NULL DEFAULT 'pending',
	reason TEXT NOT NULL,
	created_at TEXT NOT NULL,
	processed_at TEXT,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
	FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS item_search_documents (
	bookmark_id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	title TEXT,
	notes TEXT,
	tags_text TEXT,
	excerpt TEXT,
	body_text TEXT,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmark_embeddings (
	bookmark_id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	vector_id TEXT NOT NULL,
	model_name TEXT NOT NULL,
	embedding_version TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tool_events (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	tool_name TEXT NOT NULL,
	status TEXT NOT NULL,
	duration_ms INTEGER NOT NULL DEFAULT 0,
	error_text TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS item_search_fts USING fts5(
	bookmark_id UNINDEXED,
	user_id UNINDEXED,
	title,
	notes,
	tags_text,
	excerpt,
	body_text
);

CREATE INDEX IF NOT EXISTS idx_account_settings_user_id ON account_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_sources_user_id ON sources(user_id);
CREATE INDEX IF NOT EXISTS idx_sources_user_status ON sources(user_id, status);
CREATE INDEX IF NOT EXISTS idx_source_runs_source_id ON source_runs(source_id);
CREATE INDEX IF NOT EXISTS idx_inbox_entries_user_state_created ON inbox_entries(user_id, state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_entries_bookmark_id ON inbox_entries(bookmark_id);
CREATE INDEX IF NOT EXISTS idx_item_search_documents_user_id ON item_search_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmark_embeddings_user_id ON bookmark_embeddings(user_id);
CREATE INDEX IF NOT EXISTS idx_tool_events_user_created_at ON tool_events(user_id, created_at DESC);
