// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * PR #2621's review: `useStandingsRoom` measures again when a panel is added
 * to the HUD, and when a panel's class or style changes — either can move the
 * standings or the actions panel without resizing a box a `ResizeObserver`
 * watches. jsdom lays nothing out, so the boxes are stubbed per element and
 * the `ResizeObserver` is a fake that records what it watches. Where the room
 * is on a real stage is the browser gate's (`lap-race-hud.browser.spec.ts`
 * §"#2599").
 */

import { act, useRef, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mount, type Mounted } from '../../testing/mount';
import { useStandingsRoom } from './standings-room';

/** Every element a fake ResizeObserver has been asked to watch. */
let watched: Element[] = [];

class FakeResizeObserver {
  observe(target: Element): void {
    watched.push(target);
  }
  unobserve(): void {}
  disconnect(): void {}
}

/** The boxes the stub hands back, by the element's `data-box` name. */
const boxes = new Map<string, { top: number; bottom: number; left: number; right: number }>();

let mounted: Mounted | undefined;

beforeEach(() => {
  watched = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const name = this.getAttribute('data-box') ?? '';
    const box = boxes.get(name) ?? { top: 0, bottom: 0, left: 0, right: 0 };
    return {
      ...box,
      x: box.left,
      y: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
      toJSON: () => box,
    };
  });
  // The standings to 509, their list 300 → 500 of eight 25 px lines, the
  // actions panel from 900: room for every line.
  boxes.set('standings', { top: 280, bottom: 509, left: 700, right: 1000 });
  boxes.set('list', { top: 300, bottom: 500, left: 700, right: 1000 });
  boxes.set('line', { top: 300, bottom: 325, left: 700, right: 1000 });
  boxes.set('actions', { top: 900, bottom: 1000, left: 680, right: 1000 });
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  boxes.clear();
});

function Standings(): JSX.Element {
  const panel = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const fit = useStandingsRoom(panel, list, 8);
  return (
    <section ref={panel} data-box="standings" data-fit={fit === undefined ? 'all' : String(fit)}>
      <ol ref={list} data-box="list">
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index} data-box="line" />
        ))}
      </ol>
    </section>
  );
}

function Hud(): JSX.Element {
  return (
    <div className="oyl-hud">
      <div className="oyl-hud__actions" data-box="actions" />
      <Standings />
    </div>
  );
}

function fitOf(container: HTMLElement): string | null {
  return container.querySelector('section')?.getAttribute('data-fit') ?? null;
}

/** Let the MutationObserver's microtask run, and React render what it set. */
async function delivered(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useStandingsRoom — measured again when the HUD changes (PR #2621)', () => {
  it('measures at mount, and draws every line where the room holds them', async () => {
    mounted = await mount(<Hud />);
    expect(fitOf(mounted.container)).toBe('all');
  });

  it('measures again, and watches the new panel, when a panel is added to the HUD', async () => {
    mounted = await mount(<Hud />);
    const hud = mounted.container.querySelector('.oyl-hud');
    if (hud === null) throw new Error('no HUD');
    // The panel added pushes the actions panel up: 300 + 4 lines of 25 + 9
    // below the list + 16 clear is 425.
    boxes.set('actions', { top: 425, bottom: 1000, left: 680, right: 1000 });
    const added = document.createElement('div');
    hud.append(added);
    await delivered();
    expect(fitOf(mounted.container)).toBe('4');
    expect(watched).toContain(added);
  });

  it('measures again when a panel’s style moves it without resizing it', async () => {
    mounted = await mount(<Hud />);
    const actions = mounted.container.querySelector<HTMLElement>('.oyl-hud__actions');
    if (actions === null) throw new Error('no actions panel');
    boxes.set('actions', { top: 450, bottom: 750, left: 680, right: 1000 });
    actions.style.marginTop = '-250px';
    await delivered();
    expect(fitOf(mounted.container)).toBe('5');
  });
});
