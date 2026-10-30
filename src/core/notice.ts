import { create } from 'zustand';

/**
 * Something said on the notice card that is not a failure: a link copied.
 *
 * The card was only ever the player's errors, and the battery saver's word.
 * This is the plain third kind — a line that confirms something done — kept
 * apart from `error` so nothing that reads errors mistakes it for one.
 */
export const useNotice = create<{ message: string | null }>(() => ({ message: null }));

/** Say it on the card. */
export function tellNotice(message: string): void {
  useNotice.setState({ message });
}

/** Put the card away. */
export function clearNotice(): void {
  useNotice.setState({ message: null });
}
