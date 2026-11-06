'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const {
  MAX_REDIRECTS, PROGRESS_THROTTLE_MS, DOWNLOAD_IDLE_TIMEOUT_MS, MAX_TEXT_RESPONSE_BYTES,
} = require('./constants');

function assertHttps(url) {
  if (new URL(url).protocol !== 'https:') {
    throw new Error(`Refusing to download over an insecure connection: ${url}`);
  }
}

/** GET a URL over HTTPS, following redirects. Resolves with the final response stream. */
function openStream(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    assertHttps(url);
    const request = https.get(url, { headers: { 'User-Agent': 'local-addon-postgresql' } }, (response) => {
      const { statusCode, headers } = response;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        response.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('Download failed: too many redirects.'));
          return;
        }
        const nextUrl = new URL(headers.location, url).toString();
        openStream(nextUrl, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (statusCode === 404) {
        response.resume();
        reject(new Error('This PostgreSQL build is not published for your operating system / CPU. Try another version.'));
        return;
      }
      if (statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${statusCode} for ${url}`));
        return;
      }
      resolve(response);
    });
    // Idle timeout covers the whole transfer: a stalled connection fails instead of hanging forever.
    request.setTimeout(DOWNLOAD_IDLE_TIMEOUT_MS, () => {
      request.destroy(new Error('the connection stalled (no data for 60 seconds)'));
    });
    request.on('error', (error) => reject(new Error(`Download failed: ${error.message}`)));
  });
}

async function fetchText(url) {
  const stream = await openStream(url);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MAX_TEXT_RESPONSE_BYTES) {
      stream.destroy();
      throw new Error('Download failed: response was unexpectedly large.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Streams a URL to disk while hashing it.
 * @returns {Promise<{ sha256: string, bytes: number }>}
 */
async function downloadFile(url, destination, onProgress = () => {}) {
  const response = await openStream(url);
  const total = Number(response.headers['content-length']) || 0;
  const hash = crypto.createHash('sha256');
  const file = fs.createWriteStream(destination);
  let received = 0;
  let lastReport = 0;

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      file.destroy();
      reject(new Error(`Download failed: ${error.message}`));
    };

    response.on('data', (chunk) => {
      hash.update(chunk);
      received += chunk.length;
      const now = Date.now();
      if (now - lastReport >= PROGRESS_THROTTLE_MS) {
        lastReport = now;
        onProgress({ received, total });
      }
    });
    response.on('error', fail);
    file.on('error', fail);
    file.on('finish', () => {
      onProgress({ received, total });
      resolve({ sha256: hash.digest('hex'), bytes: received });
    });
    response.pipe(file);
  });
}

/** Upstream `.sha256` files look like "<hex>  <filename>". */
function parseChecksumFile(text) {
  const match = /^([a-f0-9]{64})\b/i.exec(text.trim());
  if (!match) {
    throw new Error('Checksum file has an unexpected format.');
  }
  return match[1].toLowerCase();
}

module.exports = { downloadFile, fetchText, parseChecksumFile };
