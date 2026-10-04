/**
 * The queue's place in the drawer: shown over whatever the drawer holds, and
 * gone again the way it came.
 *
 * The drawer already holds the library or the lyrics. The queue goes over both
 * rather than becoming a third thing to switch between, because it is looked at
 * for a moment — what is coming, a song moved, one taken out — and then the
 * drawer is wanted back as it was. So it remembers whether it brought the
 * drawer out itself: if it did, putting it away puts the drawer away too.
 */

export interface QueueView {
  shown: boolean;
  /** The drawer was shut until the queue opened it. */
  openedDrawer: boolean;
}

export const queueHidden: QueueView = { shown: false, openedDrawer: false };

/** The queue button: out, opening the drawer if need be; away, as it found it. */
export function pressQueue(
  view: QueueView,
  drawerOpen: boolean,
): { view: QueueView; drawerOpen: boolean } {
  if (view.shown) return { view: queueHidden, drawerOpen: view.openedDrawer ? false : drawerOpen };
  return { view: { shown: true, openedDrawer: !drawerOpen }, drawerOpen: true };
}
