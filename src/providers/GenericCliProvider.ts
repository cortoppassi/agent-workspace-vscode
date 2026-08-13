import type { AgentConfig } from '../config/types';
import { UserFacingError } from '../config/validation';
import type { AgentProvider, TerminalLaunch } from './AgentProvider';

export class GenericCliProvider implements AgentProvider {
  public readonly id = 'custom';
  public readonly displayName = 'Custom CLI';

  public buildLaunch(agent: AgentConfig): TerminalLaunch {
    const command = agent.command?.trim();
    if (!command) {
      throw new UserFacingError(`Agent "${agent.name}" does not have a custom CLI command.`);
    }
    return { kind: 'shell', command };
  }
}
