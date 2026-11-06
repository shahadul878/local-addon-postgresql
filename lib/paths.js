'use strict';

const path = require('path');
const { getBinaryName } = require('./platform');

/**
 * All on-disk locations the add-on uses, rooted in Local's user-data folder:
 *
 *   <userData>/postgresql/
 *     config.json                 per-site settings
 *     downloads/                  in-flight archives
 *     versions/<version>/bin/     extracted PostgreSQL builds
 *     sites/<siteId>/data/        cluster data directory
 *     sites/<siteId>/postgres.log server log
 */
function createPaths(userDataPath, platform = process.platform) {
  const root = path.join(userDataPath, 'postgresql');
  const versionsDir = path.join(root, 'versions');
  const sitesDir = path.join(root, 'sites');

  const versionDir = (version) => path.join(versionsDir, version);
  const siteDir = (siteId) => path.join(sitesDir, siteId);

  return Object.freeze({
    root,
    configFile: path.join(root, 'config.json'),
    downloadsDir: path.join(root, 'downloads'),
    versionsDir,
    versionDir,
    binary: (version, name) => path.join(versionDir(version), 'bin', getBinaryName(name, platform)),
    siteDir,
    dataDir: (siteId) => path.join(siteDir(siteId), 'data'),
    logFile: (siteId) => path.join(siteDir(siteId), 'postgres.log'),
  });
}

module.exports = { createPaths };
