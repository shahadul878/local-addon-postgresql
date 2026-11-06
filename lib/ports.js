'use strict';

const net = require('net');
const { HOST, DEFAULT_PORT, PORT_SCAN_LIMIT } = require('./constants');

function isPortFree(port, host = HOST) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/**
 * Finds the first port, from `start`, that is not reserved by another site and is not in use.
 * @param {Set<number>} reserved ports already assigned to other sites
 */
async function findFreePort(reserved, { start = DEFAULT_PORT, check = isPortFree } = {}) {
  for (let port = start; port < start + PORT_SCAN_LIMIT; port += 1) {
    if (!reserved.has(port) && (await check(port))) {
      return port;
    }
  }
  throw new Error(`No free port found between ${start} and ${start + PORT_SCAN_LIMIT - 1}.`);
}

module.exports = { isPortFree, findFreePort };
