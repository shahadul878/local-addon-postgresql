'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

const { createInstanceManager, RUNTIME_CONF } = require('../lib/instanceManager');
const { createPaths } = require('../lib/paths');
const { STATUS, LOG_TAIL_BYTES } = require('../lib/constants');
const {
  makeTempDir, createSilentLogger, createFakeRunner, exitError, sampleSiteConfig,
} = require('./helpers');

const SITE = 'site1';

/** Simulates initdb/pg_ctl well enough to exercise the manager's logic. */
function createFakePostgres(paths) {
  const state = { running: false, pwFileContents: null };
  const runner = createFakeRunner(async (_file, args) => {
    const bin = path.basename(_file);
    if (bin === 'initdb') {
      const pwArg = args.find((a) => a.startsWith('--pwfile='));
      state.pwFileContents = await fs.readFile(pwArg.slice('--pwfile='.length), 'utf8');
      const dataDir = args[args.indexOf('-D') + 1];
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, 'PG_VERSION'), '17');
      await fs.writeFile(path.join(dataDir, 'postgresql.conf'), '# defaults\n');
      return null;
    }
    if (bin === 'pg_ctl' && args[0] === 'status') {
      if (!state.running) throw exitError(3, 'no server running');
      return null;
    }
    if (bin === 'pg_ctl' && args[0] === 'start') {
      state.running = true;
      return null;
    }
    if (bin === 'pg_ctl' && args[0] === 'stop') {
      state.running = false;
      return null;
    }
    if (bin === 'psql') {
      return { stdout: 'local\npostgres\r\nshop\n', stderr: '' };
    }
    return null;
  });
  return { state, runner, paths };
}

async function setup() {
  const dir = await makeTempDir();
  const paths = createPaths(dir, 'linux');
  const fake = createFakePostgres(paths);
  const manager = createInstanceManager({
    paths, binary: paths.binary, fs, runCommand: fake.runner.run, logger: createSilentLogger(),
  });
  return { paths, manager, fake };
}

test('status is not-initialized before initdb', async () => {
  const { manager } = await setup();
  assert.equal(await manager.status(SITE, sampleSiteConfig), STATUS.NOT_INITIALIZED);
});

test('initCluster runs initdb with scram auth, removes the password file and writes runtime config', async () => {
  const { manager, paths, fake } = await setup();
  await manager.initCluster(SITE, sampleSiteConfig);

  const initdb = fake.runner.calls.find((c) => c.bin === 'initdb');
  assert.ok(initdb.args.includes('--auth=scram-sha-256'));
  assert.deepEqual(initdb.args.slice(initdb.args.indexOf('-U'), initdb.args.indexOf('-U') + 2), ['-U', 'postgres']);
  assert.equal(fake.state.pwFileContents, sampleSiteConfig.password);
  await assert.rejects(fs.access(path.join(paths.siteDir(SITE), '.pwfile')));

  const mainConf = await fs.readFile(path.join(paths.dataDir(SITE), 'postgresql.conf'), 'utf8');
  assert.match(mainConf, /include_if_exists = 'local-addon.conf'/);
  const runtime = await fs.readFile(path.join(paths.dataDir(SITE), RUNTIME_CONF), 'utf8');
  assert.match(runtime, /port = 5432/);
  assert.match(runtime, /listen_addresses = '127.0.0.1'/);
});

test('status reports missing binaries instead of throwing', async () => {
  const dir = await makeTempDir();
  const paths = createPaths(dir, 'linux');
  await fs.mkdir(paths.dataDir(SITE), { recursive: true });
  await fs.writeFile(path.join(paths.dataDir(SITE), 'PG_VERSION'), '17');
  const runner = createFakeRunner(async () => { throw exitError('ENOENT', 'spawn pg_ctl ENOENT'); });
  const manager = createInstanceManager({ paths, binary: paths.binary, fs, runCommand: runner.run, logger: createSilentLogger() });
  assert.equal(await manager.status(SITE, sampleSiteConfig), STATUS.BINARY_MISSING);
});

test('start and stop drive pg_ctl and are idempotent', async () => {
  const { manager, fake } = await setup();
  await manager.initCluster(SITE, sampleSiteConfig);

  await manager.start(SITE, sampleSiteConfig);
  await manager.start(SITE, sampleSiteConfig);
  assert.equal(await manager.status(SITE, sampleSiteConfig), STATUS.RUNNING);
  assert.equal(fake.runner.calls.filter((c) => c.args[0] === 'start').length, 1);

  await manager.stop(SITE, sampleSiteConfig);
  await manager.stop(SITE, sampleSiteConfig);
  assert.equal(await manager.status(SITE, sampleSiteConfig), STATUS.STOPPED);
  assert.equal(fake.runner.calls.filter((c) => c.args[0] === 'stop').length, 1);
});

test('start rewrites the runtime config so port changes apply', async () => {
  const { manager, paths } = await setup();
  await manager.initCluster(SITE, sampleSiteConfig);
  await manager.start(SITE, { ...sampleSiteConfig, port: 5555 });
  const runtime = await fs.readFile(path.join(paths.dataDir(SITE), RUNTIME_CONF), 'utf8');
  assert.match(runtime, /port = 5555/);
});

test('start reports a friendly error when pg_ctl fails', async () => {
  const dir = await makeTempDir();
  const paths = createPaths(dir, 'linux');
  const fake = createFakePostgres(paths);
  const failing = createFakeRunner(async (file, args, options) => {
    if (path.basename(file) === 'pg_ctl' && args[0] === 'start') throw exitError(1, 'could not bind');
    return fake.runner.run(file, args, options);
  });
  const manager = createInstanceManager({ paths, binary: paths.binary, fs, runCommand: failing.run, logger: createSilentLogger() });
  await manager.initCluster(SITE, sampleSiteConfig);
  await assert.rejects(manager.start(SITE, sampleSiteConfig), /failed to start.*could not bind/);
});

test('status rethrows unexpected pg_ctl errors', async () => {
  const dir = await makeTempDir();
  const paths = createPaths(dir, 'linux');
  await fs.mkdir(paths.dataDir(SITE), { recursive: true });
  await fs.writeFile(path.join(paths.dataDir(SITE), 'PG_VERSION'), '17');
  const runner = createFakeRunner(async () => { throw exitError(127, 'binary missing'); });
  const manager = createInstanceManager({ paths, binary: paths.binary, fs, runCommand: runner.run, logger: createSilentLogger() });
  await assert.rejects(manager.status(SITE, sampleSiteConfig), /binary missing/);
});

test('database commands pass credentials via env and names as separate arguments', async () => {
  const { manager, fake } = await setup();
  assert.deepEqual(await manager.listDatabases(sampleSiteConfig), ['local', 'postgres', 'shop']);

  await manager.createDatabase(sampleSiteConfig, 'shop');
  await manager.dropDatabase(sampleSiteConfig, 'shop');

  const create = fake.runner.calls.find((c) => c.bin === 'createdb');
  const drop = fake.runner.calls.find((c) => c.bin === 'dropdb');
  assert.equal(create.args.at(-1), 'shop');
  assert.ok(drop.args.includes('--force'));
  assert.equal(create.options.env.PGPASSWORD, sampleSiteConfig.password);
  assert.ok(!create.args.join(' ').includes(sampleSiteConfig.password));
});

test('readLog returns the tail of the server log, or empty when missing', async () => {
  const { manager, paths } = await setup();
  assert.equal(await manager.readLog(SITE), '');

  await fs.mkdir(paths.siteDir(SITE), { recursive: true });
  const content = `${'x'.repeat(LOG_TAIL_BYTES)}LAST LINE`;
  await fs.writeFile(paths.logFile(SITE), content);
  const tail = await manager.readLog(SITE);
  assert.equal(tail.length, LOG_TAIL_BYTES);
  assert.ok(tail.endsWith('LAST LINE'));
});

test('destroy removes the site folder', async () => {
  const { manager, paths } = await setup();
  await manager.initCluster(SITE, sampleSiteConfig);
  await manager.destroy(SITE);
  await assert.rejects(fs.access(paths.siteDir(SITE)));
});
