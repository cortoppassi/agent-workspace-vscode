import path from 'node:path';
import * as vscode from 'vscode';
import type { AgentConfig, WorkspaceConfig } from './types';
import { parseWorkspaceConfig, resolveInsideWorkspace, UserFacingError } from './validation';

const CONFIG_DIRECTORY = '.agent-workspace';
const CONFIG_FILE = 'config.json';

export class ConfigManager {
  public constructor(private readonly workspaceFolder: vscode.WorkspaceFolder) {}

  public get workspaceRoot(): string {
    return this.workspaceFolder.uri.fsPath;
  }

  public async load(): Promise<WorkspaceConfig> {
    const configUri = this.configUri();
    let contents: Uint8Array;
    try {
      contents = await vscode.workspace.fs.readFile(configUri);
    } catch (error: unknown) {
      if (isFileNotFound(error)) {
        return { version: 1, agents: [] };
      }
      throw new UserFacingError('Could not read .agent-workspace/config.json.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(contents));
    } catch {
      throw new UserFacingError('.agent-workspace/config.json contains invalid JSON.');
    }
    return parseWorkspaceConfig(parsed);
  }

  public async save(agents: readonly AgentConfig[]): Promise<void> {
    const directory = vscode.Uri.joinPath(this.workspaceFolder.uri, CONFIG_DIRECTORY);
    await vscode.workspace.fs.createDirectory(directory);
    const config: WorkspaceConfig = { version: 1, agents };
    const data = new TextEncoder().encode(`${JSON.stringify(config, undefined, 2)}\n`);
    const target = this.configUri();
    const temporary = vscode.Uri.joinPath(directory, `${CONFIG_FILE}.tmp`);
    try {
      await vscode.workspace.fs.writeFile(temporary, data);
      await vscode.workspace.fs.rename(temporary, target, { overwrite: true });
    } catch {
      throw new UserFacingError('Could not save .agent-workspace/config.json.');
    }
  }

  public async createInstructions(agent: AgentConfig): Promise<void> {
    const uri = this.resolveUri(agent.instructionsFile);
    const directory = vscode.Uri.file(path.dirname(uri.fsPath));
    const template = `# ${agent.name}\n\n## Role\n\nDescribe the responsibility of this agent.\n\n## Instructions\n\n- Add project-specific instructions here.\n\n## Constraints\n\n- Follow the existing project architecture.\n- Review existing code before making changes.\n`;
    try {
      await vscode.workspace.fs.createDirectory(directory);
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(template));
    } catch {
      throw new UserFacingError(`Could not create instructions file for "${agent.name}".`);
    }
  }

  public async deleteInstructions(agent: AgentConfig): Promise<void> {
    try {
      await vscode.workspace.fs.delete(this.resolveUri(agent.instructionsFile), { useTrash: true });
    } catch (error: unknown) {
      if (!isFileNotFound(error)) {
        throw new UserFacingError(`Could not remove instructions file for "${agent.name}".`);
      }
    }
  }

  public resolveUri(relativePath: string): vscode.Uri {
    return vscode.Uri.file(resolveInsideWorkspace(this.workspaceRoot, relativePath));
  }

  public async validateAgentFiles(agent: AgentConfig): Promise<void> {
    const cwd = this.resolveUri(agent.cwd);
    const instructions = this.resolveUri(agent.instructionsFile);
    const cwdStat = await statOrUndefined(cwd);
    if (!cwdStat || (cwdStat.type & vscode.FileType.Directory) === 0) {
      throw new UserFacingError(`Working directory for "${agent.name}" does not exist: ${agent.cwd}.`);
    }
    const instructionsStat = await statOrUndefined(instructions);
    if (!instructionsStat || (instructionsStat.type & vscode.FileType.File) === 0) {
      throw new UserFacingError(`Instructions file for "${agent.name}" does not exist: ${agent.instructionsFile}.`);
    }
  }

  private configUri(): vscode.Uri {
    return vscode.Uri.joinPath(this.workspaceFolder.uri, CONFIG_DIRECTORY, CONFIG_FILE);
  }
}

async function statOrUndefined(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
  try {
    return await vscode.workspace.fs.stat(uri);
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return undefined;
    }
    throw new UserFacingError(`Could not access ${uri.fsPath}.`);
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}
