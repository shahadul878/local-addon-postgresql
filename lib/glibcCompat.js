'use strict';

const path = require('path');

/**
 * Linux builds bundle their own shared libraries. Some of them (e.g. libstdc++) are built
 * against a newer glibc than older distributions ship (Ubuntu 22.04 has 2.35), which makes
 * every PostgreSQL program fail to load. When the system has its own copy of such a library,
 * the bundled one is moved aside so the dynamic linker falls back to the system copy.
 */

/** Programs the add-on runs; if any of these needs a newer glibc the build cannot work at all. */
const CORE_PROGRAMS = Object.freeze(['postgres', 'initdb', 'pg_ctl', 'psql', 'createdb', 'dropdb']);
const DISABLED_DIR = 'lib-disabled';
const READ_CHUNK_BYTES = 1024 * 1024;
const VERSION_OVERLAP_BYTES = 32;
const GLIBC_PATTERN = /GLIBC_(\d+\.\d+(?:\.\d+)?)/g;
const SHARED_LIBRARY_PATTERN = /^lib.+\.so(\.\d+)*$/;

const MULTIARCH = Object.freeze({ x64: 'x86_64-linux-gnu', arm64: 'aarch64-linux-gnu' });

function compareGlibc(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

const newest = (versions) => versions.reduce((max, v) => (max === null || compareGlibc(v, max) > 0 ? v : max), null);

/** Folders the dynamic linker searches for system libraries on glibc distributions. */
function systemLibraryDirs(arch = process.arch) {
  const multiarch = MULTIARCH[arch];
  const debianStyle = multiarch ? [`/lib/${multiarch}`, `/usr/lib/${multiarch}`] : [];
  return [...debianStyle, '/lib64', '/usr/lib64', '/lib', '/usr/lib'];
}

/** The running glibc version (e.g. "2.35"), or null on macOS, Windows and musl systems. */
function detectSystemGlibc(proc = process) {
  if (proc.platform !== 'linux' || !proc.report) {
    return null;
  }
  try {
    return proc.report.getReport().header.glibcVersionRuntime || null;
  } catch {
    // Without a version the check is skipped; the add-on must still load.
    return null;
  }
}

/** Highest GLIBC_x.y version name in an ELF file, i.e. the oldest glibc it can run on. */
async function maxGlibcRequired(file, fs, { chunkSize = READ_CHUNK_BYTES } = {}) {
  const handle = await fs.open(file, 'r');
  const found = new Set();
  try {
    const buffer = Buffer.alloc(chunkSize);
    let carry = '';
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, position);
      if (bytesRead === 0) {
        break;
      }
      position += bytesRead;
      const text = carry + buffer.toString('latin1', 0, bytesRead);
      for (const match of text.matchAll(GLIBC_PATTERN)) {
        found.add(match[1]);
      }
      carry = text.slice(-VERSION_OVERLAP_BYTES);
    }
  } finally {
    await handle.close();
  }
  return newest([...found]);
}

const pathExists = (fs, target) => fs.access(target).then(() => true, () => false);

async function hasSystemCopy(fs, name, systemLibDirs) {
  const checks = await Promise.all(systemLibDirs.map((dir) => pathExists(fs, path.join(dir, name))));
  return checks.includes(true);
}

async function assertProgramsSupported({ dir, systemGlibc, fs }) {
  for (const program of CORE_PROGRAMS) {
    const file = path.join(dir, 'bin', program);
    if (await pathExists(fs, file)) {
      const required = await maxGlibcRequired(file, fs);
      if (required && compareGlibc(required, systemGlibc) > 0) {
        throw new Error(
          `This PostgreSQL build needs a newer Linux: ${program} requires glibc ${required}, but this system has glibc ${systemGlibc}. Try an older PostgreSQL version.`,
        );
      }
    }
  }
}

/** Only libraries the system also has can be swapped, so others (e.g. the large libLLVM) are never read. */
async function disableIfNewer({ dir, name, systemGlibc, systemLibDirs, fs }) {
  if (!(await hasSystemCopy(fs, name, systemLibDirs))) {
    return false;
  }
  const file = path.join(dir, 'lib', name);
  const required = await maxGlibcRequired(file, fs);
  if (!required || compareGlibc(required, systemGlibc) <= 0) {
    return false;
  }
  await fs.mkdir(path.join(dir, DISABLED_DIR), { recursive: true });
  await fs.rename(file, path.join(dir, DISABLED_DIR, name));
  return true;
}

/**
 * Makes an extracted Linux build loadable on this system. Returns the bundled libraries
 * that were moved aside. Safe to run again on an already-adjusted build.
 */
async function makeCompatible({ dir, systemGlibc, systemLibDirs = systemLibraryDirs(), fs, logger }) {
  if (!systemGlibc) {
    return [];
  }
  await assertProgramsSupported({ dir, systemGlibc, fs });

  const entries = await fs.readdir(path.join(dir, 'lib'), { withFileTypes: true }).catch(() => []);
  const candidates = entries.filter((entry) => entry.isFile() && SHARED_LIBRARY_PATTERN.test(entry.name));
  const disabled = [];
  for (const { name } of candidates) {
    if (await disableIfNewer({ dir, name, systemGlibc, systemLibDirs, fs })) {
      disabled.push(name);
    }
  }
  if (disabled.length > 0) {
    logger.info(`Using system copies of ${disabled.join(', ')} (bundled ones need a newer glibc than ${systemGlibc})`);
  }
  return disabled;
}

module.exports = {
  makeCompatible,
  maxGlibcRequired,
  compareGlibc,
  systemLibraryDirs,
  detectSystemGlibc,
  CORE_PROGRAMS,
};
