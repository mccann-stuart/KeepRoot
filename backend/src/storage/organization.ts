import { getTableColumnNames, runSchemaStatement, type StorageEnv } from './shared';

const REQUIRED_BOOKMARK_COLUMNS = [
	'list_id',
	'pinned',
	'sort_order',
	'is_read',
	'notes',
	'source_id',
	'source_entry_id',
	'source_entry_fingerprint',
	'published_at',
	'processing_state',
	'search_updated_at',
	'embedding_updated_at',
] as const;

const REQUIRED_SOURCE_COLUMNS = [
	'validator_url',
	'http_etag',
	'http_last_modified',
	'active_run_id',
	'lease_expires_at',
	'next_poll_at',
	'poll_interval_minutes',
] as const;

const REQUIRED_SOURCE_RUN_COLUMNS = [
	'dispatch_key',
	'attempt_count',
	'processed_count',
	'created_count',
	'refreshed_count',
	'unchanged_count',
	'not_modified',
	'saturated',
	'duration_ms',
	'queued_at',
	'lease_expires_at',
	'examined_count',
	'skipped_count',
	'upstream_error_count',
	'upstream_job_id',
	'upstream_phase',
	'upstream_cursor',
	'upstream_started_at',
	'initial_crawl',
] as const;

const REQUIRED_TABLE_NAMES = [
	'lists',
	'smart_lists',
	'account_settings',
	'sources',
	'source_runs',
	'source_discoveries',
	'inbox_entries',
	'item_search_documents',
	'bookmark_embeddings',
	'tool_events',
	'item_search_fts',
] as const;

const schemaReadyByEnv = new WeakMap<StorageEnv, Promise<void>>();

interface CountRow {
	count: number;
}

export class SchemaCompatibilityError extends Error {
	constructor(details?: string) {
		super(details ?? 'KeepRoot database schema is out of date. Run `npm run db:migrate:local` or `npm run db:migrate:remote`.');
		this.name = 'SchemaCompatibilityError';
	}
}

export async function validateOrganizationSchema(env: StorageEnv): Promise<void> {
	const placeholders = REQUIRED_TABLE_NAMES.map(() => '?').join(', ');
	const tableCount = await env.KEEPROOT_DB.prepare(
		`SELECT COUNT(*) AS count
		FROM sqlite_master
		WHERE type IN ('table', 'view') AND name IN (${placeholders})`,
	)
		.bind(...REQUIRED_TABLE_NAMES)
		.first<CountRow>();

	if ((tableCount?.count ?? 0) !== REQUIRED_TABLE_NAMES.length) {
		throw new SchemaCompatibilityError();
	}

	const bookmarkColumns = await getTableColumnNames(env, 'bookmarks');
	const missingColumns = REQUIRED_BOOKMARK_COLUMNS.filter((column) => !bookmarkColumns.has(column));
	if (missingColumns.length > 0) {
		throw new SchemaCompatibilityError(`KeepRoot database schema is out of date. Missing bookmarks columns: ${missingColumns.join(', ')}. Run \`npm run db:migrate:local\` or \`npm run db:migrate:remote\`.`);
	}
	const sourceColumns = await getTableColumnNames(env, 'sources');
	const missingSourceColumns = REQUIRED_SOURCE_COLUMNS.filter((column) => !sourceColumns.has(column));
	const sourceRunColumns = await getTableColumnNames(env, 'source_runs');
	const missingSourceRunColumns = REQUIRED_SOURCE_RUN_COLUMNS.filter((column) => !sourceRunColumns.has(column));
	if (missingSourceColumns.length || missingSourceRunColumns.length) {
		throw new SchemaCompatibilityError('KeepRoot database schema is out of date for queue-first source crawling. Run `npm run db:migrate:local` or `npm run db:migrate:remote`.');
	}
}

export async function assertOrganizationSchemaReady(env: StorageEnv): Promise<void> {
	const existingCheck = schemaReadyByEnv.get(env);
	if (existingCheck) {
		return existingCheck;
	}

	const check = validateOrganizationSchema(env).catch((error) => {
		schemaReadyByEnv.delete(env);
		throw error;
	});
	schemaReadyByEnv.set(env, check);
	return check;
}

export async function ensureMcpSchema(env: StorageEnv): Promise<void> {
	const bookmarkColumns = await getTableColumnNames(env, 'bookmarks');
	const bookmarkPromises: Promise<void>[] = [];

	if (!bookmarkColumns.has('notes')) {
		bookmarkPromises.push(runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN notes TEXT'));
	}
	if (!bookmarkColumns.has('source_id')) {
		bookmarkPromises.push(runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN source_id TEXT'));
	}
	if (!bookmarkColumns.has('source_entry_id')) {
		bookmarkPromises.push(runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN source_entry_id TEXT'));
	}
	if (!bookmarkColumns.has('source_entry_fingerprint')) {
		bookmarkPromises.push(runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN source_entry_fingerprint TEXT'));
	}
	if (!bookmarkColumns.has('published_at')) {
		bookmarkPromises.push(runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN published_at TEXT'));
	}
	if (!bookmarkColumns.has('processing_state')) {
		bookmarkPromises.push(runSchemaStatement(env, "ALTER TABLE bookmarks ADD COLUMN processing_state TEXT NOT NULL DEFAULT 'ready'"));
	}
	if (!bookmarkColumns.has('search_updated_at')) {
		bookmarkPromises.push(runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN search_updated_at TEXT'));
	}
	if (!bookmarkColumns.has('embedding_updated_at')) {
		bookmarkPromises.push(runSchemaStatement(env, 'ALTER TABLE bookmarks ADD COLUMN embedding_updated_at TEXT'));
	}
	await Promise.all(bookmarkPromises);

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
			next_poll_at TEXT,
			poll_interval_minutes INTEGER NOT NULL DEFAULT 60,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE (user_id, kind, normalized_identifier)
		)`,
	);

	const sourceColumns = await getTableColumnNames(env, 'sources');
	const sourceColumnDefinitions: Record<string, string> = {
		active_run_id: 'TEXT',
		http_etag: 'TEXT',
		http_last_modified: 'TEXT',
		lease_expires_at: 'TEXT',
		next_poll_at: 'TEXT',
		poll_interval_minutes: 'INTEGER NOT NULL DEFAULT 60',
		validator_url: 'TEXT',
	};
	const sourcePromises: Promise<void>[] = [];
	for (const [column, definition] of Object.entries(sourceColumnDefinitions)) {
		if (!sourceColumns.has(column)) {
			sourcePromises.push(runSchemaStatement(env, `ALTER TABLE sources ADD COLUMN ${column} ${definition}`));
		}
	}
	await Promise.all(sourcePromises);

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

	const sourceRunColumns = await getTableColumnNames(env, 'source_runs');
	const sourceRunColumnDefinitions: Record<string, string> = {
		attempt_count: 'INTEGER NOT NULL DEFAULT 0',
		created_count: 'INTEGER NOT NULL DEFAULT 0',
		dispatch_key: 'TEXT',
		duration_ms: 'INTEGER NOT NULL DEFAULT 0',
		lease_expires_at: 'TEXT',
		not_modified: 'INTEGER NOT NULL DEFAULT 0',
		processed_count: 'INTEGER NOT NULL DEFAULT 0',
		queued_at: 'TEXT',
		refreshed_count: 'INTEGER NOT NULL DEFAULT 0',
		saturated: 'INTEGER NOT NULL DEFAULT 0',
		examined_count: 'INTEGER NOT NULL DEFAULT 0',
		skipped_count: 'INTEGER NOT NULL DEFAULT 0',
		upstream_error_count: 'INTEGER NOT NULL DEFAULT 0',
		upstream_job_id: 'TEXT',
		upstream_phase: 'TEXT',
		upstream_cursor: 'TEXT',
		upstream_started_at: 'TEXT',
		initial_crawl: 'INTEGER NOT NULL DEFAULT 0',
		unchanged_count: 'INTEGER NOT NULL DEFAULT 0',
	};
	const sourceRunPromises: Promise<void>[] = [];
	for (const [column, definition] of Object.entries(sourceRunColumnDefinitions)) {
		if (!sourceRunColumns.has(column)) {
			sourceRunPromises.push(runSchemaStatement(env, `ALTER TABLE source_runs ADD COLUMN ${column} ${definition}`));
		}
	}
	await Promise.all(sourceRunPromises);

	await runSchemaStatement(
		env,
		`CREATE TABLE IF NOT EXISTS source_discoveries (
			source_id TEXT NOT NULL,
			url_hash TEXT NOT NULL,
			canonical_url TEXT NOT NULL,
			title TEXT NOT NULL,
			published_at TEXT NOT NULL,
			state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'imported', 'baselined')),
			first_seen_run_id TEXT NOT NULL,
			last_seen_run_id TEXT NOT NULL,
			first_seen_at TEXT NOT NULL,
			last_seen_at TEXT NOT NULL,
			imported_at TEXT,
			PRIMARY KEY (source_id, url_hash),
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

	await Promise.all([
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_bookmarks_source_id ON bookmarks(source_id)'),
		runSchemaStatement(env, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_bookmarks_source_entry_identity ON bookmarks(source_id, source_entry_id) WHERE source_id IS NOT NULL AND source_entry_id IS NOT NULL'),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_bookmarks_source_fingerprint ON bookmarks(source_id, source_entry_id, source_entry_fingerprint) WHERE source_id IS NOT NULL AND source_entry_id IS NOT NULL'),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_bookmarks_processing_state ON bookmarks(processing_state)'),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_account_settings_user_id ON account_settings(user_id)'),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_sources_user_kind_status ON sources(user_id, kind, status)'),
		runSchemaStatement(env, "CREATE INDEX IF NOT EXISTS idx_sources_due_poll ON sources(status, next_poll_at) WHERE status = 'active' AND poll_url IS NOT NULL"),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_source_runs_source_id_started_at ON source_runs(source_id, started_at DESC)'),
		runSchemaStatement(env, 'CREATE UNIQUE INDEX IF NOT EXISTS idx_source_runs_dispatch_key ON source_runs(dispatch_key) WHERE dispatch_key IS NOT NULL'),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_source_runs_status_queued_at ON source_runs(status, queued_at)'),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_source_discoveries_run ON source_discoveries(source_id, first_seen_run_id, state, published_at DESC)'),
		runSchemaStatement(env, "CREATE INDEX IF NOT EXISTS idx_source_discoveries_pending ON source_discoveries(source_id, state) WHERE state = 'pending'"),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_inbox_entries_user_state_created_at ON inbox_entries(user_id, state, created_at DESC)'),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_inbox_entries_bookmark_id ON inbox_entries(bookmark_id)'),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_item_search_documents_user_id_updated_at ON item_search_documents(user_id, updated_at DESC)'),
		runSchemaStatement(env, 'CREATE INDEX IF NOT EXISTS idx_tool_usage_events_user_id_created_at ON tool_usage_events(user_id, created_at DESC)'),
	]);
}
