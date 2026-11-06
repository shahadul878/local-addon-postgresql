'use strict';

const { execFile } = require('child_process');

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;

/**
 * Runs a binary with an argument array (never through a shell, so arguments can't inject commands).
 * Rejects with an Error carrying `code`, `stdout` and `stderr` when the process exits non-zero
 * or cannot be started.
 *
 * @param {string} file
 * @param {string[]} args
 * @param {{ env?: Record<string, string>, cwd?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function runCommand(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env || {}) },
        timeout: options.timeoutMs || 0,
        maxBuffer: MAX_OUTPUT_BYTES,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout, stderr });
          return;
        }
        const detail = (stderr || stdout || error.message).trim();
        const wrapped = new Error(detail);
        // Exit status (number) or a spawn error code such as 'ENOENT' (string).
        wrapped.code = error.code === undefined ? null : error.code;
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        reject(wrapped);
      },
    );
  });
}

module.exports = { runCommand };
