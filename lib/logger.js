'use strict';

const fs = require('fs');
const path = require('path');

const MAX_LOG_BYTES = 1024 * 1024;

function formatError(error) {
  if (!error) {
    return '';
  }
  return ` | ${error.stack || error.message || String(error)}`;
}

/**
 * Minimal file logger for the main process. Local doesn't hand add-ons its logger,
 * so we keep our own at <userData>/postgresql/addon.log (rotated at 1 MB).
 */
function createLogger(logFile) {
  let ready = false;

  function write(level, message, error) {
    try {
      if (!ready) {
        fs.mkdirSync(path.dirname(logFile), { recursive: true });
        ready = true;
      }
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_BYTES) {
        fs.renameSync(logFile, `${logFile}.1`);
      }
      fs.appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${message}${formatError(error)}\n`);
    } catch (writeError) {
      process.stderr.write(`[local-addon-postgresql] ${level}: ${message} (log write failed: ${writeError.message})\n`);
    }
  }

  return {
    info: (message) => write('info', message),
    warn: (message, error) => write('warn', message, error),
    error: (message, error) => write('error', message, error),
  };
}

module.exports = { createLogger };
