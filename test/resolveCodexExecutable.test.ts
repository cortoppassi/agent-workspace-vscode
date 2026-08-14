import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { resolveCodexExecutable } from '../src/chat/resolveCodexExecutable';

void test('resolveCodexExecutable uses a native Windows executable when available', () => {
  const directory = 'C:\\tools';
  const executable = join(directory, 'codex.exe');

  assert.deepEqual(resolveCodexExecutable('win32', { PATH: directory }, (candidate) => candidate === executable), {
    command: executable,
    argsPrefix: [],
  });
});

void test('resolveCodexExecutable runs the Windows npm shim through cmd', () => {
  const directory = 'C:\\tools';
  const commandScript = join(directory, 'codex.cmd');

  assert.deepEqual(
    resolveCodexExecutable('win32', { PATH: directory, ComSpec: 'cmd.exe' }, (candidate) => candidate === commandScript),
    {
      command: 'cmd.exe',
      argsPrefix: ['/d', '/s', '/c', `"${commandScript}"`],
      windowsVerbatimArguments: true,
    },
  );
});

void test('resolveCodexExecutable checks the default Windows npm directory outside PATH', () => {
  const appData = 'C:\\Users\\developer\\AppData\\Roaming';
  const commandScript = join(appData, 'npm', 'codex.cmd');

  const result = resolveCodexExecutable(
    'win32',
    { PATH: 'C:\\Windows\\System32', APPDATA: appData, ComSpec: 'cmd.exe' },
    (candidate) => candidate === commandScript,
  );

  assert.equal(result?.argsPrefix[3], `"${commandScript}"`);
});
