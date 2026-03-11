const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');

const baseConfig = {
  bundle: true,
  minify: !isWatch,
  sourcemap: isWatch ? 'inline' : false,
  format: 'iife',
  target: ['chrome110'],
  logLevel: 'info',
};

async function build() {
  const contentsConfig = {
    ...baseConfig,
    entryPoints: ['src/content/content.js'],
    outfile: 'dist/content.js',
  };

  const backgroundConfig = {
    ...baseConfig,
    entryPoints: ['src/background/background.js'],
    outfile: 'dist/background.js',
  };

  if (isWatch) {
    const ctxContent = await esbuild.context(contentsConfig);
    const ctxBackground = await esbuild.context(backgroundConfig);
    
    await ctxContent.watch();
    await ctxBackground.watch();
    console.log('Watching for changes...');
  } else {
    await esbuild.build(contentsConfig);
    await esbuild.build(backgroundConfig);
    console.log('Build completed.');
  }
}

build().catch(() => process.exit(1));
