ALTER TABLE bookmarks ADD COLUMN notes TEXT;
ALTER TABLE bookmarks ADD COLUMN source_id TEXT REFERENCES sources(id) ON DELETE SET NULL;
ALTER TABLE bookmarks ADD COLUMN processing_state TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE bookmarks ADD COLUMN search_updated_at TEXT;
ALTER TABLE bookmarks ADD COLUMN embedding_updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_bookmarks_source_id ON bookmarks(source_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_processing_state ON bookmarks(processing_state);
