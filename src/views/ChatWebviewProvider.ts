import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { AgentManager } from '../agents/AgentManager';
import type { ChatSessionManager } from '../chat/ChatSessionManager';
import type { AgentConfig } from '../config/types';
import { UserFacingError } from '../config/validation';
import { createDispatchRecord, recommendRoutes } from '../routing/TaskRouter';

interface WebviewMessage {
  readonly type: 'send' | 'interrupt' | 'selectModel' | 'economyDispatch';
  readonly text?: string;
  readonly model?: string;
  readonly effort?: string;
}

export class ChatWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'agentWorkspace.chat';

  private readonly subscriptions: vscode.Disposable[];
  private view: vscode.WebviewView | undefined;
  private selectedAgentId: string | undefined;
  private selectedConversationId: string | undefined;
  private economyModeActive = false;
  private economyDispatchBusy = false;

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
      chats.onDidChangeModels(() => this.update()),
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
    this.economyModeActive = false;
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

  public async openEconomyMode(): Promise<void> {
    this.selectedAgentId = undefined;
    this.selectedConversationId = undefined;
    this.economyModeActive = true;
    this.view?.show(true);
    await vscode.commands.executeCommand(`${ChatWebviewProvider.viewType}.focus`);
    this.update();
  }

  public dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private receive(value: unknown): void {
    const message = parseWebviewMessage(value);
    if (!message) {
      return;
    }
    if (message.type === 'economyDispatch' && message.text) {
      if (!this.economyModeActive || this.economyDispatchBusy) {
        return;
      }
      this.economyDispatchBusy = true;
      this.update();
      void this.dispatchEconomically(message.text)
        .catch((error: unknown) => showChatError(error))
        .finally(() => {
          this.economyDispatchBusy = false;
          this.update();
        });
      return;
    }
    const agent = this.selectedAgent();
    const conversationId = this.selectedConversationId;
    if (!agent || !conversationId) {
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
    if (message.type === 'selectModel' && message.model) {
      void this.chats.setAgentModel(agent.id, message.model, message.effort).catch((error: unknown) =>
        showChatError(error),
      );
    }
  }

  private async dispatchEconomically(task: string): Promise<void> {
    const eligibleAgents = this.agents.list().filter((agent) => agent.provider === 'codex');
    if (eligibleAgents.length === 0) {
      throw new UserFacingError('O Modo Economia precisa de pelo menos um agente Codex.');
    }
    const [models, profiles] = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Modo Economia: analisando a melhor rota' },
      async () => Promise.all([
        this.chats.getAvailableModels(),
        Promise.all(eligibleAgents.map(async (agent) => ({
          agent,
          instructions: await this.agents.readInstructions(agent),
        }))),
      ]),
    );
    const route = recommendRoutes(task, profiles, models)[0];
    if (!route) {
      throw new UserFacingError('O Modo Economia não encontrou um agente disponível.');
    }
    const modelName = route.model?.displayName ?? route.agent.model ?? 'seleção automática do Codex';
    const effort = route.reasoningEffort ? ` · reasoning ${route.reasoningEffort}` : '';
    const decision = await vscode.window.showInformationMessage(
      `Modo Economia escolheu ${route.agent.name} — ${modelName}${effort}`,
      {
        modal: true,
        detail: `${route.agentReason}\n\n${route.modelReason}\n\nConfiança: ${Math.round(route.confidence * 100)}%.`,
      },
      'Executar',
    );
    if (decision !== 'Executar') {
      return;
    }
    if (route.model && route.agent.model !== route.model.model) {
      await this.chats.setAgentModel(route.agent.id, route.model.model, route.reasoningEffort);
    }
    const agent = this.agents.require(route.agent.id);
    const conversation = this.chats.createConversation(agent);
    this.chats.recordDispatch(agent.id, conversation.id, createDispatchRecord(route, Date.now()));
    await this.selectConversation(agent, conversation.id);
    await this.chats.send(agent, conversation.id, task);
  }

  private update(): void {
    if (!this.view) {
      return;
    }
    const agent = this.selectedAgent();
    const conversation = agent && this.selectedConversationId
      ? this.chats.getConversation(agent.id, this.selectedConversationId)
      : undefined;
    this.view.title = this.economyModeActive
      ? 'Modo Economia'
      : agent && conversation ? `${agent.name} · ${conversation.title}` : 'Chat';
    void this.view.webview.postMessage({
      type: 'state',
      mode: this.economyModeActive ? 'economy' : 'chat',
      economyBusy: this.economyDispatchBusy,
      agent: agent ? { id: agent.id, name: agent.name, provider: agent.provider } : undefined,
      conversation: conversation
        ? { id: conversation.id, title: conversation.title, ...(conversation.dispatch ? { dispatch: conversation.dispatch } : {}) }
        : undefined,
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
  if (type !== 'send' && type !== 'interrupt' && type !== 'selectModel' && type !== 'economyDispatch') {
    return undefined;
  }
  const text = 'text' in value && typeof value.text === 'string' ? value.text : undefined;
  const model = 'model' in value && typeof value.model === 'string' ? value.model : undefined;
  const effort = 'effort' in value && typeof value.effort === 'string' ? value.effort : undefined;
  return {
    type,
    ...(text ? { text } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  };
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
    #settings { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; padding: 8px 10px; border-bottom: 1px solid var(--vscode-widget-border); }
    .setting { flex: 1 1 110px; min-width: 0; }
    #settings label { display: block; margin: 0 0 3px 1px; color: var(--vscode-descriptionForeground); font-size: 0.82em; }
    #settings select { min-width: 0; width: 100%; height: 28px; padding: 3px 22px 3px 7px; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border); border-radius: 3px; font: inherit; }
    #settings select:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    #model-status { display: none; flex-basis: 100%; color: var(--vscode-descriptionForeground); font-size: 0.82em; line-height: 1.35; }
    #dispatch { margin: 8px 10px 0; padding: 8px 9px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border); border-left: 2px solid var(--vscode-textLink-foreground); border-radius: 4px; }
    #dispatch-header { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
    #dispatch-header strong { font-size: 0.9em; }
    #dispatch-confidence { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 0.8em; white-space: nowrap; }
    #dispatch-summary { line-height: 1.35; }
    #dispatch-model-reason { margin-top: 3px; color: var(--vscode-descriptionForeground); font-size: 0.84em; line-height: 1.35; }
    #messages { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 10px 8px; }
    #welcome { display: grid; height: 100%; min-height: 140px; place-content: center; padding: 20px; color: var(--vscode-descriptionForeground); text-align: center; line-height: 1.5; }
    #welcome strong { margin-bottom: 4px; color: var(--vscode-foreground); font-size: 1.05em; }
    .message { max-width: 96%; margin: 0 0 14px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.5; }
    .user { width: fit-content; margin-left: auto; padding: 8px 10px; background: var(--vscode-editor-inactiveSelectionBackground); border: 1px solid var(--vscode-widget-border); border-radius: 7px 7px 2px 7px; }
    .assistant { padding: 2px 8px 2px 10px; border-left: 2px solid var(--vscode-textLink-foreground); }
    .role { display: block; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 0.82em; font-weight: 600; }
    #usage { display: none; padding: 6px 10px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-widget-border); font-size: 0.86em; }
    #usage-summary { display: flex; gap: 6px; align-items: center; min-height: 22px; }
    #usage-total { color: var(--vscode-foreground); font-weight: 600; }
    #usage-detail { padding: 4px 0 2px; overflow-wrap: anywhere; line-height: 1.4; }
    #usage-toggle { margin-left: auto; padding: 2px 0; color: var(--vscode-textLink-foreground); background: transparent; }
    #usage-toggle:hover { color: var(--vscode-textLink-activeForeground); background: transparent; text-decoration: underline; }
    [hidden] { display: none !important; }
    #error { display: none; margin: 0 10px 8px; padding: 8px 10px; color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); border-radius: 4px; line-height: 1.4; }
    #composer { padding: 8px 10px 10px; border-top: 1px solid var(--vscode-widget-border); background: var(--vscode-sideBar-background); }
    #composer-surface { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 6px; }
    #composer-surface:focus-within { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    textarea { display: block; width: 100%; height: 58px; min-height: 42px; max-height: 150px; resize: none; overflow-y: auto; padding: 9px 9px 4px; color: var(--vscode-input-foreground); background: transparent; border: 0; font: inherit; line-height: 1.4; }
    textarea:focus { outline: 0; }
    #actions { display: flex; justify-content: flex-end; gap: 6px; align-items: center; padding: 4px 5px 5px 9px; }
    #shortcut { margin-right: auto; color: var(--vscode-descriptionForeground); font-size: 0.78em; }
    button { min-height: 26px; padding: 4px 11px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; border-radius: 3px; font: inherit; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button:disabled, textarea:disabled, select:disabled { opacity: 0.6; cursor: default; }
    #working { display: none; min-width: 0; margin-right: auto; overflow: hidden; align-self: center; color: var(--vscode-descriptionForeground); text-overflow: ellipsis; white-space: nowrap; }
    @media (max-width: 230px) { #shortcut { display: none; } }
  </style>
</head>
<body>
  <main id="app">
    <div id="empty">Select a Codex agent above to open its chat.</div>
    <section id="chat">
      <div id="settings">
        <div class="setting">
          <label for="model">Agent model</label>
          <select id="model" aria-label="Agent model"></select>
        </div>
        <div class="setting">
          <label for="effort">Agent reasoning</label>
          <select id="effort" aria-label="Agent reasoning effort"></select>
        </div>
        <span id="model-status"></span>
      </div>
      <aside id="dispatch" aria-label="Decisão do Modo Economia" hidden>
        <div id="dispatch-header">
          <strong>Modo Economia</strong>
          <span id="dispatch-confidence"></span>
        </div>
        <div id="dispatch-summary"></div>
        <div id="dispatch-model-reason"></div>
      </aside>
      <div id="messages" aria-live="polite"></div>
      <div id="usage" title="Token usage for this conversation">
        <div id="usage-summary">
          <span>Conversation usage</span>
          <span id="usage-total"></span>
          <button id="usage-toggle" type="button" aria-expanded="false" aria-controls="usage-detail">Details</button>
        </div>
        <div id="usage-detail" hidden></div>
      </div>
      <div id="error" role="alert"></div>
      <form id="composer">
        <div id="composer-surface">
          <textarea id="input" aria-label="Message" placeholder="Describe a task for this agent..."></textarea>
          <div id="actions">
            <span id="shortcut">Enter to send</span>
            <span id="working" role="status">Codex is working...</span>
            <button id="stop" class="secondary" type="button">Stop</button>
            <button id="send" type="submit">Send</button>
          </div>
        </div>
      </form>
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const empty = document.getElementById('empty');
    const chat = document.getElementById('chat');
    const settings = document.getElementById('settings');
    const messages = document.getElementById('messages');
    const error = document.getElementById('error');
    const model = document.getElementById('model');
    const effort = document.getElementById('effort');
    const modelStatus = document.getElementById('model-status');
    const dispatch = document.getElementById('dispatch');
    const dispatchConfidence = document.getElementById('dispatch-confidence');
    const dispatchSummary = document.getElementById('dispatch-summary');
    const dispatchModelReason = document.getElementById('dispatch-model-reason');
    const usage = document.getElementById('usage');
    const usageTotal = document.getElementById('usage-total');
    const usageDetail = document.getElementById('usage-detail');
    const usageToggle = document.getElementById('usage-toggle');
    const form = document.getElementById('composer');
    const input = document.getElementById('input');
    const send = document.getElementById('send');
    const stop = document.getElementById('stop');
    const shortcut = document.getElementById('shortcut');
    const working = document.getElementById('working');
    let currentConversationId;
    let currentModels = [];
    let usageExpanded = false;
    let economyMode = false;

    window.addEventListener('message', (event) => {
      const payload = event.data;
      if (!payload || payload.type !== 'state') return;
      const agent = payload.agent;
      const conversation = payload.conversation;
      const state = payload.state;
      economyMode = payload.mode === 'economy';
      if (economyMode) {
        const economyBusy = Boolean(payload.economyBusy);
        empty.style.display = 'none';
        chat.style.display = 'flex';
        settings.style.display = 'none';
        dispatch.hidden = true;
        usage.style.display = 'none';
        error.style.display = 'none';
        messages.replaceChildren();
        const welcome = document.createElement('div');
        welcome.id = 'welcome';
        const title = document.createElement('strong');
        title.textContent = 'Modo Economia';
        const detail = document.createElement('span');
        detail.textContent = 'Descreva a tarefa sem escolher um agente. A rota com melhor custo-benefício será selecionada automaticamente.';
        const hint = document.createElement('span');
        hint.textContent = 'A decisão será explicada antes da execução.';
        welcome.append(title, detail, hint);
        messages.append(welcome);
        currentConversationId = undefined;
        currentModels = [];
        input.disabled = economyBusy;
        send.disabled = economyBusy;
        send.textContent = economyBusy ? 'Analisando…' : 'Analisar e enviar';
        stop.style.display = 'none';
        working.textContent = economyBusy ? 'Analisando tarefa e agentes…' : '';
        working.style.display = economyBusy ? 'inline' : 'none';
        shortcut.style.display = economyBusy ? 'none' : '';
        shortcut.textContent = 'Enter para enviar';
        input.placeholder = 'Descreva a tarefa para o Modo Economia...';
        if (!economyBusy) input.focus();
        return;
      }
      if (!agent || !conversation || !state) {
        empty.style.display = 'block';
        chat.style.display = 'none';
        return;
      }
      const previousScrollTop = messages.scrollTop;
      const followLatest = currentConversationId !== conversation.id
        || messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
      if (currentConversationId !== conversation.id) {
        currentConversationId = conversation.id;
        input.value = '';
        resizeInput();
        usageExpanded = false;
        updateUsageDisclosure();
      }
      empty.style.display = 'none';
      chat.style.display = 'flex';
      settings.style.display = 'flex';
      send.textContent = 'Send';
      shortcut.textContent = 'Enter to send';
      currentModels = state.models || [];
      renderModels(state.model, state.reasoningEffort);
      const settingsDisabled = state.busy || state.modelsLoading || currentModels.length === 0;
      model.disabled = settingsDisabled;
      effort.disabled = settingsDisabled || effort.options.length === 0;
      modelStatus.textContent = state.modelsError
        || (state.modelsLoading ? 'Loading available models...' : currentModels.length === 0 ? 'No models available.' : '');
      modelStatus.style.display = modelStatus.textContent ? 'block' : 'none';
      if (conversation.dispatch) {
        dispatch.hidden = false;
        dispatchConfidence.textContent = Math.round(conversation.dispatch.confidence * 100) + '% confidence';
        dispatchSummary.textContent = capitalize(conversation.dispatch.complexity) + ' task · ' + conversation.dispatch.agentReason;
        const routeChanged = conversation.dispatch.model && state.model && conversation.dispatch.model !== state.model;
        dispatchModelReason.textContent = conversation.dispatch.modelReason
          + (routeChanged ? ' The model was changed manually after routing.' : '');
        dispatch.title = 'Routed ' + new Date(conversation.dispatch.routedAt).toLocaleString();
      } else {
        dispatch.hidden = true;
      }
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
        usage.style.display = 'block';
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
      shortcut.style.display = working.textContent ? 'none' : '';
      input.placeholder = supported ? 'Describe a task for this agent...' : 'Embedded chat currently supports Codex agents only.';
      messages.scrollTop = followLatest ? messages.scrollHeight : previousScrollTop;
    });

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      vscode.postMessage({ type: economyMode ? 'economyDispatch' : 'send', text });
      input.value = '';
      resizeInput();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    input.addEventListener('input', resizeInput);
    stop.addEventListener('click', () => vscode.postMessage({ type: 'interrupt' }));
    usageToggle.addEventListener('click', () => {
      usageExpanded = !usageExpanded;
      updateUsageDisclosure();
    });
    model.addEventListener('change', () => {
      const selectedModel = currentModels.find((candidate) => candidate.model === model.value);
      renderEfforts(selectedModel, selectedModel && selectedModel.defaultReasoningEffort);
      postModelSelection();
    });
    effort.addEventListener('change', postModelSelection);

    function postModelSelection() {
      if (!model.value) return;
      vscode.postMessage({ type: 'selectModel', model: model.value, effort: effort.value || undefined });
    }

    function renderModels(selectedModel, selectedEffort) {
      model.replaceChildren();
      for (const candidate of currentModels) {
        const option = document.createElement('option');
        option.value = candidate.model;
        option.textContent = candidate.displayName;
        model.append(option);
      }
      if (selectedModel && !currentModels.some((candidate) => candidate.model === selectedModel)) {
        const unavailable = document.createElement('option');
        unavailable.value = selectedModel;
        unavailable.textContent = selectedModel + ' (unavailable)';
        unavailable.disabled = true;
        model.append(unavailable);
      }
      model.value = selectedModel || '';
      renderEfforts(
        currentModels.find((candidate) => candidate.model === model.value),
        selectedEffort,
      );
    }

    function renderEfforts(selectedModel, selectedEffort) {
      effort.replaceChildren();
      if (!selectedModel) return;
      for (const candidate of selectedModel.supportedReasoningEfforts) {
        const option = document.createElement('option');
        option.value = candidate.reasoningEffort;
        option.textContent = capitalize(candidate.reasoningEffort);
        option.title = candidate.description || '';
        effort.append(option);
      }
      effort.value = selectedEffort || selectedModel.defaultReasoningEffort || '';
    }

    function capitalize(value) {
      return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
    }

    function updateUsageDisclosure() {
      usageDetail.hidden = !usageExpanded;
      usageToggle.textContent = usageExpanded ? 'Hide' : 'Details';
      usageToggle.setAttribute('aria-expanded', String(usageExpanded));
    }

    function resizeInput() {
      input.style.height = 'auto';
      input.style.height = Math.min(Math.max(input.scrollHeight, 42), 150) + 'px';
    }

    function formatTokens(value) {
      return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    }
  </script>
</body>
</html>`;
}
