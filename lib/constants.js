'use strict';

/** Portable PostgreSQL builds for Linux, macOS and Windows (MIT/PostgreSQL licensed). */
const RELEASE_BASE_URL = 'https://github.com/theseus-rs/postgresql-binaries/releases/download';

/** Versions offered in the UI, newest first. Each must exist as a release tag upstream. */
const SUPPORTED_VERSIONS = Object.freeze(['18.6.1', '17.11.1', '16.15.1', '15.19.1', '14.24.1']);
const DEFAULT_VERSION = '17.11.1';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 5432;
const PORT_SCAN_LIMIT = 200;
const MIN_PORT = 1024;
const MAX_PORT = 65535;

const DEFAULT_DB_USER = 'postgres';
const DEFAULT_DATABASE = 'local';
const PASSWORD_BYTES = 18;

const START_TIMEOUT_SECONDS = 30;
const LOG_TAIL_BYTES = 16 * 1024;
const MAX_REDIRECTS = 5;
const DOWNLOAD_IDLE_TIMEOUT_MS = 60 * 1000;
const MAX_TEXT_RESPONSE_BYTES = 64 * 1024;
const PROGRESS_THROTTLE_MS = 250;

/** Databases the add-on never lets a user drop. */
const PROTECTED_DATABASES = Object.freeze(['postgres', 'template0', 'template1']);

const IPC = Object.freeze({
  GET_STATE: 'pgaddon:get-state',
  INSTALL_VERSION: 'pgaddon:install-version',
  REMOVE_VERSION: 'pgaddon:remove-version',
  ENABLE_SITE: 'pgaddon:enable-site',
  DISABLE_SITE: 'pgaddon:disable-site',
  START: 'pgaddon:start',
  STOP: 'pgaddon:stop',
  RESTART: 'pgaddon:restart',
  SET_AUTOSTART: 'pgaddon:set-autostart',
  LIST_DATABASES: 'pgaddon:list-databases',
  CREATE_DATABASE: 'pgaddon:create-database',
  DROP_DATABASE: 'pgaddon:drop-database',
  READ_LOG: 'pgaddon:read-log',
  PROGRESS: 'pgaddon:progress',
});

const STATUS = Object.freeze({
  RUNNING: 'running',
  STOPPED: 'stopped',
  NOT_INITIALIZED: 'not-initialized',
  BINARY_MISSING: 'binary-missing',
  UNKNOWN: 'unknown',
});

module.exports = {
  RELEASE_BASE_URL,
  SUPPORTED_VERSIONS,
  DEFAULT_VERSION,
  HOST,
  DEFAULT_PORT,
  PORT_SCAN_LIMIT,
  MIN_PORT,
  MAX_PORT,
  DEFAULT_DB_USER,
  DEFAULT_DATABASE,
  PASSWORD_BYTES,
  START_TIMEOUT_SECONDS,
  LOG_TAIL_BYTES,
  MAX_REDIRECTS,
  DOWNLOAD_IDLE_TIMEOUT_MS,
  MAX_TEXT_RESPONSE_BYTES,
  PROGRESS_THROTTLE_MS,
  PROTECTED_DATABASES,
  IPC,
  STATUS,
};
