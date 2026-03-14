const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const rootDir = __dirname;
const packagedExtensionDir = path.join(rootDir, 'build', 'webextension');
const safariAppDir = path.join(rootDir, 'safari', 'KeepRoot');
const projectFilePath = path.join(safariAppDir, 'KeepRoot.xcodeproj', 'project.pbxproj');
const extensionResourcesDir = path.join(safariAppDir, 'Shared (Extension)', 'Resources');
const hostAppIconSetDir = path.join(
  safariAppDir,
  'Shared (App)',
  'Assets.xcassets',
  'AppIcon.appiconset',
);
const hostLargeIconPath = path.join(
  safariAppDir,
  'Shared (App)',
  'Assets.xcassets',
  'LargeIcon.imageset',
  'icon256.png',
);
const hostAppIconPath = path.join(safariAppDir, 'Shared (App)', 'Resources', 'Icon.png');
const icon1024SourcePath = path.join(rootDir, 'public', 'icons', 'icon1024.png');
const icon256SourcePath = path.join(rootDir, 'public', 'icons', 'icon256.png');
const packageJsonPath = path.join(rootDir, 'package.json');

const { version: marketingVersion = '1.0.0' } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const buildNumber = process.env.SAFARI_BUILD_NUMBER || '1';
const bundleIdentifier = process.env.SAFARI_BUNDLE_ID;

const iconVariants = [
  ['mac-icon-16@1x.png', 16],
  ['mac-icon-16@2x.png', 32],
  ['mac-icon-32@1x.png', 32],
  ['mac-icon-32@2x.png', 64],
  ['mac-icon-128@1x.png', 128],
  ['mac-icon-128@2x.png', 256],
  ['mac-icon-256@1x.png', 256],
  ['mac-icon-256@2x.png', 512],
  ['mac-icon-512@1x.png', 512],
  ['mac-icon-512@2x.png', 1024],
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureExists(filePath, message) {
  if (!fs.existsSync(filePath)) {
    fail(message);
  }
}

function copyDirectoryContents(sourceDir, destinationDir) {
  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir)) {
    const sourcePath = path.join(sourceDir, entry);
    const destinationPath = path.join(destinationDir, entry);
    fs.cpSync(sourcePath, destinationPath, { recursive: true });
  }
}

function run(command, args, options = {}) {
  const stdio = options.quiet ? 'pipe' : 'inherit';
  const result = spawnSync(command, args, { stdio });

  if (result.error) {
    fail(result.error.message);
  }

  if ((result.status ?? 0) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function syncHostAppIcons() {
  ensureExists(
    icon1024SourcePath,
    'Missing extension/public/icons/icon1024.png. Generate the high-resolution app icon first.',
  );

  fs.mkdirSync(hostAppIconSetDir, { recursive: true });

  for (const [fileName, size] of iconVariants) {
    const outputPath = path.join(hostAppIconSetDir, fileName);
    run('sips', ['-z', `${size}`, `${size}`, icon1024SourcePath, '--out', outputPath], {
      quiet: true,
    });
  }

  fs.copyFileSync(
    icon1024SourcePath,
    path.join(hostAppIconSetDir, 'universal-icon-1024@1x.png'),
  );
  fs.copyFileSync(icon1024SourcePath, hostAppIconPath);

  if (fs.existsSync(icon256SourcePath)) {
    fs.copyFileSync(icon256SourcePath, hostLargeIconPath);
  } else {
    run('sips', ['-z', '256', '256', icon1024SourcePath, '--out', hostLargeIconPath], {
      quiet: true,
    });
  }
}

function syncProjectMetadata() {
  const originalProject = fs.readFileSync(projectFilePath, 'utf8');
  let updatedProject = originalProject
    .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${marketingVersion};`)
    .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);

  if (bundleIdentifier) {
    updatedProject = updatedProject.replace(
      /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g,
      (match, currentIdentifier) => {
        if (currentIdentifier.trim().endsWith('.Extension')) {
          return `PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier}.Extension;`;
        }

        return `PRODUCT_BUNDLE_IDENTIFIER = ${bundleIdentifier};`;
      },
    );
  }

  if (updatedProject !== originalProject) {
    fs.writeFileSync(projectFilePath, updatedProject);
  }
}

ensureExists(packagedExtensionDir, 'Missing build/webextension. Run "npm run build" first.');
ensureExists(projectFilePath, 'Missing extension/safari/KeepRoot. Restore the checked-in Safari app project.');

copyDirectoryContents(packagedExtensionDir, extensionResourcesDir);
syncHostAppIcons();
syncProjectMetadata();

console.log(`Safari app project synced at ${safariAppDir}`);
