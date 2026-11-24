import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TrackMetadata } from "@/core/types";
import { usePlaylistPicker } from "@/components/playlists/PlaylistPicker";
import {
  explainHeartOnce,
  learnLiked,
  setLiked,
  useHeartHint,
  useLikes,
} from "@/core/spotify/likes";
import { useT } from "@/core/i18n";

/**
 * The heart on the deck, where the plus was.
 *
 * Pressed, it likes the song on the deck on Spotify, or takes the like back.
 * Right-clicked, it opens what the plus opened: the playlists to add the song
 * to. The first press says so, once, instead of saying what it did.
 *
 * A song from this computer has no Spotify library to go into, so a press on
 * one opens the playlists, as the plus always did.
 */
export function LikeButton({ track }: { track: TrackMetadata | null }) {
  const t = useT();
  const { pick } = usePlaylistPicker();
  const spotify = track?.source === "spotify";
  const liked = useLikes((s) => (track ? s.saved[track.id] === true : false));
  const id = track?.id;
  const button = useRef<HTMLButtonElement | null>(null);
  const hinting = useHeartHint((s) => s.open);

  useEffect(() => {
    if (id && spotify) void learnLiked([id]);
  }, [id, spotify]);

  return (
    <>
      {hinting && <HeartHint anchor={button} />}
      <button
        ref={button}
        type="button"
        aria-pressed={spotify ? liked : undefined}
        aria-label={
          !track
            ? t("like.like")
            : !spotify
              ? t("playlists.addNamed", { title: track.title })
              : liked
                ? t("like.unlikeNamed", { title: track.title })
                : t("like.likeNamed", { title: track.title })
        }
        title={spotify ? t("like.title") : t("playlists.add")}
        disabled={!track}
        onClick={() => {
          if (!track) return;
          if (!spotify) {
            pick(track);
            return;
          }
          const first = explainHeartOnce();
          void setLiked(track.id, !liked, "song", first);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (track) pick(track);
        }}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-35 ${
          liked
            ? "text-brass-400 hover:text-brass-300"
            : "text-cream-400 hover:text-cream-200 disabled:hover:text-cream-400"
        }`}
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          aria-hidden="true"
          fill={liked ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        >
          <path d="M12 20s-7.5-4.6-7.5-10.1A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z" />
        </svg>
      </button>
    </>
  );
}

/**
 * The once-only balloon that says what the heart does, grown out of the heart
 * in the hints' own dress, with a point down at it. Put away with its button,
 * a press anywhere else, or Escape.
 */
function HeartHint({
  anchor,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
}) {
  const t = useT();
  const balloon = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  const close = () => useHeartHint.setState({ open: false });

  // Placed over the heart before it is first drawn, then grown out of it.
  useLayoutEffect(() => {
    const el = balloon.current;
    const heart = anchor.current;
    if (!el || !heart) return;
    const box = heart.getBoundingClientRect();
    const width = el.offsetWidth;
    const left = Math.max(
      6,
      Math.min(
        window.innerWidth - width - 6,
        box.left + box.width / 2 - width / 2,
      ),
    );
    el.style.setProperty("--x", `${Math.round(left)}px`);
    el.style.setProperty(
      "--y",
      `${Math.round(box.top - 12 - el.offsetHeight)}px`,
    );
    el.style.setProperty(
      "--ox",
      `${Math.round(box.left + box.width / 2 - left)}px`,
    );
    const grow = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(grow);
  }, [anchor]);

  useEffect(() => {
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (
        e.type === "pointerdown" &&
        balloon.current?.contains(e.target as Node)
      )
        return;
      close();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", away, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", away, true);
    };
  }, []);

  return (
    <div
      ref={balloon}
      role="status"
      className="groove-tip groove-coach"
      data-shown={shown ? "" : undefined}
    >
      <p>{t("like.hint")}</p>
      <button type="button" onClick={close} className="groove-coach-done">
        {t("whatsNew.dismiss")}
      </button>
    </div>
  );
}
