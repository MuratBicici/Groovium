import { describe, expect, it } from 'vitest';
import { shouldOffer, type Offer } from './offer';

/**
 * Whether the waiting version gets put in front of somebody.
 *
 * These exist because the thing they describe cannot be tried by hand: seeing
 * the offer appear means running a build that is deliberately out of date
 * against a real release. So every clause gets a test, and the first of them is
 * the one that matters — a stranger on an old version, opening the app for the
 * first time since a release went out.
 */

/** A person on an old version who has answered nothing and hidden nothing. */
const stranger: Offer = {
  settingsReady: true,
  compact: false,
  whatsNewOpen: false,
  offeredVersion: '1.1.0',
  putAwayVersion: null,
  declinedVersion: null,
};

describe('offering an update', () => {
  it('offers it to somebody on an old version who has said nothing', () => {
    // The whole point of the feature, and the case nobody can check by hand.
    // A fresh install has null for both answers — `DEFAULT_SETTINGS` on the
    // one side and `None` in `config.rs` on the other — so this is what an
    // ordinary listener looks like on the launch after a release.
    expect(shouldOffer(stranger)).toBe(true);
  });

  it('says nothing before the stored answers have been read', () => {
    // Settings arrive from a file. Offering ahead of them would be asking a
    // question whose answer might already be on disk.
    expect(shouldOffer({ ...stranger, settingsReady: false })).toBe(false);
  });

  it('says nothing while there is no version on offer', () => {
    expect(shouldOffer({ ...stranger, offeredVersion: null })).toBe(false);
  });

  it('waits until the widget is not collapsed', () => {
    // The one clause that turns somebody away rather than answering them. A
    // dialog does not fit in a bar a few controls tall, and one shown there
    // would be marked seen having been read by nobody.
    expect(shouldOffer({ ...stranger, compact: true })).toBe(false);
  });

  it('waits behind this version summary rather than stacking on it', () => {
    // The launch after an update installs itself opens on what changed. The
    // next offer can wait the few seconds that takes.
    expect(shouldOffer({ ...stranger, whatsNewOpen: true })).toBe(false);
  });

  it('does not ask again about a version put away this launch', () => {
    expect(shouldOffer({ ...stranger, putAwayVersion: '1.1.0' })).toBe(false);
  });

  it('does not ask again about a version answered with Later', () => {
    // Kept across launches on purpose. Saying no costs nobody the update —
    // the dot stays in Settings and it installs from there.
    expect(shouldOffer({ ...stranger, declinedVersion: '1.1.0' })).toBe(false);
  });

  it('asks about a new version even though the last one was turned down', () => {
    // Why both answers are a version rather than a flag. Putting one offer
    // aside is not asking to be left alone about every later one.
    expect(
      shouldOffer({ ...stranger, putAwayVersion: '1.0.9', declinedVersion: '1.0.9' }),
    ).toBe(true);
  });
});
