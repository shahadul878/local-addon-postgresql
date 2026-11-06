'use strict';

const {
  SUPPORTED_VERSIONS,
  MIN_PORT,
  MAX_PORT,
  PROTECTED_DATABASES,
} = require('./constants');

const SITE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Unquoted PostgreSQL identifier, max 63 bytes. Lower-case only to avoid case-folding surprises. */
const DATABASE_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;

function assertVersion(version) {
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new Error(`Unsupported PostgreSQL version "${version}". Choose one of: ${SUPPORTED_VERSIONS.join(', ')}.`);
  }
  return version;
}

function assertSiteId(siteId) {
  if (typeof siteId !== 'string' || !SITE_ID_PATTERN.test(siteId)) {
    throw new Error('Invalid site id.');
  }
  return siteId;
}

function assertDatabaseName(name) {
  if (typeof name !== 'string' || !DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(
      'Database names must start with a lowercase letter or underscore and contain only lowercase letters, digits and underscores (max 63 characters).',
    );
  }
  return name;
}

function assertDroppableDatabase(name) {
  assertDatabaseName(name);
  if (PROTECTED_DATABASES.includes(name)) {
    throw new Error(`The "${name}" database is required by PostgreSQL and cannot be dropped.`);
  }
  return name;
}

function assertPort(port) {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(`Port must be a whole number between ${MIN_PORT} and ${MAX_PORT}.`);
  }
  return port;
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be true or false.`);
  }
  return value;
}

module.exports = {
  assertVersion,
  assertSiteId,
  assertDatabaseName,
  assertDroppableDatabase,
  assertPort,
  assertBoolean,
};
