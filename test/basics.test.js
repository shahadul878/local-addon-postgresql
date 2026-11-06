'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { getTargetTriple, getBinaryName, getDownloadUrl } = require('../lib/platform');
const validation = require('../lib/validation');
const { createPaths } = require('../lib/paths');
const { parseChecksumFile } = require('../lib/download');
const { findFreePort, isPortFree } = require('../lib/ports');
const { SUPPORTED_VERSIONS, DEFAULT_VERSION } = require('../lib/constants');

test('maps supported OS/CPU pairs to upstream build targets', () => {
  assert.equal(getTargetTriple('linux', 'x64'), 'x86_64-unknown-linux-gnu');
  assert.equal(getTargetTriple('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(getTargetTriple('win32', 'x64'), 'x86_64-pc-windows-msvc');
});

test('returns null for platforms without published builds', () => {
  assert.equal(getTargetTriple('freebsd', 'x64'), null);
  assert.equal(getTargetTriple('linux', 'ia32'), null);
});

test('adds .exe to binaries only on Windows', () => {
  assert.equal(getBinaryName('psql', 'win32'), 'psql.exe');
  assert.equal(getBinaryName('psql', 'linux'), 'psql');
});

test('builds the release download URL', () => {
  assert.equal(
    getDownloadUrl('17.11.1', 'x86_64-unknown-linux-gnu'),
    'https://github.com/theseus-rs/postgresql-binaries/releases/download/17.11.1/postgresql-17.11.1-x86_64-unknown-linux-gnu.tar.gz',
  );
});

test('default version is one of the supported versions', () => {
  assert.ok(SUPPORTED_VERSIONS.includes(DEFAULT_VERSION));
});

test('lays out per-version and per-site paths under the user data folder', () => {
  const paths = createPaths('/data', 'linux');
  assert.equal(paths.root, path.join('/data', 'postgresql'));
  assert.equal(paths.binary('16.15.1', 'pg_ctl'), path.join('/data', 'postgresql', 'versions', '16.15.1', 'bin', 'pg_ctl'));
  assert.equal(paths.dataDir('abc'), path.join('/data', 'postgresql', 'sites', 'abc', 'data'));
  assert.equal(paths.logFile('abc'), path.join('/data', 'postgresql', 'sites', 'abc', 'postgres.log'));
});

test('validation accepts good input', () => {
  assert.equal(validation.assertVersion('16.15.1'), '16.15.1');
  assert.equal(validation.assertSiteId('LPZpiH6Zv'), 'LPZpiH6Zv');
  assert.equal(validation.assertDatabaseName('shop_2026'), 'shop_2026');
  assert.equal(validation.assertPort(5433), 5433);
  assert.equal(validation.assertBoolean(false, 'x'), false);
});

test('validation rejects unsafe or malformed input', () => {
  assert.throws(() => validation.assertVersion('9.6.0'), /Unsupported PostgreSQL version/);
  assert.throws(() => validation.assertSiteId('../etc'), /Invalid site id/);
  assert.throws(() => validation.assertSiteId(42), /Invalid site id/);
  assert.throws(() => validation.assertDatabaseName('drop table; --'), /Database names/);
  assert.throws(() => validation.assertDatabaseName('Upper'), /Database names/);
  assert.throws(() => validation.assertDatabaseName('a'.repeat(64)), /Database names/);
  assert.throws(() => validation.assertDroppableDatabase('postgres'), /cannot be dropped/);
  assert.throws(() => validation.assertDroppableDatabase('template1'), /cannot be dropped/);
  assert.throws(() => validation.assertPort(80), /Port must be/);
  assert.throws(() => validation.assertPort(5432.5), /Port must be/);
  assert.throws(() => validation.assertBoolean('yes', 'Auto-start'), /Auto-start must be true or false/);
});

test('parses upstream checksum files', () => {
  const hex = 'aa8e2e97574bd789119ac01f1dddcd7a038c84e5c308d7b753018618258f0fbd';
  assert.equal(parseChecksumFile(`${hex.toUpperCase()}  postgresql.tar.gz\n`), hex);
  assert.throws(() => parseChecksumFile('<html>not found</html>'), /unexpected format/);
});

test('findFreePort skips reserved and busy ports', async () => {
  const busy = new Set([5433]);
  const port = await findFreePort(new Set([5432]), { check: async (p) => !busy.has(p) });
  assert.equal(port, 5434);
});

test('findFreePort gives up after the scan limit', async () => {
  await assert.rejects(findFreePort(new Set(), { check: async () => false }), /No free port found/);
});

test('isPortFree detects a port that is already listening', async () => {
  const net = require('net');
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    assert.equal(await isPortFree(port), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await isPortFree(port), true);
});
