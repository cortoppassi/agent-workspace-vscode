import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { AgentManager } from '../agents/AgentManager';
import type { ChatSessionManager } from '../chat/ChatSessionManager';
import type { AgentConfig } from '../config/types';
import { UserFacingError } from '../config/validation';

interface WebviewMessage {
  readonly type: 'send' | 'interrupt';
  readonly text?: string;
}

export class ChatWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'agentWorkspace.chat';

  private readonly subscriptions: vscode.Disposable[];
  private view: vscode.WebviewView | undefined;
  private selectedAgentId: string | undefined;
  private selectedConversationId: string | undefined;

  public constructor(
    private readonly agents: AgentManager,
    private readonly chats: ChatSessionManager,
  ) {
    this.subscriptions = [
      chats.onDidChange((conversationId) => {
        if (conversationId === this.selectedConversationId) {
          this.update();
        }
      }),
      chats.onDidChangeConversations((agentId) => {
        if (agentId === this.selectedAgentId) {
          if (this.selectedConversationId && !chats.getConversation(agentId, this.selectedConversationId)) {
            this.selectedConversationId = chats.getActiveConversation(agentId)?.id;
          }
          this.update();
        }
      }),
      agents.onDidChange(() => {
        if (this.selectedAgentId && !agents.list().some((agent) => agent.id === this.selectedAgentId)) {
          chats.forgetAgent(this.selectedAgentId);
          this.selectedAgentId = undefined;
          this.selectedConversationId = undefined;
        }
        this.update();
      }),
    ];
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = renderHtml();
    this.subscriptions.push(
      view.webview.onDidReceiveMessage((message: unknown) => this.receive(message)),
      view.onDidDispose(() => {
        this.view = undefined;
      }),
    );
    this.update();
  }

  public async selectAgent(agent: AgentConfig): Promise<void> {
    const conversation = this.chats.getActiveConversation(agent.id) ?? this.chats.createConversation(agent);
    await this.selectConversation(agent, conversation.id);
  }

  public async selectConversation(agent: AgentConfig, conversationId: string): Promise<void> {
    const conversation = this.chats.selectConversation(agent.id, conversationId);
    this.selectedAgentId = agent.id;
    this.selectedConversationId = conversation.id;
    this.view?.show(true);
    await vscode.commands.executeCommand(`${ChatWebviewProvider.viewType}.focus`);
    this.update();
    await this.chats.prepare(agent, conversation.id);
  }

  public async refreshSelectedAgent(agent: AgentConfig): Promise<void> {
    if (this.selectedAgentId !== agent.id || !this.selectedConversationId) {
      return;
    }
    await this.selectConversation(agent, this.selectedConversationId);
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private receive(value: unknown): void {
    const message = parseWebviewMessage(value);
    const agent = this.selectedAgent();
    const conversationId = this.selectedConversationId;
    if (!message || !agent || !conversationId) {
      return;
    }
    if (message.type === 'send' && message.text) {
      void this.chats.send(agent, conversationId, message.text).catch((error: unknown) =>
        showChatError(error),
      );
    }
    if (message.type === 'interrupt') {
      void this.chats.interrupt(conversationId).catch((error: unknown) =>
        showChatError(error),
      );
    }
  }

  private update(): void {
    if (!this.view) {
      return;
    }
    const agent = this.selectedAgent();
    const conversation = agent && this.selectedConversationId
      ? this.chats.getConversation(agent.id, this.selectedConversationId)
      : undefined;
    this.view.title = agent && conversation ? `${agent.name} · ${conversation.title}` : 'Chat';
    void this.view.webview.postMessage({
      type: 'state',
      agent: agent ? { id: agent.id, name: agent.name, provider: agent.provider } : undefined,
      conversation: conversation ? { id: conversation.id, title: conversation.title } : undefined,
      state: conversation ? this.chats.getState(conversation.id) : undefined,
    });
  }

  private selectedAgent(): AgentConfig | undefined {
    return this.agents.list().find((agent) => agent.id === this.selectedAgentId);
  }
}

export class EmptyChatWebviewProvider implements vscode.WebviewViewProvider {
  public resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.html = '<p style="padding: 0 12px; color: var(--vscode-descriptionForeground)">Open a folder to use agent chat.</p>';
  }
}

function parseWebviewMessage(value: unknown): WebviewMessage | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return undefined;
  }
  const type = value.type;
  if (type !== 'send' && type !== 'interrupt') {
    return undefined;
  }
  const text = 'text' in value && typeof value.text === 'string' ? value.text : undefined;
  return { type, ...(text ? { text } : {}) };
}

function showChatError(error: unknown): Thenable<string | undefined> {
  const message =
    error instanceof UserFacingError ? error.message : 'Agent Workspace could not complete the chat action.';
  return vscode.window.showErrorMessage(message);
}

function renderHtml(): string {
  const nonce = randomBytes(16).toString('base64');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { box-sizing: border-box; }
    body { margin: 0; padding: 0; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    #app { display: flex; flex-direction: column; height: 100vh; min-height: 180px; }
    #empty { margin: auto; padding: 20px; color: var(--vscode-descriptionForeground); text-align: center; line-height: 1.5; }
    #chat { display: none; flex: 1; min-height: 0; flex-direction: column; }
    #messages { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 10px 6px; }
    #welcome { display: grid; height: 100%; min-height: 140px; place-content: center; padding: 20px; color: var(--vscode-descriptionForeground); text-align: center; line-height: 1.5; }
    #welcome strong { margin-bottom: 4px; color: var(--vscode-foreground); font-size: 1.05em; }
    .message { margin: 0 0 10px; padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
    .user { margin-left: 18px; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); }
    .assistant { margin-right: 10px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); }
    .role { display: block; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 0.85em; font-weight: 600; }
    #usage { display: none; grid-template-columns: auto 1fr; gap: 2px 10px; padding: 7px 10px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-widget-border); font-size: 0.9em; }
    #usage-total { color: var(--vscode-foreground); font-weight: 600; text-align: right; }
    #usage-detail { grid-column: 1 / -1; overflow-wrap: anywhere; }
    #error { display: none; margin: 0 10px 8px; padding: 8px 10px; color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 4px; line-height: 1.4; }
    #composer { padding: 8px 10px 10px; border-top: 1px solid var(--vscode-widget-border); background: var(--vscode-sideBar-background); }
    textarea { display: block; width: 100%; min-height: 50px; max-height: 140px; resize: vertical; padding: 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 4px; font: inherit; }
    textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    #actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 7px; }
    button { padding: 4px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 2px; font: inherit; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:disabled, textarea:disabled { opacity: 0.6; cursor: default; }
    #working { display: none; margin-right: auto; align-self: center; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <main id="app">
    <div id="empty">Select a Codex agent above to open its chat.</div>
    <section id="chat">
      <div id="messages" aria-live="polite"></div>
      <div id="usage" title="Token usage for this agent's current chat">
        <span>Usage</span>
        <span id="usage-total"></span>
        <span id="usage-detail"></span>
      </div>
      <div id="error" role="alert"></div>
      <form id="composer">
        <textarea id="input" aria-label="Message" placeholder="Send a task to this agent..."></textarea>
        <div id="actions">
          <span id="working">Codex is working...</span>
          <button id="stop" class="secondary" type="button">Stop</button>
          <button id="send" type="submit">Send</button>
        </div>
      </form>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const empty = document.getElementById('empty');
    const chat = document.getElementById('chat');
    const messages = document.getElementById('messages');
    const error = document.getElementById('error');
    const usage = document.getElementById('usage');
    const usageTotal = document.getElementById('usage-total');
    const usageDetail = document.getElementById('usage-detail');
    const form = document.getElementById('composer');
    const input = document.getElementById('input');
    const send = document.getElementById('send');
    const stop = document.getElementById('stop');
    const working = document.getElementById('working');
    let currentConversationId;

    window.addEventListener('message', (event) => {
      const payload = event.data;
      if (!payload || payload.type !== 'state') return;
      const agent = payload.agent;
      const conversation = payload.conversation;
      const state = payload.state;
      if (!agent || !conversation || !state) {
        empty.style.display = 'block';
        chat.style.display = 'none';
        return;
      }
      if (currentConversationId !== conversation.id) {
        currentConversationId = conversation.id;
        input.value = '';
      }
      empty.style.display = 'none';
      chat.style.display = 'flex';
      messages.replaceChildren();
      for (const message of state.messages) {
        const item = document.createElement('article');
        item.className = 'message ' + message.role;
        const role = document.createElement('span');
        role.className = 'role';
        role.textContent = message.role === 'user' ? 'You' : agent.name;
        const text = document.createElement('span');
        text.textContent = message.text;
        item.append(role, text);
        messages.append(item);
      }
      error.textContent = state.error || '';
      error.style.display = state.error ? 'block' : 'none';
      if (state.usage) {
        usage.style.display = 'grid';
        usageTotal.textContent = formatTokens(state.usage.totalTokens) + ' tokens';
        const usageParts = [
          formatTokens(state.usage.inputTokens) + ' input',
          formatTokens(state.usage.outputTokens) + ' output',
          formatTokens(state.usage.cachedInputTokens) + ' cached',
          formatTokens(state.usage.reasoningOutputTokens) + ' reasoning',
        ];
        if (state.usage.cacheWriteInputTokens > 0) {
          usageParts.push(formatTokens(state.usage.cacheWriteInputTokens) + ' cache write');
        }
        usageDetail.textContent = usageParts.join(' · ');
        usage.title = [
          'Total: ' + state.usage.totalTokens.toLocaleString(),
          'Input: ' + state.usage.inputTokens.toLocaleString(),
          'Output: ' + state.usage.outputTokens.toLocaleString(),
          'Cached input: ' + state.usage.cachedInputTokens.toLocaleString(),
          'Cache write input: ' + state.usage.cacheWriteInputTokens.toLocaleString(),
          'Reasoning output: ' + state.usage.reasoningOutputTokens.toLocaleString(),
        ].join(' | ');
      } else {
        usage.style.display = 'none';
      }
      const supported = agent.provider === 'codex';
      if (state.messages.length === 0) {
        const welcome = document.createElement('div');
        welcome.id = 'welcome';
        const title = document.createElement('strong');
        title.textContent = supported
          ? state.ready ? conversation.title : state.error ? 'Could not start chat' : 'Starting conversation'
          : 'Chat unavailable';
        const detail = document.createElement('span');
        detail.textContent = supported
          ? state.ready ? 'Send a message to start working.' : state.error ? 'Fix the error below, then select the agent again.' : 'Starting Codex…'
          : 'Embedded chat currently supports Codex agents only.';
        welcome.append(title, detail);
        messages.append(welcome);
      }
      input.disabled = !supported || !state.ready || state.busy;
      send.disabled = !supported || !state.ready || state.busy;
      stop.disabled = !state.busy;
      stop.style.display = state.busy ? 'block' : 'none';
      working.textContent = state.busy ? 'Codex is working…' : !state.ready && !state.error && supported ? 'Starting Codex…' : '';
      working.style.display = working.textContent ? 'inline' : 'none';
      input.placeholder = supported ? 'Send a task to this agent...' : 'Embedded chat currently supports Codex agents only.';
      messages.scrollTop = messages.scrollHeight;
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      vscode.postMessage({ type: 'send', text });
      input.value = '';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    stop.addEventListener('click', () => vscode.postMessage({ type: 'interrupt' }));

    function formatTokens(value) {
      return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    }
  </script>
</body>
</html>`;
}
