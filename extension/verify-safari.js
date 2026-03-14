const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = __dirname;
const projectPath = path.join(rootDir, 'safari', 'KeepRoot', 'KeepRoot.xcodeproj');
const platform = (process.env.SAFARI_PLATFORM || 'all').toLowerCase();

const platforms = {
  ios: {
    destination: 'generic/platform=iOS',
    scheme: 'KeepRoot (iOS)',
  },
  macos: {
    destination: 'generic/platform=macOS',
    scheme: 'KeepRoot (macOS)',
  },
};

if (!fs.existsSync(projectPath)) {
  console.error('Missing extension/safari/KeepRoot/KeepRoot.xcodeproj. Run "npm run build:safari" first.');
  process.exit(1);
}

const requestedPlatforms =
  platform === 'all'
    ? ['macos', 'ios']
    : Object.hasOwn(platforms, platform)
      ? [platform]
      : null;

if (!requestedPlatforms) {
  console.error(`Unsupported SAFARI_PLATFORM "${platform}". Use "ios", "macos", or "all".`);
  process.exit(1);
}

for (const requestedPlatform of requestedPlatforms) {
  const { destination, scheme } = platforms[requestedPlatform];
  const result = spawnSync(
    'xcodebuild',
    [
      '-project',
      projectPath,
      '-scheme',
      scheme,
      '-configuration',
      'Release',
      '-destination',
      destination,
      'CODE_SIGNING_ALLOWED=NO',
      'build',
    ],
    { stdio: 'inherit' },
  );

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
}
