import type { AgentConfig } from '../config/types';

export interface DirectTerminalLaunch {
  readonly kind: 'direct';
  readonly executable: string;
  readonly args: readonly string[];
}

export interface ShellTerminalLaunch {
  readonly kind: 'shell';
  readonly command: string;
}

export type TerminalLaunch = DirectTerminalLaunch | ShellTerminalLaunch;

export interface AgentProvider {
  readonly id: AgentConfig['provider'];
  readonly displayName: string;
  buildLaunch(agent: AgentConfig): TerminalLaunch;
}
