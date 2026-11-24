import { create } from 'zustand';

/** What a notice is about, which is what its mark says at a glance. */
export type NoticeKind = 'done' | 'problem' | 'info';

/**
 * Something said on the notice that does not come from the player: a link copied,
 * the equaliser having to stop. Kept apart from the player's `error` so nothing that
 * reads errors mistakes one of these for one.
 */
/** Something the notice offers to do about what it says. */
export interface NoticeAction {
  label: string;
  onPress: () => void;
}

export const useNotice = create<{ message: string | null; kind: NoticeKind; action: NoticeAction | null }>(() => ({
  message: null,
  kind: 'done',
  action: null,
}));

/** Say it. Done unless told otherwise; with something to do about it, if there is. */
export function tellNotice(message: string, kind: NoticeKind = 'done', action: NoticeAction | null = null): void {
  useNotice.setState({ message, kind, action });
}

/** Put the card away. */
export function clearNotice(): void {
  useNotice.setState({ message: null, action: null });
}
