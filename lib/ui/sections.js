'use strict';

const { styles } = require('./styles');
const { describeProgress, progressFraction } = require('./api');
const { MIN_PORT, MAX_PORT } = require('../constants');

/** Returns the port as a number when the text is a whole number in range, otherwise null. */
function parsePort(text) {
  const trimmed = String(text).trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const port = Number(trimmed);
  return port >= MIN_PORT && port <= MAX_PORT ? port : null;
}

/** Panel sections. Each receives plain props plus an `actions` object; none talks to IPC directly. */
function createSections(React, ui) {
  const { h, Button, Card, StatusPill, CopyButton, ProgressBar } = ui;

  function ProgressNote({ progress }) {
    if (!progress) {
      return null;
    }
    return h('div', null, h('p', { style: styles.hint }, describeProgress(progress)), h(ProgressBar, { fraction: progressFraction(progress) }));
  }

  function EnableSection({ state, busy, progress, actions }) {
    const [version, setVersion] = React.useState(state.defaultVersion);
    const option = (v) => h('option', { key: v.version, value: v.version }, `PostgreSQL ${v.version}${v.isInstalled ? ' (installed)' : ''}`);
    const selected = state.versions.find((v) => v.version === version);

    return h(Card, { title: 'Set up PostgreSQL' },
      h('p', { style: { marginTop: 0 } }, 'Give this site its own PostgreSQL server. It starts and stops with the site and only listens on 127.0.0.1.'),
      h('div', { style: styles.row },
        h('select', { style: styles.select, value: version, disabled: Boolean(busy), onChange: (e) => setVersion(e.target.value) }, state.versions.map(option)),
        h(Button, { variant: 'primary', disabled: Boolean(busy), onClick: () => actions.enable(version) },
          selected && selected.isInstalled ? 'Enable PostgreSQL' : 'Download & enable')),
      h(ProgressNote, { progress }));
  }

  function PortForm({ site, busy, actions }) {
    const [portText, setPortText] = React.useState('');
    const port = parsePort(portText);
    const canSubmit = !busy && port !== null && port !== site.port;
    const submit = (event) => {
      event.preventDefault();
      if (!canSubmit) {
        return Promise.resolve(false);
      }
      return actions.setPort(port).then((isOk) => {
        if (isOk) {
          setPortText('');
        }
        return isOk;
      });
    };

    return h('form', { style: { ...styles.row, marginTop: 14 }, onSubmit: submit },
      h('span', { style: styles.kvLabel }, `Port ${site.port}`),
      h('input', {
        style: { ...styles.input, maxWidth: 120 },
        value: portText,
        inputMode: 'numeric',
        placeholder: String(site.port),
        'aria-label': 'New port',
        disabled: Boolean(busy),
        onChange: (e) => setPortText(e.target.value),
      }),
      h(Button, { disabled: !canSubmit, onClick: submit }, 'Change port'),
      h('span', { style: styles.kvLabel }, `${MIN_PORT}–${MAX_PORT}`));
  }

  function ServerSection({ site, busy, actions }) {
    const isRunning = site.status === 'running';
    return h(Card, { title: 'Server' },
      h('div', { style: styles.spread },
        h('div', { style: styles.row }, h(StatusPill, { status: site.status }), h('span', { style: styles.kvLabel }, `PostgreSQL ${site.version}`)),
        h('div', { style: styles.row },
          isRunning
            ? h(Button, { disabled: Boolean(busy), onClick: actions.stop }, 'Stop')
            : h(Button, { variant: 'primary', disabled: Boolean(busy), onClick: actions.start }, 'Start'),
          h(Button, { disabled: Boolean(busy) || !isRunning, onClick: actions.restart }, 'Restart'))),
      h('label', { style: { ...styles.row, marginTop: 14, fontSize: 13 } },
        h('input', { type: 'checkbox', checked: site.autoStart, disabled: Boolean(busy), onChange: (e) => actions.setAutoStart(e.target.checked) }),
        'Start and stop together with this Local site'),
      h(PortForm, { site, busy, actions }));
  }

  function ConnectionSection({ site }) {
    const [isPasswordVisible, setIsPasswordVisible] = React.useState(false);
    const envSnippet = `DATABASE_URL=${site.connectionUrl}`;
    const rows = [
      ['Host', site.host],
      ['Port', site.port],
      ['User', site.user],
      ['Password', site.password, true],
      ['Database', site.database],
      ['URL', site.connectionUrl, true],
    ];
    const renderRow = ([label, value, isSecret]) => [
      h('span', { key: `${label}-l`, style: styles.kvLabel }, label),
      h('code', { key: `${label}-v`, style: styles.code }, isSecret && !isPasswordVisible ? '••••••••••••' : String(value)),
      h(CopyButton, { key: `${label}-c`, value }),
    ];

    return h(Card, { title: 'Connection' },
      h('div', { style: styles.kvGrid }, rows.map(renderRow)),
      h('div', { style: { ...styles.row, marginTop: 14 } },
        h(Button, { onClick: () => setIsPasswordVisible(!isPasswordVisible) }, isPasswordVisible ? 'Hide password' : 'Show password'),
        h(CopyButton, { value: envSnippet }),
        h('span', { style: styles.kvLabel }, 'copies a DATABASE_URL line for your .env')),
      h('p', { style: styles.hint }, 'From a terminal: ', h('code', { style: styles.code }, `psql -h ${site.host} -p ${site.port} -U ${site.user} ${site.database}`)));
  }

  function DatabasesSection({ site, databases, busy, actions }) {
    const [name, setName] = React.useState('');
    if (site.status !== 'running') {
      return h(Card, { title: 'Databases' }, h('p', { style: styles.hint }, 'Start the server to see and manage databases.'));
    }
    const submit = (event) => {
      event.preventDefault();
      actions.createDatabase(name.trim()).then((isOk) => isOk && setName(''));
    };
    const item = (db) => h('li', { key: db, style: styles.listItem },
      h('code', { style: styles.code }, db),
      db === 'postgres' ? h('span', { style: styles.kvLabel }, 'system') : h(Button, { variant: 'danger', disabled: Boolean(busy), onClick: () => actions.dropDatabase(db) }, 'Drop'));

    return h(Card, { title: `Databases (${databases.length})` },
      h('ul', { style: styles.list }, databases.map(item)),
      h('form', { style: styles.row, onSubmit: submit },
        h('input', { style: styles.input, value: name, placeholder: 'new_database_name', 'aria-label': 'New database name', onChange: (e) => setName(e.target.value.toLowerCase()) }),
        h(Button, { variant: 'primary', disabled: Boolean(busy) || !name.trim(), onClick: submit }, 'Create database')));
  }

  function LogSection({ log, actions }) {
    return h(Card, { title: 'Server log' },
      h('div', { style: styles.row },
        h(Button, { onClick: actions.loadLog }, log === null ? 'Show log' : 'Refresh log'),
        log === null ? null : h(Button, { onClick: actions.hideLog }, 'Hide')),
      log === null ? null : h('pre', { style: styles.pre }, log || 'The log is empty.'));
  }

  function VersionsSection({ state, busy, progress, actions }) {
    const item = (v) => h('li', { key: v.version, style: styles.listItem },
      h('span', null, `PostgreSQL ${v.version}`, v.siteCount ? h('span', { style: styles.kvLabel }, `  · used by ${v.siteCount} site(s)`) : null),
      v.isInstalled
        ? h(Button, { variant: 'danger', disabled: Boolean(busy) || v.siteCount > 0, onClick: () => actions.removeVersion(v.version), title: v.siteCount ? 'In use by a site' : 'Delete these binaries' }, 'Remove')
        : h(Button, { disabled: Boolean(busy), onClick: () => actions.installVersion(v.version) }, 'Download'));

    return h(Card, { title: 'Installed versions' },
      h('ul', { style: styles.list }, state.versions.map(item)),
      h(ProgressNote, { progress: progress && progress.siteId ? null : progress }),
      h('p', { style: styles.hint }, 'Binaries are shared by all sites. Each download is checked against its published SHA-256 checksum to catch corruption.'));
  }

  function DangerSection({ busy, actions }) {
    return h(Card, { title: 'Remove' },
      h('div', { style: styles.spread },
        h('span', { style: { fontSize: 13 } }, 'Stop the server and permanently delete all of this site’s PostgreSQL data.'),
        h(Button, { variant: 'danger', disabled: Boolean(busy), onClick: actions.disable }, 'Remove PostgreSQL')));
  }

  return { EnableSection, ServerSection, ConnectionSection, DatabasesSection, LogSection, VersionsSection, DangerSection };
}

module.exports = { createSections, parsePort };
