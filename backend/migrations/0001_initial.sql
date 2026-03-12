CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
	credential_id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	public_key TEXT NOT NULL,
	counter INTEGER NOT NULL DEFAULT 0,
	transports TEXT,
	device_type TEXT,
	backed_up INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_challenges (
	id TEXT PRIMARY KEY,
	username TEXT NOT NULL,
	user_id TEXT,
	challenge TEXT NOT NULL,
	type TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	token_hash TEXT NOT NULL UNIQUE,
	user_id TEXT NOT NULL,
	username TEXT NOT NULL,
	created_at TEXT NOT NULL,
	expires_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS api_keys (
	id TEXT PRIMARY KEY,
	secret_hash TEXT NOT NULL UNIQUE,
	user_id TEXT NOT NULL,
	username TEXT NOT NULL,
	name TEXT NOT NULL,
	created_at TEXT NOT NULL,
	last_used_at TEXT,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmarks (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	url TEXT NOT NULL,
	canonical_url TEXT NOT NULL,
	url_hash TEXT NOT NULL,
	title TEXT NOT NULL,
	site_name TEXT,
	domain TEXT,
	status TEXT NOT NULL DEFAULT 'saved',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	last_fetched_at TEXT,
	content_hash TEXT,
	content_ref TEXT,
	content_type TEXT,
	content_length INTEGER,
	excerpt TEXT,
	word_count INTEGER,
	lang TEXT,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	UNIQUE (user_id, url_hash)
);

CREATE TABLE IF NOT EXISTS bookmark_contents (
	bookmark_id TEXT PRIMARY KEY,
	content_hash TEXT NOT NULL,
	r2_key TEXT NOT NULL,
	html_r2_key TEXT,
	excerpt TEXT,
	word_count INTEGER,
	lang TEXT,
	content_type TEXT,
	content_length INTEGER,
	fetched_at TEXT NOT NULL,
	FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookmark_images (
	bookmark_id TEXT NOT NULL,
	image_hash TEXT NOT NULL,
	r2_key TEXT NOT NULL,
	width INTEGER,
	height INTEGER,
	type TEXT,
	created_at TEXT NOT NULL,
	PRIMARY KEY (bookmark_id, image_hash),
	FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	name TEXT NOT NULL,
	normalized_name TEXT NOT NULL,
	created_at TEXT NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	UNIQUE (user_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS bookmark_tags (
	bookmark_id TEXT NOT NULL,
	tag_id TEXT NOT NULL,
	PRIMARY KEY (bookmark_id, tag_id),
	FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
	FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id
	ON webauthn_credentials(user_id);

CREATE INDEX IF NOT EXISTS idx_auth_challenges_lookup
	ON auth_challenges(username, type, expires_at);

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash
	ON sessions(token_hash, expires_at);

CREATE INDEX IF NOT EXISTS idx_api_keys_secret_hash
	ON api_keys(secret_hash);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created_at
	ON bookmarks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_domain
	ON bookmarks(user_id, domain);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user_status
	ON bookmarks(user_id, status);

CREATE INDEX IF NOT EXISTS idx_bookmarks_content_hash
	ON bookmarks(content_hash);

CREATE INDEX IF NOT EXISTS idx_tags_user_name
	ON tags(user_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_bookmark_tags_tag_id
	ON bookmark_tags(tag_id);
