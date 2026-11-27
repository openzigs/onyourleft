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

import { elevationAt, watts, type RouteProfile } from '@onyourleft/domain';
import { circuitRouteId } from '@onyourleft/store';
import { ATHLETE_A, resetFixtureIds, routeFor } from '@onyourleft/store/testing';

import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { GameView, type GamePort, type RidableRoute } from './GameView';
import type { CorridorState } from './world-data/corridor';
import type { GameRenderer, SceneFrame } from './port';
import { drawnRoadPoints, nearestOnDrawnRoad } from './road-grid';
import { circuitRoute } from './route-fixtures-testing';
import type { SceneInput } from './scene';
import { corridorOrigin, EDGE_LINE_WIDTH_METRES, ROAD_WIDTH_METRES } from './terrain';
import { StreetNameBelt } from './three-renderer';
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
  globalThis.location.hash = '';
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

/**
 * A corridor shaped as a real one is (the tablet check of 2026-11-26 on PR
 * #3261): each side of the square route is ONE street split into three ways,
 * its centreline {@link OFFSET_METRES} to the side of the drawn road, and each
 * name carries digits and a full stop. Every name is invented.
 */
const REAL_NAMES = ['Testf 3rd St.', 'Testa 12th Ave.', 'Testb St. 40', 'Testc Rd. 7'] as const;

/** How far a mapped centreline is from the drawn road, metres: a lane's width, as OSM's often is. */
const OFFSET_METRES = 4;

function realisticStreets(profile: RouteProfile): CorridorStreet[] {
  const road = drawnRoadPoints(profile, corridorOrigin(profile));
  const count = road.points.length / 2;
  const at = (index: number): [number, number] => {
    const from = Math.min(index, count - 2);
    const dx = (road.points[from * 2 + 2] as number) - (road.points[from * 2] as number);
    const dz = (road.points[from * 2 + 3] as number) - (road.points[from * 2 + 1] as number);
    const length = Math.hypot(dx, dz);
    return [
      (road.points[index * 2] as number) + (dz / length) * OFFSET_METRES,
      (road.points[index * 2 + 1] as number) - (dx / length) * OFFSET_METRES,
    ];
  };
  const streets: CorridorStreet[] = [];
  for (const [side, name] of REAL_NAMES.entries()) {
    // Each side's own points, clear of the corners, in three ways that meet end to end.
    const a = Math.round((side * (count - 1)) / 4) + 5;
    const b = Math.round(((side + 1) * (count - 1)) / 4) - 5;
    for (let way = 0; way < 3; way += 1) {
      const from = a + Math.round(((b - a) * way) / 3);
      const to = a + Math.round(((b - a) * (way + 1)) / 3);
      const line: number[] = [];
      for (let index = from; index <= to; index = index === to ? to + 1 : Math.min(to, index + 7)) {
        line.push(...at(index));
      }
      streets.push({
        kind: 'minor_road',
        kindDetail: 'residential',
        grade: 'ground',
        line: Float32Array.from(line),
        name,
      });
    }
  }
  return streets;
}

function previewButton(): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Preview '),
  );
}

/**
 * Rides `route` as #1992's *Preview without a trainer*, as the tablet does: the
 * picker reads the corridor and says it is ready, the rider presses Preview,
 * and the preview's NEW screen (`GameView`'s `key`) reads the corridor again.
 * That second read is held until after the preview has started, as a stored
 * corridor's read (IndexedDB, then a gunzip) is on the device. Returns each
 * ride frame's input.
 */
async function preview(
  route: RidableRoute,
  corridor: WorldCorridor,
  frames: SceneFrame[],
): Promise<SceneInput[]> {
  let reads = 0;
  const held: ((state: CorridorState) => void)[] = [];
  const ready: CorridorState = { kind: 'ready', corridor };
  const port: GamePort = {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(250), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    loadWorldCorridor: () => {
      reads += 1;
      if (reads === 1) return Promise.resolve(ready);
      return new Promise<CorridorState>((resolve) => held.push(resolve));
    },
  };
  globalThis.location.hash = '#/game';
  mounted = await mount(
    <GameView
      port={port}
      renderer={() => Promise.resolve(capturingRenderer(frames))}
      now={() => nowMs}
    />,
  );
  for (let i = 0; i < 200 && !text().includes('Towns from map data: ready'); i++) await settle();
  expect(text()).toContain('Towns from map data: ready');
  const button = previewButton();
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
    await Promise.resolve();
  });
  for (let index = 0; index < 5; index += 1) await settle();
  await pump(8);
  // The preview's own read, still running when it started, ends now.
  expect(reads).toBeGreaterThan(1);
  for (const resolve of held) resolve(ready);
  await settle();
  await pump(4);
  const ridden = inputs.filter((input) => input.state.ride.distance >= 0);
  expect(ridden.length).toBeGreaterThan(3);
  return ridden;
}

describe('a preview without a trainer names the street it is on — the tablet check on PR #3261', () => {
  it('rides the corridor the picker had ready, and the realistic world paints the start label on the road', async () => {
    const route = savedRoute();
    const frames: SceneFrame[] = [];
    const ridden = await preview(route, corridorOf(route, realisticStreets(route.profile)), frames);
    // Read back through what the scene is handed: the corridor, and one list
    // of labels, from the first frame of the preview on.
    for (const input of ridden) expect(input.worldCorridor?.routeId).toBe(route.id);
    const lists = new Set(ridden.map((input) => input.streetNames));
    expect(lists.size).toBe(1);
    const [labels] = [...lists];
    expect(new Set(labels?.map((label) => label.text))).toStrictEqual(new Set(REAL_NAMES));
    // One street a side however many ways it is mapped as: a join label and one a kilometre on.
    expect(labels).toHaveLength(8);
    // And the first street's join label is in the frames the renderer is handed…
    const named = frames.filter((frame) => (frame.streetNames?.cells.length ?? 0) > 0);
    expect(named.length).toBeGreaterThan(0);
    const view = named[0]?.streetNames;
    expect(view?.labels.map((label) => label.text)).toContain(REAL_NAMES[0]);
    // …standing on the road's surface, not under it: every corner above the
    // drawn road's own height at the point of it nearest that corner…
    const origin = corridorOrigin(route.profile);
    const corners = view?.corners ?? new Float32Array(0);
    expect(corners.length).toBeGreaterThan(0);
    for (let corner = 0; corner < corners.length; corner += 3) {
      const x = corners[corner] as number;
      const z = corners[corner + 2] as number;
      const near = nearestOnDrawnRoad(route.profile, origin, x, z, 50);
      // #3344: across the rider's lane, inside the road's edge line.
      expect(near?.distance).toBeLessThan(ROAD_WIDTH_METRES / 2 - EDGE_LINE_WIDTH_METRES);
      const road = elevationAt(route.profile, near?.along ?? 0) - origin.elevation;
      expect(corners[corner + 1]).toBeGreaterThan(road);
    }
    // …and the realistic world's belt draws every letter of it.
    const belt = new StreetNameBelt(undefined);
    belt.update(view, 'realistic');
    expect(belt.mesh.visible).toBe(true);
    expect(belt.mesh.geometry.index?.count).toBe((view?.cells.length ?? 0) * 6);
    belt.dispose();
  });
});
