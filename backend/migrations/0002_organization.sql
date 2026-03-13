CREATE TABLE IF NOT EXISTS lists (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	name TEXT NOT NULL,
	created_at TEXT NOT NULL,
	sort_order REAL NOT NULL DEFAULT 0,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS smart_lists (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	name TEXT NOT NULL,
	icon TEXT,
	rules TEXT NOT NULL,
	created_at TEXT NOT NULL,
	sort_order REAL NOT NULL DEFAULT 0,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

ALTER TABLE bookmarks ADD COLUMN list_id TEXT REFERENCES lists(id) ON DELETE SET NULL;
ALTER TABLE bookmarks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookmarks ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
ALTER TABLE bookmarks ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_lists_user_id ON lists(user_id);
CREATE INDEX IF NOT EXISTS idx_smart_lists_user_id ON smart_lists(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_list_id ON bookmarks(list_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_pinned ON bookmarks(pinned);
CREATE INDEX IF NOT EXISTS idx_bookmarks_is_read ON bookmarks(is_read);
CREATE INDEX IF NOT EXISTS idx_bookmarks_sort_order ON bookmarks(sort_order);
