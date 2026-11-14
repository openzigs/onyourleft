// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2599, the owner's ruling on PR #2621: a race's standings that scroll open
 * on the rider's own line, keep it in view as places change while nobody
 * holds the list, and ease back to it {@link STANDINGS_RETURN_MS} after the
 * rider's last touch or scroll — jumping, for a rider who asks for reduced
 * motion. jsdom lays nothing out, so the boxes are stubbed and `scrollTo` is
 * recorded; the fake clock stands in for the wait. Where the list is on a
 * real stage, and that a real finger scrolls it, is the browser gate's
 * (`lap-race-hud.browser.spec.ts` §"#2599").
 */

import { useRef, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, type Mounted } from '../../testing/mount';
import {
  STANDINGS_RETURN_MS,
  centredScrollTop,
  following,
  heldUntil,
  moreBeyond,
  needsScroll,
  useOwnLineInView,
} from './standings-follow';

describe('the arithmetic — #2599', () => {
  it('centres a row, held to what the list can scroll to', () => {
    const list = { height: 100, scrollHeight: 200 };
    expect(centredScrollTop({ top: 75, height: 25 }, list)).toBe(37.5);
    expect(centredScrollTop({ top: 0, height: 25 }, list)).toBe(0);
    expect(centredScrollTop({ top: 175, height: 25 }, list)).toBe(100);
  });

  it('scrolls only for a pixel or more', () => {
    expect(needsScroll(100, 100.5)).toBe(false);
    expect(needsScroll(100, 101)).toBe(true);
  });

  it('holds the list for the return time after a touch, and follows again from then', () => {
    const hold = heldUntil(1_000);
    expect(hold).toBe(1_000 + STANDINGS_RETURN_MS);
    expect(following(hold, hold - 1)).toBe(false);
    expect(following(hold, hold)).toBe(true);
    expect(following(undefined, 0)).toBe(true);
  });

  it('says which edges have more beyond them', () => {
    expect(moreBeyond({ scrollTop: 0, height: 100, scrollHeight: 200 })).toBe('below');
    expect(moreBeyond({ scrollTop: 50, height: 100, scrollHeight: 200 })).toBe('above below');
    expect(moreBeyond({ scrollTop: 100, height: 100, scrollHeight: 200 })).toBe('above');
    expect(moreBeyond({ scrollTop: 0, height: 200, scrollHeight: 200 })).toBe('');
  });
});

/** The list's scroll position, as the stubs keep it. */
let scrollTop = 0;
const scrolls: { top: number; behavior: string }[] = [];
let reducedMotion = false;
let mounted: Mounted | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  scrollTop = 0;
  scrolls.length = 0;
  reducedMotion = false;
  // Eight lines of 25 px in a list 100 px tall: four in view, 200 px to scroll.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const line = this.getAttribute('data-line');
    const top = line === null ? 0 : Number(line) * 25 - scrollTop;
    const height = line === null ? 100 : 25;
    return {
      top,
      bottom: top + height,
      left: 0,
      right: 300,
      x: 0,
      y: top,
      width: 300,
      height,
      toJSON: () => ({}),
    };
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100);
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(200);
  vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(() => scrollTop);
  Element.prototype.scrollTo = function (options?: ScrollToOptions | number): void {
    if (typeof options !== 'object') return;
    scrollTop = options.top ?? scrollTop;
    scrolls.push({ top: scrollTop, behavior: options.behavior ?? 'auto' });
  };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') && reducedMotion,
  }));
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function List(props: { own: number; room: number | undefined }): JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  useOwnLineInView(list, props.own, props.room);
  return (
    <div ref={list} data-testid="list">
      <ol>
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index} data-line={String(index)} />
        ))}
      </ol>
    </div>
  );
}

function listOf(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('[data-testid="list"]');
  if (element === null) throw new Error('no list');
  return element;
}

describe('useOwnLineInView — #2599', () => {
  it('opens on the rider’s own line, at once, and fades the edge with more beyond it', async () => {
    mounted = await mount(<List own={7} room={100} />);
    expect(scrolls).toEqual([{ top: 100, behavior: 'instant' }]);
    expect(listOf(mounted.container).getAttribute('data-oyl-more')).toBe('above');
  });

  it('does not scroll a list that does not scroll', async () => {
    mounted = await mount(<List own={7} room={undefined} />);
    expect(scrolls).toEqual([]);
  });

  it('keeps the own line in view as the place changes, and scrolls only when it moves', async () => {
    mounted = await mount(<List own={7} room={100} />);
    // A tick where the own line has not moved: no scroll, wherever the list is.
    scrollTop = 40;
    await mounted.rerender(<List own={7} room={100} />);
    expect(scrolls).toHaveLength(1);
    await mounted.rerender(<List own={4} room={100} />);
    expect(scrolls.at(-1)).toEqual({ top: 62.5, behavior: 'smooth' });
    expect(scrolls).toHaveLength(2);
  });

  it('jumps to the own line when the room changes, and eases only when the place does', async () => {
    mounted = await mount(<List own={7} room={100} />);
    scrollTop = 0;
    await mounted.rerender(<List own={7} room={125} />);
    expect(scrolls.at(-1)?.behavior).toBe('instant');
    scrollTop = 0;
    await mounted.rerender(<List own={6} room={125} />);
    expect(scrolls.at(-1)?.behavior).toBe('smooth');
  });

  it('leaves a list the rider scrolled, and eases back to the own line after the return time', async () => {
    mounted = await mount(<List own={7} room={100} />);
    const list = listOf(mounted.container);
    list.dispatchEvent(new Event('touchstart'));
    scrollTop = 0;
    list.dispatchEvent(new Event('scroll'));
    // A place changes while the rider holds the list: it is left alone.
    await mounted.rerender(<List own={5} room={100} />);
    vi.advanceTimersByTime(STANDINGS_RETURN_MS - 1);
    expect(scrolls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(scrolls.at(-1)).toEqual({ top: 87.5, behavior: 'smooth' });
  });

  it('counts the return time from the last scroll, not the first touch', async () => {
    mounted = await mount(<List own={7} room={100} />);
    const list = listOf(mounted.container);
    list.dispatchEvent(new Event('wheel'));
    vi.advanceTimersByTime(3_000);
    scrollTop = 20;
    list.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(STANDINGS_RETURN_MS - 1);
    expect(scrolls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(scrolls).toHaveLength(2);
  });

  it('jumps back rather than easing for a rider who asks for reduced motion', async () => {
    reducedMotion = true;
    mounted = await mount(<List own={7} room={100} />);
    const list = listOf(mounted.container);
    list.dispatchEvent(new Event('keydown'));
    scrollTop = 0;
    vi.advanceTimersByTime(STANDINGS_RETURN_MS);
    expect(scrolls.at(-1)).toEqual({ top: 100, behavior: 'instant' });
  });
});
