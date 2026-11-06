'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runCommand } = require('../lib/runCommand');
const { downloadFile, fetchText } = require('../lib/download');

const NODE = process.execPath;

test('runCommand resolves with stdout and passes env without a shell', async () => {
  const { stdout } = await runCommand(NODE, ['-e', 'process.stdout.write(process.env.PG_TEST + process.argv[1])', '; echo injected'], {
    env: { PG_TEST: 'ok' },
  });
  assert.equal(stdout, 'ok; echo injected');
});

test('runCommand rejects with exit code and stderr on failure', async () => {
  await assert.rejects(
    runCommand(NODE, ['-e', 'process.stderr.write("bad things"); process.exit(3)']),
    (error) => error.code === 3 && error.message === 'bad things',
  );
});

test('downloads refuse insecure URLs', async () => {
  await assert.rejects(fetchText('http://example.com/file'), /insecure connection/);
  await assert.rejects(downloadFile('http://example.com/file', '/dev/null'), /insecure connection/);
});
