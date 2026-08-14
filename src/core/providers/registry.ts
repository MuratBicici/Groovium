import type { AudioProvider, SourceType } from '@/core/types';

/**
 * Live provider instances, held outside the Zustand store on purpose.
 *
 * A provider owns an `HTMLAudioElement` and event listeners. Putting that in
 * reactive state would make every render subscribe to a mutable object graph
 * that React cannot meaningfully diff. The store keeps only `activeProviderId`
 * and looks the instance up here when it needs to issue a command.
 */
const providers = new Map<SourceType, AudioProvider>();

export function registerProvider(provider: AudioProvider): void {
  const existing = providers.get(provider.id);
  if (existing && existing !== provider) existing.dispose();
  providers.set(provider.id, provider);
}

export function getProvider(id: SourceType): AudioProvider | undefined {
  return providers.get(id);
}

/** Look up a provider, throwing when it is missing. For code paths that require one. */
export function requireProvider(id: SourceType): AudioProvider {
  const provider = providers.get(id);
  if (!provider) throw new Error(`No provider registered for "${id}"`);
  return provider;
}

export function listProviders(): AudioProvider[] {
  return [...providers.values()];
}

/** Tear every provider down. Call on app unmount. */
export function disposeAllProviders(): void {
  for (const provider of providers.values()) provider.dispose();
  providers.clear();
}
