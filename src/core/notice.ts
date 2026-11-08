import { create } from 'zustand';

/** What a notice is about, which is what its mark says at a glance. */
export type NoticeKind = 'done' | 'problem' | 'info';

/**
 * Something said on the notice that does not come from the player: a link copied,
 * the equaliser having to stop. Kept apart from the player's `error` so nothing that
 * reads errors mistakes one of these for one.
 */
export const useNotice = create<{ message: string | null; kind: NoticeKind }>(() => ({
  message: null,
  kind: 'done',
}));

/** Say it. Done unless told otherwise. */
export function tellNotice(message: string, kind: NoticeKind = 'done'): void {
  useNotice.setState({ message, kind });
}

/** Put the card away. */
export function clearNotice(): void {
  useNotice.setState({ message: null });
}
