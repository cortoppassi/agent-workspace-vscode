import type { AgentConfig } from '../config/types';
import type { AgentStatus } from './AgentStatus';

export interface Agent extends AgentConfig {
  readonly status: AgentStatus;
}
