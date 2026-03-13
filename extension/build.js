const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');
const rootDir = __dirname;
const packagedExtensionDir = path.join(rootDir, 'build', 'webextension');
const staticAssets = [
  'manifest.json',
  'public',
  'src/popup/popup.html',
  'src/options/options.html',
  'src/styles',
];

const baseConfig = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  logLevel: 'info',
  entryPoints: {
    background: 'src/background/background.js',
    content: 'src/content/content.js',
    options: 'src/options/options.js',
    popup: 'src/popup/popup.js',
  },
  outdir: 'dist',
};

function copyStaticAssets() {
  fs.rmSync(packagedExtensionDir, { recursive: true, force: true });

  for (const relativePath of staticAssets) {
    const sourcePath = path.join(rootDir, relativePath);
    const outputPath = path.join(packagedExtensionDir, relativePath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.cpSync(sourcePath, outputPath, { recursive: true });
  }

  fs.cpSync(path.join(rootDir, 'dist'), path.join(packagedExtensionDir, 'dist'), { recursive: true });
}

async function build() {
  if (isWatch) {
    const ctx = await esbuild.context(baseConfig);
    await ctx.watch();
    console.log('Watching dist/ bundles. Run npm run build to refresh build/webextension/.');
  } else {
    await esbuild.build(baseConfig);
    copyStaticAssets();
    console.log('Build completed. Load extension/build/webextension in Chrome or package it for Safari.');
  }
}

build().catch(() => process.exit(1));
