import assert from 'node:assert/strict';
import test from 'node:test';
import { extractChatHistory, parseJsonRpcLine, readTokenUsageBreakdown } from '../src/chat/protocol';

void test('parseJsonRpcLine recognizes responses and notifications', () => {
  assert.deepEqual(parseJsonRpcLine('{"id":1,"result":{"thread":{"id":"thread-1"}}}'), {
    id: 1,
    result: { thread: { id: 'thread-1' } },
  });
  assert.deepEqual(parseJsonRpcLine('{"method":"item/agentMessage/delta","params":{"delta":"Hi"}}'), {
    method: 'item/agentMessage/delta',
    params: { delta: 'Hi' },
  });
  assert.equal(parseJsonRpcLine('not-json'), undefined);
});

void test('parseJsonRpcLine preserves JSON-RPC errors', () => {
  assert.deepEqual(parseJsonRpcLine('{"id":2,"error":{"code":-1,"message":"failed"}}'), {
    id: 2,
    error: { code: -1, message: 'failed' },
  });
});

void test('extractChatHistory keeps only user and agent messages in order', () => {
  const history = extractChatHistory({
    thread: {
      turns: [
        {
          items: [
            {
              type: 'userMessage',
              id: 'user-1',
              content: [
                { type: 'text', text: 'First line' },
                { type: 'image', url: 'file.png' },
                { type: 'text', text: 'Second line' },
              ],
            },
            { type: 'commandExecution', id: 'command-1', command: 'npm test' },
            { type: 'agentMessage', id: 'agent-1', text: 'Done' },
          ],
        },
      ],
    },
  });

  assert.deepEqual(history, [
    { id: 'user-1', role: 'user', text: 'First line\nSecond line' },
    { id: 'agent-1', role: 'assistant', text: 'Done' },
  ]);
});

void test('extractChatHistory tolerates incomplete server payloads', () => {
  assert.deepEqual(extractChatHistory(undefined), []);
  assert.deepEqual(extractChatHistory({ thread: { turns: [{ items: [null, { type: 'agentMessage' }] }] } }), []);
});

void test('readTokenUsageBreakdown validates and normalizes token counts', () => {
  assert.deepEqual(
    readTokenUsageBreakdown({
      inputTokens: 1200,
      cachedInputTokens: 300,
      outputTokens: 400,
      reasoningOutputTokens: 250,
      totalTokens: 1600,
    }),
    {
      inputTokens: 1200,
      cachedInputTokens: 300,
      cacheWriteInputTokens: 0,
      outputTokens: 400,
      reasoningOutputTokens: 250,
      totalTokens: 1600,
    },
  );
  assert.equal(readTokenUsageBreakdown({ inputTokens: -1 }), undefined);
  assert.equal(readTokenUsageBreakdown({}), undefined);
});
