'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const { maxGlibcRequired, makeCompatible, compareGlibc, systemLibraryDirs, detectSystemGlibc } = require('../lib/glibcCompat');
const { makeTempDir, createSilentLogger } = require('./helpers');

/** A stand-in for an ELF file: the version names a dynamic linker would read from .dynstr. */
const elf = (...versions) => Buffer.from(`\x7fELF junk\0${versions.map((v) => `GLIBC_${v}`).join('\0')}\0more junk`, 'latin1');

async function makeBundle({ bin = {}, lib = {} } = {}) {
  const root = await makeTempDir();
  const bundle = path.join(root, 'pg');
  const system = path.join(root, 'system');
  await fs.mkdir(path.join(bundle, 'bin'), { recursive: true });
  await fs.mkdir(path.join(bundle, 'lib'), { recursive: true });
  await fs.mkdir(system, { recursive: true });
  await Promise.all([
    ...Object.entries(bin).map(([name, content]) => fs.writeFile(path.join(bundle, 'bin', name), content)),
    ...Object.entries(lib).map(([name, content]) => fs.writeFile(path.join(bundle, 'lib', name), content)),
  ]);
  return { bundle, system };
}

const exists = (file) => fs.access(file).then(() => true, () => false);

test('compareGlibc orders versions numerically', () => {
  assert.ok(compareGlibc('2.36', '2.35') > 0);
  assert.ok(compareGlibc('2.9', '2.17') < 0);
  assert.equal(compareGlibc('2.35', '2.35'), 0);
});

test('maxGlibcRequired finds the highest version, even across read chunks', async () => {
  const { bundle } = await makeBundle({ lib: { 'libx.so.1': elf('2.2.5', '2.17', '2.36', '2.34') } });
  const file = path.join(bundle, 'lib', 'libx.so.1');

  assert.equal(await maxGlibcRequired(file, fs), '2.36');
  assert.equal(await maxGlibcRequired(file, fs, { chunkSize: 7 }), '2.36');
});

test('maxGlibcRequired returns null for files without glibc references', async () => {
  const { bundle } = await makeBundle({ lib: { 'data.so': Buffer.from('nothing here') } });
  assert.equal(await maxGlibcRequired(path.join(bundle, 'lib', 'data.so'), fs), null);
});

test('moves aside bundled libraries that need a newer glibc when the system has its own copy', async () => {
  const { bundle, system } = await makeBundle({
    bin: { postgres: elf('2.34'), initdb: elf('2.34') },
    lib: { 'libstdc++.so.6': elf('2.36'), 'libssl.so.3': elf('2.34'), 'libfoo.so.1': elf('2.36') },
  });
  await fs.writeFile(path.join(system, 'libstdc++.so.6'), 'system copy');
  await fs.writeFile(path.join(system, 'libssl.so.3'), 'system copy');
  const logger = createSilentLogger();

  const disabled = await makeCompatible({ dir: bundle, systemGlibc: '2.35', systemLibDirs: [system], fs, logger });

  assert.deepEqual(disabled, ['libstdc++.so.6']);
  assert.equal(await exists(path.join(bundle, 'lib', 'libstdc++.so.6')), false);
  assert.equal(await exists(path.join(bundle, 'lib-disabled', 'libstdc++.so.6')), true);
  assert.equal(await exists(path.join(bundle, 'lib', 'libssl.so.3')), true, 'compatible libraries stay');
  assert.equal(await exists(path.join(bundle, 'lib', 'libfoo.so.1')), true, 'no system copy, so it stays');
});

test('refuses a build whose PostgreSQL programs need a newer glibc', async () => {
  const { bundle, system } = await makeBundle({ bin: { postgres: elf('2.17'), initdb: elf('2.38') } });

  await assert.rejects(
    makeCompatible({ dir: bundle, systemGlibc: '2.35', systemLibDirs: [system], fs, logger: createSilentLogger() }),
    /needs a newer Linux: initdb requires glibc 2\.38, but this system has glibc 2\.35/,
  );
});

test('does nothing when the system glibc is unknown, and is safe to run twice', async () => {
  const { bundle, system } = await makeBundle({ bin: { initdb: elf('2.40') }, lib: { 'libz.so.1': elf('2.40') } });
  await fs.writeFile(path.join(system, 'libz.so.1'), 'system copy');
  const options = { dir: bundle, systemLibDirs: [system], fs, logger: createSilentLogger() };

  assert.deepEqual(await makeCompatible({ ...options, systemGlibc: null }), []);

  const { bundle: second, system: secondSystem } = await makeBundle({ lib: { 'libz.so.1': elf('2.40') } });
  await fs.writeFile(path.join(secondSystem, 'libz.so.1'), 'system copy');
  const again = { dir: second, systemGlibc: '2.35', systemLibDirs: [secondSystem], fs, logger: createSilentLogger() };
  assert.deepEqual(await makeCompatible(again), ['libz.so.1']);
  assert.deepEqual(await makeCompatible(again), []);
});

test('systemLibraryDirs lists the multiarch folders for the CPU', () => {
  assert.ok(systemLibraryDirs('x64').includes('/usr/lib/x86_64-linux-gnu'));
  assert.ok(systemLibraryDirs('arm64').includes('/usr/lib/aarch64-linux-gnu'));
  assert.ok(systemLibraryDirs('x64').includes('/usr/lib64'));
});

test('only libraries the system also has are scanned', async () => {
  const { bundle, system } = await makeBundle({ lib: { 'libLLVM-16.so': elf('2.36'), 'libz.so.1': elf('2.36') } });
  await fs.writeFile(path.join(system, 'libz.so.1'), 'system copy');
  const opened = [];
  const spyFs = { ...fs, open: (file, ...rest) => { opened.push(path.basename(file)); return fs.open(file, ...rest); } };

  await makeCompatible({ dir: bundle, systemGlibc: '2.35', systemLibDirs: [system], fs: spyFs, logger: createSilentLogger() });

  assert.deepEqual(opened, ['libz.so.1']);
});

test('detectSystemGlibc reads the runtime version and never throws', () => {
  const report = (header) => ({ platform: 'linux', report: { getReport: () => ({ header }) } });
  assert.equal(detectSystemGlibc(report({ glibcVersionRuntime: '2.35' })), '2.35');
  assert.equal(detectSystemGlibc(report({})), null, 'musl systems report no glibc');
  assert.equal(detectSystemGlibc({ platform: 'darwin' }), null);
  assert.equal(detectSystemGlibc({ platform: 'linux', report: { getReport: () => { throw new Error('boom'); } } }), null);
});
