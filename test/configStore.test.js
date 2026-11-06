'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const {
  createConfigStore, normalizeConfig, withSite, withSitePatch, withoutSite, EMPTY_CONFIG,
} = require('../lib/configStore');
const { makeTempDir, createSilentLogger, sampleSiteConfig } = require('./helpers');

test('pure updaters return new objects and never mutate the input', () => {
  const original = withSite(EMPTY_CONFIG, 'a', sampleSiteConfig);
  const frozen = JSON.parse(JSON.stringify(original));

  const patched = withSitePatch(original, 'a', { autoStart: false });
  const removed = withoutSite(original, 'a');

  assert.deepEqual(original, frozen);
  assert.equal(patched.sites.a.autoStart, false);
  assert.equal(original.sites.a.autoStart, true);
  assert.deepEqual(removed.sites, {});
});

test('withSitePatch refuses unknown sites', () => {
  assert.throws(() => withSitePatch(EMPTY_CONFIG, 'missing', {}), /not enabled/);
});

test('normalizeConfig drops malformed site entries', () => {
  const result = normalizeConfig({ sites: { good: sampleSiteConfig, bad: { port: 'x' } } });
  assert.deepEqual(Object.keys(result.sites), ['good']);
  assert.deepEqual(normalizeConfig(null), { sites: {} });
});

test('store returns an empty config when no file exists', async () => {
  const dir = await makeTempDir();
  const store = createConfigStore(path.join(dir, 'config.json'), createSilentLogger());
  assert.deepEqual(await store.read(), EMPTY_CONFIG);
  assert.equal(await store.getSite('x'), null);
});

test('store persists updates atomically and serialises concurrent writes', async () => {
  const dir = await makeTempDir();
  const file = path.join(dir, 'nested', 'config.json');
  const store = createConfigStore(file, createSilentLogger());

  await Promise.all([
    store.update((c) => withSite(c, 'a', sampleSiteConfig)),
    store.update((c) => withSite(c, 'b', { ...sampleSiteConfig, port: 5433 })),
  ]);

  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(saved.sites).sort(), ['a', 'b']);
  assert.equal((await store.getSite('b')).port, 5433);
  const leftovers = (await fs.readdir(path.dirname(file))).filter((name) => name.endsWith('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('store keeps working after a failed transform', async () => {
  const dir = await makeTempDir();
  const store = createConfigStore(path.join(dir, 'config.json'), createSilentLogger());
  await assert.rejects(store.update(() => { throw new Error('boom'); }), /boom/);
  await store.update((c) => withSite(c, 'a', sampleSiteConfig));
  assert.ok(await store.getSite('a'));
});

test('store backs up a corrupt file and starts fresh', async () => {
  const dir = await makeTempDir();
  const file = path.join(dir, 'config.json');
  await fs.writeFile(file, '{not json');
  const logger = createSilentLogger();
  const store = createConfigStore(file, logger);

  assert.deepEqual(await store.read(), EMPTY_CONFIG);
  const files = await fs.readdir(dir);
  assert.ok(files.some((name) => name.startsWith('config.json.corrupt-')));
  assert.equal(logger.entries[0].level, 'error');
});

test('store surfaces unexpected read errors', async () => {
  const dir = await makeTempDir();
  const store = createConfigStore(dir, createSilentLogger()); // a directory, not a file
  await assert.rejects(store.read(), /Could not read PostgreSQL add-on settings/);
});

test('store backs up the file before ignoring malformed site entries', async () => {
  const dir = await makeTempDir();
  const file = path.join(dir, 'config.json');
  await fs.writeFile(file, JSON.stringify({ sites: { good: sampleSiteConfig, broken: { port: 'x' } } }));
  const logger = createSilentLogger();
  const store = createConfigStore(file, logger);

  const config = await store.read();
  assert.deepEqual(Object.keys(config.sites), ['good']);
  const backups = (await fs.readdir(dir)).filter((name) => name.startsWith('config.json.invalid-'));
  assert.equal(backups.length, 1);
  assert.match(await fs.readFile(path.join(dir, backups[0]), 'utf8'), /broken/);
  assert.match(logger.entries[0].message, /broken/);
});
