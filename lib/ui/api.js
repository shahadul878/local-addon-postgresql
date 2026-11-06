'use strict';

const { IPC } = require('../constants');

const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']+':\s*(Error:\s*)?/;

/** Electron prefixes errors thrown in ipcMain.handle; strip that so users see our message. */
function cleanErrorMessage(error) {
  const message = (error && error.message) || 'Unexpected error.';
  return message.replace(REMOTE_ERROR_PREFIX, '');
}

/** Thin promise-based client for the main-process handlers registered in lib/ipc.js. */
function createApi(ipcRenderer) {
  const call = async (channel, payload) => {
    try {
      return await ipcRenderer.invoke(channel, payload);
    } catch (error) {
      throw new Error(cleanErrorMessage(error));
    }
  };

  return {
    getState: (siteId) => call(IPC.GET_STATE, { siteId }),
    installVersion: (version) => call(IPC.INSTALL_VERSION, { version }),
    removeVersion: (version) => call(IPC.REMOVE_VERSION, { version }),
    enableSite: (siteId, version) => call(IPC.ENABLE_SITE, { siteId, version }),
    disableSite: (siteId) => call(IPC.DISABLE_SITE, { siteId }),
    start: (siteId) => call(IPC.START, { siteId }),
    stop: (siteId) => call(IPC.STOP, { siteId }),
    restart: (siteId) => call(IPC.RESTART, { siteId }),
    setAutoStart: (siteId, autoStart) => call(IPC.SET_AUTOSTART, { siteId, autoStart }),
    listDatabases: (siteId) => call(IPC.LIST_DATABASES, { siteId }),
    createDatabase: (siteId, name) => call(IPC.CREATE_DATABASE, { siteId, name }),
    dropDatabase: (siteId, name) => call(IPC.DROP_DATABASE, { siteId, name }),
    readLog: (siteId) => call(IPC.READ_LOG, { siteId }),
    onProgress: (callback) => {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on(IPC.PROGRESS, listener);
      return () => ipcRenderer.removeListener(IPC.PROGRESS, listener);
    },
  };
}

const BYTES_PER_MB = 1024 * 1024;

/** Human-readable text for a progress event from the main process. */
function describeProgress(progress) {
  if (!progress) {
    return '';
  }
  switch (progress.phase) {
    case 'download': {
      const received = (progress.received / BYTES_PER_MB).toFixed(1);
      if (!progress.total) {
        return `Downloading PostgreSQL ${progress.version}… ${received} MB`;
      }
      const percent = Math.floor((progress.received / progress.total) * 100);
      const total = (progress.total / BYTES_PER_MB).toFixed(1);
      return `Downloading PostgreSQL ${progress.version}… ${percent}% (${received} / ${total} MB)`;
    }
    case 'extract':
      return `Unpacking PostgreSQL ${progress.version}…`;
    case 'initdb':
      return 'Creating the database cluster…';
    case 'start':
      return 'Starting the server…';
    case 'done':
      return 'Done.';
    default:
      return '';
  }
}

function progressFraction(progress) {
  if (!progress || progress.phase !== 'download' || !progress.total) {
    return null;
  }
  return Math.min(progress.received / progress.total, 1);
}

module.exports = { createApi, cleanErrorMessage, describeProgress, progressFraction };
