'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'pgaddon-test-'));
}

function createSilentLogger() {
  const entries = [];
  const record = (level) => (message, error) => entries.push({ level, message, error });
  return { entries, info: record('info'), warn: record('warn'), error: record('error') };
}

/** Records calls and returns scripted results: handler(file, args, options) => result | throws. */
function createFakeRunner(handler = () => ({ stdout: '', stderr: '' })) {
  const calls = [];
  const run = async (file, args, options) => {
    calls.push({ file, bin: path.basename(file), args, options });
    const result = await handler(file, args, options);
    return result || { stdout: '', stderr: '' };
  };
  return { run, calls };
}

function exitError(code, message = 'failed') {
  const error = new Error(message);
  error.code = code;
  return error;
}

const sampleSiteConfig = Object.freeze({
  version: '17.11.1',
  port: 5432,
  user: 'postgres',
  password: 'secret-pass',
  database: 'local',
  autoStart: true,
  createdAt: '2026-11-06T00:00:00.000Z',
});

module.exports = { makeTempDir, createSilentLogger, createFakeRunner, exitError, sampleSiteConfig };
