import * as vscode from 'vscode';
import type { AgentManager } from '../agents/AgentManager';
import type { ChatSessionManager } from '../chat/ChatSessionManager';
import type { AgentConfig, AgentDraft, ProviderId } from '../config/types';
import { UserFacingError } from '../config/validation';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import type { TerminalManager } from '../terminal/TerminalManager';
import { AgentTreeItem } from '../views/AgentTreeItem';
import type { ChatWebviewProvider } from '../views/ChatWebviewProvider';
import { ConversationTreeItem } from '../views/ConversationTreeItem';

interface CommandServices {
  readonly agents: AgentManager;
  readonly terminals: TerminalManager;
  readonly providers: ProviderRegistry;
  readonly chats: ChatSessionManager;
  readonly chatView: ChatWebviewProvider;
  readonly output: vscode.OutputChannel;
}

export function registerCommands(context: vscode.ExtensionContext, services: CommandServices): void {
  const { agents, terminals, chats, chatView } = services;
  const register = (id: string, handler: (...args: unknown[]) => Promise<void>): void => {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, (...args: unknown[]) => runSafely(services.output, () => handler(...args))),
    );
  };

  register('agentWorkspace.createAgent', async () => {
    const draft = await promptForAgent();
    if (!draft) {
      return;
    }
    const agent = await agents.create(draft);
    await openInstructions(agents, agent);
  });

  register('agentWorkspace.refresh', async () => agents.reload());

  register('agentWorkspace.openChat', async (value) => {
    const agent = await resolveAgent(value, agents);
    if (agent) {
      await chatView.selectAgent(agent);
    }
  });

  register('agentWorkspace.newConversation', async (value) => {
    const agent = await resolveAgent(value, agents);
    if (!agent) {
      return;
    }
    const conversation = chats.createConversation(agent);
    await chatView.selectConversation(agent, conversation.id);
  });

  register('agentWorkspace.openConversation', async (value) => {
    const resolved = await resolveConversation(value, agents, chats);
    if (resolved) {
      await chatView.selectConversation(resolved.agent, resolved.conversationId);
    }
  });

  register('agentWorkspace.renameConversation', async (value) => {
    const resolved = await resolveConversation(value, agents, chats);
    if (!resolved) {
      return;
    }
    const conversation = chats.getConversation(resolved.agent.id, resolved.conversationId);
    if (!conversation) {
      return;
    }
    const title = await vscode.window.showInputBox({
      title: 'Rename Conversation',
      prompt: 'A short title shown under this agent',
      value: conversation.title,
      ignoreFocusOut: true,
      validateInput: (candidate) => (candidate.trim() ? undefined : 'Conversation title cannot be empty.'),
    });
    if (title !== undefined) {
      chats.renameConversation(resolved.agent.id, conversation.id, title);
    }
  });

  register('agentWorkspace.deleteConversation', async (value) => {
    const resolved = await resolveConversation(value, agents, chats);
    if (!resolved) {
      return;
    }
    const conversation = chats.getConversation(resolved.agent.id, resolved.conversationId);
    if (!conversation) {
      return;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Remove conversation "${conversation.title}"? Its Codex thread will be archived.`,
      { modal: true },
      'Remove Conversation',
    );
    if (confirmation !== 'Remove Conversation') {
      return;
    }
    await chats.deleteConversation(resolved.agent.id, conversation.id);
    await chatView.selectAgent(resolved.agent);
  });

  register('agentWorkspace.startAgent', async (value) => {
    const agent = await resolveAgent(value, agents);
    if (agent) {
      await startAgent(agents, terminals, agent);
    }
  });

  register('agentWorkspace.stopAgent', async (value) => {
    const agent = await resolveAgent(value, agents);
    if (agent) {
      terminals.stop(agent.id);
    }
  });

  register('agentWorkspace.restartAgent', async (value) => {
    const agent = await resolveAgent(value, agents);
    if (!agent) {
      return;
    }
    await agents.validateFiles(agent);
    terminals.restart(agent, agents.workingDirectoryUri(agent));
  });

  register('agentWorkspace.openInstructions', async (value) => {
    const agent = await resolveAgent(value, agents);
    if (agent) {
      await openInstructions(agents, agent);
    }
  });

  register('agentWorkspace.editAgent', async (value) => {
    const agent = await resolveAgent(value, agents);
    if (!agent) {
      return;
    }
    const draft = await promptForAgent(agent);
    if (!draft) {
      return;
    }
    const updated = await agents.update(agent.id, draft);
    chats.resetAgentSessions(agent.id);
    await chatView.refreshSelectedAgent(updated);
    terminals.stop(agent.id);
  });

  register('agentWorkspace.deleteAgent', async (value) => {
    const agent = await resolveAgent(value, agents);
    if (!agent) {
      return;
    }
    const confirmation = await vscode.window.showWarningMessage(
      `Delete agent "${agent.name}"? Its instructions file will be kept for now.`,
      { modal: true },
      'Delete Agent',
    );
    if (confirmation !== 'Delete Agent') {
      return;
    }
    terminals.stop(agent.id);
    await agents.delete(agent.id);
    chats.forgetAgent(agent.id);
    const removeInstructions = await vscode.window.showWarningMessage(
      `Also move ${agent.instructionsFile} to the trash?`,
      'Move to Trash',
      'Keep File',
    );
    if (removeInstructions === 'Move to Trash') {
      await agents.deleteInstructions(agent);
    }
  });
}

async function promptForAgent(existing?: AgentConfig): Promise<AgentDraft | undefined> {
  const name = await vscode.window.showInputBox({
    title: existing ? 'Edit Agent: Name' : 'Create Agent: Name',
    prompt: 'A unique display name for this agent',
    value: existing?.name,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Agent name cannot be empty.'),
  });
  if (name === undefined) {
    return undefined;
  }

  const providerPick = await vscode.window.showQuickPick(
    [
      { label: 'Codex', description: 'Local Codex CLI', id: 'codex' as const },
      { label: 'Custom CLI', description: 'Run a command in the agent terminal', id: 'custom' as const },
    ],
    {
      title: existing ? 'Edit Agent: Provider' : 'Create Agent: Provider',
      placeHolder: 'Choose a provider',
      ignoreFocusOut: true,
    },
  );
  if (!providerPick) {
    return undefined;
  }
  const provider: ProviderId = providerPick.id;

  const cwd = await vscode.window.showInputBox({
    title: existing ? 'Edit Agent: Working Directory' : 'Create Agent: Working Directory',
    prompt: 'Workspace-relative directory (multi-root workspaces use the first folder)',
    value: existing?.cwd ?? '.',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Working directory cannot be empty.'),
  });
  if (cwd === undefined) {
    return undefined;
  }

  let command: string | undefined;
  if (provider === 'custom') {
    command = await vscode.window.showInputBox({
      title: existing ? 'Edit Agent: Custom CLI Command' : 'Create Agent: Custom CLI Command',
      prompt: 'Command to run, for example: gemini, claude, opencode, or aider',
      value: existing?.provider === 'custom' ? existing.command : undefined,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Custom CLI command cannot be empty.'),
    });
    if (command === undefined) {
      return undefined;
    }
  }
  return { name, provider, cwd, ...(command ? { command } : {}) };
}

async function resolveAgent(value: unknown, manager: AgentManager): Promise<AgentConfig | undefined> {
  if (value instanceof AgentTreeItem) {
    return manager.require(value.agent.id);
  }
  if (isAgentConfig(value)) {
    return manager.require(value.id);
  }
  const pick = await vscode.window.showQuickPick(
    manager.list().map((agent) => ({ label: agent.name, description: agent.provider, agent })),
    { title: 'Select Agent', placeHolder: 'Choose an agent' },
  );
  return pick?.agent;
}

async function resolveConversation(
  value: unknown,
  agents: AgentManager,
  chats: ChatSessionManager,
): Promise<{ agent: AgentConfig; conversationId: string } | undefined> {
  if (value instanceof ConversationTreeItem) {
    return { agent: agents.require(value.agent.id), conversationId: value.conversation.id };
  }
  const picks = agents.list().flatMap((agent) =>
    chats.listConversations(agent.id).map((conversation) => ({
      label: conversation.title,
      description: agent.name,
      agent,
      conversationId: conversation.id,
    })),
  );
  const pick = await vscode.window.showQuickPick(picks, {
    title: 'Select Conversation',
    placeHolder: 'Choose a conversation',
  });
  return pick ? { agent: pick.agent, conversationId: pick.conversationId } : undefined;
}

async function startAgent(manager: AgentManager, terminals: TerminalManager, agent: AgentConfig): Promise<void> {
  await manager.validateFiles(agent);
  terminals.start(agent, manager.workingDirectoryUri(agent));
}

async function openInstructions(manager: AgentManager, agent: AgentConfig): Promise<void> {
  await manager.validateFiles(agent);
  const document = await vscode.workspace.openTextDocument(manager.instructionsUri(agent));
  await vscode.window.showTextDocument(document);
}

async function runSafely(output: vscode.OutputChannel, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    if (error instanceof UserFacingError) {
      await vscode.window.showErrorMessage(error.message);
      return;
    }
    const details = error instanceof Error ? error.stack ?? error.message : String(error);
    output.appendLine(`[${new Date().toISOString()}] ${details}`);
    await vscode.window.showErrorMessage('Agent Workspace could not complete the action. See the Agent Workspace output for details.');
  }
}

function isAgentConfig(value: unknown): value is AgentConfig {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string';
}
