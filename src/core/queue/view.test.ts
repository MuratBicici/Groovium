import { describe, expect, it } from 'vitest';
import { pressQueue, queueHidden } from './view';

describe('the queue button', () => {
  it('opens the drawer on the queue, and shuts it again if it opened it', () => {
    const out = pressQueue(queueHidden, false);
    expect(out).toEqual({ view: { shown: true, openedDrawer: true }, drawerOpen: true });
    expect(pressQueue(out.view, out.drawerOpen)).toEqual({ view: queueHidden, drawerOpen: false });
  });

  it('leaves a drawer that was already out where it was', () => {
    const out = pressQueue(queueHidden, true);
    expect(out.view.openedDrawer).toBe(false);
    expect(pressQueue(out.view, true)).toEqual({ view: queueHidden, drawerOpen: true });
  });
});
