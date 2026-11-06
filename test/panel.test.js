'use strict';

/** Renders the real panel with React 16.14 (the version Local ships) against a fake API. */
const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const TestRenderer = require('react-test-renderer');

const { createPostgresPanel } = require('../lib/ui/PostgresPanel');
const { STATUS } = require('../lib/constants');

const { act } = TestRenderer;
const SITE = { id: 'site1', name: 'Shop' };

const versions = [
  { version: '17.11.1', isInstalled: true, siteCount: 1 },
  { version: '16.15.1', isInstalled: false, siteCount: 0 },
];
const enabledSite = {
  version: '17.11.1', port: 5432, user: 'postgres', password: 'pw', database: 'local', autoStart: true,
  host: '127.0.0.1', status: STATUS.RUNNING, connectionUrl: 'postgresql://postgres:pw@127.0.0.1:5432/local',
};

function createFakeApi(initialSite) {
  let site = initialSite;
  const calls = [];
  let progressListener = null;
  const record = (name, effect = () => {}) => async (...args) => {
    calls.push([name, ...args]);
    return effect(...args);
  };
  const api = {
    getState: async () => ({ isPlatformSupported: true, defaultVersion: '17.11.1', versions, site }),
    listDatabases: async () => ['local', 'postgres'],
    enableSite: record('enableSite', () => {
      progressListener({ phase: 'download', version: '17.11.1', received: 1, total: 2 });
      site = enabledSite;
    }),
    start: record('start'),
    stop: record('stop', () => { throw new Error('Could not stop.'); }),
    restart: record('restart'),
    setAutoStart: record('setAutoStart'),
    setPort: record('setPort'),
    createDatabase: record('createDatabase'),
    dropDatabase: record('dropDatabase'),
    readLog: record('readLog', () => 'server log line'),
    installVersion: record('installVersion'),
    removeVersion: record('removeVersion'),
    disableSite: record('disableSite', () => { site = null; }),
    onProgress: (callback) => {
      progressListener = callback;
      return () => { progressListener = null; };
    },
  };
  return { api, calls };
}

async function renderPanel(initialSite, { confirmResult = true } = {}) {
  const { api, calls } = createFakeApi(initialSite);
  const copied = [];
  const Panel = createPostgresPanel(React, {
    api,
    clipboard: { writeText: (text) => copied.push(text) },
    confirm: () => confirmResult,
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Panel, { site: SITE }));
  });
  return { renderer, calls, copied };
}

const text = (node) => (typeof node === 'string' ? node : (node.children || []).map(text).join(''));
const findButton = (renderer, label) => renderer.root.findAll((n) => n.type === 'button' && text(n) === label)[0];
const click = async (button) => act(async () => { await button.props.onClick({ preventDefault() {} }); });

test('shows the setup card and enables PostgreSQL for a new site', async () => {
  const { renderer, calls } = await renderPanel(null);
  assert.ok(text(renderer.root).includes('Set up PostgreSQL'));

  await click(findButton(renderer, 'Enable PostgreSQL'));

  assert.deepEqual(calls[0], ['enableSite', 'site1', '17.11.1']);
  const content = text(renderer.root);
  assert.ok(content.includes('Connection'));
  assert.ok(content.includes('Databases (2)'));
  renderer.unmount();
});

test('server controls, auto-start and errors', async () => {
  const { renderer, calls } = await renderPanel(enabledSite);

  await click(findButton(renderer, 'Restart'));
  await click(findButton(renderer, 'Stop'));
  assert.ok(text(renderer.root).includes('Could not stop.'), 'error banner shows the failure');
  await click(findButton(renderer, 'Dismiss'));
  assert.ok(!text(renderer.root).includes('Could not stop.'));

  const checkbox = renderer.root.find((n) => n.type === 'input' && n.props.type === 'checkbox');
  await act(async () => { await checkbox.props.onChange({ target: { checked: false } }); });

  assert.deepEqual(calls.map((c) => c[0]), ['restart', 'stop', 'setAutoStart']);
  assert.deepEqual(calls[2], ['setAutoStart', 'site1', false]);
  renderer.unmount();
});

test('connection details are masked until revealed and can be copied', async () => {
  const { renderer, copied } = await renderPanel(enabledSite);
  assert.ok(!text(renderer.root).includes('postgresql://postgres:pw@'));

  await click(findButton(renderer, 'Show password'));
  assert.ok(text(renderer.root).includes('postgresql://postgres:pw@127.0.0.1:5432/local'));

  await click(findButton(renderer, 'Copy'));
  assert.equal(copied[0], '127.0.0.1');
  renderer.unmount();
});

test('creates and drops databases, and reads the log', async () => {
  const { renderer, calls } = await renderPanel(enabledSite);
  const input = renderer.root.find((n) => n.type === 'input' && n.props['aria-label'] === 'New database name');
  await act(async () => { input.props.onChange({ target: { value: 'Shop_DB' } }); });
  await click(findButton(renderer, 'Create database'));
  await click(findButton(renderer, 'Drop'));
  await click(findButton(renderer, 'Show log'));

  assert.deepEqual(calls.find((c) => c[0] === 'createDatabase'), ['createDatabase', 'site1', 'shop_db']);
  assert.deepEqual(calls.find((c) => c[0] === 'dropDatabase'), ['dropDatabase', 'site1', 'local']);
  assert.ok(text(renderer.root).includes('server log line'));
  await click(findButton(renderer, 'Hide'));
  assert.ok(!text(renderer.root).includes('server log line'));
  renderer.unmount();
});

test('destructive actions respect the confirmation dialog', async () => {
  const declined = await renderPanel(enabledSite, { confirmResult: false });
  await click(findButton(declined.renderer, 'Remove PostgreSQL'));
  await click(findButton(declined.renderer, 'Drop'));
  assert.deepEqual(declined.calls, []);
  declined.renderer.unmount();

  const accepted = await renderPanel(enabledSite);
  await click(findButton(accepted.renderer, 'Download'));
  await click(findButton(accepted.renderer, 'Remove PostgreSQL'));
  assert.deepEqual(accepted.calls.map((c) => c[0]), ['installVersion', 'disableSite']);
  assert.ok(text(accepted.renderer.root).includes('Set up PostgreSQL'));
  accepted.renderer.unmount();
});

test('stopped servers hide database management', async () => {
  const { renderer } = await renderPanel({ ...enabledSite, status: STATUS.STOPPED });
  assert.ok(text(renderer.root).includes('Start the server to see and manage databases.'));
  assert.ok(findButton(renderer, 'Start'));
  renderer.unmount();
});

const findPortInput = (renderer) => renderer.root.find((n) => n.type === 'input' && n.props['aria-label'] === 'New port');
const typeInto = async (input, value) => act(async () => { input.props.onChange({ target: { value } }); });

test('changes the port after confirmation', async () => {
  const { renderer, calls } = await renderPanel(enabledSite);

  await typeInto(findPortInput(renderer), '5440');
  await click(findButton(renderer, 'Change port'));

  assert.deepEqual(calls.at(-1), ['setPort', 'site1', 5440]);
  renderer.unmount();
});

test('the Change port button is disabled for invalid or unchanged ports', async () => {
  const { renderer } = await renderPanel(enabledSite);
  const isDisabled = () => findButton(renderer, 'Change port').props.disabled;

  assert.equal(isDisabled(), true, 'empty input');
  for (const value of ['80', '70000', '54.5', 'abc', '5432']) {
    await typeInto(findPortInput(renderer), value);
    assert.equal(isDisabled(), true, `rejects ${value}`);
  }
  await typeInto(findPortInput(renderer), '5440');
  assert.equal(isDisabled(), false);
  renderer.unmount();
});

test('cancelling the port change confirmation does nothing', async () => {
  const { renderer, calls } = await renderPanel(enabledSite, { confirmResult: false });

  await typeInto(findPortInput(renderer), '5440');
  await click(findButton(renderer, 'Change port'));

  assert.equal(calls.some((c) => c[0] === 'setPort'), false);
  renderer.unmount();
});
