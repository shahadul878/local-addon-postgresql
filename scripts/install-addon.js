#!/usr/bin/env node
'use strict';

/**
 * Installs this add-on into Local and enables it.
 *
 *   node scripts/install-addon.js            copy into Local's add-ons folder (default)
 *   node scripts/install-addon.js --link     symlink instead, for development
 *   node scripts/install-addon.js --remove   uninstall and disable
 *
 * Quit Local first; it reads add-ons and enabled-addons.json at start-up.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_DIR = path.resolve(__dirname, '..');
const { name: ADDON_NAME } = require(path.join(PROJECT_DIR, 'package.json'));
const SHIPPED_ENTRIES = ['package.json', 'lib', 'assets/icon.png', 'README.md', 'LICENSE'];

function localUserDataDir() {
  if (process.env.LOCAL_USER_DATA) {
    return process.env.LOCAL_USER_DATA;
  }
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Local');
    case 'win32':
      return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Local');
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Local');
  }
}

function readEnabledAddons(file) {
  if (!fs.existsSync(file)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch (error) {
    throw new Error(`${file} is not valid JSON (${error.message}); fix or delete it and retry.`);
  }
}

function setEnabled(userDataDir, isEnabled) {
  const file = path.join(userDataDir, 'enabled-addons.json');
  const current = readEnabledAddons(file);
  const { [ADDON_NAME]: _previous, ...others } = current;
  const next = isEnabled ? { ...others, [ADDON_NAME]: true } : others;
  fs.writeFileSync(file, JSON.stringify(next));
}

function install(target, isLink) {
  fs.rmSync(target, { recursive: true, force: true });
  if (isLink) {
    fs.symlinkSync(PROJECT_DIR, target, process.platform === 'win32' ? 'junction' : 'dir');
    return;
  }
  fs.mkdirSync(target, { recursive: true });
  SHIPPED_ENTRIES
    .filter((entry) => fs.existsSync(path.join(PROJECT_DIR, entry)))
    .forEach((entry) => fs.cpSync(path.join(PROJECT_DIR, entry), path.join(target, entry), { recursive: true }));
}

function main() {
  const args = new Set(process.argv.slice(2));
  const userDataDir = localUserDataDir();
  if (!fs.existsSync(userDataDir)) {
    throw new Error(`Local's data folder was not found at ${userDataDir}. Is Local installed? Set LOCAL_USER_DATA to override.`);
  }
  const addonsDir = path.join(userDataDir, 'addons');
  const target = path.join(addonsDir, ADDON_NAME);

  if (args.has('--remove')) {
    fs.rmSync(target, { recursive: true, force: true });
    setEnabled(userDataDir, false);
    process.stdout.write(`Removed ${ADDON_NAME} from ${addonsDir}\n`);
    return;
  }

  fs.mkdirSync(addonsDir, { recursive: true });
  install(target, args.has('--link'));
  setEnabled(userDataDir, true);
  process.stdout.write(`${args.has('--link') ? 'Linked' : 'Installed'} ${ADDON_NAME} into ${addonsDir} and enabled it. Restart Local to load it.\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
}
