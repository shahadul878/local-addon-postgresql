'use strict';

const path = require('path');
const { SUPPORTED_VERSIONS } = require('./constants');
const { getArchiveBaseName, getDownloadUrl } = require('./platform');
const { parseChecksumFile } = require('./download');
const { assertVersion } = require('./validation');
const { makeCompatible, systemLibraryDirs } = require('./glibcCompat');

/** Windows' built-in bsdtar; a GNU tar earlier on PATH would read "C:\\..." as a remote host. */
function resolveTar(platform = process.platform, env = process.env) {
  if (platform !== 'win32') {
    return 'tar';
  }
  return path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
}

async function pathExists(fs, target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads, verifies (SHA-256) and unpacks portable PostgreSQL builds into
 * <userData>/postgresql/versions/<version>.
 */
function createBinaryManager({
  paths, triple, fs, downloadFile, fetchText, runCommand, logger, systemGlibc = null, systemLibDirs = systemLibraryDirs(),
}) {
  const inFlight = new Map();
  const isPlatformSupported = Boolean(triple);
  const adjustForSystem = (dir) => makeCompatible({ dir, systemGlibc, systemLibDirs, fs, logger });

  const isInstalled = (version) => pathExists(fs, paths.binary(version, 'postgres'));

  async function listInstalled() {
    const results = await Promise.all(
      SUPPORTED_VERSIONS.map(async (version) => ((await isInstalled(version)) ? version : null)),
    );
    return results.filter(Boolean);
  }

  async function downloadAndVerify(version, archivePath, onProgress) {
    const url = getDownloadUrl(version, triple);
    const expected = parseChecksumFile(await fetchText(`${url}.sha256`));
    const { sha256 } = await downloadFile(url, archivePath, (progress) => onProgress({ phase: 'download', ...progress }));
    if (sha256 !== expected) {
      throw new Error(`Checksum mismatch for PostgreSQL ${version}; the download may be corrupted. Please try again.`);
    }
  }

  async function extractInto(version, archivePath, stagingDir) {
    await fs.mkdir(stagingDir, { recursive: true });
    await runCommand(resolveTar(), ['-xzf', archivePath, '-C', stagingDir]);
    const extracted = path.join(stagingDir, getArchiveBaseName(version, triple));
    if (!(await pathExists(fs, path.join(extracted, 'bin')))) {
      throw new Error(`The PostgreSQL ${version} archive did not contain the expected files.`);
    }
    await adjustForSystem(extracted);
    await fs.rm(paths.versionDir(version), { recursive: true, force: true });
    await fs.rename(extracted, paths.versionDir(version));
  }

  async function doInstall(version, onProgress) {
    const archivePath = path.join(paths.downloadsDir, `${getArchiveBaseName(version, triple)}.tar.gz.part`);
    const stagingDir = path.join(paths.versionsDir, `.staging-${version}-${Date.now()}`);
    await fs.mkdir(paths.downloadsDir, { recursive: true });
    await fs.mkdir(paths.versionsDir, { recursive: true });

    try {
      logger.info(`Downloading PostgreSQL ${version} for ${triple}`);
      await downloadAndVerify(version, archivePath, onProgress);
      onProgress({ phase: 'extract' });
      await extractInto(version, archivePath, stagingDir);
      logger.info(`Installed PostgreSQL ${version}`);
      onProgress({ phase: 'done' });
    } finally {
      await fs.rm(stagingDir, { recursive: true, force: true });
      await fs.rm(archivePath, { force: true });
    }
  }

  /** Installs a missing version, or re-checks an installed one so older installs get repaired. */
  async function prepare(version, onProgress) {
    if (await isInstalled(version)) {
      await adjustForSystem(paths.versionDir(version));
      return;
    }
    await doInstall(version, onProgress);
  }

  /** Idempotent; concurrent calls for the same version share one job and all get progress. */
  async function install(version, onProgress = () => {}) {
    assertVersion(version);
    if (!isPlatformSupported) {
      throw new Error(`PostgreSQL builds are not available for ${process.platform}/${process.arch}.`);
    }
    if (!inFlight.has(version)) {
      const listeners = new Set();
      const broadcast = (event) => listeners.forEach((listener) => listener(event));
      const job = prepare(version, broadcast).finally(() => inFlight.delete(version));
      inFlight.set(version, { job, listeners });
    }
    const { job, listeners } = inFlight.get(version);
    listeners.add(onProgress);
    try {
      await job;
    } finally {
      listeners.delete(onProgress);
    }
  }

  async function remove(version) {
    assertVersion(version);
    await fs.rm(paths.versionDir(version), { recursive: true, force: true });
    logger.info(`Removed PostgreSQL ${version}`);
  }

  return {
    isPlatformSupported,
    isInstalled,
    listInstalled,
    install,
    remove,
    binary: paths.binary,
  };
}

module.exports = { createBinaryManager, resolveTar };
