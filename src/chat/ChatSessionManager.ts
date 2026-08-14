import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { AgentManager } from '../agents/AgentManager';
import type { AgentConfig } from '../config/types';
import { UserFacingError } from '../config/validation';
import { CodexAppServerClient } from './CodexAppServerClient';
import {
  DEFAULT_CONVERSATION_TITLE,
  migrateLegacyConversations,
  readStoredConversations,
  sumTokenUsage,
  titleFromFirstMessage,
  type ConversationConfig,
} from './conversations';
import {
  extractChatHistory,
  readRecord,
  readString,
  readTokenUsageBreakdown,
  type ChatHistoryMessage,
  type JsonRpcMessage,
  type TokenUsageBreakdown,
} from './protocol';

const CONVERSATIONS_KEY = 'agentWorkspace.chat.conversations';
const ACTIVE_CONVERSATIONS_KEY = 'agentWorkspace.chat.activeConversations';
const LEGACY_THREAD_IDS_KEY = 'agentWorkspace.chat.threadIds';
const LEGACY_TOKEN_USAGE_KEY = 'agentWorkspace.chat.tokenUsage';

export interface ChatMessage extends ChatHistoryMessage {
  readonly streaming?: boolean;
}

export interface ChatState {
  readonly messages: readonly ChatMessage[];
  readonly ready: boolean;
  readonly busy: boolean;
  readonly usage?: TokenUsageBreakdown;
  readonly error?: string;
}

interface MutableChatSession {
  threadId?: string;
  activeTurnId?: string;
  loading?: Promise<void>;
  messages: ChatMessage[];
  busy: boolean;
  error?: string;
  loaded: boolean;
}

interface ThreadResponse {
  readonly thread?: {
    readonly id?: string;
  };
}

interface TurnResponse {
  readonly turn?: {
    readonly id?: string;
  };
}

export class ChatSessionManager implements vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<string>();
  private readonly conversationsChangedEmitter = new vscode.EventEmitter<string>();
  private readonly sessions = new Map<string, MutableChatSession>();
  private readonly client: CodexAppServerClient;
  private readonly notificationSubscription: { dispose(): void };
  private conversations: ConversationConfig[];
  private activeConversationIds: Record<string, string>;

  public readonly onDidChange = this.changedEmitter.event;
  public readonly onDidChangeConversations = this.conversationsChangedEmitter.event;

  public constructor(
    private readonly agents: AgentManager,
    private readonly workspaceState: vscode.Memento,
    private readonly output: vscode.OutputChannel,
  ) {
    const storedConversations = workspaceState.get<unknown>(CONVERSATIONS_KEY);
    this.conversations = readStoredConversations(storedConversations);
    this.activeConversationIds = readStoredStringMap(workspaceState.get<unknown>(ACTIVE_CONVERSATIONS_KEY));
    if (storedConversations === undefined) {
      this.conversations = migrateLegacyConversations(
        workspaceState.get<unknown>(LEGACY_THREAD_IDS_KEY),
        workspaceState.get<unknown>(LEGACY_TOKEN_USAGE_KEY),
        Date.now(),
        randomUUID,
      );
      for (const conversation of this.conversations) {
        this.activeConversationIds[conversation.agentId] = conversation.id;
      }
      void this.persistConversations();
      void this.persistActiveConversations();
      void workspaceState.update(LEGACY_THREAD_IDS_KEY, undefined);
      void workspaceState.update(LEGACY_TOKEN_USAGE_KEY, undefined);
    }
    this.client = new CodexAppServerClient(
      (message) => output.appendLine(message),
      (message) => this.handleServerRequest(message),
    );
    this.notificationSubscription = this.client.onNotification((message) => this.handleNotification(message));
  }

  public listConversations(agentId: string): readonly ConversationConfig[] {
    return this.conversations
      .filter((conversation) => conversation.agentId === agentId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  public getActiveConversation(agentId: string): ConversationConfig | undefined {
    const activeId = this.activeConversationIds[agentId];
    return this.conversations.find((conversation) => conversation.agentId === agentId && conversation.id === activeId)
      ?? this.listConversations(agentId)[0];
  }

  public getConversation(agentId: string, conversationId: string): ConversationConfig | undefined {
    return this.conversations.find(
      (conversation) => conversation.agentId === agentId && conversation.id === conversationId,
    );
  }

  public getState(conversationId: string): ChatState {
    const session = this.session(conversationId);
    const conversation = this.conversations.find((candidate) => candidate.id === conversationId);
    return {
      messages: [...session.messages],
      ready: session.loaded,
      busy: session.busy,
      ...(conversation?.usage ? { usage: conversation.usage } : {}),
      ...(session.error ? { error: session.error } : {}),
    };
  }

  public getAgentTokenUsage(agentId: string): TokenUsageBreakdown | undefined {
    return sumTokenUsage(this.listConversations(agentId));
  }

  public isBusy(conversationId: string): boolean {
    return this.sessions.get(conversationId)?.busy ?? false;
  }

  public createConversation(agent: AgentConfig): ConversationConfig {
    if (agent.provider !== 'codex') {
      throw new UserFacingError('Conversations are currently available only for Codex agents.');
    }
    const now = Date.now();
    const conversation: ConversationConfig = {
      id: randomUUID(),
      agentId: agent.id,
      title: DEFAULT_CONVERSATION_TITLE,
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.push(conversation);
    this.activeConversationIds[agent.id] = conversation.id;
    void this.persistConversations();
    void this.persistActiveConversations();
    this.conversationsChangedEmitter.fire(agent.id);
    return conversation;
  }

  public selectConversation(agentId: string, conversationId: string): ConversationConfig {
    const conversation = this.requireConversation(agentId, conversationId);
    this.activeConversationIds[agentId] = conversationId;
    void this.persistActiveConversations();
    this.conversationsChangedEmitter.fire(agentId);
    return conversation;
  }

  public renameConversation(agentId: string, conversationId: string, title: string): void {
    const conversation = this.requireConversation(agentId, conversationId);
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      throw new UserFacingError('Conversation title cannot be empty.');
    }
    const updated = { ...conversation, title: normalizedTitle, updatedAt: Date.now() };
    this.replaceConversation(updated);
    if (updated.threadId) {
      this.syncThreadName(updated.threadId, normalizedTitle);
    }
  }

  public async deleteConversation(agentId: string, conversationId: string): Promise<void> {
    const conversation = this.requireConversation(agentId, conversationId);
    if (this.isBusy(conversationId)) {
      throw new UserFacingError('Stop the active response before removing this conversation.');
    }
    if (conversation.threadId) {
      await this.client.request('thread/archive', { threadId: conversation.threadId });
    }
    this.sessions.delete(conversationId);
    this.conversations = this.conversations.filter((candidate) => candidate.id !== conversationId);
    if (this.activeConversationIds[agentId] === conversationId) {
      const next = this.listConversations(agentId)[0];
      if (next) {
        this.activeConversationIds[agentId] = next.id;
      } else {
        delete this.activeConversationIds[agentId];
      }
    }
    await Promise.all([this.persistConversations(), this.persistActiveConversations()]);
    this.conversationsChangedEmitter.fire(agentId);
  }

  public resetAgentSessions(agentId: string): void {
    for (const conversation of this.listConversations(agentId)) {
      this.sessions.delete(conversation.id);
      this.changedEmitter.fire(conversation.id);
    }
  }

  public forgetAgent(agentId: string): void {
    for (const conversation of this.listConversations(agentId)) {
      this.sessions.delete(conversation.id);
    }
    this.conversations = this.conversations.filter((conversation) => conversation.agentId !== agentId);
    delete this.activeConversationIds[agentId];
    void this.persistConversations();
    void this.persistActiveConversations();
    this.conversationsChangedEmitter.fire(agentId);
  }

  public async prepare(agent: AgentConfig, conversationId: string): Promise<void> {
    if (agent.provider !== 'codex') {
      return;
    }
    this.requireConversation(agent.id, conversationId);
    const session = this.session(conversationId);
    if (session.loaded) {
      return;
    }
    if (session.loading) {
      await session.loading;
      return;
    }
    session.error = undefined;
    this.changedEmitter.fire(conversationId);
    session.loading = this.ensureThread(agent, conversationId, session)
      .catch((error: unknown) => {
        session.error = readableError(error);
        this.changedEmitter.fire(conversationId);
      })
      .finally(() => {
        session.loading = undefined;
      });
    await session.loading;
  }

  public async send(agent: AgentConfig, conversationId: string, text: string): Promise<void> {
    const prompt = text.trim();
    if (!prompt) {
      return;
    }
    if (agent.provider !== 'codex') {
      throw new UserFacingError('Embedded chat is currently available only for Codex agents.');
    }

    const session = this.session(conversationId);
    if (session.busy) {
      throw new UserFacingError(`Agent "${agent.name}" is still working. Wait or stop the current response.`);
    }
    await this.ensureThread(agent, conversationId, session);
    const conversation = this.requireConversation(agent.id, conversationId);
    if (!session.threadId) {
      throw new UserFacingError(`Could not start a chat for "${agent.name}".`);
    }

    const userMessage: ChatMessage = { id: randomUUID(), role: 'user', text: prompt };
    const shouldSetTitle = conversation.title === DEFAULT_CONVERSATION_TITLE && session.messages.length === 0;
    session.messages.push(userMessage);
    session.busy = true;
    session.error = undefined;
    const updatedConversation = {
      ...conversation,
      title: shouldSetTitle ? titleFromFirstMessage(prompt) : conversation.title,
      updatedAt: Date.now(),
    };
    this.replaceConversation(updatedConversation);
    if (shouldSetTitle && updatedConversation.threadId) {
      this.syncThreadName(updatedConversation.threadId, updatedConversation.title);
    }
    this.changedEmitter.fire(conversationId);
    try {
      const response = await this.client.request<TurnResponse>('turn/start', {
        threadId: session.threadId,
        clientUserMessageId: userMessage.id,
        input: [{ type: 'text', text: prompt, text_elements: [] }],
      });
      const turnId = response.turn?.id;
      if (!turnId) {
        throw new Error('Codex did not return a turn id.');
      }
      session.activeTurnId = turnId;
    } catch (error: unknown) {
      session.busy = false;
      session.error = readableError(error);
      this.changedEmitter.fire(conversationId);
    }
  }

  public async interrupt(conversationId: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session?.threadId || !session.activeTurnId) {
      return;
    }
    await this.client.request('turn/interrupt', {
      threadId: session.threadId,
      turnId: session.activeTurnId,
    });
  }

  public dispose(): void {
    this.notificationSubscription.dispose();
    this.client.dispose();
    this.changedEmitter.dispose();
    this.conversationsChangedEmitter.dispose();
  }

  private async ensureThread(
    agent: AgentConfig,
    conversationId: string,
    session: MutableChatSession,
  ): Promise<void> {
    if (session.loaded && session.threadId) {
      return;
    }
    await this.agents.validateFiles(agent);
    const instructions = await vscode.workspace.fs.readFile(this.agents.instructionsUri(agent));
    const developerInstructions = new TextDecoder().decode(instructions);
    const cwd = this.agents.workingDirectoryUri(agent).fsPath;
    let conversation = this.requireConversation(agent.id, conversationId);

    if (conversation.threadId) {
      try {
        const resumed = await this.client.request<ThreadResponse>('thread/resume', {
          threadId: conversation.threadId,
          cwd,
          approvalPolicy: 'on-request',
          sandbox: 'workspace-write',
          developerInstructions,
        });
        const threadId = resumed.thread?.id;
        if (threadId) {
          session.threadId = threadId;
          session.messages = extractChatHistory(
            await this.client.request('thread/read', { threadId, includeTurns: true }),
          );
          session.loaded = true;
          this.changedEmitter.fire(conversationId);
          return;
        }
      } catch (error: unknown) {
        this.output.appendLine(`[chat] Could not resume ${conversation.threadId}: ${readableError(error)}`);
      }
    }

    const started = await this.client.request<ThreadResponse>('thread/start', {
      cwd,
      approvalPolicy: 'on-request',
      sandbox: 'workspace-write',
      developerInstructions,
      serviceName: 'agent_workspace',
    });
    const threadId = started.thread?.id;
    if (!threadId) {
      throw new Error('Codex did not return a thread id.');
    }
    session.threadId = threadId;
    session.messages = [];
    session.loaded = true;
    conversation = { ...conversation, threadId, usage: undefined, updatedAt: Date.now() };
    this.replaceConversation(conversation);
    if (conversation.title !== DEFAULT_CONVERSATION_TITLE) {
      this.syncThreadName(threadId, conversation.title);
    }
    this.changedEmitter.fire(conversationId);
  }

  private handleNotification(message: JsonRpcMessage): void {
    const params = readRecord(message.params) ?? {};
    const threadId = readString(params, 'threadId');
    if (!threadId) {
      return;
    }
    const entry = [...this.sessions.entries()].find(([, session]) => session.threadId === threadId);
    if (!entry) {
      return;
    }
    const [conversationId, session] = entry;
    const conversation = this.conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) {
      return;
    }

    if (message.method === 'thread/tokenUsage/updated') {
      const usage = readTokenUsageBreakdown(readRecord(params.tokenUsage)?.total);
      if (usage) {
        this.replaceConversation({ ...conversation, usage, updatedAt: Date.now() });
      }
    }

    if (message.method === 'item/agentMessage/delta') {
      const itemId = readString(params, 'itemId');
      const delta = readString(params, 'delta');
      if (itemId && delta) {
        const existingIndex = session.messages.findIndex((candidate) => candidate.id === itemId);
        if (existingIndex >= 0) {
          const existing = session.messages[existingIndex];
          if (existing) {
            session.messages[existingIndex] = { ...existing, text: `${existing.text}${delta}`, streaming: true };
          }
        } else {
          session.messages.push({ id: itemId, role: 'assistant', text: delta, streaming: true });
        }
      }
    }

    if (message.method === 'item/completed') {
      const item = readRecord(params.item);
      if (item?.type === 'agentMessage' && typeof item.id === 'string' && typeof item.text === 'string') {
        const existingIndex = session.messages.findIndex((candidate) => candidate.id === item.id);
        const completed: ChatMessage = { id: item.id, role: 'assistant', text: item.text };
        if (existingIndex >= 0) {
          session.messages[existingIndex] = completed;
        } else {
          session.messages.push(completed);
        }
      }
    }

    if (message.method === 'turn/completed') {
      const turn = readRecord(params.turn);
      session.busy = false;
      session.activeTurnId = undefined;
      if (turn?.status === 'failed') {
        const error = readRecord(turn.error);
        session.error = readString(error, 'message') ?? 'Codex could not complete the response.';
      }
      session.messages = session.messages.map((candidate) =>
        candidate.streaming ? { id: candidate.id, role: candidate.role, text: candidate.text } : candidate,
      );
    }

    if (message.method === 'error') {
      const error = readRecord(params.error);
      session.error = readString(error, 'message') ?? 'Codex reported an error.';
      if (params.willRetry !== true) {
        session.busy = false;
      }
    }
    this.changedEmitter.fire(conversationId);
  }

  private async handleServerRequest(message: JsonRpcMessage): Promise<unknown> {
    const params = readRecord(message.params) ?? {};
    const threadId = readString(params, 'threadId');
    const entry = [...this.sessions.entries()].find(([, session]) => session.threadId === threadId);
    const conversation = entry
      ? this.conversations.find((candidate) => candidate.id === entry[0])
      : undefined;
    const agentName = conversation ? this.agents.require(conversation.agentId).name : 'Codex agent';

    if (message.method === 'item/commandExecution/requestApproval') {
      const command = readString(params, 'command') ?? 'Run a command';
      const decision = await vscode.window.showWarningMessage(
        `${agentName} wants to run:\n\n${command}`,
        { modal: true },
        'Allow Once',
        'Allow for Session',
        'Decline',
      );
      return { decision: decision === 'Allow Once' ? 'accept' : decision === 'Allow for Session' ? 'acceptForSession' : 'decline' };
    }

    if (message.method === 'item/fileChange/requestApproval') {
      const reason = readString(params, 'reason') ?? 'The agent wants to change files in the workspace.';
      const decision = await vscode.window.showWarningMessage(
        `${agentName}: ${reason}`,
        { modal: true },
        'Allow Once',
        'Allow for Session',
        'Decline',
      );
      return { decision: decision === 'Allow Once' ? 'accept' : decision === 'Allow for Session' ? 'acceptForSession' : 'decline' };
    }

    throw new Error(`Unsupported Codex request: ${message.method ?? 'unknown'}.`);
  }

  private session(conversationId: string): MutableChatSession {
    let session = this.sessions.get(conversationId);
    if (!session) {
      session = { messages: [], busy: false, loaded: false };
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  private requireConversation(agentId: string, conversationId: string): ConversationConfig {
    const conversation = this.getConversation(agentId, conversationId);
    if (!conversation) {
      throw new UserFacingError('The selected conversation no longer exists.');
    }
    return conversation;
  }

  private replaceConversation(conversation: ConversationConfig): void {
    const index = this.conversations.findIndex((candidate) => candidate.id === conversation.id);
    if (index < 0) {
      return;
    }
    const next = [...this.conversations];
    next[index] = conversation;
    this.conversations = next;
    void this.persistConversations();
    this.conversationsChangedEmitter.fire(conversation.agentId);
  }

  private syncThreadName(threadId: string, name: string): void {
    void this.client.request('thread/name/set', { threadId, name }).catch((error: unknown) => {
      this.output.appendLine(`[chat] Could not set thread name: ${readableError(error)}`);
    });
  }

  private persistConversations(): Thenable<void> {
    return this.workspaceState.update(CONVERSATIONS_KEY, this.conversations);
  }

  private persistActiveConversations(): Thenable<void> {
    return this.workspaceState.update(ACTIVE_CONVERSATIONS_KEY, { ...this.activeConversationIds });
  }
}

function readStoredStringMap(value: unknown): Record<string, string> {
  const record = readRecord(value);
  if (!record) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
