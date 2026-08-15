import * as vscode from 'vscode';
import type { AgentConfig } from '../config/types';
import { AgentStatus } from '../agents/AgentStatus';
import type { TokenUsageBreakdown } from '../chat/protocol';
import type { ProviderRegistry } from '../providers/ProviderRegistry';

export class AgentTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly agent: AgentConfig,
    status: AgentStatus,
    providers: ProviderRegistry,
    usage?: TokenUsageBreakdown,
  ) {
    super(
      agent.name,
      agent.provider === 'codex' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.id = agent.id;
    this.description = usage ? `${formatTokenCount(usage.totalTokens)} total` : status;
    this.tooltip = new vscode.MarkdownString(
      `**${agent.name}**\n\nProvider: ${providers.displayName(agent.provider)}\n\nWorking directory: \`${agent.cwd}\`${agent.specialties?.length ? `\n\nSpecialties: ${agent.specialties.join(', ')}` : ''}\n\nStatus: ${status}${usage ? `\n\nTotal usage across conversations: ${usage.totalTokens.toLocaleString()} tokens` : ''}`,
    );
    this.contextValue = `${agent.provider}Agent${status === AgentStatus.Running ? 'Running' : 'Stopped'}`;
    this.iconPath = new vscode.ThemeIcon(
      status === AgentStatus.Running ? 'circle-filled' : 'circle-outline',
      status === AgentStatus.Running ? new vscode.ThemeColor('charts.green') : undefined,
    );
    this.command = {
      command: 'agentWorkspace.openChat',
      title: 'Open Chat',
      arguments: [this],
    };
  }
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${formatCompact(value / 1_000_000)}M tokens`;
  }
  if (value >= 1_000) {
    return `${formatCompact(value / 1_000)}K tokens`;
  }
  return `${value} tokens`;
}

function formatCompact(value: number): string {
  return value.toFixed(value >= 10 ? 0 : 1).replace(/\.0$/, '');
}
