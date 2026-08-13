import * as vscode from 'vscode';
import type { AgentManager } from '../agents/AgentManager';
import { AgentStatus } from '../agents/AgentStatus';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import type { TerminalManager } from '../terminal/TerminalManager';
import { AgentTreeItem } from './AgentTreeItem';

export class AgentTreeProvider implements vscode.TreeDataProvider<AgentTreeItem>, vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<AgentTreeItem | undefined>();
  private readonly subscriptions: vscode.Disposable[];

  public readonly onDidChangeTreeData = this.changedEmitter.event;

  public constructor(
    private readonly agents: AgentManager,
    private readonly terminals: TerminalManager,
    private readonly providers: ProviderRegistry,
  ) {
    this.subscriptions = [
      agents.onDidChange(() => this.refresh()),
      terminals.onDidChangeStatus(() => this.refresh()),
    ];
  }

  public getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(): AgentTreeItem[] {
    return this.agents.list().map(
      (agent) =>
        new AgentTreeItem(
          agent,
          this.terminals.isRunning(agent.id) ? AgentStatus.Running : AgentStatus.Stopped,
          this.providers,
        ),
    );
  }

  public refresh(): void {
    void vscode.commands.executeCommand('setContext', 'agentWorkspace.hasAgents', this.agents.list().length > 0);
    this.changedEmitter.fire(undefined);
  }

  public dispose(): void {
    this.changedEmitter.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }
}
