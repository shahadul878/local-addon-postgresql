'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPostgresService, buildConnectionUrl } = require('../lib/postgresService');
const { EMPTY_CONFIG } = require('../lib/configStore');
const { STATUS } = require('../lib/constants');
const { createSilentLogger, sampleSiteConfig } = require('./helpers');

function createMemoryStore(initial = EMPTY_CONFIG) {
  let config = initial;
  return {
    read: async () => config,
    getSite: async (id) => config.sites[id] || null,
    update: async (transform) => {
      config = transform(config);
      return config;
    },
    snapshot: () => config,
  };
}

function createFakes({ installed = [], failInit = false, portFree = true } = {}) {
  const log = [];
  const running = new Set();
  const initialized = new Set();
  const installedSet = new Set(installed);
  const databases = new Set(['postgres']);

  const binaries = {
    isPlatformSupported: true,
    listInstalled: async () => [...installedSet],
    isInstalled: async (v) => installedSet.has(v),
    install: async (v, onProgress = () => {}) => {
      log.push(`install:${v}`);
      onProgress({ phase: 'download', received: 1, total: 1 });
      installedSet.add(v);
    },
    remove: async (v) => { log.push(`remove:${v}`); installedSet.delete(v); },
  };

  const instances = {
    initCluster: async (id) => {
      if (failInit) throw new Error('initdb exploded');
      initialized.add(id);
      log.push(`init:${id}`);
    },
    status: async (id) => {
      if (!initialized.has(id)) return STATUS.NOT_INITIALIZED;
      return running.has(id) ? STATUS.RUNNING : STATUS.STOPPED;
    },
    start: async (id) => { running.add(id); log.push(`start:${id}`); },
    stop: async (id) => { running.delete(id); log.push(`stop:${id}`); },
    listDatabases: async () => [...databases].sort(),
    createDatabase: async (_cfg, name) => { databases.add(name); log.push(`createdb:${name}`); },
    dropDatabase: async (_cfg, name) => { databases.delete(name); log.push(`dropdb:${name}`); },
    readLog: async () => 'log text',
    destroy: async (id) => { initialized.delete(id); log.push(`destroy:${id}`); },
  };

  return { log, running, initialized, databases, binaries, instances, portFree };
}

function setup(options = {}) {
  const fakes = createFakes(options);
  const store = createMemoryStore(options.config);
  const logger = createSilentLogger();
  const service = createPostgresService({
    store,
    binaries: fakes.binaries,
    instances: fakes.instances,
    findFreePort: async (reserved) => (reserved.has(5432) ? 5433 : 5432),
    isPortFree: async (port) => (typeof fakes.portFree === 'function' ? fakes.portFree(port) : fakes.portFree),
    generatePassword: () => 'generated-pw',
    logger,
    now: () => new Date('2026-11-06T10:00:00Z'),
  });
  return { service, store, fakes, logger };
}

const noop = () => {};

test('buildConnectionUrl encodes credentials', () => {
  const url = buildConnectionUrl({ ...sampleSiteConfig, password: 'p@ss/word' });
  assert.equal(url, 'postgresql://postgres:p%40ss%2Fword@127.0.0.1:5432/local');
});

test('getState lists versions and reports no site before enabling', async () => {
  const { service } = setup({ installed: ['16.15.1'] });
  const state = await service.getState('site1');
  assert.equal(state.site, null);
  assert.equal(state.isPlatformSupported, true);
  assert.equal(state.versions.find((v) => v.version === '16.15.1').isInstalled, true);
  assert.equal(state.versions.find((v) => v.version === '17.11.1').isInstalled, false);
});

test('enableSite installs binaries, creates the cluster, starts it and creates the default database', async () => {
  const { service, store, fakes } = setup();
  const phases = [];
  await service.enableSite('site1', '17.11.1', (p) => phases.push(p.phase));

  assert.deepEqual(fakes.log, ['install:17.11.1', 'destroy:site1', 'init:site1', 'start:site1', 'createdb:local']);
  assert.deepEqual(phases, ['download', 'initdb', 'start', 'done']);
  assert.deepEqual(store.snapshot().sites.site1, {
    version: '17.11.1', port: 5432, user: 'postgres', password: 'generated-pw', database: 'local', autoStart: true,
    createdAt: '2026-11-06T10:00:00.000Z',
  });

  const state = await service.getState('site1');
  assert.equal(state.site.status, STATUS.RUNNING);
  assert.equal(state.site.connectionUrl, 'postgresql://postgres:generated-pw@127.0.0.1:5432/local');
  assert.equal(state.versions.find((v) => v.version === '17.11.1').siteCount, 1);
});

test('enableSite gives each site its own port', async () => {
  const { service, store } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  await service.enableSite('site2', '17.11.1', noop);
  assert.equal(store.snapshot().sites.site2.port, 5433);
});

test('enableSite refuses to run twice and cleans up when initdb fails', async () => {
  const { service } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  await assert.rejects(service.enableSite('site1', '17.11.1', noop), /already enabled/);

  const failing = setup({ failInit: true });
  await assert.rejects(failing.service.enableSite('site1', '17.11.1', noop), /Could not create the PostgreSQL cluster: initdb exploded/);
  assert.ok(failing.fakes.log.includes('destroy:site1'));
  assert.equal(failing.store.snapshot().sites.site1, undefined);
});

test('startSite checks that the port is free and the binaries still exist', async () => {
  const config = { sites: { site1: sampleSiteConfig } };
  const busy = setup({ config, installed: ['17.11.1'], portFree: false });
  busy.fakes.initialized.add('site1');
  await assert.rejects(busy.service.startSite('site1'), /Port 5432 is already in use/);

  const missing = setup({ config, installed: [] });
  missing.fakes.initialized.add('site1');
  await assert.rejects(missing.service.startSite('site1'), /no longer installed/);
});

test('stop, restart and auto-start settings', async () => {
  const { service, store, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);

  await service.restartSite('site1');
  assert.deepEqual(fakes.log.slice(-2), ['stop:site1', 'start:site1']);

  await service.stopSite('site1');
  assert.equal(fakes.running.has('site1'), false);

  await service.setAutoStart('site1', false);
  assert.equal(store.snapshot().sites.site1.autoStart, false);
  await assert.rejects(service.setAutoStart('site1', 'nope'), /must be true or false/);
});

test('database operations require a running server and validate names', async () => {
  const { service, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);

  assert.deepEqual(await service.listDatabases('site1'), ['local', 'postgres']);

  await service.createDatabase('site1', 'shop');
  await service.dropDatabase('site1', 'shop');
  assert.ok(fakes.log.includes('createdb:shop') && fakes.log.includes('dropdb:shop'));

  await assert.rejects(service.createDatabase('site1', 'bad name'), /Database names/);
  await assert.rejects(service.dropDatabase('site1', 'postgres'), /cannot be dropped/);

  await service.stopSite('site1');
  await assert.rejects(service.listDatabases('site1'), /Start PostgreSQL/);
});

test('operations on sites without PostgreSQL fail clearly', async () => {
  const { service } = setup();
  await assert.rejects(service.startSite('nosite'), /not enabled/);
  await assert.rejects(service.readLog('nosite'), /not enabled/);
  await assert.rejects(service.getState('../bad'), /Invalid site id/);
});

test('removeVersion refuses while a site uses it', async () => {
  const { service, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  await assert.rejects(service.removeVersion('17.11.1'), /still used by 1 site/);

  await service.disableSite('site1');
  await service.removeVersion('17.11.1');
  assert.ok(fakes.log.includes('remove:17.11.1'));
});

test('disableSite stops the server, deletes data and forgets the site', async () => {
  const { service, store, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  await service.disableSite('site1');
  assert.deepEqual(fakes.log.slice(-2), ['stop:site1', 'destroy:site1']);
  assert.equal(store.snapshot().sites.site1, undefined);
});

test('disableSite keeps data and config when the server cannot be stopped', async () => {
  const { service, store, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  fakes.instances.stop = async () => { throw new Error('stuck'); };

  await assert.rejects(service.disableSite('site1'), /data was left in place: stuck/);
  assert.equal(fakes.initialized.has('site1'), true);
  assert.ok(store.snapshot().sites.site1);
});

test('enabling two sites at the same time gives them different ports', async () => {
  const { service, store } = setup();
  await Promise.all([
    service.enableSite('site1', '17.11.1', noop),
    service.enableSite('site2', '17.11.1', noop),
  ]);
  const { site1, site2 } = store.snapshot().sites;
  assert.notEqual(site1.port, site2.port);
});

test('a double-click on enable creates one cluster and rejects the second request', async () => {
  const { service, fakes } = setup();
  const results = await Promise.allSettled([
    service.enableSite('site1', '17.11.1', noop),
    service.enableSite('site1', '17.11.1', noop),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(fakes.log.filter((entry) => entry === 'init:site1').length, 1);
});

test('starting re-creates the default database if it went missing', async () => {
  const { service, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  await service.stopSite('site1');
  fakes.databases.delete('local');

  await service.startSite('site1');
  assert.ok(fakes.databases.has('local'));
});

test('getState reports an unknown status instead of failing when status checks break', async () => {
  const { service, fakes, logger } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  fakes.instances.status = async () => { throw new Error('weird'); };

  const state = await service.getState('site1');
  assert.equal(state.site.status, STATUS.UNKNOWN);
  assert.equal(logger.entries.at(-1).level, 'warn');
});

test('site lifecycle hooks follow the auto-start setting and never throw', async () => {
  const { service, fakes, logger } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  await service.stopSite('site1');

  await service.handleSiteStarted('site1');
  assert.equal(fakes.running.has('site1'), true);
  await service.handleSiteStopped('site1');
  assert.equal(fakes.running.has('site1'), false);

  await service.setAutoStart('site1', false);
  await service.handleSiteStarted('site1');
  assert.equal(fakes.running.has('site1'), false);

  await service.handleSiteStarted('unknown');
  await service.handleSiteStarted(undefined);

  fakes.instances.start = async () => { throw new Error('boom'); };
  await service.setAutoStart('site1', true);
  await service.handleSiteStarted('site1');
  assert.equal(logger.entries.at(-1).level, 'error');
});

test('handleSiteDeleted removes the site; stopAll stops everything and logs failures', async () => {
  const { service, store, fakes, logger } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  await service.enableSite('site2', '17.11.1', noop);

  await service.handleSiteDeleted('site1');
  assert.equal(store.snapshot().sites.site1, undefined);

  fakes.instances.stop = async () => { throw new Error('cannot stop'); };
  await service.stopAll();
  assert.match(logger.entries.at(-1).message, /Failed to stop/);
});

test('readLog returns the server log for an enabled site', async () => {
  const { service } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  assert.equal(await service.readLog('site1'), 'log text');
});

test('setPort moves a running server to the new port and restarts it', async () => {
  const { service, store, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);

  await service.setPort('site1', 5440);

  assert.equal(store.snapshot().sites.site1.port, 5440);
  assert.deepEqual(fakes.log.slice(-2), ['stop:site1', 'start:site1']);
  assert.equal(fakes.running.has('site1'), true);
});

test('setPort on a stopped server saves the port without starting it', async () => {
  const { service, store, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  await service.stopSite('site1');

  await service.setPort('site1', 5440);

  assert.equal(store.snapshot().sites.site1.port, 5440);
  assert.equal(fakes.running.has('site1'), false);
});

test('setPort to the current port changes nothing', async () => {
  const { service, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  const before = fakes.log.length;

  await service.setPort('site1', 5432);

  assert.equal(fakes.log.length, before);
});

test('setPort refuses a port another Local site already has', async () => {
  const { service, store, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  await service.enableSite('site2', '17.11.1', noop);
  await service.stopSite('site2');

  await assert.rejects(service.setPort('site1', 5433), /Port 5433 is already assigned to another Local site/);
  assert.equal(store.snapshot().sites.site1.port, 5432);
  assert.equal(fakes.running.has('site1'), true);
});

test('setPort refuses a port another program is using and leaves the server running', async () => {
  const { service, store, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  fakes.portFree = (port) => port !== 5440;

  await assert.rejects(service.setPort('site1', 5440), /Port 5440 is already in use by another program/);
  assert.equal(store.snapshot().sites.site1.port, 5432);
  assert.equal(fakes.running.has('site1'), true);
});

test('setPort validates the port and the site', async () => {
  const { service } = setup();
  await service.enableSite('site1', '17.11.1', noop);

  await assert.rejects(service.setPort('site1', 80), /whole number between 1024 and 65535/);
  await assert.rejects(service.setPort('site1', '5440'), /whole number/);
  await assert.rejects(service.setPort('other', 5440), /not enabled/);
});

test('setPort puts a running server back on its old port when the new one fails to start', async () => {
  const { service, store, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  const realStart = fakes.instances.start;
  fakes.instances.start = async (id, cfg) => {
    if (cfg.port === 5440) throw new Error('pg_ctl failed');
    return realStart(id, cfg);
  };

  await assert.rejects(service.setPort('site1', 5440), /Could not move PostgreSQL to port 5440: pg_ctl failed\. It is back on port 5432\./);
  assert.equal(store.snapshot().sites.site1.port, 5432);
  assert.equal(fakes.running.has('site1'), true);
});

test('setPort says so when the server cannot be restored either', async () => {
  const { service, store, fakes } = setup();
  await service.enableSite('site1', '17.11.1', noop);
  fakes.instances.start = async () => { throw new Error('pg_ctl failed'); };

  await assert.rejects(service.setPort('site1', 5440), /Could not move PostgreSQL to port 5440: pg_ctl failed\. Port 5432 was restored, but the server could not be restarted/);
  assert.equal(store.snapshot().sites.site1.port, 5432);
});
