import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateAgentId,
  normalizeRelativePath,
  parseWorkspaceConfig,
  resolveInsideWorkspace,
  UserFacingError,
  validateDraft,
} from '../src/config/validation';

void test('generateAgentId creates stable safe ids', () => {
  assert.equal(generateAgentId(' Backend API '), 'backend-api');
  assert.equal(generateAgentId('Revisão & Testes'), 'revisao-testes');
  assert.equal(generateAgentId('✨'), 'agent');
});

void test('validateDraft requires a custom command', () => {
  assert.throws(
    () => validateDraft({ name: 'Reviewer', provider: 'custom', cwd: '.', command: ' ' }),
    /Custom CLI command cannot be empty/,
  );
  assert.doesNotThrow(() => validateDraft({ name: 'Backend', provider: 'codex', cwd: '.' }));
});

void test('parseWorkspaceConfig accepts version 1 config', () => {
  const config = parseWorkspaceConfig({
    version: 1,
    agents: [
      {
        id: 'backend',
        name: 'Backend',
        provider: 'codex',
        instructionsFile: '.agent-workspace/agents/backend.md',
        cwd: '.',
      },
    ],
  });
  assert.equal(config.agents[0]?.id, 'backend');
});

void test('parseWorkspaceConfig rejects duplicate ids and invalid providers', () => {
  const base = {
    id: 'backend',
    name: 'Backend',
    provider: 'codex',
    instructionsFile: '.agent-workspace/agents/backend.md',
    cwd: '.',
  };
  assert.throws(
    () => parseWorkspaceConfig({ version: 1, agents: [base, { ...base, name: 'Other' }] }),
    /Duplicate agent id/,
  );
  assert.throws(
    () => parseWorkspaceConfig({ version: 1, agents: [{ ...base, provider: 'unknown' }] }),
    /unsupported provider/i,
  );
});

void test('workspace paths cannot escape the workspace', () => {
  const root = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';
  assert.throws(() => resolveInsideWorkspace(root, '../outside'), UserFacingError);
  assert.equal(normalizeRelativePath('.\\packages\\api'), 'packages/api');
});
