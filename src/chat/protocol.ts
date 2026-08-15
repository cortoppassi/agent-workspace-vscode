export type JsonRpcId = number | string;

export interface JsonRpcMessage {
  readonly id?: JsonRpcId;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly code?: number;
    readonly message?: string;
  };
}

export interface ChatHistoryMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface TokenUsageBreakdown {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

export interface CodexReasoningEffort {
  readonly reasoningEffort: string;
  readonly description?: string;
}

export interface CodexModel {
  readonly model: string;
  readonly displayName: string;
  readonly defaultReasoningEffort?: string;
  readonly supportedReasoningEfforts: readonly CodexReasoningEffort[];
  readonly isDefault: boolean;
}

export interface CodexModelPage {
  readonly models: readonly CodexModel[];
  readonly nextCursor?: string;
}

export function parseJsonRpcLine(line: string): JsonRpcMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const id = typeof value.id === 'number' || typeof value.id === 'string' ? value.id : undefined;
  const method = typeof value.method === 'string' ? value.method : undefined;
  const error = isRecord(value.error)
    ? {
        code: typeof value.error.code === 'number' ? value.error.code : undefined,
        message: typeof value.error.message === 'string' ? value.error.message : undefined,
      }
    : undefined;
  return {
    ...(id !== undefined ? { id } : {}),
    ...(method ? { method } : {}),
    ...('params' in value ? { params: value.params } : {}),
    ...('result' in value ? { result: value.result } : {}),
    ...(error ? { error } : {}),
  };
}

export function extractChatHistory(result: unknown): ChatHistoryMessage[] {
  if (!isRecord(result) || !isRecord(result.thread) || !Array.isArray(result.thread.turns)) {
    return [];
  }

  const messages: ChatHistoryMessage[] = [];
  for (const turn of result.thread.turns) {
    if (!isRecord(turn) || !Array.isArray(turn.items)) {
      continue;
    }
    for (const item of turn.items) {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.type !== 'string') {
        continue;
      }
      if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text) {
        messages.push({ id: item.id, role: 'assistant', text: item.text });
      }
      if (item.type === 'userMessage' && Array.isArray(item.content)) {
        const text = item.content
          .filter((content): content is Record<string, unknown> => isRecord(content))
          .filter((content) => content.type === 'text' && typeof content.text === 'string')
          .map((content) => String(content.text))
          .join('\n');
        if (text) {
          messages.push({ id: item.id, role: 'user', text });
        }
      }
    }
  }
  return messages;
}

export function readRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function readString(value: unknown, key: string): string | undefined {
  const record = readRecord(value);
  const field = record?.[key];
  return typeof field === 'string' ? field : undefined;
}

export function readTokenUsageBreakdown(value: unknown): TokenUsageBreakdown | undefined {
  const record = readRecord(value);
  const inputTokens = readTokenCount(record, 'inputTokens');
  const cachedInputTokens = readTokenCount(record, 'cachedInputTokens');
  const outputTokens = readTokenCount(record, 'outputTokens');
  const reasoningOutputTokens = readTokenCount(record, 'reasoningOutputTokens');
  const totalTokens = readTokenCount(record, 'totalTokens');
  if (
    inputTokens === undefined ||
    cachedInputTokens === undefined ||
    outputTokens === undefined ||
    reasoningOutputTokens === undefined ||
    totalTokens === undefined
  ) {
    return undefined;
  }
  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens: readTokenCount(record, 'cacheWriteInputTokens') ?? 0,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  };
}

export function readCodexModelPage(value: unknown): CodexModelPage {
  const record = readRecord(value);
  const data = Array.isArray(record?.data) ? record.data : [];
  const models = data.flatMap((entry) => {
    const modelRecord = readRecord(entry);
    const model = readString(modelRecord, 'model') ?? readString(modelRecord, 'id');
    if (!model) {
      return [];
    }
    const defaultReasoningEffort = readString(modelRecord, 'defaultReasoningEffort');
    const efforts = Array.isArray(modelRecord?.supportedReasoningEfforts)
      ? modelRecord.supportedReasoningEfforts.flatMap((candidate) => {
          const effortRecord = readRecord(candidate);
          const reasoningEffort = readString(effortRecord, 'reasoningEffort');
          const description = readString(effortRecord, 'description');
          return reasoningEffort
            ? [{ reasoningEffort, ...(description ? { description } : {}) }]
            : [];
        })
      : [];
    return [{
      model,
      displayName: readString(modelRecord, 'displayName') ?? model,
      supportedReasoningEfforts: efforts,
      isDefault: modelRecord?.isDefault === true,
      ...(defaultReasoningEffort ? { defaultReasoningEffort } : {}),
    }];
  });
  const nextCursor = readString(record, 'nextCursor');
  return { models, ...(nextCursor ? { nextCursor } : {}) };
}

function readTokenCount(value: unknown, key: string): number | undefined {
  const record = readRecord(value);
  const field = record?.[key];
  return typeof field === 'number' && Number.isSafeInteger(field) && field >= 0 ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
