// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2068: a chart's slot is reported once, the first time it is in view; and
 * every slot is reported at once where there is no observer to ask.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { installFakeIntersectionObserver, type FakeIntersectionObservers } from './testing';
import { SLOT_ROOT_MARGIN, watchUntilSeen } from './visibility';

let observers: FakeIntersectionObservers | undefined;

afterEach(() => {
  observers?.restore();
  observers = undefined;
});

function slots(...names: readonly string[]): Map<string, Element> {
  return new Map(names.map((name) => [name, document.createElement('div')]));
}

describe('watchUntilSeen', () => {
  it('reports nothing until a slot is in view, then that slot alone, once', async () => {
    observers = installFakeIntersectionObserver();
    const targets = slots('power', 'heartRate', 'cadence');
    const seen: string[][] = [];
    const stop = watchUntilSeen(targets, (keys) => seen.push([...keys]));
    expect(seen).toEqual([]);
    expect(observers.observed()).toEqual([...targets.values()]);

    await observers.reveal([targets.get('heartRate') as Element]);
    expect(seen).toEqual([['heartRate']]);
    // Seen once is seen: no longer watched, so a second sighting says nothing.
    expect(observers.observed()).not.toContain(targets.get('heartRate'));
    await observers.reveal([targets.get('heartRate') as Element]);
    expect(seen).toEqual([['heartRate']]);

    await observers.reveal([targets.get('power') as Element, targets.get('cadence') as Element]);
    expect(seen).toEqual([['heartRate'], ['power', 'cadence']]);
    stop();
    expect(observers.observed()).toEqual([]);
  });

  it('ignores an entry that is not intersecting', async () => {
    observers = installFakeIntersectionObserver();
    const targets = slots('power');
    const seen: string[][] = [];
    watchUntilSeen(targets, (keys) => seen.push([...keys]));
    // An observer's first callback reports every target, the ones off screen
    // as not intersecting: those are still to be seen.
    const element = targets.get('power') as Element;
    await observers.reveal([element], false);
    expect(seen).toEqual([]);
    expect(observers.observed()).toContain(element);
  });

  it('asks for a margin, so the next chart is read before the rider reaches it', () => {
    let margin: string | undefined;
    const before = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      constructor(_callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        margin = options?.rootMargin;
      }
      observe(): void {}
      disconnect(): void {}
    } as unknown as typeof IntersectionObserver;
    try {
      watchUntilSeen(slots('power'), () => undefined);
    } finally {
      globalThis.IntersectionObserver = before;
    }
    expect(margin).toBe(SLOT_ROOT_MARGIN);
  });

  it('reports every slot at once where there is no IntersectionObserver', () => {
    expect(typeof globalThis.IntersectionObserver).toBe('undefined');
    const seen: string[][] = [];
    watchUntilSeen(slots('power', 'speed'), (keys) => seen.push([...keys]));
    expect(seen).toEqual([['power', 'speed']]);
  });

  it('reports nothing for no slots', () => {
    const seen: string[][] = [];
    watchUntilSeen(new Map<string, Element>(), (keys) => seen.push([...keys]));
    expect(seen).toEqual([]);
  });
});
