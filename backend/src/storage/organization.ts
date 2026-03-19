import { getTableColumnNames, type StorageEnv } from './shared';

const REQUIRED_BOOKMARK_COLUMNS = [
	'list_id',
	'pinned',
	'sort_order',
	'is_read',
	'notes',
	'source_id',
	'processing_state',
	'search_updated_at',
	'embedding_updated_at',
] as const;

const REQUIRED_TABLE_NAMES = [
	'lists',
	'smart_lists',
	'account_settings',
	'sources',
	'source_runs',
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

async function validateOrganizationSchema(env: StorageEnv): Promise<void> {
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
