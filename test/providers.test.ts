import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentConfig } from '../src/config/types';
import { CodexProvider } from '../src/providers/CodexProvider';
import { GenericCliProvider } from '../src/providers/GenericCliProvider';

const agent: AgentConfig = {
  id: 'backend',
  name: 'Backend',
  provider: 'codex',
  instructionsFile: '.agent-workspace/agents/backend.md',
  cwd: '.',
};

void test('Codex provider uses a direct executable with a separate prompt argument', () => {
  const launch = new CodexProvider().buildLaunch(agent);
  assert.equal(launch.kind, 'direct');
  if (launch.kind === 'direct') {
    assert.equal(launch.executable, 'codex');
    assert.equal(launch.args.length, 1);
    assert.match(launch.args[0] ?? '', /\.agent-workspace\/agents\/backend\.md/);
    assert.match(launch.args[0] ?? '', /wait for my next task/i);
  }
});

void test('Custom CLI provider returns the configured command unchanged', () => {
  const launch = new GenericCliProvider().buildLaunch({ ...agent, provider: 'custom', command: 'opencode --continue' });
  assert.deepEqual(launch, { kind: 'shell', command: 'opencode --continue' });
});
