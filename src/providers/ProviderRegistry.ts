import type { ProviderId } from '../config/types';
import { UserFacingError } from '../config/validation';
import type { AgentProvider } from './AgentProvider';
import { CodexProvider } from './CodexProvider';
import { GenericCliProvider } from './GenericCliProvider';

export class ProviderRegistry {
  private readonly providers: ReadonlyMap<ProviderId, AgentProvider>;

  public constructor(providers: readonly AgentProvider[] = [new CodexProvider(), new GenericCliProvider()]) {
    this.providers = new Map(providers.map((provider) => [provider.id, provider]));
  }

  public get(id: ProviderId): AgentProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new UserFacingError(`Unsupported provider: ${id}.`);
    }
    return provider;
  }

  public displayName(id: ProviderId): string {
    return this.get(id).displayName;
  }
}
