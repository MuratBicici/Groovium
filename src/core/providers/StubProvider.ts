import type { AuthResult } from '@/core/types';
import { BaseProvider } from './BaseProvider';

/**
 * Shared body for providers that are declared but not yet implemented.
 *
 * These exist so the registry, the source picker and the store can be built and
 * exercised against more than one provider today. Every method fails loudly
 * rather than silently doing nothing, so a half-wired integration is obvious.
 */
export abstract class StubProvider extends BaseProvider {
  async initialize(): Promise<boolean> {
    return false;
  }

  async authenticate(): Promise<AuthResult> {
    return { success: false, error: `${this.displayName} is not implemented yet.` };
  }

  async play(_trackId: string): Promise<void> {
    throw this.notImplemented('play');
  }

  async pause(): Promise<void> {
    throw this.notImplemented('pause');
  }

  async resume(): Promise<void> {
    throw this.notImplemented('resume');
  }

  async seek(_positionMs: number): Promise<void> {
    throw this.notImplemented('seek');
  }

  async setVolume(_volume: number): Promise<void> {
    throw this.notImplemented('setVolume');
  }

  protected notImplemented(method: string): Error {
    return new Error(`${this.displayName}: ${method}() is not implemented yet.`);
  }
}
