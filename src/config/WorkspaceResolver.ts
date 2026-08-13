import * as vscode from 'vscode';
import { UserFacingError } from './validation';

export class WorkspaceResolver {
  public getPrimaryFolder(): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.workspaceFolders?.[0];
  }

  public requirePrimaryFolder(): vscode.WorkspaceFolder {
    const folder = this.getPrimaryFolder();
    if (!folder) {
      throw new UserFacingError('Open a folder or workspace before using Agent Workspace.');
    }
    return folder;
  }
}
