'use strict';

const fs = require('fs/promises');
const path = require('path');
const { createSerialQueue } = require('./serialQueue');

const EMPTY_CONFIG = Object.freeze({ sites: Object.freeze({}) });

/**
 * @typedef {Object} SiteConfig
 * @property {string} version   PostgreSQL version this cluster was created with
 * @property {number} port
 * @property {string} user
 * @property {string} password
 * @property {string} database  default database created for the site
 * @property {boolean} autoStart start/stop together with the Local site
 * @property {string} createdAt ISO timestamp
 */

/** @param {unknown} value */
function isValidSiteConfig(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.version === 'string'
    && Number.isInteger(value.port)
    && typeof value.user === 'string'
    && typeof value.password === 'string'
    && typeof value.database === 'string'
    && typeof value.autoStart === 'boolean';
}

/** Keeps only well-formed site entries so a hand-edited file can't crash the add-on. */
function normalizeConfig(raw) {
  const sites = raw && typeof raw === 'object' && raw.sites && typeof raw.sites === 'object' ? raw.sites : {};
  const validSites = Object.fromEntries(
    Object.entries(sites).filter(([, siteConfig]) => isValidSiteConfig(siteConfig)),
  );
  return { sites: validSites };
}

function withSite(config, siteId, siteConfig) {
  return { ...config, sites: { ...config.sites, [siteId]: { ...siteConfig } } };
}

function withSitePatch(config, siteId, patch) {
  const current = config.sites[siteId];
  if (!current) {
    throw new Error('PostgreSQL is not enabled for this site.');
  }
  return withSite(config, siteId, { ...current, ...patch });
}

function withoutSite(config, siteId) {
  const { [siteId]: _removed, ...rest } = config.sites;
  return { ...config, sites: rest };
}

/**
 * File-backed store. Every write is atomic (write temp file, then rename) so a crash
 * mid-write never leaves a truncated config behind.
 */
function createConfigStore(configFile, logger) {
  const enqueue = createSerialQueue();
  let hasBackedUpInvalidEntries = false;

  async function read() {
    let text;
    try {
      text = await fs.readFile(configFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return EMPTY_CONFIG;
      }
      throw new Error(`Could not read PostgreSQL add-on settings: ${error.message}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      const backup = `${configFile}.corrupt-${Date.now()}`;
      logger.error(`Settings file is not valid JSON; moving it to ${backup}`, error);
      await fs.rename(configFile, backup);
      return EMPTY_CONFIG;
    }

    const config = normalizeConfig(parsed);
    const dropped = Object.keys((parsed && parsed.sites) || {}).filter((id) => !(id in config.sites));
    if (dropped.length > 0 && !hasBackedUpInvalidEntries) {
      hasBackedUpInvalidEntries = true;
      // Passwords only live in this file, so keep a copy before the next write drops these entries.
      const backup = `${configFile}.invalid-${Date.now()}`;
      logger.warn(`Ignoring malformed settings for site(s) ${dropped.join(', ')}; original saved to ${backup}`);
      await fs.copyFile(configFile, backup);
    }
    return config;
  }

  async function write(config) {
    await fs.mkdir(path.dirname(configFile), { recursive: true });
    const tempFile = `${configFile}.${process.pid}.tmp`;
    await fs.writeFile(tempFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tempFile, configFile);
  }

  /** Serialises read-modify-write cycles so concurrent IPC calls can't lose updates. */
  function update(transform) {
    return enqueue(async () => {
      const next = transform(await read());
      await write(next);
      return next;
    });
  }

  async function getSite(siteId) {
    const config = await read();
    return config.sites[siteId] || null;
  }

  return { read, update, getSite };
}

module.exports = {
  createConfigStore,
  normalizeConfig,
  withSite,
  withSitePatch,
  withoutSite,
  EMPTY_CONFIG,
};
