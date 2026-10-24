import { createContext, useContext } from 'react';

/**
 * The shell, for something drawn inside a panel to be shown over the whole
 * window.
 *
 * A panel is its own stacking context and its own clipped box, so a sheet
 * drawn in it covers the panel and nothing else — which is right for a
 * crate's details and wrong for the search, which opens in the middle of the
 * window. Drawn into the shell through a portal instead, it keeps everything
 * the panel gives it: the panel's state, its callbacks, and the providers
 * around it, such as the one a record flies to the deck with.
 */
export const SheetHost = createContext<HTMLElement | null>(null);

/** The shell, once it is on the page. */
export function useSheetHost(): HTMLElement | null {
  return useContext(SheetHost);
}
