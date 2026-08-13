import * as vscode from 'vscode';
import type { AgentConfig } from '../config/types';
import type { ProviderRegistry } from '../providers/ProviderRegistry';

export class TerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly changedEmitter = new vscode.EventEmitter<string>();
  private readonly closeSubscription: vscode.Disposable;

  public readonly onDidChangeStatus = this.changedEmitter.event;

  public constructor(private readonly providers: ProviderRegistry) {
    this.closeSubscription = vscode.window.onDidCloseTerminal((terminal) => {
      for (const [agentId, activeTerminal] of this.terminals) {
        if (activeTerminal === terminal) {
          this.terminals.delete(agentId);
          this.changedEmitter.fire(agentId);
          break;
        }
      }
    });
  }

  public isRunning(agentId: string): boolean {
    return this.terminals.has(agentId);
  }

  public start(agent: AgentConfig, cwd: vscode.Uri): void {
    const existing = this.terminals.get(agent.id);
    if (existing) {
      existing.show();
      return;
    }

    const launch = this.providers.get(agent.provider).buildLaunch(agent);
    const terminal =
      launch.kind === 'direct'
        ? vscode.window.createTerminal({
            name: agent.name,
            cwd,
            shellPath: launch.executable,
            shellArgs: [...launch.args],
            isTransient: true,
          })
        : vscode.window.createTerminal({ name: agent.name, cwd, isTransient: true });
    this.terminals.set(agent.id, terminal);
    this.changedEmitter.fire(agent.id);
    terminal.show();
    if (launch.kind === 'shell') {
      terminal.sendText(launch.command, true);
    }
  }

  public focus(agentId: string): void {
    this.terminals.get(agentId)?.show();
  }

  public stop(agentId: string): void {
    const terminal = this.terminals.get(agentId);
    if (terminal) {
      this.terminals.delete(agentId);
      terminal.dispose();
      this.changedEmitter.fire(agentId);
    }
  }

  public restart(agent: AgentConfig, cwd: vscode.Uri): void {
    this.stop(agent.id);
    this.start(agent, cwd);
  }

  public dispose(): void {
    this.closeSubscription.dispose();
    this.changedEmitter.dispose();
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}
