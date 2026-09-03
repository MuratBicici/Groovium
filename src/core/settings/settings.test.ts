import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/settings')>()),
  saveSettings: vi.fn(async () => true),
}));

import { DEFAULT_SETTINGS, saveSettings, type Settings } from '@/core/settings';
import { useSettingsStore } from '@/core/settings/store';
import { APP_VERSION } from '@/core/version';

const saved = vi.mocked(saveSettings);

/** The last thing written to disk, which is the whole settings object each time. */
const lastWrite = () => saved.mock.calls.at(-1)?.[0] as Settings;

beforeEach(() => {
  saved.mockClear();
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, ready: true });
});

describe('remembering that a version has been shown', () => {
  it('records the running version', () => {
    expect(useSettingsStore.getState().lastSeenVersion).toBeNull();
    useSettingsStore.getState().markVersionSeen();
    expect(useSettingsStore.getState().lastSeenVersion).toBe(APP_VERSION);
  });

  it('writes every other preference back unchanged', () => {
    // `config.json` is rewritten whole, so a field missing from `commit` is a
    // preference silently reset. This is the test that notices.
    useSettingsStore.setState({
      theme: 'espresso',
      language: 'tr',
      reduceMotion: true,
      alwaysOnTop: true,
      compact: true,
      drawerOpen: true,
      customPrimary: '#123456',
      customSecondary: '#654321',
      boostContrast: true,
      windowBorder: true,
      declinedVersion: '2.0.0',
    });

    useSettingsStore.getState().markVersionSeen();

    expect(lastWrite()).toEqual({
      theme: 'espresso',
      language: 'tr',
      reduceMotion: true,
      alwaysOnTop: true,
      compact: true,
      drawerOpen: true,
      customPrimary: '#123456',
      customSecondary: '#654321',
      boostContrast: true,
      windowBorder: true,
      lastSeenVersion: APP_VERSION,
      declinedVersion: '2.0.0',
    });
  });

  it('does not write again once it has been recorded', () => {
    // Settings can re-open the summary, and each of those closes marks it read.
    useSettingsStore.getState().markVersionSeen();
    useSettingsStore.getState().markVersionSeen();
    useSettingsStore.getState().markVersionSeen();
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('records a version again after an upgrade left an older one behind', () => {
    useSettingsStore.setState({ lastSeenVersion: '0.9.0' });
    useSettingsStore.getState().markVersionSeen();
    expect(lastWrite().lastSeenVersion).toBe(APP_VERSION);
  });
});

describe('turning down an offered update', () => {
  it('records the version that was declined', () => {
    useSettingsStore.getState().declineVersion('1.0.5');
    expect(useSettingsStore.getState().declinedVersion).toBe('1.0.5');
  });

  it('does not write again for the same version', () => {
    // Every launch re-offers until it is answered, and answering it twice is
    // the same answer.
    useSettingsStore.getState().declineVersion('1.0.5');
    useSettingsStore.getState().declineVersion('1.0.5');
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it('asks again about a later version', () => {
    // The point of recording a version rather than a boolean: saying no once
    // is not saying no for ever.
    useSettingsStore.setState({ declinedVersion: '1.0.5' });
    useSettingsStore.getState().declineVersion('1.0.6');
    expect(lastWrite().declinedVersion).toBe('1.0.6');
  });

  it('leaves what has been seen alone', () => {
    useSettingsStore.setState({ lastSeenVersion: '1.0.4' });
    useSettingsStore.getState().declineVersion('1.0.5');
    expect(lastWrite().lastSeenVersion).toBe('1.0.4');
  });
});

describe('the settings that survive a restart', () => {
  it('starts with nothing seen, so a first run is told once', () => {
    // Equally true of an install that predates the field: a missing key reads
    // as the default on both sides of the boundary.
    expect(DEFAULT_SETTINGS.lastSeenVersion).toBeNull();
  });

  it('starts with nothing declined, so the first offer is made', () => {
    expect(DEFAULT_SETTINGS.declinedVersion).toBeNull();
  });

  it('starts with the drawer shut', () => {
    expect(DEFAULT_SETTINGS.drawerOpen).toBe(false);
  });
});

describe('collapsing the window', () => {
  it('closes the drawer with it', () => {
    // A `z-20` panel collapsing is only hidden; the drawer is width the window
    // does not have while collapsed, so it has to actually shut. Recorded
    // rather than derived, so the state on disk is the state on screen.
    useSettingsStore.setState({ drawerOpen: true });
    useSettingsStore.getState().setCompact(true);
    expect(lastWrite()).toMatchObject({ compact: true, drawerOpen: false });
  });

  it('leaves the drawer alone when opening back up', () => {
    // Expanding says nothing about the drawer: whatever it was before the
    // collapse is what it still is.
    useSettingsStore.setState({ compact: true, drawerOpen: false });
    useSettingsStore.getState().setCompact(false);
    expect(lastWrite()).toMatchObject({ compact: false, drawerOpen: false });
  });
});
