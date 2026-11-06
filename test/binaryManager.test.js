'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const { createBinaryManager, resolveTar } = require('../lib/binaryManager');
const { createPaths } = require('../lib/paths');
const { getArchiveBaseName } = require('../lib/platform');
const { makeTempDir, createSilentLogger, createFakeRunner } = require('./helpers');

const TRIPLE = 'x86_64-unknown-linux-gnu';
const VERSION = '16.15.1';
const GOOD_SHA = 'a'.repeat(64);

/** Fake `tar -xzf <archive> -C <dir>` that produces the upstream folder layout. */
function fakeTar({ withBin = true, libs = {} } = {}) {
  return createFakeRunner(async (_file, args) => {
    const dest = args[args.indexOf('-C') + 1];
    const root = path.join(dest, getArchiveBaseName(VERSION, TRIPLE));
    await fs.mkdir(withBin ? path.join(root, 'bin') : root, { recursive: true });
    if (withBin) {
      await fs.writeFile(path.join(root, 'bin', 'postgres'), '');
    }
    await fs.mkdir(path.join(root, 'lib'), { recursive: true });
    await Promise.all(Object.entries(libs).map(([name, content]) => fs.writeFile(path.join(root, 'lib', name), content)));
  });
}

async function setup({ sha = GOOD_SHA, runner = fakeTar(), triple = TRIPLE, systemGlibc = null, systemLibDirs = [] } = {}) {
  const dir = await makeTempDir();
  const paths = createPaths(dir, 'linux');
  const downloads = [];
  const downloadFile = async (url, destination, onProgress) => {
    downloads.push(url);
    await fs.writeFile(destination, 'archive');
    onProgress({ received: 7, total: 7 });
    return { sha256: sha, bytes: 7 };
  };
  const fetchText = async () => `${GOOD_SHA}  file.tar.gz\n`;
  const manager = createBinaryManager({
    paths, triple, fs, downloadFile, fetchText, runCommand: runner.run, logger: createSilentLogger(), systemGlibc, systemLibDirs,
  });
  return { dir, paths, manager, downloads, runner };
}

test('installs a version: download, verify, extract, clean up', async () => {
  const { paths, manager, downloads } = await setup();
  const events = [];

  await manager.install(VERSION, (event) => events.push(event.phase));

  assert.equal(await manager.isInstalled(VERSION), true);
  assert.deepEqual(await manager.listInstalled(), [VERSION]);
  assert.equal(downloads.length, 1);
  assert.deepEqual(events, ['download', 'extract', 'done']);
  assert.deepEqual(await fs.readdir(paths.downloadsDir), []);
  assert.deepEqual((await fs.readdir(paths.versionsDir)).filter((n) => n.startsWith('.staging')), []);
});

test('install is a no-op when the version is already present', async () => {
  const { manager, downloads } = await setup();
  await manager.install(VERSION);
  await manager.install(VERSION);
  assert.equal(downloads.length, 1);
});

test('concurrent installs of the same version share one download', async () => {
  const { manager, downloads } = await setup();
  await Promise.all([manager.install(VERSION), manager.install(VERSION)]);
  assert.equal(downloads.length, 1);
});

test('rejects a download whose checksum does not match', async () => {
  const { manager, paths } = await setup({ sha: 'b'.repeat(64) });
  await assert.rejects(manager.install(VERSION), /Checksum mismatch/);
  assert.equal(await manager.isInstalled(VERSION), false);
  assert.deepEqual(await fs.readdir(paths.downloadsDir), []);
});

test('rejects an archive without the expected layout', async () => {
  const { manager } = await setup({ runner: fakeTar({ withBin: false }) });
  await assert.rejects(manager.install(VERSION), /did not contain the expected files/);
});

test('refuses unsupported versions and platforms', async () => {
  const { manager } = await setup();
  await assert.rejects(manager.install('1.0.0'), /Unsupported PostgreSQL version/);

  const unsupported = await setup({ triple: null });
  assert.equal(unsupported.manager.isPlatformSupported, false);
  await assert.rejects(unsupported.manager.install(VERSION), /not available/);
});

test('remove deletes an installed version', async () => {
  const { manager } = await setup();
  await manager.install(VERSION);
  await manager.remove(VERSION);
  assert.equal(await manager.isInstalled(VERSION), false);
});

test('every concurrent caller receives progress for a shared download', async () => {
  const { manager } = await setup();
  const first = [];
  const second = [];
  await Promise.all([
    manager.install(VERSION, (e) => first.push(e.phase)),
    manager.install(VERSION, (e) => second.push(e.phase)),
  ]);
  assert.deepEqual(first, ['download', 'extract', 'done']);
  assert.deepEqual(second, first);
});

test('uses the Windows system tar so GNU tar on PATH cannot misread drive letters', () => {
  assert.equal(resolveTar('linux'), 'tar');
  assert.equal(resolveTar('win32', { SystemRoot: 'D:\\Win' }), 'D:\\Win\\System32\\tar.exe');
  assert.equal(resolveTar('win32', {}), 'C:\\Windows\\System32\\tar.exe');
});

const NEEDS_NEWER_GLIBC = Buffer.from('\x7fELF\0GLIBC_2.17\0GLIBC_2.36\0', 'latin1');

async function systemWithLibstdcxx() {
  const systemDir = await makeTempDir();
  await fs.writeFile(path.join(systemDir, 'libstdc++.so.6'), 'system copy');
  return systemDir;
}

test('install uses the system copy of a bundled library that needs a newer glibc', async () => {
  const systemDir = await systemWithLibstdcxx();
  const { paths, manager } = await setup({
    runner: fakeTar({ libs: { 'libstdc++.so.6': NEEDS_NEWER_GLIBC } }), systemGlibc: '2.35', systemLibDirs: [systemDir],
  });

  await manager.install(VERSION);

  const lib = path.join(paths.versionDir(VERSION), 'lib', 'libstdc++.so.6');
  await assert.rejects(fs.access(lib));
  await fs.access(path.join(paths.versionDir(VERSION), 'lib-disabled', 'libstdc++.so.6'));
});

test('install repairs a version that was installed before the glibc check existed', async () => {
  const { paths, manager } = await setup({ runner: fakeTar({ libs: { 'libstdc++.so.6': NEEDS_NEWER_GLIBC } }) });
  await manager.install(VERSION);
  const lib = path.join(paths.versionDir(VERSION), 'lib', 'libstdc++.so.6');
  await fs.access(lib);

  const repaired = createBinaryManager({
    paths, triple: TRIPLE, fs, downloadFile: async () => assert.fail('must not download again'), fetchText: async () => '',
    runCommand: async () => assert.fail('must not extract again'), logger: createSilentLogger(),
    systemGlibc: '2.35', systemLibDirs: [await systemWithLibstdcxx()],
  });
  await repaired.install(VERSION);

  await assert.rejects(fs.access(lib));
});
