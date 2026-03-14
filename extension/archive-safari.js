const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = __dirname;
const projectPath = path.join(rootDir, 'safari', 'KeepRoot', 'KeepRoot.xcodeproj');
const archiveRoot = path.join(rootDir, 'build', 'safari');
const teamId = process.env.SAFARI_TEAM_ID || process.env.DEVELOPMENT_TEAM;
const platform = (process.env.SAFARI_PLATFORM || 'macos').toLowerCase();

const platformConfig = {
  ios: {
    archiveName: 'KeepRoot-iOS.xcarchive',
    destination: 'generic/platform=iOS',
    scheme: 'KeepRoot (iOS)',
  },
  macos: {
    archiveName: 'KeepRoot-macOS.xcarchive',
    destination: 'generic/platform=macOS',
    scheme: 'KeepRoot (macOS)',
  },
}[platform];

if (!fs.existsSync(projectPath)) {
  console.error('Missing extension/safari/KeepRoot/KeepRoot.xcodeproj. Run "npm run build:safari" first.');
  process.exit(1);
}

if (!platformConfig) {
  console.error(`Unsupported SAFARI_PLATFORM "${platform}". Use "ios" or "macos".`);
  process.exit(1);
}

fs.mkdirSync(archiveRoot, { recursive: true });
const archivePath = path.join(archiveRoot, platformConfig.archiveName);

const args = [
  '-project',
  projectPath,
  '-scheme',
  platformConfig.scheme,
  '-configuration',
  'Release',
  '-destination',
  platformConfig.destination,
  '-archivePath',
  archivePath,
  'archive',
];

if (teamId) {
  args.push(`DEVELOPMENT_TEAM=${teamId}`);
}

const result = spawnSync('xcodebuild', args, { stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);
