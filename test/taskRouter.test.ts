import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexModel } from '../src/chat/protocol';
import type { AgentConfig } from '../src/config/types';
import {
  assessTaskComplexity,
  createDispatchRecord,
  readDispatchRecord,
  recommendRoutes,
} from '../src/routing/TaskRouter';

const frontend = agent('frontend', 'Frontend', ['React', 'CSS', 'UI'], 'gpt-5.6-luna', 'low');
const backend = agent('backend', 'Backend', ['API', 'SQL', 'authentication'], 'gpt-5.6-sol', 'high');
const models: CodexModel[] = [
  model('gpt-5.6-luna', 'GPT-5.6 Luna', ['low', 'medium'], 'low'),
  model('gpt-5.6-terra', 'GPT-5.6 Terra', ['low', 'medium', 'high'], 'medium'),
  { ...model('gpt-5.6-sol', 'GPT-5.6 Sol', ['medium', 'high'], 'high'), isDefault: true },
];

void test('recommendRoutes selects the matching specialist and economical model for a simple task', () => {
  const routes = recommendRoutes(
    'Corrigir o layout responsivo do componente de checkout',
    [
      { agent: backend, instructions: 'Maintain endpoints and database access.' },
      { agent: frontend, instructions: 'Build accessible responsive interfaces.' },
    ],
    models,
  );

  assert.equal(routes[0]?.agent.id, 'frontend');
  assert.equal(routes[0]?.complexity, 'simple');
  assert.equal(routes[0]?.model?.model, 'gpt-5.6-luna');
  assert.equal(routes[0]?.reasoningEffort, 'low');
  assert.match(routes[0]?.agentReason ?? '', /Matched specialties|frontend/);
});

void test('recommendRoutes prioritizes capability for a complex task', () => {
  const routes = recommendRoutes(
    'Investigate a security race condition and refactor the authentication architecture across multiple services.',
    [{ agent: backend, instructions: 'Own authentication, security, APIs, and databases.' }],
    models,
  );

  assert.equal(routes[0]?.complexity, 'complex');
  assert.equal(routes[0]?.model?.model, 'gpt-5.6-sol');
  assert.equal(routes[0]?.reasoningEffort, 'high');
});

void test('recommendRoutes leaves model selection to Codex when metadata is unavailable', () => {
  const unconfigured = agent('docs', 'Docs', ['README']);
  const route = recommendRoutes('Update the README', [{ agent: unconfigured, instructions: 'Documentation.' }], [])[0];
  assert.equal(route?.model, undefined);
  assert.match(route?.modelReason ?? '', /automatic model selection/);
});

void test('routes fall back to the Codex default when an agent model is unavailable', () => {
  const route = recommendRoutes(
    'Update a CSS class',
    [{ agent: frontend, instructions: 'Frontend UI.' }],
    models.filter((candidate) => !candidate.model.includes('luna')),
  )[0];
  assert.equal(route?.model?.model, 'gpt-5.6-sol');
  assert.match(route?.modelReason ?? '', /unavailable/);
});

void test('simple work favors the cheaper configured agent when expertise is equivalent', () => {
  const premiumFrontend = agent('premium', 'Premium Frontend', ['CSS'], 'gpt-5.6-sol', 'high');
  const route = recommendRoutes(
    'Adjust a CSS class',
    [
      { agent: premiumFrontend, instructions: 'Frontend UI.' },
      { agent: frontend, instructions: 'Frontend UI.' },
    ],
    models,
  )[0];
  assert.equal(route?.agent.id, 'frontend');
});

void test('dispatch records are validated before being restored', () => {
  const route = recommendRoutes('Fix a CSS class', [{ agent: frontend, instructions: 'Frontend UI.' }], models)[0];
  assert.ok(route);
  const record = createDispatchRecord(route, 123);
  assert.deepEqual(readDispatchRecord(record), record);
  assert.equal(readDispatchRecord({ ...record, confidence: 2 }), undefined);
});

void test('assessTaskComplexity distinguishes narrow and broad work', () => {
  assert.equal(assessTaskComplexity('Rename a button'), 'simple');
  assert.equal(assessTaskComplexity('Investigate performance and refactor the architecture'), 'complex');
});

function agent(
  id: string,
  name: string,
  specialties: readonly string[],
  modelId?: string,
  reasoningEffort?: string,
): AgentConfig {
  return {
    id,
    name,
    provider: 'codex',
    instructionsFile: `.agent-workspace/agents/${id}.md`,
    cwd: '.',
    specialties,
    ...(modelId ? { model: modelId } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

function model(
  id: string,
  displayName: string,
  efforts: readonly string[],
  defaultReasoningEffort: string,
): CodexModel {
  return {
    model: id,
    displayName,
    defaultReasoningEffort,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({ reasoningEffort })),
    isDefault: false,
  };
}
