import * as vscode from 'vscode';
import type { ConversationConfig } from '../chat/conversations';
import type { AgentConfig } from '../config/types';
import { formatTokenCount } from './AgentTreeItem';

export class ConversationTreeItem extends vscode.TreeItem {
  public constructor(
    public readonly agent: AgentConfig,
    public readonly conversation: ConversationConfig,
    active: boolean,
    busy: boolean,
  ) {
    super(conversation.title, vscode.TreeItemCollapsibleState.None);
    this.id = conversation.id;
    this.description = conversation.usage ? formatTokenCount(conversation.usage.totalTokens) : undefined;
    this.tooltip = new vscode.MarkdownString(
      `**${conversation.title}**\n\nUpdated: ${new Date(conversation.updatedAt).toLocaleString()}${conversation.usage ? `\n\nToken usage: ${conversation.usage.totalTokens.toLocaleString()}` : ''}`,
    );
    this.contextValue = 'conversation';
    this.iconPath = new vscode.ThemeIcon(
      busy ? 'sync~spin' : active ? 'comment-discussion' : 'comment',
      active ? new vscode.ThemeColor('charts.green') : undefined,
    );
    this.command = {
      command: 'agentWorkspace.openConversation',
      title: 'Open Conversation',
      arguments: [this],
    };
  }
}
