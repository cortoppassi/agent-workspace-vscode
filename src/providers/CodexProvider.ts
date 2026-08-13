import type { AgentConfig } from '../config/types';
import type { AgentProvider, TerminalLaunch } from './AgentProvider';

export class CodexProvider implements AgentProvider {
  public readonly id = 'codex';
  public readonly displayName = 'Codex';

  public buildLaunch(agent: AgentConfig): TerminalLaunch {
    const prompt = [
      'Before doing any work, read and follow the instructions in:',
      '',
      agent.instructionsFile,
      '',
      'These instructions define your role in this workspace.',
      '',
      'After reading them, wait for my next task.',
    ].join('\n');
    return { kind: 'direct', executable: 'codex', args: [prompt] };
  }
}
