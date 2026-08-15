import * as vscode from 'vscode';
import type { AgentConfig, AgentDraft } from '../config/types';
import type { ConfigManager } from '../config/ConfigManager';
import {
  generateAgentId,
  normalizeRelativePath,
  resolveInsideWorkspace,
  UserFacingError,
  validateDraft,
} from '../config/validation';

export class AgentManager implements vscode.Disposable {
  private readonly changedEmitter = new vscode.EventEmitter<void>();
  private agents: AgentConfig[] = [];

  public readonly onDidChange = this.changedEmitter.event;

  public constructor(private readonly configManager: ConfigManager) {}

  public get workspaceRoot(): string {
    return this.configManager.workspaceRoot;
  }

  public dispose(): void {
    this.changedEmitter.dispose();
  }

  public list(): readonly AgentConfig[] {
    return this.agents;
  }

  public async reload(): Promise<void> {
    const config = await this.configManager.load();
    this.agents = [...config.agents];
    this.changedEmitter.fire();
  }

  public async create(draft: AgentDraft): Promise<AgentConfig> {
    const normalizedDraft = normalizeDraft(draft);
    validateDraft(normalizedDraft);
    this.assertUnique(normalizedDraft.name);
    await this.assertWorkingDirectory(normalizedDraft.cwd);

    const id = generateAgentId(normalizedDraft.name);
    if (this.agents.some((agent) => agent.id === id)) {
      throw new UserFacingError(`An agent with id "${id}" already exists.`);
    }
    const agent: AgentConfig = {
      id,
      name: normalizedDraft.name,
      provider: normalizedDraft.provider,
      instructionsFile: `.agent-workspace/agents/${id}.md`,
      cwd: normalizedDraft.cwd,
      ...(normalizedDraft.specialties?.length ? { specialties: normalizedDraft.specialties } : {}),
      ...(normalizedDraft.command ? { command: normalizedDraft.command } : {}),
    };

    await this.configManager.createInstructions(agent);
    try {
      await this.configManager.save([...this.agents, agent]);
    } catch (error: unknown) {
      await this.configManager.deleteInstructions(agent);
      throw error;
    }
    this.agents.push(agent);
    this.changedEmitter.fire();
    return agent;
  }

  public async update(id: string, draft: AgentDraft): Promise<AgentConfig> {
    const index = this.agents.findIndex((agent) => agent.id === id);
    const existing = this.agents[index];
    if (!existing) {
      throw new UserFacingError('The selected agent no longer exists.');
    }
    const normalizedDraft = normalizeDraft(draft);
    validateDraft(normalizedDraft);
    this.assertUnique(normalizedDraft.name, id);
    await this.assertWorkingDirectory(normalizedDraft.cwd);

    const updated: AgentConfig = {
      ...existing,
      name: normalizedDraft.name,
      provider: normalizedDraft.provider,
      cwd: normalizedDraft.cwd,
      ...(normalizedDraft.specialties?.length
        ? { specialties: normalizedDraft.specialties }
        : { specialties: undefined }),
      ...(normalizedDraft.command ? { command: normalizedDraft.command } : { command: undefined }),
    };
    const next = [...this.agents];
    next[index] = updated;
    await this.configManager.save(next);
    this.agents = next;
    this.changedEmitter.fire();
    return updated;
  }

  public async delete(id: string): Promise<AgentConfig> {
    const agent = this.require(id);
    const next = this.agents.filter((candidate) => candidate.id !== id);
    await this.configManager.save(next);
    this.agents = next;
    this.changedEmitter.fire();
    return agent;
  }

  public async setModelSelection(
    id: string,
    model: string,
    reasoningEffort?: string,
  ): Promise<AgentConfig> {
    const index = this.agents.findIndex((agent) => agent.id === id);
    const existing = this.agents[index];
    if (!existing) {
      throw new UserFacingError('The selected agent no longer exists.');
    }
    const updated: AgentConfig = {
      ...existing,
      model,
      ...(reasoningEffort ? { reasoningEffort } : { reasoningEffort: undefined }),
    };
    const next = [...this.agents];
    next[index] = updated;
    await this.configManager.save(next);
    this.agents = next;
    this.changedEmitter.fire();
    return updated;
  }

  public require(id: string): AgentConfig {
    const agent = this.agents.find((candidate) => candidate.id === id);
    if (!agent) {
      throw new UserFacingError('The selected agent no longer exists.');
    }
    return agent;
  }

  public async validateFiles(agent: AgentConfig): Promise<void> {
    await this.configManager.validateAgentFiles(agent);
  }

  public async readInstructions(agent: AgentConfig): Promise<string> {
    await this.configManager.validateAgentFiles(agent);
    const contents = await vscode.workspace.fs.readFile(this.instructionsUri(agent));
    return new TextDecoder().decode(contents);
  }

  public instructionsUri(agent: AgentConfig): vscode.Uri {
    return this.configManager.resolveUri(agent.instructionsFile);
  }

  public workingDirectoryUri(agent: AgentConfig): vscode.Uri {
    return this.configManager.resolveUri(agent.cwd);
  }

  public async deleteInstructions(agent: AgentConfig): Promise<void> {
    await this.configManager.deleteInstructions(agent);
  }

  private assertUnique(name: string, exceptId?: string): void {
    if (this.agents.some((agent) => agent.id !== exceptId && agent.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      throw new UserFacingError(`An agent named "${name}" already exists.`);
    }
  }

  private async assertWorkingDirectory(relativePath: string): Promise<void> {
    const absolutePath = resolveInsideWorkspace(this.configManager.workspaceRoot, relativePath);
    let stat: vscode.FileStat;
    try {
      stat = await vscode.workspace.fs.stat(vscode.Uri.file(absolutePath));
    } catch {
      throw new UserFacingError(`Working directory does not exist: ${relativePath}.`);
    }
    if ((stat.type & vscode.FileType.Directory) === 0) {
      throw new UserFacingError(`Working directory is not a directory: ${relativePath}.`);
    }
  }
}

function normalizeDraft(draft: AgentDraft): AgentDraft {
  const command = draft.command?.trim();
  const specialties = [...new Set(
    draft.specialties?.map((specialty) => specialty.trim()).filter(Boolean),
  )];
  return {
    name: draft.name.trim(),
    provider: draft.provider,
    cwd: normalizeRelativePath(draft.cwd),
    ...(specialties.length > 0 ? { specialties } : {}),
    ...(command ? { command } : {}),
  };
}
