'use strict';

const path = require('path');
const { HOST, STATUS, START_TIMEOUT_SECONDS, LOG_TAIL_BYTES } = require('./constants');

const RUNTIME_CONF = 'local-addon.conf';
const INCLUDE_LINE = `\n# Managed by the Local PostgreSQL add-on\ninclude_if_exists = '${RUNTIME_CONF}'\n`;
/** `pg_ctl status` exit codes. */
const PG_CTL_NOT_RUNNING = 3;
const PG_CTL_NO_DATA_DIR = 4;

/**
 * Controls one PostgreSQL cluster per site via initdb / pg_ctl / psql.
 * Every call takes the site's config so this module stays stateless.
 */
function createInstanceManager({ paths, binary, fs, runCommand, logger }) {
  const isInitialized = async (siteId) => {
    try {
      await fs.access(path.join(paths.dataDir(siteId), 'PG_VERSION'));
      return true;
    } catch {
      return false;
    }
  };

  async function writeRuntimeConf(siteId, cfg) {
    const conf = [
      `port = ${cfg.port}`,
      `listen_addresses = '${HOST}'`,
      "unix_socket_directories = ''",
      '',
    ].join('\n');
    await fs.writeFile(path.join(paths.dataDir(siteId), RUNTIME_CONF), conf);
  }

  /** Creates a new cluster. The caller must make sure the data directory doesn't exist yet. */
  async function initCluster(siteId, cfg) {
    const dataDir = paths.dataDir(siteId);
    const pwFile = path.join(paths.siteDir(siteId), '.pwfile');
    await fs.mkdir(paths.siteDir(siteId), { recursive: true });
    await fs.writeFile(pwFile, cfg.password, { mode: 0o600 });
    try {
      await runCommand(binary(cfg.version, 'initdb'), [
        '-D', dataDir,
        '-U', cfg.user,
        `--pwfile=${pwFile}`,
        '--auth=scram-sha-256',
        '--encoding=UTF8',
        '--locale=C',
      ]);
    } finally {
      await fs.rm(pwFile, { force: true });
    }
    await fs.appendFile(path.join(dataDir, 'postgresql.conf'), INCLUDE_LINE);
    await writeRuntimeConf(siteId, cfg);
    logger.info(`Initialised PostgreSQL ${cfg.version} cluster for site ${siteId}`);
  }

  async function status(siteId, cfg) {
    if (!(await isInitialized(siteId))) {
      return STATUS.NOT_INITIALIZED;
    }
    try {
      await runCommand(binary(cfg.version, 'pg_ctl'), ['status', '-D', paths.dataDir(siteId)]);
      return STATUS.RUNNING;
    } catch (error) {
      if (error.code === PG_CTL_NOT_RUNNING || error.code === PG_CTL_NO_DATA_DIR) {
        return STATUS.STOPPED;
      }
      if (error.code === 'ENOENT') {
        return STATUS.BINARY_MISSING;
      }
      throw error;
    }
  }

  async function start(siteId, cfg) {
    if ((await status(siteId, cfg)) === STATUS.RUNNING) {
      return;
    }
    await writeRuntimeConf(siteId, cfg);
    try {
      await runCommand(binary(cfg.version, 'pg_ctl'), [
        'start', '-D', paths.dataDir(siteId), '-l', paths.logFile(siteId), '-w', '-t', String(START_TIMEOUT_SECONDS),
      ]);
    } catch (error) {
      throw new Error(`PostgreSQL failed to start. See the server log for details. (${error.message})`);
    }
    logger.info(`Started PostgreSQL for site ${siteId} on port ${cfg.port}`);
  }

  async function stop(siteId, cfg) {
    if ((await status(siteId, cfg)) !== STATUS.RUNNING) {
      return;
    }
    await runCommand(binary(cfg.version, 'pg_ctl'), ['stop', '-D', paths.dataDir(siteId), '-m', 'fast', '-w']);
    logger.info(`Stopped PostgreSQL for site ${siteId}`);
  }

  const connectionArgs = (cfg) => ['-h', HOST, '-p', String(cfg.port), '-U', cfg.user];
  const connectionEnv = (cfg) => ({ PGPASSWORD: cfg.password, PGCONNECT_TIMEOUT: '5' });

  async function listDatabases(cfg) {
    const { stdout } = await runCommand(
      binary(cfg.version, 'psql'),
      [...connectionArgs(cfg), '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1',
        '-c', 'SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname'],
      { env: connectionEnv(cfg) },
    );
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  /** createdb/dropdb quote the identifier themselves; names are also validated upstream. */
  async function createDatabase(cfg, name) {
    await runCommand(binary(cfg.version, 'createdb'), [...connectionArgs(cfg), name], { env: connectionEnv(cfg) });
  }

  async function dropDatabase(cfg, name) {
    await runCommand(
      binary(cfg.version, 'dropdb'),
      [...connectionArgs(cfg), '--if-exists', '--force', name],
      { env: connectionEnv(cfg) },
    );
  }

  async function readLog(siteId) {
    let handle;
    try {
      handle = await fs.open(paths.logFile(siteId), 'r');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return '';
      }
      throw error;
    }
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, LOG_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } finally {
      await handle.close();
    }
  }

  async function destroy(siteId) {
    await fs.rm(paths.siteDir(siteId), { recursive: true, force: true });
    logger.info(`Deleted PostgreSQL data for site ${siteId}`);
  }

  return {
    initCluster,
    status,
    start,
    stop,
    listDatabases,
    createDatabase,
    dropDatabase,
    readLog,
    destroy,
  };
}

module.exports = { createInstanceManager, RUNTIME_CONF };
