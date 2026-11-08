/**
 * better-sqlite3 ships prebuilt binaries for Electron, but not for every host
 * Node version. Installing it with the host Node ABI leaves Electron unable to
 * load the module, and building from source needs a full C++ toolchain.
 *
 * This script downloads the prebuilt binary matching the installed Electron
 * version and only falls back to a source rebuild when none is available.
 */
const { execFileSync } = require('child_process');
const path = require('path');

function run(command, args, options) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

let electronVersion;
try {
  electronVersion = require('electron/package.json').version;
} catch {
  console.log('[rebuild-native] Electron is not installed yet, skipping.');
  process.exit(0);
}

let moduleDir;
try {
  moduleDir = path.dirname(require.resolve('better-sqlite3/package.json'));
} catch {
  console.log('[rebuild-native] better-sqlite3 is not installed, skipping.');
  process.exit(0);
}

try {
  const prebuildInstall = require.resolve('prebuild-install/bin.js', { paths: [moduleDir] });
  console.log(`[rebuild-native] Installing better-sqlite3 prebuilt binary for Electron ${electronVersion}...`);
  run(process.execPath, [prebuildInstall, '-r', 'electron', '-t', electronVersion], { cwd: moduleDir });
  console.log('[rebuild-native] Done.');
} catch (error) {
  console.warn('[rebuild-native] No prebuilt binary available, rebuilding from source...');
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  run(npx, ['electron-builder', 'install-app-deps'], { cwd: path.resolve(__dirname, '..') });
}
