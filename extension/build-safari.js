const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = __dirname;
const packagedExtensionDir = path.join(rootDir, 'build', 'webextension');
const safariProjectDir = path.join(rootDir, 'build', 'safari');
const appName = process.env.SAFARI_APP_NAME || 'KeepRoot';
const bundleIdentifier = process.env.SAFARI_BUNDLE_ID || 'com.keeproot.safari';

function patchProjectBundleIdentifiers() {
  const projectFilePath = path.join(
    safariProjectDir,
    appName,
    `${appName}.xcodeproj`,
    'project.pbxproj',
  );

  if (!fs.existsSync(projectFilePath)) {
    console.warn(`Unable to locate generated Xcode project at ${projectFilePath}`);
    return;
  }

  const originalProject = fs.readFileSync(projectFilePath, 'utf8');
  const patchedProject = originalProject.replace(
    /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g,
    (match, currentIdentifier) => {
      if (currentIdentifier.trim().endsWith('.Extension')) {
        return match;
      }

      return `PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier};`;
    },
  );

  fs.writeFileSync(projectFilePath, patchedProject);
}

if (!fs.existsSync(packagedExtensionDir)) {
  console.error('Missing build/webextension. Run "npm run build" first.');
  process.exit(1);
}

fs.rmSync(safariProjectDir, { recursive: true, force: true });

const result = spawnSync(
  'xcrun',
  [
    'safari-web-extension-packager',
    '--project-location',
    safariProjectDir,
    '--app-name',
    appName,
    '--bundle-identifier',
    bundleIdentifier,
    '--swift',
    '--macos-only',
    '--copy-resources',
    '--no-open',
    '--no-prompt',
    '--force',
    packagedExtensionDir,
  ],
  {
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if ((result.status ?? 0) === 0) {
  patchProjectBundleIdentifiers();
}

process.exit(result.status ?? 0);
