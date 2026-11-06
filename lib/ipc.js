'use strict';

const { IPC } = require('./constants');

function requireObject(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid request.');
  }
  return payload;
}

function progressSender(event, extra) {
  return (progress) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(IPC.PROGRESS, { ...extra, ...progress });
    }
  };
}

/** Maps each IPC channel to a service call. Payloads are validated again inside the service. */
function buildRoutes(service) {
  return {
    [IPC.GET_STATE]: (_event, { siteId }) => service.getState(siteId),
    [IPC.INSTALL_VERSION]: (event, { version }) => service.installVersion(version, progressSender(event, { version })),
    [IPC.REMOVE_VERSION]: (_event, { version }) => service.removeVersion(version),
    [IPC.ENABLE_SITE]: (event, { siteId, version }) => (
      service.enableSite(siteId, version, progressSender(event, { siteId, version }))
    ),
    [IPC.DISABLE_SITE]: (_event, { siteId }) => service.disableSite(siteId),
    [IPC.START]: (_event, { siteId }) => service.startSite(siteId),
    [IPC.STOP]: (_event, { siteId }) => service.stopSite(siteId),
    [IPC.RESTART]: (_event, { siteId }) => service.restartSite(siteId),
    [IPC.SET_AUTOSTART]: (_event, { siteId, autoStart }) => service.setAutoStart(siteId, autoStart),
    [IPC.LIST_DATABASES]: (_event, { siteId }) => service.listDatabases(siteId),
    [IPC.CREATE_DATABASE]: (_event, { siteId, name }) => service.createDatabase(siteId, name),
    [IPC.DROP_DATABASE]: (_event, { siteId, name }) => service.dropDatabase(siteId, name),
    [IPC.READ_LOG]: (_event, { siteId }) => service.readLog(siteId),
  };
}

function registerIpcHandlers(ipcMain, service, logger) {
  Object.entries(buildRoutes(service)).forEach(([channel, route]) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, payload) => {
      try {
        const result = await route(event, requireObject(payload));
        return result === undefined ? null : result;
      } catch (error) {
        logger.error(`${channel} failed`, error);
        throw new Error(error.message || 'Unexpected PostgreSQL add-on error.');
      }
    });
  });
}

module.exports = { registerIpcHandlers, buildRoutes };
