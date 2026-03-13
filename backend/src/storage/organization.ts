import { getTableColumnNames, runSchemaStatement, type StorageEnv } from './shared';

export async function ensureOrganizationSchema(env: StorageEnv): Promise<void> {
	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS lists (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			created_at TEXT NOT NULL,
			sort_order REAL NOT NULL DEFAULT 0,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
	);

	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS smart_lists (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			name TEXT NOT NULL,
			icon TEXT,
			rules TEXT NOT NULL,
			created_at TEXT NOT NULL,
			sort_order REAL NOT NULL DEFAULT 0,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
	);

	const bookmarkColumns = await getTableColumnNames(env, 'bookmarks');

	if (!bookmarkColumns.has('list_id')) {
		await runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN list_id TEXT REFERENCES lists(id) ON DELETE SET NULL');
	}
	if (!bookmarkColumns.has('pinned')) {
		await runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
	}
	if (!bookmarkColumns.has('sort_order')) {
		await runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN sort_order REAL NOT NULL DEFAULT 0');
	}
	if (!bookmarkColumns.has('is_read')) {
		await runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0');
	}

	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_lists_user_id ON lists(user_id)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_smart_lists_user_id ON smart_lists(user_id)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_bookmarks_list_id ON bookmarks(list_id)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_bookmarks_pinned ON bookmarks(pinned)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_bookmarks_is_read ON bookmarks(is_read)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_bookmarks_sort_order ON bookmarks(sort_order)');
}
