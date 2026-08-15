import assert from 'node:assert/strict';
import test from 'node:test';
import {
  migrateLegacyConversations,
  readStoredConversations,
  sumTokenUsage,
  titleFromFirstMessage,
} from '../src/chat/conversations';

void test('migrateLegacyConversations preserves the current thread and usage', () => {
  const conversations = migrateLegacyConversations(
    { agent: 'thread-1' },
    {
      agent: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 5,
        reasoningOutputTokens: 3,
        totalTokens: 15,
      },
    },
    100,
    () => 'conversation-1',
  );

  assert.deepEqual(conversations, [
    {
      id: 'conversation-1',
      agentId: 'agent',
      title: 'Main conversation',
      threadId: 'thread-1',
      createdAt: 100,
      updatedAt: 100,
      usage: {
        inputTokens: 10,
        cachedInputTokens: 2,
        cacheWriteInputTokens: 0,
        outputTokens: 5,
        reasoningOutputTokens: 3,
        totalTokens: 15,
      },
    },
  ]);
});

void test('readStoredConversations rejects malformed records', () => {
  assert.deepEqual(
    readStoredConversations([
      { id: 'one', agentId: 'agent', title: 'Valid', createdAt: 1, updatedAt: 2 },
      { id: 'two', title: 'Missing agent', createdAt: 1, updatedAt: 2 },
    ]),
    [{ id: 'one', agentId: 'agent', title: 'Valid', createdAt: 1, updatedAt: 2 }],
  );
});

void test('readStoredConversations preserves model selection', () => {
  assert.deepEqual(
    readStoredConversations([
      {
        id: 'one',
        agentId: 'agent',
        title: 'Model test',
        model: 'model-slug',
        reasoningEffort: 'high',
        createdAt: 1,
        updatedAt: 2,
      },
    ]),
    [{
      id: 'one',
      agentId: 'agent',
      title: 'Model test',
      model: 'model-slug',
      reasoningEffort: 'high',
      createdAt: 1,
      updatedAt: 2,
    }],
  );
});

void test('readStoredConversations preserves valid Modo Economia decisions', () => {
  const dispatch = {
    version: 1 as const,
    routedAt: 10,
    complexity: 'simple' as const,
    confidence: 0.8,
    agentReason: 'A IA identificou que a tarefa exige experiência com CSS.',
    modelReason: 'Selected an economical model.',
    routerModel: 'gpt-5.6-luna',
  };
  assert.deepEqual(
    readStoredConversations([{
      id: 'one',
      agentId: 'agent',
      title: 'Routed task',
      createdAt: 1,
      updatedAt: 2,
      dispatch,
    }]),
    [{ id: 'one', agentId: 'agent', title: 'Routed task', createdAt: 1, updatedAt: 2, dispatch }],
  );
});

void test('titleFromFirstMessage creates a compact single-line title', () => {
  assert.equal(titleFromFirstMessage('  Fix   the\nlogin flow  '), 'Fix the login flow');
  assert.equal(titleFromFirstMessage('x'.repeat(60)), `${'x'.repeat(47)}…`);
});

void test('sumTokenUsage aggregates conversations without double counting snapshots', () => {
  const conversations = readStoredConversations([
    {
      id: 'one',
      agentId: 'agent',
      title: 'One',
      createdAt: 1,
      updatedAt: 2,
      usage: { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningOutputTokens: 3, totalTokens: 15 },
    },
    {
      id: 'two',
      agentId: 'agent',
      title: 'Two',
      createdAt: 3,
      updatedAt: 4,
      usage: { inputTokens: 20, cachedInputTokens: 4, outputTokens: 8, reasoningOutputTokens: 5, totalTokens: 28 },
    },
  ]);

  assert.equal(sumTokenUsage(conversations)?.totalTokens, 43);
});
