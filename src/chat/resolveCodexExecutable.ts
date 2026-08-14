import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CodexExecutable {
  readonly command: string;
  readonly argsPrefix: readonly string[];
  readonly windowsVerbatimArguments?: boolean;
}

export function resolveCodexExecutable(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  fileExists: (path: string) => boolean = existsSync,
): CodexExecutable | undefined {
  const pathDirectories = (environment.PATH ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);

  if (platform === 'win32') {
    const appDataNpm = environment.APPDATA ? join(environment.APPDATA, 'npm') : undefined;
    const directories = [...pathDirectories, ...(appDataNpm && !pathDirectories.includes(appDataNpm) ? [appDataNpm] : [])];
    const executable = findInDirectories(directories, 'codex.exe', fileExists);
    if (executable) {
      return { command: executable, argsPrefix: [] };
    }
    const commandScript = findInDirectories(directories, 'codex.cmd', fileExists);
    if (commandScript) {
      return {
        command: environment.ComSpec ?? 'cmd.exe',
        argsPrefix: ['/d', '/s', '/c', `"${commandScript}"`],
        windowsVerbatimArguments: true,
      };
    }
    return undefined;
  }

  const executable = findInDirectories(pathDirectories, 'codex', fileExists);
  return executable ? { command: executable, argsPrefix: [] } : undefined;
}

function findInDirectories(
  directories: readonly string[],
  filename: string,
  fileExists: (path: string) => boolean,
): string | undefined {
  return directories.map((directory) => join(directory, filename)).find((candidate) => fileExists(candidate));
}
