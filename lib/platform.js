'use strict';

const { RELEASE_BASE_URL } = require('./constants');

const TARGET_TRIPLES = Object.freeze({
  'linux:x64': 'x86_64-unknown-linux-gnu',
  'linux:arm64': 'aarch64-unknown-linux-gnu',
  'darwin:x64': 'x86_64-apple-darwin',
  'darwin:arm64': 'aarch64-apple-darwin',
  'win32:x64': 'x86_64-pc-windows-msvc',
  'win32:arm64': 'aarch64-pc-windows-msvc',
});

/** Returns the upstream build target for this OS/CPU, or null if none is published. */
function getTargetTriple(platform = process.platform, arch = process.arch) {
  return TARGET_TRIPLES[`${platform}:${arch}`] || null;
}

function getBinaryName(name, platform = process.platform) {
  return platform === 'win32' ? `${name}.exe` : name;
}

function getArchiveBaseName(version, triple) {
  return `postgresql-${version}-${triple}`;
}

function getDownloadUrl(version, triple) {
  return `${RELEASE_BASE_URL}/${version}/${getArchiveBaseName(version, triple)}.tar.gz`;
}

module.exports = {
  getTargetTriple,
  getBinaryName,
  getArchiveBaseName,
  getDownloadUrl,
};
