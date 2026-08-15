import path from 'node:path';
import type { AgentConfig, AgentDraft, ProviderId, WorkspaceConfig } from './types';
import { SUPPORTED_PROVIDERS } from './types';

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class UserFacingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UserFacingError';
  }
}

export function generateAgentId(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'agent';
}

export function validateDraft(draft: AgentDraft): void {
  if (!draft.name.trim()) {
    throw new UserFacingError('Agent name cannot be empty.');
  }
  if (!isProviderId(draft.provider)) {
    throw new UserFacingError(`Unsupported provider: ${String(draft.provider)}.`);
  }
  if (!draft.cwd.trim()) {
    throw new UserFacingError('Working directory cannot be empty.');
  }
  if (draft.provider === 'custom' && !draft.command?.trim()) {
    throw new UserFacingError('Custom CLI command cannot be empty.');
  }
  if (draft.command?.includes('\n') || draft.command?.includes('\r')) {
    throw new UserFacingError('Custom CLI command must be a single line.');
  }
  if ((draft.specialties?.length ?? 0) > 12) {
    throw new UserFacingError('An agent can have at most 12 specialties.');
  }
  if (draft.specialties?.some((specialty) => !specialty.trim() || specialty.length > 40)) {
    throw new UserFacingError('Agent specialties must contain between 1 and 40 characters.');
  }
}

export function parseWorkspaceConfig(value: unknown): WorkspaceConfig {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.agents)) {
    throw new UserFacingError('The Agent Workspace config must contain version 1 and an agents array.');
  }

  const agents = value.agents.map((entry, index) => parseAgent(entry, index));
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const agent of agents) {
    const normalizedName = agent.name.toLocaleLowerCase();
    if (ids.has(agent.id)) {
      throw new UserFacingError(`Duplicate agent id in config: ${agent.id}.`);
    }
    if (names.has(normalizedName)) {
      throw new UserFacingError(`Duplicate agent name in config: ${agent.name}.`);
    }
    ids.add(agent.id);
    names.add(normalizedName);
  }
  return { version: 1, agents };
}

export function normalizeRelativePath(input: string): string {
  const normalized = input.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  return normalized || '.';
}

export function resolveInsideWorkspace(workspaceRoot: string, relativePath: string): string {
  const absolute = path.resolve(workspaceRoot, relativePath);
  const relation = path.relative(workspaceRoot, absolute);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new UserFacingError('Paths must stay inside the current workspace.');
  }
  return absolute;
}

function parseAgent(value: unknown, index: number): AgentConfig {
  if (!isRecord(value)) {
    throw new UserFacingError(`Agent at position ${index + 1} is invalid.`);
  }
  const id = readString(value, 'id', index);
  const name = readString(value, 'name', index);
  const provider = readString(value, 'provider', index);
  const instructionsFile = readString(value, 'instructionsFile', index);
  const cwd = readString(value, 'cwd', index);
  const command = typeof value.command === 'string' ? value.command : undefined;
  const specialties = readSpecialties(value.specialties, name);

  if (!ID_PATTERN.test(id)) {
    throw new UserFacingError(`Agent id "${id}" is not a safe id.`);
  }
  if (!isProviderId(provider)) {
    throw new UserFacingError(`Agent "${name}" uses unsupported provider "${provider}".`);
  }
  const draft: AgentDraft = { name, provider, cwd, command, specialties };
  validateDraft(draft);
  return {
    id,
    name: name.trim(),
    provider,
    instructionsFile,
    cwd,
    ...(specialties.length > 0 ? { specialties } : {}),
    ...(command ? { command } : {}),
  };
}

function readSpecialties(value: unknown, agentName: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new UserFacingError(`Agent "${agentName}" has invalid specialties.`);
  }
  const specialties: string[] = [];
  for (const specialty of value as unknown[]) {
    if (typeof specialty !== 'string') {
      throw new UserFacingError(`Agent "${agentName}" has invalid specialties.`);
    }
    specialties.push(specialty.trim());
  }
  return specialties;
}

function readString(value: Record<string, unknown>, key: string, index: number): string {
  const field = value[key];
  if (typeof field !== 'string' || !field.trim()) {
    throw new UserFacingError(`Agent at position ${index + 1} has an invalid ${key}.`);
  }
  return field;
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
