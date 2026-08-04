const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const extensionDir = __dirname;
const repositoryDir = path.resolve(extensionDir, '..');
const chromeSourceDir = path.join(extensionDir, 'build', 'webextension');
const safariSourceDir = path.join(extensionDir, 'safari', 'KeepRoot');
const downloadDir = path.join(repositoryDir, 'backend', 'public', 'downloads');
const maxCloudflareAssetBytes = 25 * 1024 * 1024;
const packageJson = JSON.parse(fs.readFileSync(path.join(extensionDir, 'package.json'), 'utf8'));
const version = packageJson.version;

const ignoredNames = new Set([
  '.DS_Store',
  'DerivedData',
  'build',
  'xcuserdata',
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureDirectory(directoryPath, description) {
  if (!fs.statSync(directoryPath, { throwIfNoEntry: false })?.isDirectory()) {
    fail(`Missing ${description} at "${directoryPath}".`);
  }
}

function shouldInclude(sourcePath) {
  const name = path.basename(sourcePath);
  return !ignoredNames.has(name) && !name.endsWith('.xcuserstate');
}

function copyCleanDirectory(sourceDir, destinationDir) {
  fs.cpSync(sourceDir, destinationDir, {
    filter: shouldInclude,
    recursive: true,
  });
}

function createZip(workingDir, entry, outputPath) {
  fs.rmSync(outputPath, { force: true });
  const result = spawnSync('zip', ['-q', '-r', '-X', outputPath, entry], {
    cwd: workingDir,
    stdio: 'pipe',
  });

  if (result.error) {
    fail(`Failed to package "${outputPath}": ${result.error.message}`);
  }

  if ((result.status ?? 0) !== 0) {
    const detail = result.stderr?.toString().trim() || `zip exited with status ${result.status}`;
    fail(`Failed to package "${outputPath}": ${detail}`);
  }
}

function verifyCloudflareAsset(outputPath) {
  const size = fs.statSync(outputPath).size;
  if (size > maxCloudflareAssetBytes) {
    fail(
      `Package "${outputPath}" is ${(size / 1024 / 1024).toFixed(2)} MiB, `
      + 'which exceeds Cloudflare Workers\' 25 MiB static-asset limit.',
    );
  }

  console.log(`Packaged ${path.basename(outputPath)} (${(size / 1024 / 1024).toFixed(2)} MiB)`);
}

ensureDirectory(chromeSourceDir, 'built Chrome WebExtension');
ensureDirectory(safariSourceDir, 'Safari Xcode project');

const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keeproot-downloads-'));

try {
  const chromeStageDir = path.join(stagingDir, 'chrome');
  const safariStageParent = path.join(stagingDir, 'safari');
  const safariStageDir = path.join(safariStageParent, 'KeepRoot-Safari');
  fs.mkdirSync(chromeStageDir, { recursive: true });
  fs.mkdirSync(safariStageParent, { recursive: true });

  copyCleanDirectory(chromeSourceDir, chromeStageDir);
  copyCleanDirectory(safariSourceDir, safariStageDir);

  fs.writeFileSync(path.join(chromeStageDir, 'README.txt'), [
    `KeepRoot Chrome extension ${version}`,
    '',
    '1. Unzip this bundle.',
    '2. Open chrome://extensions in Chrome.',
    '3. Enable Developer mode.',
    '4. Choose Load unpacked and select the unzipped folder.',
    '5. Open the KeepRoot extension settings and enter your Worker URL and API key.',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(safariStageDir, 'README.txt'), [
    `KeepRoot Safari extension ${version}`,
    '',
    '1. Open KeepRoot.xcodeproj in Xcode.',
    '2. Select your Apple development team for the app and extension targets.',
    '3. Build and run the macOS or iOS app.',
    '4. Enable KeepRoot in Safari Extensions settings.',
    '5. Open the KeepRoot extension settings and enter your Worker URL and API key.',
    '',
    'Apple signing is account-specific, so this bundle contains the clean Xcode project rather than an unsigned app.',
    '',
  ].join('\n'));

  fs.rmSync(downloadDir, { force: true, recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  const chromeOutput = path.join(downloadDir, 'keeproot-chrome.zip');
  const safariOutput = path.join(downloadDir, 'keeproot-safari.zip');
  createZip(chromeStageDir, '.', chromeOutput);
  createZip(safariStageParent, 'KeepRoot-Safari', safariOutput);
  verifyCloudflareAsset(chromeOutput);
  verifyCloudflareAsset(safariOutput);
} finally {
  fs.rmSync(stagingDir, { force: true, recursive: true });
}
