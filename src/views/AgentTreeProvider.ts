import * as vscode from 'vscode';
import type { AgentManager } from '../agents/AgentManager';
import { AgentStatus } from '../agents/AgentStatus';
import type { ChatSessionManager } from '../chat/ChatSessionManager';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import type { TerminalManager } from '../terminal/TerminalManager';
import { AgentTreeItem } from './AgentTreeItem';
import { ConversationTreeItem } from './ConversationTreeItem';

type TreeElement = AgentTreeItem | ConversationTreeItem;

export class AgentTreeProvider implements vscode.TreeDataProvider<TreeElement>, vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<TreeElement | undefined>();
  private readonly subscriptions: vscode.Disposable[];

  public readonly onDidChangeTreeData = this.changedEmitter.event;

  public constructor(
    private readonly agents: AgentManager,
    private readonly terminals: TerminalManager,
    private readonly providers: ProviderRegistry,
    private readonly chats: ChatSessionManager,
  ) {
    this.subscriptions = [
      agents.onDidChange(() => this.refresh()),
      terminals.onDidChangeStatus(() => this.refresh()),
      chats.onDidChangeConversations(() => this.refresh()),
    ];
  }

  public getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: TreeElement): TreeElement[] {
    if (element instanceof ConversationTreeItem) {
      return [];
    }
    if (element instanceof AgentTreeItem) {
      const activeConversation = this.chats.getActiveConversation(element.agent.id);
      return this.chats.listConversations(element.agent.id).map(
        (conversation) => new ConversationTreeItem(
          element.agent,
          conversation,
          activeConversation?.id === conversation.id,
          this.chats.isBusy(conversation.id),
        ),
      );
    }
    return this.agents.list().map(
      (agent) => new AgentTreeItem(
        agent,
        this.terminals.isRunning(agent.id) ? AgentStatus.Running : AgentStatus.Stopped,
        this.providers,
        this.chats.getAgentTokenUsage(agent.id),
      ),
    );
  }

  public refresh(): void {
    void vscode.commands.executeCommand('setContext', 'agentWorkspace.hasAgents', this.agents.list().length > 0);
    void vscode.commands.executeCommand(
      'setContext',
      'agentWorkspace.hasCodexAgents',
      this.agents.list().some((agent) => agent.provider === 'codex'),
    );
    this.changedEmitter.fire(undefined);
  }

  public dispose(): void {
    this.changedEmitter.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }
}
