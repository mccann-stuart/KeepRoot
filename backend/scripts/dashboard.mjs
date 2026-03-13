import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const command = process.argv[2] ?? 'build';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(scriptDir, '..');
const dashboardDir = path.join(backendDir, 'dashboard', 'src');
const publicDir = path.join(backendDir, 'public');
const assetDir = path.join(publicDir, 'assets');
const isWatch = command === 'watch';

function resetAssetDirectory() {
	fs.rmSync(assetDir, { force: true, recursive: true });
	fs.mkdirSync(assetDir, { recursive: true });
}

const appConfig = {
	bundle: true,
	entryNames: '[name]',
	entryPoints: {
		app: path.join(dashboardDir, 'main.ts'),
	},
	format: 'esm',
	logLevel: 'info',
	minify: !isWatch,
	outdir: assetDir,
	platform: 'browser',
	sourcemap: isWatch ? 'inline' : false,
	target: ['es2022'],
};

const serviceWorkerConfig = {
	bundle: true,
	entryPoints: [path.join(dashboardDir, 'service-worker.ts')],
	format: 'iife',
	logLevel: 'info',
	minify: !isWatch,
	outfile: path.join(publicDir, 'sw.js'),
	platform: 'browser',
	sourcemap: isWatch ? 'inline' : false,
	target: ['es2020'],
};

async function buildOnce() {
	resetAssetDirectory();
	await esbuild.build(appConfig);
	await esbuild.build(serviceWorkerConfig);
}

async function watch() {
	resetAssetDirectory();
	const appContext = await esbuild.context(appConfig);
	const serviceWorkerContext = await esbuild.context(serviceWorkerConfig);
	await Promise.all([appContext.watch(), serviceWorkerContext.watch()]);
	console.log('Watching dashboard assets...');
}

if (isWatch) {
	watch().catch(() => process.exit(1));
} else {
	buildOnce().catch(() => process.exit(1));
}
