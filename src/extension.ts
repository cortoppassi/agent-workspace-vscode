import * as vscode from 'vscode';
import { AgentManager } from './agents/AgentManager';
import { registerCommands } from './commands/registerCommands';
import { ConfigManager } from './config/ConfigManager';
import { UserFacingError } from './config/validation';
import { WorkspaceResolver } from './config/WorkspaceResolver';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { TerminalManager } from './terminal/TerminalManager';
import { AgentTreeProvider } from './views/AgentTreeProvider';

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
  const treeProvider = new AgentTreeProvider(agents, terminals, providers);

  context.subscriptions.push(
    agents,
    terminals,
    treeProvider,
    vscode.window.createTreeView('agentWorkspace.agents', {
      treeDataProvider: treeProvider,
      showCollapseAll: false,
    }),
  );
  registerCommands(context, { agents, terminals, providers, output });

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
  );
  await vscode.commands.executeCommand('setContext', 'agentWorkspace.hasAgents', false);
  const commandIds = [
    'agentWorkspace.createAgent',
    'agentWorkspace.refresh',
    'agentWorkspace.toggleAgent',
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
