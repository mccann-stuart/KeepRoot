import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, '..');
const configPath = path.join(backendDir, 'wrangler.jsonc');
const command = process.argv[2];

function loadConfig() {
	const configText = readFileSync(configPath, 'utf8');
	const parsed = ts.parseConfigFileTextToJson(configPath, configText);
	if (parsed.error) {
		throw new Error(`Unable to parse wrangler.jsonc: ${parsed.error.messageText}`);
	}
	return parsed.config ?? {};
}

function runWrangler(args, options = {}) {
	const result = spawnSync('npx', ['wrangler', ...args], {
		cwd: backendDir,
		encoding: 'utf8',
		env: {
			...process.env,
			CI: '1',
		},
	});

	const stdout = result.stdout ?? '';
	const stderr = result.stderr ?? '';
	
	const isAllowedError = options.allowAlreadyExists && /already exists/i.test(`${stdout}\n${stderr}`);

	if (result.status === 0) {
		if (stdout) process.stdout.write(stdout);
		if (stderr) process.stderr.write(stderr);
		return;
	}

	if (isAllowedError) {
		// Suppress output to avoid confusing the user with scary error messages for benign failures
		return;
	}

	if (stdout) process.stdout.write(stdout);
	if (stderr) process.stderr.write(stderr);
	process.exit(result.status ?? 1);
}

function runNodeScript(relativeScriptPath, args = []) {
	const result = spawnSync('node', [relativeScriptPath, ...args], {
		cwd: backendDir,
		encoding: 'utf8',
		env: {
			...process.env,
			CI: '1',
		},
	});

	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function ensureRemoteResources() {
	const config = loadConfig();
	for (const database of config.d1_databases ?? []) {
		if (!database.database_name) {
			continue;
		}

		runWrangler(['d1', 'create', database.database_name], { allowAlreadyExists: true });
	}

	for (const bucket of config.r2_buckets ?? []) {
		if (!bucket.bucket_name) {
			continue;
		}

		runWrangler(['r2', 'bucket', 'create', bucket.bucket_name], { allowAlreadyExists: true });
	}
}

switch (command) {
	case 'provision':
		ensureRemoteResources();
		runWrangler(['d1', 'migrations', 'apply', 'KEEPROOT_DB', '--remote']);
		runWrangler(['types']);
		break;
	case 'deploy':
		ensureRemoteResources();
		runWrangler(['d1', 'migrations', 'apply', 'KEEPROOT_DB', '--remote']);
		runWrangler(['types']);
		runWrangler(['deploy']);
		break;
	case 'dev':
		runWrangler(['types']);
		runWrangler(['d1', 'migrations', 'apply', 'KEEPROOT_DB', '--local']);
		runWrangler(['dev']);
		break;
	case 'types':
		runWrangler(['types']);
		break;
	default:
		console.error('Usage: node scripts/cloudflare.mjs <provision|deploy|dev|types>');
		process.exit(1);
}
