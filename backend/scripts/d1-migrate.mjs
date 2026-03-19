import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, '..');
const databaseName = 'KEEPROOT_DB';
const migrationName = '0004_bookmark_hot_path.sql';
const scopeArgs = process.argv.slice(2);

const bookmarkHotPathStatements = [
	'ALTER TABLE bookmarks ADD COLUMN notes TEXT',
	'ALTER TABLE bookmarks ADD COLUMN source_id TEXT REFERENCES sources(id) ON DELETE SET NULL',
	"ALTER TABLE bookmarks ADD COLUMN processing_state TEXT NOT NULL DEFAULT 'ready'",
	'ALTER TABLE bookmarks ADD COLUMN search_updated_at TEXT',
	'ALTER TABLE bookmarks ADD COLUMN embedding_updated_at TEXT',
	'CREATE INDEX IF NOT EXISTS idx_bookmarks_source_id ON bookmarks(source_id)',
	'CREATE INDEX IF NOT EXISTS idx_bookmarks_processing_state ON bookmarks(processing_state)',
];

const compatibilityColumns = [
	'notes',
	'source_id',
	'processing_state',
	'search_updated_at',
	'embedding_updated_at',
];

function usage() {
	console.error('Usage: node ./scripts/d1-migrate.mjs <--local|--remote|--preview> [additional wrangler flags]');
	process.exit(1);
}

function runCommand(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: backendDir,
		encoding: 'utf8',
		env: {
			...process.env,
			CI: '1',
		},
	});

	const stdout = result.stdout ?? '';
	const stderr = result.stderr ?? '';
	if (result.status !== 0) {
		if (stdout) {
			process.stdout.write(stdout);
		}
		if (stderr) {
			process.stderr.write(stderr);
		}
		process.exit(result.status ?? 1);
	}

	if (!options.quiet) {
		if (stdout) {
			process.stdout.write(stdout);
		}
		if (stderr) {
			process.stderr.write(stderr);
		}
	}

	if (options.json) {
		const jsonOutput = stdout.trim() || stderr.trim() || '[]';
		return JSON.parse(jsonOutput);
	}

	return `${stdout}\n${stderr}`;
}

function runWrangler(args, options = {}) {
	return runCommand('npx', ['wrangler', ...args], options);
}

function executeJson(sql) {
	return runWrangler([
		'd1',
		'execute',
		databaseName,
		...scopeArgs,
		'--command',
		sql,
		'--json',
	], { json: true, quiet: true });
}

function executeSql(sql) {
	runWrangler([
		'd1',
		'execute',
		databaseName,
		...scopeArgs,
		'--command',
		sql,
	]);
}

function tableExists(name) {
	const rows = executeJson(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${name}'`);
	return rows[0]?.results?.length > 0;
}

function getBookmarkColumns() {
	const rows = executeJson('PRAGMA table_info(bookmarks)');
	return new Set((rows[0]?.results ?? []).map((row) => row.name));
}

function getAppliedMigrationNames() {
	if (!tableExists('d1_migrations')) {
		return new Set();
	}

	const rows = executeJson('SELECT name FROM d1_migrations ORDER BY id');
	return new Set((rows[0]?.results ?? []).map((row) => row.name));
}

function maybeBackfillBookmarkHotPathMigration() {
	const appliedMigrationNames = getAppliedMigrationNames();
	if (appliedMigrationNames.has(migrationName) || !tableExists('bookmarks')) {
		return;
	}

	const bookmarkColumns = getBookmarkColumns();
	const isMixedSchema = compatibilityColumns.some((column) => bookmarkColumns.has(column));
	if (!isMixedSchema) {
		return;
	}

	const pendingStatements = bookmarkHotPathStatements.filter((statement) => {
		if (!statement.startsWith('ALTER TABLE bookmarks ADD COLUMN ')) {
			return true;
		}

		const columnName = statement.split(' ')[5];
		return !bookmarkColumns.has(columnName);
	});

	pendingStatements.push(
		`INSERT INTO d1_migrations (id, name, applied_at)
		VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM d1_migrations), '${migrationName}', CURRENT_TIMESTAMP)`,
	);

	executeSql(pendingStatements.join('; '));
}

if (!scopeArgs.some((arg) => arg === '--local' || arg === '--remote' || arg === '--preview')) {
	usage();
}

maybeBackfillBookmarkHotPathMigration();

runWrangler([
	'd1',
	'migrations',
	'apply',
	databaseName,
	...scopeArgs,
]);
