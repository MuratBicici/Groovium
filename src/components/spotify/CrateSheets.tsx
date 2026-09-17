import { useState } from 'react';
import type { SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import { useT } from '@/core/i18n';

/**
 * The menu and the two sheets an open crate offers about the playlist itself.
 *
 * Kept out of `OpenCrate`, which is about records. These are about the thing
 * that holds them: its details, and removing it from the library.
 *
 * All three are drawn inside the crate's own layer and cover only it. The
 * drawer's header and the deck beside it stay where they are, because nothing
 * here is a reason to hide the rest of the window.
 *
 * None of them listens for Escape itself. The crate does, once, and closes
 * whichever is on top — a second capture listener on `window` registered later
 * than the crate's would never hear the key.
 */

/**
 * What the ⋯ button opens.
 *
 * `onCover` is optional because the cover lives in a later part of this work;
 * the menu leaves the item out rather than showing one that does nothing.
 */
export function CrateMenu({
  onDetails,
  onRemove,
  onCover,
  onClose,
}: {
  onDetails: () => void;
  onRemove: () => void;
  onCover?: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <>
      {/* A catch for a press anywhere else, invisible: the menu is small and
          nothing behind it needs dimming to be understood. */}
      <button
        type="button"
        aria-label={t('common.close')}
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 z-20 cursor-default"
      />
      <div
        role="menu"
        className="absolute top-9 right-3 z-30 min-w-[160px] overflow-hidden rounded-md groove-surface py-1 shadow-lg ring-1 ring-[var(--color-edge)]"
      >
        {onCover && <MenuItem label={t('spotify.changeCover')} onPress={onCover} />}
        <MenuItem label={t('spotify.details')} onPress={onDetails} />
        <MenuItem label={t('spotify.removeFromLibrary')} onPress={onRemove} danger />
      </div>
    </>
  );
}

function MenuItem({
  label,
  onPress,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onPress}
      className={`block w-full px-3 py-1.5 text-left text-meta transition-colors hover:bg-shell-700 ${
        danger ? 'text-red-300 hover:text-red-200' : 'text-cream-200 hover:text-cream-50'
      }`}
    >
      {label}
    </button>
  );
}

/** A sheet over the crate, with a dimmed backdrop that closes it. */
function Sheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-5">
      <button
        type="button"
        aria-label={t('common.cancel')}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-shell-900/70 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-label={label}
        className="relative flex w-full max-w-[300px] flex-col gap-2 rounded-lg groove-surface groove-halo p-3 ring-1 ring-[var(--color-edge)]"
      >
        {children}
      </div>
    </div>
  );
}

/** Spotify's limit on a playlist description. */
const DESCRIPTION_MAX = 300;

/**
 * A playlist's description, and whether it is on the profile.
 *
 * The name is not here: it is edited in place in the crate's header, where it
 * already is. Saved together, since a change to either is one decision about
 * how the playlist presents itself.
 */
export function DetailsSheet({
  playlist,
  onSave,
  onClose,
}: {
  playlist: SpotifyPlaylist;
  onSave: (details: { description: string; isPublic: boolean }) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [description, setDescription] = useState(playlist.description);
  const [isPublic, setIsPublic] = useState(playlist.isPublic);
  const changed = description !== playlist.description || isPublic !== playlist.isPublic;

  return (
    <Sheet label={t('spotify.detailsTitle')} onClose={onClose}>
      <p className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
        {t('spotify.detailsTitle')}
      </p>
      <p className="truncate text-body text-cream-100">{playlist.name}</p>

      <label className="flex flex-col gap-1">
        <span className="text-meta text-cream-400">{t('spotify.description')}</span>
        <textarea
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          className="resize-none groove-inset rounded px-2 py-1 text-meta leading-snug text-cream-50 outline-none ring-1 ring-[var(--color-edge)] focus:ring-brass-500"
        />
      </label>

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
          className="mt-0.5 accent-[var(--color-brass-500)]"
        />
        <span className="flex flex-col">
          <span className="text-meta text-cream-100">{t('spotify.public')}</span>
          <span className="text-label leading-snug text-cream-400">{t('spotify.publicHint')}</span>
        </span>
      </label>

      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-label tracking-wide text-cream-400 uppercase transition-colors hover:text-cream-100"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={!changed}
          onClick={() => onSave({ description, isPublic })}
          className="rounded-full bg-brass-600 px-3 py-1 text-label font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500 disabled:opacity-40"
        >
          {t('common.save')}
        </button>
      </div>
    </Sheet>
  );
}

/**
 * Removing a playlist from the library, confirmed.
 *
 * Says what actually happens rather than "delete": Spotify has no delete, the
 * playlist leaves the library, and for ninety days it can be put back from the
 * account page. Somebody who knows that can press the button without being
 * afraid of it.
 */
export function RemoveSheet({
  playlist,
  onRemove,
  onClose,
}: {
  playlist: SpotifyPlaylist;
  onRemove: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Sheet label={t('spotify.removeFromLibrary')} onClose={onClose}>
      <p className="text-body text-cream-100">
        {t('spotify.removeConfirmTitle', { name: playlist.name })}
      </p>
      <p className="text-meta leading-snug text-cream-400">{t('spotify.removeConfirmBody')}</p>
      <div className="mt-1 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-full px-3 py-1 text-label tracking-wide text-cream-400 uppercase transition-colors hover:text-cream-100"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full bg-red-700 px-3 py-1 text-label font-medium tracking-wide text-red-50 uppercase transition-colors hover:bg-red-600"
        >
          {t('common.remove')}
        </button>
      </div>
    </Sheet>
  );
}
