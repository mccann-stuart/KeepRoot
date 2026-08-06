ALTER TABLE bookmarks ADD COLUMN source_entry_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_source_entry_identity
	ON bookmarks(source_id, source_entry_id)
	WHERE source_id IS NOT NULL AND source_entry_id IS NOT NULL;
