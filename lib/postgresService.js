'use strict';

const {
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  HOST,
  DEFAULT_DB_USER,
  DEFAULT_DATABASE,
  STATUS,
} = require('./constants');
const { withSite, withSitePatch, withoutSite } = require('./configStore');
const { createSerialQueue } = require('./serialQueue');
const {
  assertVersion,
  assertSiteId,
  assertDatabaseName,
  assertDroppableDatabase,
  assertBoolean,
} = require('./validation');

function buildConnectionUrl(cfg) {
  const user = encodeURIComponent(cfg.user);
  const password = encodeURIComponent(cfg.password);
  return `postgresql://${user}:${password}@${HOST}:${cfg.port}/${encodeURIComponent(cfg.database)}`;
}

/**
 * Business logic behind every IPC call and site lifecycle hook.
 * All collaborators are injected so the whole flow is unit-testable without PostgreSQL.
 */
function createPostgresService({ store, binaries, instances, findFreePort, isPortFree, generatePassword, logger, now = () => new Date() }) {
  /** Every change to a cluster (enable, disable, start, stop) runs through this one queue. */
  const exclusive = createSerialQueue();

  async function requireSite(siteId) {
    assertSiteId(siteId);
    const cfg = await store.getSite(siteId);
    if (!cfg) {
      throw new Error('PostgreSQL is not enabled for this site.');
    }
    return cfg;
  }

  async function requireRunning(siteId) {
    const cfg = await requireSite(siteId);
    if ((await instances.status(siteId, cfg)) !== STATUS.RUNNING) {
      throw new Error('Start PostgreSQL for this site first.');
    }
    return cfg;
  }

  /** Status for display; a broken install must not stop the panel from loading. */
  async function safeStatus(siteId, cfg) {
    try {
      return await instances.status(siteId, cfg);
    } catch (error) {
      logger.warn(`Could not read PostgreSQL status for ${siteId}`, error);
      return STATUS.UNKNOWN;
    }
  }

  async function getState(siteId) {
    assertSiteId(siteId);
    const [config, installed] = await Promise.all([store.read(), binaries.listInstalled()]);
    const usage = Object.values(config.sites).map((cfg) => cfg.version);
    const versions = SUPPORTED_VERSIONS.map((version) => ({
      version,
      isInstalled: installed.includes(version),
      siteCount: usage.filter((used) => used === version).length,
    }));

    const cfg = config.sites[siteId];
    const site = cfg
      ? { ...cfg, host: HOST, status: await safeStatus(siteId, cfg), connectionUrl: buildConnectionUrl(cfg) }
      : null;

    return { isPlatformSupported: binaries.isPlatformSupported, defaultVersion: DEFAULT_VERSION, versions, site };
  }

  const installVersion = (version, onProgress) => binaries.install(assertVersion(version), onProgress);

  async function removeVersion(version) {
    assertVersion(version);
    const config = await store.read();
    const users = Object.values(config.sites).filter((cfg) => cfg.version === version).length;
    if (users > 0) {
      throw new Error(`PostgreSQL ${version} is still used by ${users} site(s). Remove it from those sites first.`);
    }
    await binaries.remove(version);
  }

  /** Creates the site's default database if it is missing (e.g. a previous createdb failed). */
  async function ensureDefaultDatabase(cfg) {
    const databases = await instances.listDatabases(cfg);
    if (!databases.includes(cfg.database)) {
      await instances.createDatabase(cfg, cfg.database);
    }
  }

  async function startUnlocked(siteId) {
    const cfg = await requireSite(siteId);
    if (!(await binaries.isInstalled(cfg.version))) {
      throw new Error(`PostgreSQL ${cfg.version} is no longer installed. Download it again from the versions list.`);
    }
    if ((await instances.status(siteId, cfg)) === STATUS.RUNNING) {
      return;
    }
    if (!(await isPortFree(cfg.port))) {
      throw new Error(`Port ${cfg.port} is already in use by another program. Stop that program and try again.`);
    }
    await instances.start(siteId, cfg);
    await ensureDefaultDatabase(cfg);
  }

  async function stopUnlocked(siteId) {
    const cfg = await requireSite(siteId);
    await instances.stop(siteId, cfg);
  }

  const startSite = (siteId) => exclusive(() => startUnlocked(siteId));
  const stopSite = (siteId) => exclusive(() => stopUnlocked(siteId));
  const restartSite = (siteId) => exclusive(async () => {
    await stopUnlocked(siteId);
    await startUnlocked(siteId);
  });

  async function createClusterConfig(version) {
    const config = await store.read();
    const reserved = new Set(Object.values(config.sites).map((cfg) => cfg.port));
    return {
      version,
      port: await findFreePort(reserved),
      user: DEFAULT_DB_USER,
      password: generatePassword(),
      database: DEFAULT_DATABASE,
      autoStart: true,
      createdAt: now().toISOString(),
    };
  }

  async function enableSite(siteId, version, onProgress) {
    assertSiteId(siteId);
    assertVersion(version);
    if (await store.getSite(siteId)) {
      throw new Error('PostgreSQL is already enabled for this site.');
    }
    // Download outside the queue so a slow download doesn't block other sites' start/stop.
    await binaries.install(version, onProgress);

    await exclusive(async () => {
      if (await store.getSite(siteId)) {
        throw new Error('PostgreSQL is already enabled for this site.');
      }
      // Port is picked inside the queue so two sites enabled at once can't get the same one.
      const cfg = await createClusterConfig(version);

      onProgress({ phase: 'initdb' });
      // No config entry means any data on disk is a leftover from an interrupted attempt.
      await instances.destroy(siteId);
      try {
        await instances.initCluster(siteId, cfg);
      } catch (error) {
        await instances.destroy(siteId);
        throw new Error(`Could not create the PostgreSQL cluster: ${error.message}`);
      }
      await store.update((config) => withSite(config, siteId, cfg));

      onProgress({ phase: 'start' });
      await startUnlocked(siteId);
      onProgress({ phase: 'done' });
    });
  }

  /** Data is only deleted once the server is confirmed stopped; config is removed last. */
  const disableSite = (siteId) => exclusive(async () => {
    const cfg = await requireSite(siteId);
    try {
      await instances.stop(siteId, cfg);
    } catch (error) {
      throw new Error(`Could not stop PostgreSQL, so its data was left in place: ${error.message}`);
    }
    await instances.destroy(siteId);
    await store.update((config) => withoutSite(config, siteId));
  });

  async function setAutoStart(siteId, autoStart) {
    assertBoolean(autoStart, 'Auto-start');
    await requireSite(siteId);
    await store.update((config) => withSitePatch(config, siteId, { autoStart }));
  }

  async function listDatabases(siteId) {
    return instances.listDatabases(await requireRunning(siteId));
  }

  async function createDatabase(siteId, name) {
    assertDatabaseName(name);
    await instances.createDatabase(await requireRunning(siteId), name);
  }

  async function dropDatabase(siteId, name) {
    assertDroppableDatabase(name);
    await instances.dropDatabase(await requireRunning(siteId), name);
  }

  async function readLog(siteId) {
    await requireSite(siteId);
    return instances.readLog(siteId);
  }

  /** Lifecycle hooks must never throw: a PostgreSQL problem shouldn't block the WordPress site. */
  async function runHookSafely(label, siteId, action) {
    try {
      const cfg = siteId ? await store.getSite(siteId) : null;
      if (cfg) {
        await action(cfg);
      }
    } catch (error) {
      logger.error(`${label} failed for site ${siteId}`, error);
    }
  }

  const handleSiteStarted = (siteId) => runHookSafely('Auto-start', siteId, (cfg) => (cfg.autoStart ? startSite(siteId) : null));
  const handleSiteStopped = (siteId) => runHookSafely('Auto-stop', siteId, (cfg) => (cfg.autoStart ? stopSite(siteId) : null));
  const handleSiteDeleted = (siteId) => runHookSafely('Cleanup', siteId, () => disableSite(siteId));

  const stopAll = () => exclusive(async () => {
    const config = await store.read();
    const results = await Promise.allSettled(
      Object.entries(config.sites).map(([siteId, cfg]) => instances.stop(siteId, cfg)),
    );
    results
      .filter((result) => result.status === 'rejected')
      .forEach((result) => logger.error('Failed to stop a PostgreSQL server on quit', result.reason));
  });

  return {
    getState,
    installVersion,
    removeVersion,
    enableSite,
    disableSite,
    startSite,
    stopSite,
    restartSite,
    setAutoStart,
    listDatabases,
    createDatabase,
    dropDatabase,
    readLog,
    handleSiteStarted,
    handleSiteStopped,
    handleSiteDeleted,
    stopAll,
  };
}

module.exports = { createPostgresService, buildConnectionUrl };
