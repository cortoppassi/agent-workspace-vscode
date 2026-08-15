import { readRecord, readString, readTokenUsageBreakdown, type TokenUsageBreakdown } from './protocol';

export const DEFAULT_CONVERSATION_TITLE = 'New conversation';

export interface ConversationConfig {
  readonly id: string;
  readonly agentId: string;
  readonly title: string;
  readonly threadId?: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly usage?: TokenUsageBreakdown;
}

export function readStoredConversations(value: unknown): ConversationConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const record = readRecord(entry);
    const id = readString(record, 'id');
    const agentId = readString(record, 'agentId');
    const title = readString(record, 'title');
    const createdAt = readTimestamp(record?.createdAt);
    const updatedAt = readTimestamp(record?.updatedAt);
    if (!id || !agentId || !title?.trim() || createdAt === undefined || updatedAt === undefined) {
      return [];
    }
    const threadId = readString(record, 'threadId');
    const model = readString(record, 'model');
    const reasoningEffort = readString(record, 'reasoningEffort');
    const usage = readTokenUsageBreakdown(record?.usage);
    return [{
      id,
      agentId,
      title,
      createdAt,
      updatedAt,
      ...(threadId ? { threadId } : {}),
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(usage ? { usage } : {}),
    }];
  });
}

export function migrateLegacyConversations(
  threadIdsValue: unknown,
  tokenUsageValue: unknown,
  now: number,
  createId: () => string,
): ConversationConfig[] {
  const threadIds = readRecord(threadIdsValue) ?? {};
  const tokenUsage = readRecord(tokenUsageValue) ?? {};
  return Object.entries(threadIds).flatMap(([agentId, threadId]) => {
    if (typeof threadId !== 'string' || !threadId) {
      return [];
    }
    const usage = readTokenUsageBreakdown(tokenUsage[agentId]);
    return [{
      id: createId(),
      agentId,
      title: 'Main conversation',
      threadId,
      createdAt: now,
      updatedAt: now,
      ...(usage ? { usage } : {}),
    }];
  });
}

export function titleFromFirstMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length <= 48 ? normalized : `${normalized.slice(0, 47).trimEnd()}…`;
}

export function sumTokenUsage(conversations: readonly ConversationConfig[]): TokenUsageBreakdown | undefined {
  const usages = conversations.flatMap((conversation) => (conversation.usage ? [conversation.usage] : []));
  if (usages.length === 0) {
    return undefined;
  }
  return usages.reduce<TokenUsageBreakdown>(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
      cacheWriteInputTokens: total.cacheWriteInputTokens + usage.cacheWriteInputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      reasoningOutputTokens: total.reasoningOutputTokens + usage.reasoningOutputTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  );
}

function readTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
