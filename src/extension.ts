import * as vscode from 'vscode';
import { AgentManager } from './agents/AgentManager';
import { ChatSessionManager } from './chat/ChatSessionManager';
import { registerCommands } from './commands/registerCommands';
import { ConfigManager } from './config/ConfigManager';
import { UserFacingError } from './config/validation';
import { WorkspaceResolver } from './config/WorkspaceResolver';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { TerminalManager } from './terminal/TerminalManager';
import { AgentTreeProvider } from './views/AgentTreeProvider';
import { ChatWebviewProvider, EmptyChatWebviewProvider } from './views/ChatWebviewProvider';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Agent Workspace', { log: true });
  context.subscriptions.push(output);

  const workspaceFolder = new WorkspaceResolver().getPrimaryFolder();
  if (!workspaceFolder) {
    await registerWithoutWorkspace(context);
    return;
  }

  const configManager = new ConfigManager(workspaceFolder);
  const agents = new AgentManager(configManager);
  const providers = new ProviderRegistry();
  const terminals = new TerminalManager(providers);
  const chats = new ChatSessionManager(agents, context.workspaceState, output);
  const treeProvider = new AgentTreeProvider(agents, terminals, providers, chats);
  const chatView = new ChatWebviewProvider(agents, chats);

  context.subscriptions.push(
    agents,
    terminals,
    chats,
    treeProvider,
    chatView,
    vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, chatView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.createTreeView('agentWorkspace.agents', {
      treeDataProvider: treeProvider,
      showCollapseAll: false,
    }),
  );
  registerCommands(context, { agents, terminals, providers, chats, chatView, output });

  try {
    await agents.reload();
  } catch (error: unknown) {
    const message = error instanceof UserFacingError ? error.message : 'Could not load Agent Workspace configuration.';
    if (!(error instanceof UserFacingError)) {
      output.error(error instanceof Error ? error : String(error));
    }
    await vscode.window.showErrorMessage(message);
    treeProvider.refresh();
  }
}

export function deactivate(): void {}

async function registerWithoutWorkspace(context: vscode.ExtensionContext): Promise<void> {
  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(
    changed,
    vscode.window.createTreeView('agentWorkspace.agents', {
      treeDataProvider: {
        onDidChangeTreeData: changed.event,
        getTreeItem: (item: vscode.TreeItem) => item,
        getChildren: () => [],
      },
    }),
    vscode.window.registerWebviewViewProvider(ChatWebviewProvider.viewType, new EmptyChatWebviewProvider()),
  );
  await vscode.commands.executeCommand('setContext', 'agentWorkspace.hasAgents', false);
  await vscode.commands.executeCommand('setContext', 'agentWorkspace.hasCodexAgents', false);
  const commandIds = [
    'agentWorkspace.createAgent',
    'agentWorkspace.smartDispatch',
    'agentWorkspace.refresh',
    'agentWorkspace.openChat',
    'agentWorkspace.newConversation',
    'agentWorkspace.openConversation',
    'agentWorkspace.renameConversation',
    'agentWorkspace.deleteConversation',
    'agentWorkspace.startAgent',
    'agentWorkspace.stopAgent',
    'agentWorkspace.restartAgent',
    'agentWorkspace.openInstructions',
    'agentWorkspace.editAgent',
    'agentWorkspace.deleteAgent',
  ];
  for (const id of commandIds) {
    context.subscriptions.push(
      vscode.commands.registerCommand(id, () =>
        vscode.window.showErrorMessage('Open a folder or workspace before using Agent Workspace.'),
      ),
    );
  }
}
