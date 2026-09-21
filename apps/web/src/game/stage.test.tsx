// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The ride takes the screen over — #423, the half jsdom can see.
 *
 * ## What is here and what is deliberately not
 *
 * jsdom performs no layout (CLAUDE.md §4e), so nothing in this file can say
 * that *Pause* is on screen, that a panel is in a corner or that the world
 * fills anything. `browser/ride.browser.spec.ts` measures all of that in the
 * pinned Chromium. What a DOM *can* say is the wiring that layout depends on,
 * and each of these is a thing that would leave the browser gate measuring the
 * wrong screen, or nothing:
 *
 * - the stage class is on the root for exactly as long as a ride has the screen;
 * - the shell is told when that starts and when it stops — including when the
 *   component is **unmounted** mid-ride, which is the platform's own Back;
 * - a resized canvas reaches the renderer, which #423 made load-bearing;
 * - a notice is laid out by the HUD rather than beside it.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer } from './port';
import type { GameTrainerPort } from './trainer-port';

function testRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.2),
    });
  }
  return { id: 'route-1', name: 'Test hill', profile: routeProfile(points), attempts: 0 };
}

const PORT: GamePort = {
  listRoutes: () => Promise.resolve([testRoute()]),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(220), live: true, paired: true },
    cadence: { value: 88, live: true, paired: true },
    heartRate: { value: 142, live: true, paired: true },
  }),
};

/** A renderer that records every size it is handed. */
function sizingRenderer(sizes: [number, number][]): GameRenderer {
  return {
    create: () => ({
      hasContext: true,
      render: () => undefined,
      setQuality: () => undefined,
      resize: (width: number, height: number) => {
        sizes.push([width, height]);
      },
      destroy: () => undefined,
    }),
  };
}

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
/** Every live observer's callback, so a test can fire a resize by hand. */
let observers: (() => void)[] = [];
let disconnected = 0;

beforeEach(() => {
  pending = [];
  observers = [];
  disconnected = 0;
  nowMs = 1_000_000;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // jsdom has no `ResizeObserver`, which is the case `GameView` guards for. A
  // stand-in here is what lets the *other* branch be tested at all.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly #callback: () => void;
      constructor(callback: () => void) {
        this.#callback = callback;
      }
      observe(): void {
        observers.push(this.#callback);
      }
      disconnect(): void {
        disconnected += 1;
      }
    },
  );
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
});

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) {
      return;
    }
    nowMs += 1000 / 30;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

function button(text: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((each) =>
    (each.textContent ?? '').startsWith(text),
  );
}

async function press(text: string): Promise<void> {
  const target = button(text);
  expect(target, `no "${text}" control`).toBeDefined();
  await act(async () => {
    target?.click();
    await Promise.resolve();
  });
  await settle();
}

async function ride(props: Partial<Parameters<typeof GameView>[0]> = {}): Promise<void> {
  mounted = await mount(<GameView port={PORT} now={() => nowMs} {...props} />);
  await settle();
  await press('Ride ');
  await pump(2);
  await settle();
}

function stage(): Element | null {
  return (mounted?.container ?? document).querySelector('.oyl-game--riding');
}

describe('the stage — #423', () => {
  it('is what a ride renders, and not what the route picker renders', async () => {
    mounted = await mount(<GameView port={PORT} now={() => nowMs} />);
    await settle();
    // The picker is a form. A stage class on it would make the form full-bleed
    // and fixed, over a shell that still has its header.
    expect(stage()).toBeNull();

    await press('Ride ');
    await pump(2);

    expect(stage()).not.toBeNull();
    // The world and the HUD are both INSIDE it: `theme.css` positions each
    // against this box, and one outside it is positioned against the page.
    expect(stage()?.querySelector('canvas.oyl-game__world')).not.toBeNull();
    expect(stage()?.querySelector('.oyl-hud')).not.toBeNull();
  });

  it('stays the stage while the ride is paused', async () => {
    // A paused ride still has the screen. Handing the chrome back on Pause
    // would move every control under a rider's thumb at the moment they
    // reached for one.
    await ride();
    await press('Pause');

    expect(stage()).not.toBeNull();
    expect(button('Resume')).toBeDefined();
  });

  it('goes when the ride ends', async () => {
    await ride();
    await press('End ride');

    expect(stage()).toBeNull();
    expect(button('Ride ')).toBeDefined();
  });
});

describe('the shell is told who has the screen — #423', () => {
  it('says nothing while a rider is still choosing a route', async () => {
    const heard: boolean[] = [];
    mounted = await mount(
      <GameView port={PORT} now={() => nowMs} onImmersive={(on) => heard.push(on)} />,
    );
    await settle();

    expect(heard).toEqual([]);
  });

  it('says so when the ride starts and again when it ends', async () => {
    const heard: boolean[] = [];
    await ride({ onImmersive: (on) => heard.push(on) });
    expect(heard).toEqual([true]);

    await press('End ride');
    expect(heard).toEqual([true, false]);
  });

  it('does not hand the screen back on Pause', async () => {
    const heard: boolean[] = [];
    await ride({ onImmersive: (on) => heard.push(on) });
    await press('Pause');
    await press('Resume');

    expect(heard).toEqual([true]);
  });

  it('hands the screen back when the rider leaves without pressing End ride', async () => {
    // ⚠️ The platform's own Back: the route changes, `AppShell` renders another
    // view and this component is unmounted mid-ride. Without the cleanup the
    // shell is left believing a ride has the screen, and the page the rider
    // landed on has no header, no navigation and no way back.
    const heard: boolean[] = [];
    await ride({ onImmersive: (on) => heard.push(on) });

    mounted?.unmount();
    mounted = undefined;

    expect(heard).toEqual([true, false]);
  });
});

describe('a canvas that changes shape reaches the renderer — #423', () => {
  /** jsdom lays nothing out, so a canvas has whatever size a test says it has. */
  function size(canvas: Element | null, width: number, height: number): void {
    expect(canvas).not.toBeNull();
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: height });
  }

  it('forwards the new size when the stage is resized', async () => {
    // Portrait to landscape on a tablet: about 0.6 : 1 to 1.6 : 1. The canvas
    // used to be 16 : 9 whatever happened, so nothing had to tell the renderer;
    // since #423 a renderer that is not told draws every wheel as an ellipse.
    const sizes: [number, number][] = [];
    await ride({ renderer: () => Promise.resolve(sizingRenderer(sizes)) });
    const before = sizes.length;
    expect(observers.length).toBeGreaterThan(0);

    size(stage()?.querySelector('canvas') ?? null, 1280, 800);
    for (const fire of observers) {
      fire();
    }

    expect(sizes.slice(before)).toEqual([[1280, 800]]);
  });

  it('does not forward an empty box', async () => {
    // A zero height is an aspect ratio of infinity, which three turns into a
    // NaN projection matrix and a black frame for the rest of the ride.
    const sizes: [number, number][] = [];
    await ride({ renderer: () => Promise.resolve(sizingRenderer(sizes)) });
    const before = sizes.length;

    size(stage()?.querySelector('canvas') ?? null, 1280, 0);
    for (const fire of observers) {
      fire();
    }

    expect(sizes.slice(before)).toEqual([]);
  });

  it('stops observing when the ride ends', async () => {
    await ride();
    const live = observers.length;
    expect(live).toBeGreaterThan(0);

    await press('End ride');

    expect(disconnected).toBe(live);
  });
});

describe('a notice is laid out by the HUD — #423', () => {
  /** A trainer that is paired and has not been given control. @see trainer-port.ts */
  const NO_CONTROL: GameTrainerPort = {
    readTrainer: () => ({ kind: 'no-control', control: undefined }),
  };

  it('puts what the ride has to say inside the HUD, in its own slot', async () => {
    // Over a full-bleed world everything is positioned against the stage, and
    // two things positioned independently against one box overlap the day
    // either grows. Inside the HUD's grid a notice has a cell of its own.
    await ride({ trainer: NO_CONTROL });

    const slot = stage()?.querySelector('.oyl-hud .oyl-hud__notices');
    expect(slot).not.toBeNull();
    expect(slot?.querySelector('.oyl-status--warning')).not.toBeNull();
  });

  it('renders no slot at all on a ride with nothing to say', async () => {
    // ⚠️ An empty grid item is still a grid item, and this one sits across the
    // middle of the stage — the part of the screen the layout exists to keep
    // clear.
    await ride();

    expect(stage()?.querySelector('.oyl-hud')).not.toBeNull();
    expect(stage()?.querySelector('.oyl-hud__notices')).toBeNull();
  });
});
