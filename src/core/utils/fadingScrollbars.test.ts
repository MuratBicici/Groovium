import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fadeScrollbarsWhenIdle } from './fadingScrollbars';

/** As much of an element as is touched here. These tests run without a DOM. */
class FakeElement {
  private readonly attributes = new Map<string, string>();
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

describe('scrollbars that fade when nothing is scrolling', () => {
  let listener: ((event: Event) => void) | null;
  let stop: () => void;
  let list: FakeElement;
  let root: FakeElement;
  let page: object;

  const scroll = (target: unknown) => listener?.({ target } as unknown as Event);
  const state = (el: FakeElement) => el.getAttribute('data-scrollbar');

  beforeEach(() => {
    vi.useFakeTimers();
    list = new FakeElement();
    root = new FakeElement();
    listener = null;
    page = {
      documentElement: root,
      addEventListener: (_type: string, added: (event: Event) => void) => {
        listener = added;
      },
      removeEventListener: () => {
        listener = null;
      },
    };
    vi.stubGlobal('document', page);
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('Element', FakeElement);
    stop = fadeScrollbarsWhenIdle();
  });

  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('leaves a list that has never scrolled alone', () => {
    expect(state(list)).toBeNull();
  });

  it('shows the one list that scrolled', () => {
    const other = new FakeElement();
    scroll(list);
    expect(state(list)).toBe('shown');
    expect(state(other)).toBeNull();
  });

  it('lets it go once the scrolling has stopped for a while', () => {
    scroll(list);
    vi.advanceTimersByTime(1199);
    expect(state(list)).toBe('shown');
    vi.advanceTimersByTime(1);
    expect(state(list)).toBe('idle');
  });

  it('keeps it for as long as the scrolling goes on', () => {
    scroll(list);
    vi.advanceTimersByTime(1000);
    scroll(list);
    vi.advanceTimersByTime(1000);
    expect(state(list)).toBe('shown');
  });

  it('counts the page itself as the root element', () => {
    scroll(page);
    expect(state(root)).toBe('shown');
  });

  it('stops listening when told to', () => {
    stop();
    scroll(list);
    expect(state(list)).toBeNull();
  });
});
