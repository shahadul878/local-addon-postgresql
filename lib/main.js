'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { PASSWORD_BYTES } = require('./constants');
const { createPaths } = require('./paths');
const { getTargetTriple } = require('./platform');
const { createLogger } = require('./logger');
const { createConfigStore } = require('./configStore');
const { downloadFile, fetchText } = require('./download');
const { runCommand } = require('./runCommand');
const { findFreePort, isPortFree } = require('./ports');
const { createBinaryManager } = require('./binaryManager');
const { detectSystemGlibc } = require('./glibcCompat');
const { createInstanceManager } = require('./instanceManager');
const { createPostgresService } = require('./postgresService');
const { registerIpcHandlers } = require('./ipc');

const QUIT_STOP_TIMEOUT_MS = 15000;

function buildService(userDataPath) {
  const paths = createPaths(userDataPath);
  const logger = createLogger(path.join(paths.root, 'addon.log'));
  const binaries = createBinaryManager({
    paths, triple: getTargetTriple(), fs, downloadFile, fetchText, runCommand, logger, systemGlibc: detectSystemGlibc(),
  });
  const instances = createInstanceManager({ paths, binary: paths.binary, fs, runCommand, logger });
  const service = createPostgresService({
    store: createConfigStore(paths.configFile, logger),
    binaries,
    instances,
    findFreePort: (reserved) => findFreePort(reserved),
    isPortFree: (port) => isPortFree(port),
    generatePassword: () => crypto.randomBytes(PASSWORD_BYTES).toString('base64url'),
    logger,
  });
  return { service, logger };
}

/** Stop every PostgreSQL server before Local exits so no orphaned postgres processes are left. */
function stopServersOnQuit(app, service, logger) {
  let hasStopped = false;
  app.on('before-quit', (event) => {
    if (hasStopped) {
      return;
    }
    event.preventDefault();
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => {
        logger.warn('Timed out stopping PostgreSQL servers on quit');
        resolve();
      }, QUIT_STOP_TIMEOUT_MS);
    });
    Promise.race([service.stopAll(), timeout])
      .catch((error) => logger.error('Stopping PostgreSQL servers on quit failed', error))
      .finally(() => {
        clearTimeout(timer);
        hasStopped = true;
        app.quit();
      });
  });
}

/** Main-process entry point. Local instantiates this with `new`, so it must be a regular function. */
module.exports = function PostgresAddonMain(context) {
  const { electron, hooks, environment } = context;
  const { service, logger } = buildService(environment.userDataPath);

  registerIpcHandlers(electron.ipcMain, service, logger);

  hooks.addAction('siteStarted', (site) => service.handleSiteStarted(site && site.id));
  hooks.addAction('siteStopped', (site) => service.handleSiteStopped(site && site.id));
  hooks.addAction('siteDeleted', (siteId) => service.handleSiteDeleted(siteId));

  stopServersOnQuit(electron.app, service, logger);
  logger.info(`PostgreSQL add-on loaded (Local ${environment.version})`);
};
