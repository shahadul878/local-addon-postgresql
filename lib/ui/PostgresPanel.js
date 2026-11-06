'use strict';

const { styles } = require('./styles');
const { createComponents } = require('./components');
const { createSections } = require('./sections');

const POLL_INTERVAL_MS = 5000;

/**
 * Container component: owns state, talks to the main process via `api`,
 * and hands plain props + actions to the presentational sections.
 */
function createPostgresPanel(React, { api, clipboard, confirm }) {
  const ui = createComponents(React, clipboard);
  const sections = createSections(React, ui);
  const { h, StatusPill, ErrorBanner } = ui;

  function useProgress(busy) {
    const [progress, setProgress] = React.useState(null);
    React.useEffect(() => api.onProgress((next) => setProgress(next)), []);
    React.useEffect(() => {
      if (!busy) {
        setProgress(null);
      }
    }, [busy]);
    return progress;
  }

  function usePanelState(siteId) {
    const [state, setState] = React.useState(null);
    const [databases, setDatabases] = React.useState([]);
    const [error, setError] = React.useState(null);
    const isMounted = React.useRef(true);
    const latestRequest = React.useRef(0);

    // Polling and post-action refreshes can overlap; only the newest response is applied,
    // and nothing is applied after the panel unmounts.
    const refresh = React.useCallback(async () => {
      latestRequest.current += 1;
      const requestId = latestRequest.current;
      const isCurrent = () => isMounted.current && requestId === latestRequest.current;
      try {
        const next = await api.getState(siteId);
        const isRunning = next.site && next.site.status === 'running';
        const nextDatabases = isRunning ? await api.listDatabases(siteId) : [];
        if (isCurrent()) {
          setState(next);
          setDatabases(nextDatabases);
        }
      } catch (refreshError) {
        if (isCurrent()) {
          setError(refreshError.message);
        }
      }
    }, [siteId]);

    React.useEffect(() => {
      isMounted.current = true;
      refresh();
      const timer = setInterval(refresh, POLL_INTERVAL_MS);
      return () => {
        isMounted.current = false;
        clearInterval(timer);
      };
    }, [refresh]);

    return { state, databases, error, setError, refresh, isMounted };
  }

  function PostgresPanel({ site }) {
    const siteId = site.id;
    const { state, databases, error, setError, refresh, isMounted } = usePanelState(siteId);
    const [busy, setBusy] = React.useState(null);
    const [log, setLog] = React.useState(null);
    const progress = useProgress(busy);

    /** Runs one action at a time, surfaces errors, then refreshes. Resolves true on success. */
    const run = async (label, task) => {
      setBusy(label);
      setError(null);
      try {
        await task();
        return true;
      } catch (taskError) {
        if (isMounted.current) {
          setError(taskError.message);
        }
        return false;
      } finally {
        if (isMounted.current) {
          setBusy(null);
          await refresh();
        }
      }
    };

    const actions = {
      enable: (version) => run('enable', () => api.enableSite(siteId, version)),
      start: () => run('start', () => api.start(siteId)),
      stop: () => run('stop', () => api.stop(siteId)),
      restart: () => run('restart', () => api.restart(siteId)),
      setAutoStart: (autoStart) => run('autostart', () => api.setAutoStart(siteId, autoStart)),
      setPort: (port) => (confirm(`Move PostgreSQL to port ${port}? A running server restarts, and apps using the old port need the new DATABASE_URL.`)
        ? run('port', () => api.setPort(siteId, port))
        : Promise.resolve(false)),
      createDatabase: (name) => run('create-db', () => api.createDatabase(siteId, name)),
      dropDatabase: (name) => (confirm(`Drop the "${name}" database? All of its data will be lost.`)
        ? run('drop-db', () => api.dropDatabase(siteId, name))
        : Promise.resolve(false)),
      loadLog: () => api.readLog(siteId).then(setLog, (logError) => setError(logError.message)),
      hideLog: () => setLog(null),
      installVersion: (version) => run('install', () => api.installVersion(version)),
      removeVersion: (version) => (confirm(`Delete the PostgreSQL ${version} binaries?`)
        ? run('remove-version', () => api.removeVersion(version))
        : Promise.resolve(false)),
      disable: () => (confirm(`Remove PostgreSQL from "${site.name}"? This permanently deletes all of its databases.`)
        ? run('disable', () => api.disableSite(siteId))
        : Promise.resolve(false)),
    };

    const header = h('header', { style: styles.header },
      h('div', { style: { flex: 1 } },
        h('h2', { style: styles.title }, 'PostgreSQL'),
        h('p', { style: styles.subtitle }, `A private PostgreSQL server for ${site.name}`)),
      state && state.site ? h(StatusPill, { status: state.site.status }) : null);

    const errorBanner = h(ErrorBanner, { message: error, onDismiss: () => setError(null) });

    if (!state) {
      return h('div', { style: styles.panel }, header, errorBanner, error ? null : h('p', { style: styles.hint }, 'Loading…'));
    }
    if (!state.isPlatformSupported) {
      return h('div', { style: styles.panel }, header, h('p', null, 'Prebuilt PostgreSQL binaries are not available for this operating system / CPU.'));
    }

    const common = { state, busy, progress, actions };
    const body = state.site
      ? [
        h(sections.ServerSection, { key: 'server', site: state.site, busy, actions }),
        h(sections.ConnectionSection, { key: 'conn', site: state.site }),
        h(sections.DatabasesSection, { key: 'dbs', site: state.site, databases, busy, actions }),
        h(sections.LogSection, { key: 'log', log, actions }),
        h(sections.VersionsSection, { key: 'versions', ...common }),
        h(sections.DangerSection, { key: 'danger', busy, actions }),
      ]
      : [
        h(sections.EnableSection, { key: 'enable', ...common }),
        h(sections.VersionsSection, { key: 'versions', ...common }),
      ];

    return h('div', { style: styles.panel }, header, errorBanner, body);
  }

  return PostgresPanel;
}

module.exports = { createPostgresPanel };
