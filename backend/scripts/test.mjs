import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, '..');
const target = process.argv[2];
const extraArgs = process.argv.slice(3).filter((arg) => arg !== '--runInBand');

function usage() {
	console.error('Usage: node ./scripts/test.mjs <all|worker|dashboard> [vitest args]');
	process.exit(1);
}

function run(command, args) {
	const result = spawnSync(command, args, {
		cwd: backendDir,
		encoding: 'utf8',
		env: {
			...process.env,
			CI: '1',
		},
	});

	if (result.stdout) {
		process.stdout.write(result.stdout);
	}
	if (result.stderr) {
		process.stderr.write(result.stderr);
	}
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

if (!['all', 'worker', 'dashboard'].includes(target)) {
	usage();
}

run('npm', ['run', 'build:dashboard']);

if (target === 'all' || target === 'worker') {
	run('npx', ['vitest', 'run', '--config', 'vitest.config.mts', ...extraArgs]);
}

if (target === 'all' || target === 'dashboard') {
	run('npx', ['vitest', 'run', '--config', 'vitest.dashboard.config.mts', ...extraArgs]);
}
