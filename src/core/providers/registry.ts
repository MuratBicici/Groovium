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

