import * as vscode from 'vscode';
import type { AgentConfig } from '../config/types';
import { AgentStatus } from '../agents/AgentStatus';
import type { ProviderRegistry } from '../providers/ProviderRegistry';

export class AgentTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly agent: AgentConfig,
    status: AgentStatus,
    providers: ProviderRegistry,
  ) {
    super(agent.name, vscode.TreeItemCollapsibleState.None);
    this.id = agent.id;
    this.description = `${providers.displayName(agent.provider)} · ${status}`;
    this.tooltip = new vscode.MarkdownString(
      `**${agent.name}**\n\nProvider: ${providers.displayName(agent.provider)}\n\nWorking directory: \`${agent.cwd}\`\n\nStatus: ${status}`,
    );
    this.contextValue = status === AgentStatus.Running ? 'agentRunning' : 'agentStopped';
    this.iconPath = new vscode.ThemeIcon(
      status === AgentStatus.Running ? 'circle-filled' : 'circle-outline',
      status === AgentStatus.Running ? new vscode.ThemeColor('charts.green') : undefined,
    );
    this.command = {
      command: 'agentWorkspace.toggleAgent',
      title: 'Start or Focus Agent',
      arguments: [this],
    };
  }
}
