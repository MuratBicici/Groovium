import { describe, expect, it, vi } from 'vitest';
import { forgetAccount, onAccountChange } from './spotifyAuth';

/**
 * Being told the account has gone.
 *
 * The playlist store had a `forget` that nothing called, so signing out left
 * the previous account's shelf, crates and spotlight in memory. This is the
 * line it now listens on: `forgetAccount` runs on signing out and on clearing
 * the Client ID, and whatever is listening hears about it.
 */
describe('announcing that the account has changed', () => {
  it('tells every listener when the account is forgotten', () => {
    const one = vi.fn();
    const two = vi.fn();
    const stopOne = onAccountChange(one);
    const stopTwo = onAccountChange(two);

    forgetAccount();

    expect(one).toHaveBeenCalledWith(null);
    expect(two).toHaveBeenCalledWith(null);
    stopOne();
    stopTwo();
  });

  it('stops telling a listener that has stopped listening', () => {
    const listener = vi.fn();
    const stop = onAccountChange(listener);
    stop();

    forgetAccount();
    expect(listener).not.toHaveBeenCalled();
  });
});
