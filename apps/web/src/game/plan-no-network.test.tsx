// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The game screen draws the route in plan and touches no network — #285.
 *
 * ## Why this is a criterion rather than an obvious property
 *
 * The thing #285 asks for looks exactly like the thing #63 is blocked on. A map
 * with roads and terrain shading needs tiles — there were none when #285 was
 * written, and since #534 the only ones are the ride-detail map's, from one
 * host the privacy policy names — and reaching
 * for a third-party tile server is both the obvious way to make this screen
 * prettier and the one change that would make it the first outbound request
 * `apps/web/src` has ever issued. ADR 0009 R5 and `map/basemap.ts`
 * §`styleOrigins` are the precedent; this is the assertion.
 *
 * ⚠️ **Every network primitive is replaced by one that throws**, rather than one
 * that records. A recorder asserts on a *count*, which is zero both when nothing
 * was requested and when the request was made somewhere the recorder does not
 * see — inside a worker, or through a primitive the list forgot. A thrower fails
 * the render at the moment of the call, and the ride below then fails loudly.
 *
 * ⚠️ **Since #2290 a ride with a corridor draws a street map here**, from the
 * corridor kept on the device before the ride; the second block below rides
 * one with every primitive still refused, so the map is held to the same
 * "no request" as the outline.
 *
 * ⚠️ **It rides**, rather than mounting and asserting. The picker makes no
 * request either, and a test that stopped there would pass against a screen that
 * fetched a tile on the first frame of every ride.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameView, type GamePort, type RidableRoute } from './GameView';
import { northCorridor, northRoute } from './hud/street-map-testing';
import { OSM_ATTRIBUTION } from '../map/basemap';
import type { GameRenderer } from './port';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

/** A 47-ish-kilometre import, which is the route #285 describes a rider on. */
function importedRoute(): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 400; index += 1) {
    // A shallow arc, so the drawn shape is a shape rather than a straight line.
    const along = index * 10;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + along / 111_320),
        degreesLongitude(-0.12 + Math.sin(index / 60) * 0.01),
      ),
      elevation: altitudeMetres(30 + Math.sin(index / 25) * 20),
    });
  }
  return { id: 'imported', name: 'Sunday loop', profile: routeProfile(points), attempts: 0 };
}

function port(route: RidableRoute, corridor?: GamePort['loadWorldCorridor']): GamePort {
  return {
    ...(corridor === undefined ? {} : { loadWorldCorridor: corridor }),
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(210), live: true, paired: true },
      cadence: { value: 85, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
  };
}

function headlessRenderer(): GameRenderer {
  return {
    // #475: never asked — no ride in this file chose the realistic world.
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: false,
      prepare: () => Promise.resolve(),
      render: () => undefined,
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

/** Every way this client could reach the network, each replaced by a refusal. */
function forbidTheNetwork(): void {
  const refuse = (name: string) => {
    return (): never => {
      throw new Error(`the game screen must not reach the network — it called ${name}`);
    };
  };
  vi.stubGlobal('fetch', refuse('fetch'));
  vi.stubGlobal('XMLHttpRequest', refuse('XMLHttpRequest'));
  vi.stubGlobal('WebSocket', refuse('WebSocket'));
  vi.stubGlobal('EventSource', refuse('EventSource'));
  vi.stubGlobal('Image', refuse('Image'));
  vi.stubGlobal('navigator', {
    ...navigator,
    sendBeacon: refuse('navigator.sendBeacon'),
  });
}

beforeEach(() => {
  pending = [];
  nowMs = 2_000_000;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  forbidTheNetwork();
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
    nowMs += 250;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

/** Mount the game over `gamePort`, press *Ride*, and ride 40 frames of 250 ms. */
async function ride(gamePort: GamePort): Promise<Mounted> {
  const shown = await mount(
    <GameView
      port={gamePort}
      renderer={() => Promise.resolve(headlessRenderer())}
      now={() => nowMs}
    />,
  );
  mounted = shown;
  await settle();
  const button = queryAll<HTMLButtonElement>(shown.container, 'button').find((each) =>
    (each.textContent ?? '').startsWith('Ride '),
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  await settle();
  await pump(40);
  await settle();
  return shown;
}

describe('the plan view draws from the profile alone', () => {
  it('rides a real imported route and issues no request of any kind', async () => {
    const route = importedRoute();
    mounted = await mount(
      <GameView
        port={port(route)}
        renderer={() => Promise.resolve(headlessRenderer())}
        now={() => nowMs}
      />,
    );
    await settle();

    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    expect(ride).toBeDefined();
    await act(async () => {
      ride?.click();
      await Promise.resolve();
    });
    await settle();
    await pump(40);
    await settle();

    // The plan is on the screen, which is what makes "no request" a statement
    // about a screen that drew something rather than about one that did not.
    const plan = mounted.container.querySelector('.oyl-hud__plan-svg');
    expect(plan).not.toBeNull();
    expect(mounted.container.querySelectorAll('.oyl-hud__plan-line').length).toBeGreaterThan(0);
    expect(plan?.getAttribute('aria-label')).toContain('Route in plan');

    // Nothing in the tree references an external resource either. A `<image>`
    // or a `url(https://…)` needs no scripted request to fetch a tile — the
    // browser issues it from the markup, past every stub above.
    expect(mounted.container.querySelectorAll('img, image, iframe, use')).toHaveLength(0);
    expect(mounted.container.innerHTML).not.toContain('http');

    // And the errors the render boundary caught, which is where a thrown
    // refusal would have landed rather than failing the assertions above.
    expect(mounted.caughtErrors).toEqual([]);
  });
});

describe('the street map draws from the corridor the ride already holds — #2290', () => {
  it('rides a route with a corridor, follows the rider on its streets, and issues no request', async () => {
    const route: RidableRoute = {
      id: 'north',
      name: 'North street',
      profile: northRoute(),
      attempts: 0,
    };
    // The corridor answers as the store would offline: kept, no read.
    const shown = await ride(
      port(route, () => Promise.resolve({ kind: 'ready', corridor: northCorridor(route.id) })),
    );

    const map = shown.container.querySelector('.oyl-hud__street-map');
    expect(map, 'the street map is drawn on a ride with a corridor').not.toBeNull();
    expect(map?.getAttribute('aria-label')).toContain('Street map around you, north up');
    // Its streets, from the corridor, and the route over them.
    const streets = map?.querySelector('[data-oyl-street-map="streets"]')?.getAttribute('d') ?? '';
    expect(streets).toMatch(/^M/);
    expect(map?.querySelector('[data-oyl-street-map="route"]')?.getAttribute('d')).toMatch(/^M/);
    // The outline it replaces is not drawn beside it.
    expect(shown.container.querySelector('.oyl-hud__plan-line')).toBeNull();
    // It follows: the view is centred on the rider, who has ridden north.
    const [, top] = (map?.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(top ?? 0).toBeLessThan(-500);
    // With the map data's credit beside it, for the whole ride.
    expect(shown.container.textContent).toContain(OSM_ATTRIBUTION);

    expect(shown.container.querySelectorAll('img, image, iframe, use')).toHaveLength(0);
    expect(shown.container.innerHTML).not.toContain('http');
    expect(shown.caughtErrors).toEqual([]);
  });

  it('draws the route’s outline, as before, on a ride whose corridor is not ready', async () => {
    const route: RidableRoute = { id: 'north', name: 'North', profile: northRoute(), attempts: 0 };
    const shown = await ride(
      port(route, () => Promise.resolve({ kind: 'unavailable', why: 'offline' })),
    );
    expect(shown.container.querySelector('.oyl-hud__street-map')).toBeNull();
    expect(shown.container.querySelectorAll('.oyl-hud__plan-line').length).toBeGreaterThan(0);
    expect(shown.container.textContent).not.toContain(OSM_ATTRIBUTION);
    expect(shown.caughtErrors).toEqual([]);
  });
});
