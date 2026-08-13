export const SUPPORTED_PROVIDERS = ['codex', 'custom'] as const;

export type ProviderId = (typeof SUPPORTED_PROVIDERS)[number];

export interface AgentConfig {
  readonly id: string;
  readonly name: string;
  readonly provider: ProviderId;
  readonly instructionsFile: string;
  readonly cwd: string;
  readonly command?: string;
}

export interface WorkspaceConfig {
  readonly version: 1;
  readonly agents: readonly AgentConfig[];
}

export interface AgentDraft {
  readonly name: string;
  readonly provider: ProviderId;
  readonly cwd: string;
  readonly command?: string;
}
