// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #3245 through `GameView`'s own press: a saved route ride over a corridor
 * whose streets are named hands the scene the names of the streets the route
 * is on — the same list on every frame of the ride, placed once at the press
 * — and the scene paints the nearest on the road. A route with no named
 * street under it, a ride with no map data, and a built-in circuit are handed
 * none. Every name is invented, on a synthetic square route.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts, type RouteProfile } from '@onyourleft/domain';
import { circuitRouteId } from '@onyourleft/store';
import { ATHLETE_A, resetFixtureIds, routeFor } from '@onyourleft/store/testing';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { GameRenderer, SceneFrame } from './port';
import { drawnRoadPoints } from './road-grid';
import { circuitRoute } from './route-fixtures-testing';
import type { SceneInput } from './scene';
import { corridorOrigin } from './terrain';
import type { CorridorStreet, WorldCorridor } from './world-data/corridor';

const inputs: SceneInput[] = [];

vi.mock('./scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      inputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

const FRAME_MS = 250;
let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  inputs.length = 0;
  pending = [];
  nowMs = 0;
  resetFixtureIds();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
});

async function pump(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  }
}

function capturingRenderer(frames: SceneFrame[]): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        frames.push(frame);
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

/** Invented names, one a quarter of the route. */
const NAMES = ['Testa Way', 'Testb Row', 'Testc Lane', 'Testd Road'] as const;

/** The route's drawn road cut in four, each quarter a street along it named `names[i]`. */
function quarters(profile: RouteProfile, names: readonly (string | undefined)[]): CorridorStreet[] {
  const road = drawnRoadPoints(profile, corridorOrigin(profile));
  const count = road.points.length / 2;
  return names.map((name, quarter) => {
    const a = Math.round((quarter * (count - 1)) / 4);
    const b = Math.round(((quarter + 1) * (count - 1)) / 4);
    const line: number[] = [];
    for (let at = a; at <= b; at = at === b ? b + 1 : Math.min(b, at + 5)) {
      line.push(road.points[at * 2] as number, road.points[at * 2 + 1] as number);
    }
    return {
      kind: 'minor_road',
      kindDetail: 'residential',
      grade: 'ground',
      line: Float32Array.from(line),
      ...(name === undefined ? {} : { name }),
    };
  });
}

function corridorOf(route: RidableRoute, streets: readonly CorridorStreet[]): WorldCorridor {
  return {
    routeId: route.id,
    origin: corridorOrigin(route.profile),
    covered: () => true,
    coveredBoxes: [],
    landUse: [],
    buildings: [],
    paths: [],
    streets,
  };
}

const text = (): string => mounted?.container.textContent ?? '';

/** Rides `route` over `corridor` (none: no map data) and returns each ride frame's input. */
async function ride(
  route: RidableRoute,
  corridor: WorldCorridor | undefined,
  frames: SceneFrame[],
  as: 'saved' | 'circuit' = 'saved',
): Promise<SceneInput[]> {
  const port: GamePort = {
    listRoutes: () => Promise.resolve(as === 'saved' ? [route] : []),
    ...(as === 'circuit' ? { listCircuits: () => Promise.resolve([route]) } : {}),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(250), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    ...(corridor === undefined
      ? {}
      : { loadWorldCorridor: () => Promise.resolve({ kind: 'ready' as const, corridor }) }),
  };
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(capturingRenderer(frames))}
      now={() => nowMs}
    />,
  );
  if (corridor !== undefined) {
    for (let i = 0; i < 200 && !text().includes('Towns from map data: ready'); i++) await settle();
    expect(text()).toContain('Towns from map data: ready');
  } else {
    await settle();
  }
  const press = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  expect(press).toBeDefined();
  await act(async () => {
    press?.click();
    await Promise.resolve();
  });
  await settle();
  await pump(8);
  const ridden = inputs.filter((input) => input.state.ride.distance >= 0);
  expect(ridden.length).toBeGreaterThan(3);
  return ridden;
}

function savedRoute(): RidableRoute {
  const record = routeFor(ATHLETE_A, { sideMetres: 1_500 });
  return { id: record.id, name: record.name, profile: record.profile, attempts: 0 };
}

describe('a saved route ride names the street it is on, through the press — #3245', () => {
  it('hands every frame the one list placed at the press, and the scene paints the nearest', async () => {
    const route = savedRoute();
    const frames: SceneFrame[] = [];
    const ridden = await ride(route, corridorOf(route, quarters(route.profile, NAMES)), frames);
    const lists = new Set(ridden.map((input) => input.streetNames));
    expect(lists.size).toBe(1);
    const [labels] = [...lists];
    expect(new Set(labels?.map((label) => label.text))).toStrictEqual(new Set(NAMES));
    // Sparse: two a 1.5 km street, a join label and one a kilometre on.
    expect(labels).toHaveLength(8);
    // And the first street's join label, 40 m from the start, is painted.
    const painted = frames.flatMap((frame) => frame.streetNames?.labels ?? []);
    expect(painted.map((label) => label.text)).toContain(NAMES[0]);
    expect(frames.some((frame) => (frame.streetNames?.cells.length ?? 0) > 0)).toBe(true);
  });

  it('hands no names where no street under the route is named', async () => {
    const route = savedRoute();
    const frames: SceneFrame[] = [];
    const unnamed = quarters(route.profile, [undefined, undefined, undefined, undefined]);
    const ridden = await ride(route, corridorOf(route, unnamed), frames);
    for (const input of ridden) expect(input.streetNames).toBeUndefined();
    for (const frame of frames) expect(frame.streetNames).toBeUndefined();
  });

  it('hands no names to a ride with no map data', async () => {
    const route = savedRoute();
    const frames: SceneFrame[] = [];
    const ridden = await ride(route, undefined, frames);
    for (const input of ridden) expect(input.streetNames).toBeUndefined();
    for (const frame of frames) expect(frame.streetNames).toBeUndefined();
  });

  it('hands no names to a built-in circuit, though its corridor names its streets', async () => {
    const ring: RidableRoute = {
      id: circuitRouteId('fixture-ring'),
      name: 'Fixture ring',
      profile: circuitRoute(2_000),
      attempts: 0,
    };
    const frames: SceneFrame[] = [];
    const ridden = await ride(
      ring,
      corridorOf(ring, quarters(ring.profile, NAMES)),
      frames,
      'circuit',
    );
    for (const input of ridden) {
      expect(input.worldCorridor?.routeId).toBe(ring.id);
      expect(input.streetNames).toBeUndefined();
    }
  });
});
