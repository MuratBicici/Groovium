import { useEffect, useRef, useState } from 'react';
import { COVER_MAX_BYTES, type SpotifyPlaylist } from '@/core/providers/spotifyPlaylists';
import {
  centredPan,
  clampPan,
  coverScale,
  fitJpeg,
  MAX_ZOOM,
  sourceSquare,
  zoomAbout,
  type Point,
  type Size,
} from '@/core/spotify/cover';
import { useT } from '@/core/i18n';

/**
 * The menu and the sheets an open crate offers about the playlist itself.
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

/** What the ⋯ button opens. */
export function CrateMenu({
  onDetails,
  onRemove,
  onClose,
}: {
  onDetails: () => void;
  onRemove: () => void;
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

/**
 * The side of the cover in the details sheet: most of the height of the row it
 * starts, and large enough to judge a crop by.
 */
const THUMB = 112;

/**
 * The playlist's cover in the details sheet, which is also how it is changed.
 *
 * No button saying so: pointing at the cover dims it and shows a pencil, which
 * is enough for a picture that is plainly the playlist's. The label is still
 * there for a screen reader and as the tooltip. Without `onPress` — outside
 * the app, with no file dialog — it is only a picture.
 */
function CoverThumb({
  url,
  label,
  onPress,
}: {
  url: string | undefined;
  label: string;
  onPress?: () => void;
}) {
  const picture = (
    <span
      className="block overflow-hidden rounded-sm bg-shell-900 shadow-md ring-1 ring-[var(--color-edge)]"
      style={{ width: THUMB, height: THUMB }}
    >
      {url && <img src={url} alt="" draggable={false} className="h-full w-full object-cover" />}
    </span>
  );
  if (!onPress) return picture;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onPress}
      className="group relative block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-brass-500"
    >
      {picture}
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center rounded-sm bg-shell-900/60 text-cream-50 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.8 2.7l2.5 2.5L5.6 12.9 2.5 13.5l.6-3.1z" />
          <path d="M9.4 4.1l2.5 2.5" />
        </svg>
      </span>
    </button>
  );
}

/** Spotify's limit on a playlist description. */
const DESCRIPTION_MAX = 300;

/**
 * A playlist's cover, description, and whether it is on the profile.
 *
 * The name is not here: it is edited in place in the crate's header, where it
 * already is. Description and visibility are saved together, since a change to
 * either is one decision about how the playlist presents itself. The cover is
 * not part of that save: choosing one is its own step, with its own screen,
 * and it is sent when that screen's Upload is pressed.
 *
 * `onCover` is optional: outside the app there is no file dialog to choose a
 * picture with, and the button is left out rather than shown doing nothing.
 */
export function DetailsSheet({
  playlist,
  onSave,
  onCover,
  coverProblem,
  onClose,
}: {
  playlist: SpotifyPlaylist;
  onSave: (details: { description: string; isPublic: boolean }) => void;
  onCover?: () => void;
  /** Why the last picture chosen could not be used. */
  coverProblem?: string | null;
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

      {/* The cover on the left, large, and the description beside it at the
          same height — the two things that say what the playlist is. Whether
          it is public goes underneath, across the whole sheet, where its hint
          has room to be read on one or two lines instead of five. */}
      <div className="flex items-stretch gap-3">
        <CoverThumb
          url={playlist.coverArtUrl}
          label={t('spotify.changeCover')}
          {...(onCover && { onPress: onCover })}
        />

        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-meta text-cream-400">{t('spotify.description')}</span>
          <textarea
            value={description}
            maxLength={DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
            className="min-h-0 flex-1 resize-none groove-inset rounded px-2 py-1 text-meta leading-snug text-cream-50 outline-none ring-1 ring-[var(--color-edge)] focus:ring-brass-500"
          />
        </label>
      </div>

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
      {coverProblem && <p className="text-meta leading-snug text-red-300">{coverProblem}</p>}

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

/** The side of the square the picture is cropped in, on screen. */
const CROP_VIEW = 176;
/** The sleeve beside it, showing the result at about the size of a shelf's. */
const PREVIEW = 72;

/**
 * Choosing the square of a picture for a playlist's cover.
 *
 * Drag to move the picture, scroll or use the slider to zoom. The picture always
 * covers the square — there is no zooming out past its short side, because a
 * cover with empty edges is not a cover — and zooming holds the middle of the
 * square still. Beside it, the result at the size it will mostly be seen at.
 *
 * Uploading draws the square onto a canvas and brings it under Spotify's limit,
 * quality first and size after; see `fitJpeg`.
 */
export function CoverCrop({
  image,
  onUpload,
  onFailed,
  onClose,
}: {
  /** The picture, as a data URL. */
  image: string;
  onUpload: (base64Jpeg: string, preview: string) => void;
  onFailed: (message: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const picture = useRef<HTMLImageElement | null>(null);
  const [natural, setNatural] = useState<Size | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });

  // The latest callback, read when the picture fails to decode. Depending on it
  // instead would decode the picture again, and re-centre it, on every render.
  const failed = useRef(onFailed);
  useEffect(() => {
    failed.current = onFailed;
  }, [onFailed]);
  const unreadable = t('spotify.coverUnreadable');

  // The picture's own size, once it has decoded, and the crop centred on it.
  useEffect(() => {
    const img = new Image();
    let live = true;
    img.onload = () => {
      if (!live) return;
      picture.current = img;
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      setNatural(size);
      setZoom(1);
      setPan(centredPan(size, CROP_VIEW, coverScale(size, CROP_VIEW, 1)));
    };
    img.onerror = () => {
      if (live) failed.current(unreadable);
    };
    img.src = image;
    return () => {
      live = false;
    };
  }, [image, unreadable]);

  const scale = natural ? coverScale(natural, CROP_VIEW, zoom) : 1;

  function zoomTo(next: number) {
    if (!natural) return;
    const clamped = Math.min(MAX_ZOOM, Math.max(1, next));
    setPan(zoomAbout(pan, natural, CROP_VIEW, zoom, clamped));
    setZoom(clamped);
  }

  function drag(down: React.PointerEvent<HTMLDivElement>) {
    if (!natural || down.button !== 0) return;
    const target = down.currentTarget;
    const start = { x: down.clientX, y: down.clientY };
    const from = pan;
    target.setPointerCapture(down.pointerId);
    const move = (e: PointerEvent) => {
      setPan(
        clampPan(
          { x: from.x + e.clientX - start.x, y: from.y + e.clientY - start.y },
          natural,
          CROP_VIEW,
          scale,
        ),
      );
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  }

  function upload() {
    const img = picture.current;
    if (!img || !natural) return;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const square = sourceSquare(pan, CROP_VIEW, scale);
    const fitted = context
      ? fitJpeg((size, quality) => {
          canvas.width = size;
          canvas.height = size;
          // A transparent PNG has no background of its own, and a JPEG must.
          context.fillStyle = '#000';
          context.fillRect(0, 0, size, size);
          context.imageSmoothingQuality = 'high';
          context.drawImage(img, square.x, square.y, square.side, square.side, 0, 0, size, size);
          return canvas.toDataURL('image/jpeg', quality);
        }, COVER_MAX_BYTES)
      : null;
    if (!fitted) {
      onFailed(t('spotify.coverTooBig'));
      return;
    }
    onUpload(fitted.base64, fitted.dataUrl);
  }

  const drawn = natural
    ? { width: natural.width * scale, height: natural.height * scale }
    : { width: 0, height: 0 };
  const shrink = PREVIEW / CROP_VIEW;

  return (
    <Sheet label={t('spotify.coverTitle')} onClose={onClose}>
      <p className="text-label font-medium tracking-[0.18em] text-brass-400/80 uppercase">
        {t('spotify.coverTitle')}
      </p>
      <div className="flex items-end justify-center gap-3">
        <div
          onPointerDown={drag}
          onWheel={(e) => zoomTo(zoom * (1 - e.deltaY * 0.0015))}
          className="relative shrink-0 cursor-grab touch-none overflow-hidden rounded bg-shell-900 ring-1 ring-[var(--color-edge)] select-none active:cursor-grabbing"
          style={{ width: CROP_VIEW, height: CROP_VIEW }}
        >
          {natural && (
            <img
              src={image}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{ left: pan.x, top: pan.y, width: drawn.width, height: drawn.height }}
            />
          )}
        </div>
        {/* The same square, small, as a sleeve on the shelf. */}
        <div
          aria-hidden="true"
          className="shrink-0 rounded-sm bg-shell-900 shadow-md ring-1 ring-[var(--color-edge)]"
          style={{
            width: PREVIEW,
            height: PREVIEW,
            backgroundImage: natural ? `url(${image})` : undefined,
            backgroundSize: `${drawn.width * shrink}px ${drawn.height * shrink}px`,
            backgroundPosition: `${pan.x * shrink}px ${pan.y * shrink}px`,
            backgroundRepeat: 'no-repeat',
          }}
        />
      </div>
      <label className="flex items-center gap-2">
        <span className="shrink-0 text-meta text-cream-400">{t('spotify.coverZoom')}</span>
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          disabled={!natural}
          onChange={(e) => zoomTo(Number(e.target.value))}
          className="min-w-0 flex-1 accent-[var(--color-brass-500)]"
        />
      </label>
      <p className="text-label leading-snug text-cream-400">{t('spotify.coverHint')}</p>
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
          disabled={!natural}
          onClick={upload}
          className="rounded-full bg-brass-600 px-3 py-1 text-label font-medium tracking-wide text-on-accent uppercase transition-colors hover:bg-brass-500 disabled:opacity-40"
        >
          {t('spotify.coverUpload')}
        </button>
      </div>
    </Sheet>
  );
}
