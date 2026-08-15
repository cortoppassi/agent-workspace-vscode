import assert from 'node:assert/strict';
import test from 'node:test';
import type { CodexModel } from '../src/chat/protocol';
import type { AgentConfig } from '../src/config/types';
import {
  createDispatchRecord,
  createRoutingPrompt,
  readAiRouteRecommendation,
  readDispatchRecord,
  selectRoutingModel,
} from '../src/routing/TaskRouter';

const frontend = agent('frontend', 'Frontend', ['React', 'CSS', 'UI'], 'gpt-5.6-luna', 'low');
const backend = agent('backend', 'Backend', ['API', 'SQL', 'authentication'], 'gpt-5.6-sol', 'high');
const profiles = [
  { agent: backend, instructions: 'Maintain endpoints and database access.' },
  { agent: frontend, instructions: 'Build accessible responsive interfaces.' },
];
const models: CodexModel[] = [
  model('gpt-5.6-luna', 'GPT-5.6 Luna', ['low', 'medium'], 'low'),
  model('gpt-5.6-terra', 'GPT-5.6 Terra', ['low', 'medium', 'high'], 'medium'),
  { ...model('gpt-5.6-sol', 'GPT-5.6 Sol', ['medium', 'high'], 'high'), isDefault: true },
];

void test('createRoutingPrompt gives the AI the task and complete agent profiles', () => {
  const prompt = createRoutingPrompt('Corrigir o checkout', profiles);
  assert.match(prompt, /Corrigir o checkout/);
  assert.match(prompt, /Build accessible responsive interfaces/);
  assert.match(prompt, /gpt-5\.6-luna/);
  assert.match(prompt, /choose exactly one candidate agent/);
});

void test('readAiRouteRecommendation accepts a structured semantic decision', () => {
  const route = readAiRouteRecommendation(
    JSON.stringify({
      agentId: 'frontend',
      complexity: 'standard',
      confidence: 0.87,
      reason: 'O checkout exige domínio de interface responsiva e acessibilidade.',
    }),
    profiles,
    models,
    'gpt-5.6-luna',
  );
  assert.equal(route?.agent.id, 'frontend');
  assert.equal(route?.complexity, 'standard');
  assert.equal(route?.confidence, 0.87);
  assert.equal(route?.model?.model, 'gpt-5.6-luna');
  assert.equal(route?.reasoningEffort, 'low');
  assert.equal(route?.routerModel, 'gpt-5.6-luna');
  assert.match(route?.agentReason ?? '', /interface responsiva/);
});

void test('AI decisions cannot select an unknown agent or return invalid confidence', () => {
  const unknown = readAiRouteRecommendation(
    JSON.stringify({ agentId: 'invented', complexity: 'simple', confidence: 0.8, reason: 'Inventado.' }),
    profiles,
    models,
  );
  const invalidConfidence = readAiRouteRecommendation(
    JSON.stringify({ agentId: 'frontend', complexity: 'simple', confidence: 2, reason: 'Inválido.' }),
    profiles,
    models,
  );
  assert.equal(unknown, undefined);
  assert.equal(invalidConfidence, undefined);
  assert.equal(readAiRouteRecommendation('frontend because CSS', profiles, models), undefined);
});

void test('execution falls back to the Codex default when the selected agent model is unavailable', () => {
  const route = readAiRouteRecommendation(
    JSON.stringify({ agentId: 'frontend', complexity: 'simple', confidence: 0.7, reason: 'Perfil adequado.' }),
    profiles,
    models.filter((candidate) => !candidate.model.includes('luna')),
  );
  assert.equal(route?.model?.model, 'gpt-5.6-sol');
  assert.match(route?.modelReason ?? '', /indisponível/);
});

void test('selectRoutingModel prefers an economical analysis model', () => {
  assert.equal(selectRoutingModel(models)?.model, 'gpt-5.6-luna');
  assert.equal(selectRoutingModel(models.slice(1))?.model, 'gpt-5.6-terra');
});

void test('dispatch records preserve the AI decision and analysis model', () => {
  const route = readAiRouteRecommendation(
    JSON.stringify({ agentId: 'backend', complexity: 'complex', confidence: 0.91, reason: 'Exige segurança.' }),
    profiles,
    models,
    'gpt-5.6-luna',
  );
  assert.ok(route);
  const record = createDispatchRecord(route, 123);
  assert.deepEqual(readDispatchRecord(record), record);
  assert.equal(record.routerModel, 'gpt-5.6-luna');
  assert.equal(readDispatchRecord({ ...record, confidence: 2 }), undefined);
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
