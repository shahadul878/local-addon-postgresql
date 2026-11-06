'use strict';

/**
 * Wiring tests: main/renderer entry points against fake Electron + Local hook objects,
 * and the IPC round trip from the renderer API to the main-process service.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { registerIpcHandlers } = require('../lib/ipc');
const { createApi, cleanErrorMessage, describeProgress, progressFraction } = require('../lib/ui/api');
const { IPC } = require('../lib/constants');
const PostgresAddonMain = require('../lib/main');
const PostgresAddonRenderer = require('../lib/renderer');
const { makeTempDir, createSilentLogger } = require('./helpers');

/** In-process stand-in for ipcMain + ipcRenderer, mimicking Electron's error wrapping. */
function createFakeIpc() {
  const handlers = new Map();
  const rendererEvents = new EventEmitter();
  const sender = { isDestroyed: () => false, send: (channel, payload) => rendererEvents.emit(channel, {}, payload) };

  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
  };
  const ipcRenderer = {
    invoke: async (channel, payload) => {
      try {
        return await handlers.get(channel)({ sender }, payload);
      } catch (error) {
        throw new Error(`Error invoking remote method '${channel}': Error: ${error.message}`);
      }
    },
    on: (channel, fn) => rendererEvents.on(channel, fn),
    removeListener: (channel, fn) => rendererEvents.removeListener(channel, fn),
  };
  return { ipcMain, ipcRenderer, handlers, rendererEvents };
}

test('every IPC channel the renderer calls has a main-process handler', () => {
  const { ipcMain, handlers } = createFakeIpc();
  registerIpcHandlers(ipcMain, {}, createSilentLogger());
  const expected = Object.entries(IPC).filter(([key]) => key !== 'PROGRESS').map(([, channel]) => channel);
  assert.deepEqual([...handlers.keys()].sort(), expected.sort());
});

test('renderer API round-trips through IPC, streams progress, and shows clean errors', async () => {
  const { ipcMain, ipcRenderer } = createFakeIpc();
  const service = {
    getState: async (siteId) => ({ siteId }),
    installVersion: async (version, onProgress) => onProgress({ phase: 'extract' }),
    startSite: async () => { throw new Error('Port 5432 is already in use.'); },
  };
  const logger = createSilentLogger();
  registerIpcHandlers(ipcMain, service, logger);
  const api = createApi(ipcRenderer);

  assert.deepEqual(await api.getState('abc'), { siteId: 'abc' });

  const progress = [];
  const unsubscribe = api.onProgress((p) => progress.push(p));
  assert.equal(await api.installVersion('16.15.1'), null);
  unsubscribe();
  assert.deepEqual(progress, [{ version: '16.15.1', phase: 'extract' }]);

  await assert.rejects(api.start('abc'), (error) => error.message === 'Port 5432 is already in use.');
  assert.equal(logger.entries.at(-1).level, 'error');
});

test('IPC handlers reject a missing payload', async () => {
  const { ipcRenderer, ipcMain } = createFakeIpc();
  registerIpcHandlers(ipcMain, { getState: async () => ({}) }, createSilentLogger());
  await assert.rejects(ipcRenderer.invoke(IPC.GET_STATE, undefined), /Invalid request/);
});

test('progress helpers describe each phase', () => {
  assert.equal(
    describeProgress({ phase: 'download', version: '17.11.1', received: 5 * 1048576, total: 10 * 1048576 }),
    'Downloading PostgreSQL 17.11.1… 50% (5.0 / 10.0 MB)',
  );
  assert.match(describeProgress({ phase: 'download', version: '1', received: 1048576, total: 0 }), /1.0 MB$/);
  assert.match(describeProgress({ phase: 'extract', version: '17.11.1' }), /Unpacking/);
  assert.match(describeProgress({ phase: 'initdb' }), /cluster/);
  assert.match(describeProgress({ phase: 'start' }), /Starting/);
  assert.equal(describeProgress({ phase: 'done' }), 'Done.');
  assert.equal(describeProgress(null), '');
  assert.equal(describeProgress({ phase: 'mystery' }), '');
  assert.equal(progressFraction({ phase: 'download', received: 3, total: 4 }), 0.75);
  assert.equal(progressFraction({ phase: 'extract' }), null);
  assert.equal(cleanErrorMessage(new Error("Error invoking remote method 'x': Error: nope")), 'nope');
  assert.equal(cleanErrorMessage(undefined), 'Unexpected error.');
});

test('main entry registers IPC, lifecycle hooks and a quit handler', async () => {
  const userDataPath = await makeTempDir();
  const { ipcMain, handlers } = createFakeIpc();
  const actions = new Map();
  const app = new EventEmitter();
  app.quit = () => app.emit('quit-called');

  // eslint-disable-next-line no-new
  new PostgresAddonMain({
    electron: { ipcMain, app },
    hooks: { addAction: (name, fn) => actions.set(name, fn) },
    environment: { userDataPath, version: '10.2.0' },
  });

  assert.ok(handlers.has(IPC.GET_STATE));
  assert.deepEqual([...actions.keys()].sort(), ['siteDeleted', 'siteStarted', 'siteStopped']);
  await actions.get('siteStarted')({ id: 'unknown' });

  let prevented = false;
  const quitCalled = new Promise((resolve) => app.once('quit-called', resolve));
  app.emit('before-quit', { preventDefault: () => { prevented = true; } });
  await quitCalled;
  assert.equal(prevented, true);

  let preventedAgain = false;
  app.emit('before-quit', { preventDefault: () => { preventedAgain = true; } });
  assert.equal(preventedAgain, false);
});

test('renderer entry adds a PostgreSQL tab to the site Tools section', () => {
  const filters = new Map();
  const created = [];
  const React = { createElement: (type, props) => { created.push({ type, props }); return { type, props }; } };
  global.window = { confirm: () => true };

  // eslint-disable-next-line no-new
  new PostgresAddonRenderer({
    React,
    hooks: { addFilter: (name, fn) => filters.set(name, fn) },
    electron: { ipcRenderer: createFakeIpc().ipcRenderer, clipboard: { writeText: () => {} } },
  });

  const filter = filters.get('siteInfoToolsItem');
  const base = [{ path: '/mailpit', menuItem: 'Mailpit' }];
  assert.equal(filter(base, {}), base);

  const items = filter(base, { routeChildrenProps: { site: { id: 'abc', name: 'Shop' } } });
  assert.equal(items.length, 2);
  assert.equal(base.length, 1);
  assert.deepEqual({ path: items[1].path, menuItem: items[1].menuItem }, { path: '/postgresql', menuItem: 'PostgreSQL' });
  const element = items[1].render();
  assert.equal(element.props.site.id, 'abc');
  delete global.window;
});
