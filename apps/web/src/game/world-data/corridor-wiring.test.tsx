// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1539 through the real game: the chosen route's corridor reaches what
 * `sceneFrame` is handed, and a corridor that arrives during a ride does not.
 *
 * ⚠️ **Why this file exists.** `GamePort.loadWorldCorridor` is an optional
 * member threaded through JSX, which `check:wiring` cannot follow (§Limits):
 * a `main.tsx` that stopped supplying it would leave that gate green and the
 * realistic world quietly procedural for ever. So the real `GameView` is
 * rendered over the port `main.tsx` builds — `createWorldCorridorPort` over a
 * real store and the product's archive reader, with only the archive's bytes
 * faked — and the corridor is read back off the input the scene was built
 * from. The last case holds `main.tsx` to supplying the member at all.
 *
 * The only doubles are the archive's bytes, the GL context behind the
 * renderer, and the animation frame.
 */

import { Blob as NodeBlob } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { watts } from '@onyourleft/domain';
import { corridorTileCover } from '@onyourleft/map-features';
import { residentialBlockTile, sidewalkTile } from '@onyourleft/map-features/testing';
import { openActivityStore, type ActivityStore, type RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  routeFor,
  seedAthletes,
} from '@onyourleft/store/testing';

import { stripComments } from '../../units/no-inline-units';
import { buildArchive, countingSource } from '../../world-data/archive-testing';
import { createWorldCorridorPort } from '../../world-data/corridor-port';
import { corridorArchiveFrom } from '../../world-data/corridor-source';
import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { GameView, type GamePort, type RidableRoute } from '../GameView';
import type { GameRenderer, SceneFrame } from '../port';
import type { SceneInput } from '../scene';
import { CORRIDOR_HALF_WIDTH_METRES, type CorridorState, type WorldCorridor } from './corridor';

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
let harness: ReturnType<typeof createStoreHarness>;
let stores: ActivityStore[];

beforeEach(async () => {
  inputs.length = 0;
  pending = [];
  nowMs = 0;
  resetFixtureIds();
  harness = createStoreHarness();
  stores = [];
  await seedAthletes(harness, [ATHLETE_A]);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // jsdom's `Blob` has no `stream()`; the browser's and Node's do, and the
  // corridor's packing uses it. Node's is the one the store's own suite
  // keeps corridors in, so it is the honest stand-in here.
  vi.stubGlobal('Blob', NodeBlob);
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  for (const store of stores) store.close();
  await harness.destroy();
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
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

function pedalling(route: RidableRoute, corridor?: GamePort['loadWorldCorridor']): GamePort {
  return {
    listRoutes: () => Promise.resolve([route]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(250), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    ...(corridor === undefined ? {} : { loadWorldCorridor: corridor }),
  };
}

const text = (): string => mounted?.container.textContent ?? '';

async function until(condition: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !condition(); i++) await settle();
  expect(condition()).toBe(true);
}

async function pressRide(): Promise<void> {
  const ride = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (button) => (button.textContent ?? '').startsWith('Ride '),
  );
  expect(ride).toBeDefined();
  await act(async () => {
    ride?.click();
    await Promise.resolve();
  });
  await settle();
}

async function savedRoute(): Promise<RouteRecord> {
  const route = routeFor(ATHLETE_A, { sideMetres: 1_500 });
  await harness.write((store) => store.putRoute(route));
  return route;
}

const ridable = (route: RouteRecord): RidableRoute => ({
  id: route.id,
  name: route.name,
  profile: route.profile,
  attempts: 0,
});

describe('the chosen route’s corridor reaches the scene — #1539', () => {
  it('is read on the picker, said in one line, and handed to every frame of the ride', async () => {
    const route = await savedRoute();
    const tiles = corridorTileCover(
      route.profile.positions,
      CORRIDOR_HALF_WIDTH_METRES + 500,
      2_000,
    ).map((tile, index) => ({
      x: tile.x,
      y: tile.y,
      bytes: index % 2 === 0 ? residentialBlockTile() : sidewalkTile(),
    }));
    const source = countingSource(await buildArchive({ tiles }));
    const store = openActivityStore(harness.databaseName);
    stores.push(store);
    const corridors = createWorldCorridorPort({
      store,
      owner: ATHLETE_A,
      basemap: () => ({ archiveUrl: 'https://tiles.example.org/a.pmtiles', attribution: '' }),
      archive: () => corridorArchiveFrom(source),
      mapTilesOn: () => true,
      realisticOn: () => true,
      recording: () => false,
      now: () => new Date('2026-10-21T00:00:00Z'),
      yieldToIdle: () => Promise.resolve(),
    });
    const frames: SceneFrame[] = [];
    mounted = await mount(
      <GameView
        port={pedalling(ridable(route), (r, signal, progress) =>
          corridors.load(r, signal, progress),
        )}
        renderer={() => Promise.resolve(capturingRenderer(frames))}
        now={() => nowMs}
      />,
    );
    await until(() => text().includes('Towns from map data: ready'));
    // Said once, in a polite status region, and never as a count.
    const status = queryAll(mounted.container, '[role="status"]').find((node) =>
      (node.textContent ?? '').startsWith('Towns from map data'),
    );
    expect(status?.textContent).toBe('Towns from map data: ready');

    await pressRide();
    await pump(10);
    const ride = inputs.filter((input) => input.state.ride.distance >= 0);
    expect(ride.length).toBeGreaterThan(3);
    const kept = await harness.read((fresh) => fresh.getWorldCorridor(ATHLETE_A, route.id));
    expect(kept).toBeDefined();
    for (const input of ride) {
      expect(input.worldCorridor?.routeId).toBe(route.id);
      expect(input.worldCorridor?.buildings.length).toBeGreaterThan(0);
    }
    // #1546: the land-class mask, built from that corridor ONCE, at the press —
    // one object on every frame — and covering where the ride starts.
    const masks = new Set(ride.map((input) => input.landClass));
    expect(masks.size).toBe(1);
    const [mask] = [...masks];
    expect(mask?.bytes).toBeGreaterThan(0);
    expect(mask?.covered(0, 0)).toBe(true);
  });

  it('hands no corridor to the scene with no port method — today’s game', async () => {
    const route = await savedRoute();
    const frames: SceneFrame[] = [];
    mounted = await mount(
      <GameView
        port={pedalling(ridable(route))}
        renderer={() => Promise.resolve(capturingRenderer(frames))}
        now={() => nowMs}
      />,
    );
    await settle();
    expect(text()).not.toContain('Towns from map data');
    await pressRide();
    await pump(10);
    expect(inputs.length).toBeGreaterThan(3);
    for (const input of inputs) {
      expect(input.worldCorridor).toBeUndefined();
      // #1546: and no land-class mask, so the scene takes `NO_LAND_CLASS`.
      expect(input.landClass).toBeUndefined();
    }
  });
});

describe('nothing changes during a ride — ADR 0054 D-2.4', () => {
  /** What a frame stands in the world, as one comparable string. */
  const structures = (frames: readonly SceneFrame[]): string =>
    JSON.stringify(
      frames.map((frame) => [frame.scatter, frame.billboards, frame.streets, frame.lines]),
    );

  async function rideFor(
    route: RouteRecord,
    corridor: GamePort['loadWorldCorridor'] | undefined,
    midRide?: () => void,
  ): Promise<SceneFrame[]> {
    const frames: SceneFrame[] = [];
    mounted = await mount(
      <GameView
        port={pedalling(ridable(route), corridor)}
        renderer={() => Promise.resolve(capturingRenderer(frames))}
        now={() => nowMs}
      />,
    );
    await settle();
    await pressRide();
    await pump(4);
    midRide?.();
    await settle();
    // 600 simulation steps: 30 s at the simulation's 20 Hz, in 250 ms frames.
    await pump(120);
    mounted.unmount();
    mounted = undefined;
    pending = [];
    nowMs = 0;
    return frames;
  }

  it('a read that finishes mid-ride leaves every frame as a ride with no corridor at all', async () => {
    const route = await savedRoute();
    const plain = await rideFor(route, undefined);
    inputs.length = 0;

    let finish: ((state: CorridorState) => void) | undefined;
    const late: WorldCorridor = {
      routeId: route.id,
      origin: { latitude: 51.5, longitude: -0.12, elevation: 0 },
      covered: () => true,
      coveredBoxes: [],
      landUse: [],
      buildings: [
        {
          kind: 'building',
          heightMetres: 9,
          minHeightMetres: 0,
          rings: [Float32Array.of(0, 0, 10, 0, 10, 10)],
        },
      ],
      paths: [],
    };
    const withLate = await rideFor(
      route,
      (_route, _signal, progress) => {
        // A port that ignores the abort and answers anyway, mid-ride.
        progress({ kind: 'reading', done: 1, of: 40 });
        return new Promise<CorridorState>((resolve) => {
          finish = resolve;
        });
      },
      () => {
        finish?.({ kind: 'ready', corridor: late });
      },
    );
    expect(finish).toBeDefined();
    expect(withLate.length).toBeGreaterThan(100);
    expect(structures(withLate)).toBe(structures(plain));
    for (const input of inputs) {
      expect(input.worldCorridor).toBeUndefined();
      // #1546: and no land-class mask, so the scene takes `NO_LAND_CLASS`.
      expect(input.landClass).toBeUndefined();
    }
  });
});

describe('main.tsx supplies the corridor to the game and to both route saves', () => {
  const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));
  const gamePort = main.slice(
    main.indexOf('function buildGamePort('),
    main.indexOf('function buildGameTrainerPort('),
  );

  it('builds the game port with loadWorldCorridor over the one corridor port', () => {
    expect(gamePort).toMatch(
      /loadWorldCorridor: \(route, signal, progress\) => corridors\.load\(route, signal, progress\)/,
    );
    expect(main).toMatch(
      /game=\{buildGamePort\(rideController, buildGhostPort\(\), worldCorridorPort\)\}/,
    );
    expect(main).toMatch(/const worldCorridorPort = buildWorldCorridorPort\(rideController\);/);
  });

  it('wraps the routes screen’s and the files screen’s store so a save reads the corridor', () => {
    expect(main).toMatch(/routes=\{buildRoutePort\(worldCorridorPort\)\}/);
    expect(main).toMatch(/transfer=\{buildTransferPort\(worldCorridorPort\)\}/);
    expect(main.match(/readingCorridorOnSave\(localStore\(\), corridors\)/g)).toHaveLength(2);
  });
});
