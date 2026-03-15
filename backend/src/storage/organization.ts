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

export async function ensureMcpSchema(env: StorageEnv): Promise<void> {
	const bookmarkColumns = await getTableColumnNames(env, 'bookmarks');

	if (!bookmarkColumns.has('notes')) {
		await runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN notes TEXT');
	}
	if (!bookmarkColumns.has('source_id')) {
		await runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN source_id TEXT');
	}
	if (!bookmarkColumns.has('processing_state')) {
		await runSchemaStatement(env, "ALTER TABLE bookmarks ADD COLUMN processing_state TEXT NOT NULL DEFAULT 'ready'");
	}
	if (!bookmarkColumns.has('search_updated_at')) {
		await runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN search_updated_at TEXT');
	}
	if (!bookmarkColumns.has('embedding_updated_at')) {
		await runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN embedding_updated_at TEXT');
	}

	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS account_settings (
			user_id TEXT PRIMARY KEY,
			plan_code TEXT NOT NULL DEFAULT 'self_hosted',
			display_name TEXT,
			limits_json TEXT NOT NULL DEFAULT '{}',
			features_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
	);

	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS sources (
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
		)`,
	);

	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS source_runs (
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
		)`,
	);

	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS inbox_entries (
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
		)`,
	);

	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS item_search_documents (
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
		)`,
	);

	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS bookmark_embeddings (
			bookmark_id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			vector_id TEXT NOT NULL,
			model_name TEXT NOT NULL,
			embedding_version TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (bookmark_id) REFERENCES bookmarks(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
	);

	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS tool_usage_events (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			tool_name TEXT NOT NULL,
			status TEXT NOT NULL,
			latency_ms INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
	);

	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_bookmarks_source_id ON bookmarks(source_id)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_bookmarks_processing_state ON bookmarks(processing_state)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_account_settings_user_id ON account_settings(user_id)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_sources_user_kind_status ON sources(user_id, kind, status)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_source_runs_source_id_started_at ON source_runs(source_id, started_at DESC)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_inbox_entries_user_state_created_at ON inbox_entries(user_id, state, created_at DESC)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_inbox_entries_bookmark_id ON inbox_entries(bookmark_id)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_item_search_documents_user_id_updated_at ON item_search_documents(user_id, updated_at DESC)');
	await runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_tool_usage_events_user_id_created_at ON tool_usage_events(user_id, created_at DESC)');
}
