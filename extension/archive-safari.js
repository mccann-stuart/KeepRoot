const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = __dirname;
const projectPath = path.join(rootDir, 'safari', 'KeepRoot', 'KeepRoot.xcodeproj');
const archiveRoot = path.join(rootDir, 'build', 'safari');
const archivePath = path.join(archiveRoot, 'KeepRoot.xcarchive');
const teamId = process.env.SAFARI_TEAM_ID || process.env.DEVELOPMENT_TEAM;

if (!fs.existsSync(projectPath)) {
  console.error('Missing extension/safari/KeepRoot/KeepRoot.xcodeproj. Run "npm run build:safari" first.');
  process.exit(1);
}

fs.mkdirSync(archiveRoot, { recursive: true });

const args = [
  '-project',
  projectPath,
  '-scheme',
  'KeepRoot',
  '-configuration',
  'Release',
  '-destination',
  'generic/platform=macOS',
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
