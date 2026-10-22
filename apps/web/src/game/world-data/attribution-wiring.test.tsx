// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1552 through the real game: the OpenStreetMap credit is on the ride screen
 * exactly when the ride's world was given map data, and for the whole ride.
 *
 * ADR 0054 D-3.6: *"While any part of the drawn world came from the store, the
 * game view shows © OpenStreetMap contributors … for the whole ride. A ride
 * drawn wholly from the procedural world shows no credit, because it owes
 * none."* So the credit is keyed on the corridor the ride STARTED with
 * (`GameView` §`worldCorridorRef`), never on the realistic world being chosen
 * and never on what is in frame.
 *
 * The real `GameView`, rendered over a port whose `loadWorldCorridor` answers
 * with a fixed state; the only other doubles are the GL context and the
 * animation frame. The credit is read off the rendered ride screen, which is
 * where a rider reads it.
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

import { OSM_ATTRIBUTION } from '../../map/basemap';
import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import type { GameRenderer } from '../port';
import type { SceneInput } from '../scene';
import { REALISTIC_WORLD_STORAGE_KEY, writeRealisticWorldChoice } from '../world-preference';
import type { CorridorState, WorldCorridor } from './corridor';

const inputs: SceneInput[] = [];

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
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
  localStorage.removeItem(REALISTIC_WORLD_STORAGE_KEY);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.removeItem(REALISTIC_WORLD_STORAGE_KEY);
  vi.unstubAllGlobals();
});

const ROUTE: RidableRoute = (() => {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 150; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(40 + (index * 10) / 111_320),
        degreesLongitude(-75),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return { id: 'route-1552', name: 'Credit test', profile: routeProfile(points), attempts: 0 };
})();

/**
 * A corridor whose one mapped building is 50 km from the route — so no mapped
 * item is ever in frame on this ride, and a credit tied to what is drawn would
 * be absent from every frame.
 */
const FAR_AWAY: WorldCorridor = {
  routeId: ROUTE.id,
  origin: { latitude: 40, longitude: -75, elevation: 10 },
  covered: () => true,
  coveredBoxes: [],
  landUse: [],
  buildings: [
    {
      kind: 'building',
      heightMetres: 9,
      minHeightMetres: 0,
      rings: [Float32Array.of(50_000, 50_000, 50_010, 50_000, 50_010, 50_010)],
    },
  ],
  paths: [],
};

function capturingRenderer(): GameRenderer {
  return {
    // Loaded, so a ride with the realistic world chosen stays in it.
    loadRealisticWorld: () => Promise.resolve({ loaded: true }),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: () => undefined,
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

function port(corridor: GamePort['loadWorldCorridor']): GamePort {
  return {
    listRoutes: () => Promise.resolve([ROUTE]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(250), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    ...(corridor === undefined ? {} : { loadWorldCorridor: corridor }),
  };
}

const answering =
  (state: CorridorState): NonNullable<GamePort['loadWorldCorridor']> =>
  () =>
    Promise.resolve(state);

async function pump(count: number, each?: () => void): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += FRAME_MS;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
    each?.();
  }
}

/** The rendered ride screen — the stage — as a rider reads it. */
const stageText = (): string =>
  mounted?.container.querySelector('.oyl-game--riding')?.textContent ?? '';

async function until(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) await settle();
  expect(condition()).toBe(true);
}

async function startRide(corridor: GamePort['loadWorldCorridor'], said: string): Promise<void> {
  mounted = await mount(
    <GameView
      port={port(corridor)}
      renderer={() => Promise.resolve(capturingRenderer())}
      now={() => nowMs}
    />,
  );
  await until(() => (mounted?.container.textContent ?? '').includes(said));
  const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  expect(ride).toBeDefined();
  await act(async () => {
    ride?.click();
    await Promise.resolve();
  });
  await settle();
  await until(() => mounted?.container.querySelector('.oyl-game--riding') !== null);
}

describe('the OpenStreetMap credit on the ride screen — #1552', () => {
  it('is shown on a ride whose world was given a ready corridor', async () => {
    await startRide(answering({ kind: 'ready', corridor: FAR_AWAY }), 'Towns from map data: ready');
    await pump(4);
    expect(stageText()).toContain(OSM_ATTRIBUTION);
    // The owner's ruling on #1572: a line of the HUD's own, in a corner of the
    // road, clear of every panel — not a line in the actions panel.
    const line = [
      ...(mounted?.container.querySelectorAll('.oyl-game--riding .oyl-hud *') ?? []),
    ].find((each) => each.textContent === OSM_ATTRIBUTION && each.children.length === 0);
    expect(line?.parentElement?.classList.contains('oyl-hud')).toBe(true);
    expect(line?.closest('.oyl-hud__panel')).toBeNull();
  });

  it('stays for the whole ride, across a stretch with no mapped item in frame', async () => {
    writeRealisticWorldChoice(localStorage, true);
    await startRide(answering({ kind: 'ready', corridor: FAR_AWAY }), 'Towns from map data: ready');
    let frames = 0;
    let missing = 0;
    // 30 s of ride in 250 ms frames; the building is 50 km off the line.
    await pump(120, () => {
      frames += 1;
      if (!stageText().includes(OSM_ATTRIBUTION)) missing += 1;
    });
    expect(frames).toBe(120);
    expect(missing).toBe(0);
    // The corridor really is this ride's, and the ride really moved.
    const ride = inputs.filter((input) => input.worldCorridor !== undefined);
    expect(ride.length).toBeGreaterThan(100);
    expect(ride.at(-1)?.state.ride.distance ?? 0).toBeGreaterThan(50);
  });

  for (const [state, said] of [
    [{ kind: 'unavailable', why: 'outside-coverage' }, 'Towns from map data: not available'],
    [{ kind: 'unavailable', why: 'offline' }, 'Towns from map data: not available'],
    [{ kind: 'off', why: 'map-tiles-off' }, 'Towns from map data: off'],
    [{ kind: 'off', why: 'no-archive' }, 'Towns from map data: off'],
  ] as const) {
    it(`is absent with the realistic world chosen and the corridor ${state.kind}: ${state.why}`, async () => {
      // The realistic world IS chosen: a credit keyed on that choice rather
      // than on map data in the world would show here, and be false.
      writeRealisticWorldChoice(localStorage, true);
      await startRide(answering(state), said);
      await pump(20);
      expect(stageText()).not.toBe('');
      expect(stageText()).not.toContain(OSM_ATTRIBUTION);
      expect(mounted?.container.querySelector('.oyl-hud__attribution')).toBeNull();
    });
  }

  it('is absent on today’s game, with no corridor port at all', async () => {
    await startRide(undefined, 'Ride ');
    await pump(20);
    expect(stageText()).not.toBe('');
    expect(stageText()).not.toContain(OSM_ATTRIBUTION);
  });

  it('is absent when the corridor arrives only after the ride started — ADR 0054 D-2.4', async () => {
    let finish: ((state: CorridorState) => void) | undefined;
    await startRide((_route, _signal, progress) => {
      progress({ kind: 'reading', done: 1, of: 40 });
      return new Promise<CorridorState>((resolve) => {
        finish = resolve;
      });
    }, 'Towns from map data: reading');
    await pump(4);
    finish?.({ kind: 'ready', corridor: FAR_AWAY });
    await settle();
    await pump(20);
    expect(finish).toBeDefined();
    expect(stageText()).not.toContain(OSM_ATTRIBUTION);
  });
});
