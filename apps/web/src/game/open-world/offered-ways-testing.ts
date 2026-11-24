// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for #3106: **the real game screen ridden over the product's
 * own open-world session**, with every frame the renderer was handed kept
 * beside the scene input it was built from, the junction prompt the rider was
 * shown on that frame, and the ride's road — so a test can ask, of each way
 * the prompt offers, whether the frame draws it.
 *
 * ⚠️ **A `-testing` file** (`check-wiring.mjs` §`isTestSupport`): imported by
 * tests and never by anything that ships. Every street it rides is a fixture
 * line written in `fixture-testing.ts`: no map data, no place.
 *
 * The session, its area reader, decoder, street graph, rolling route, road,
 * junction choice, prompt, scene and HUD are the product's. The renderer is a
 * double that keeps what it was handed.
 */

import { Blob as NodeBlob } from 'node:buffer';

import { act, createElement } from 'react';
import { expect, vi } from 'vitest';

import { positionAt, watts, type RollingJunction, type RouteProfile } from '@onyourleft/domain';
import type { GraphFixtureStreet } from '@onyourleft/map-features/testing';

import { mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { countingSource } from '../../world-data/archive-testing';
import { corridorArchiveFrom } from '../../world-data/corridor-source';
import type { SideRoad } from '../cross-streets';
import { retainedFrame } from '../frame-testing';
import { GameView, type GamePort } from '../GameView';
import type { GameRenderer, SceneFrame } from '../port';
import type { SceneInput } from '../scene';
import { corridorOrigin, localGroundPosition, ROAD_WIDTH_METRES } from '../terrain';
import { createOpenWorldEntry } from './entry';
import { fixtureStart, openWorldFixtureArchive } from './fixture-testing';
import { promptedJunction } from './junction-choice';
import type { OpenWorldSessions } from './ride';
import type { OpenWorldRoad } from './road';
import { createOpenWorldSession } from './session';
import { lazyOpenWorldSessions } from './session-lazy';

/** One frame the renderer was handed. */
export interface RiddenFrame {
  readonly frame: SceneFrame;
  readonly input: SceneInput;
  /** The ride's odometer on this frame. */
  readonly odometer: number;
  /** What each of the junction pop-up's way buttons said on this frame; none while it is not shown. */
  readonly offered: readonly string[];
  /**
   * The junction the prompt is for, read from the ride's own rolling route
   * by the prompt's own rule (`junction-choice.ts` §`promptedJunction`).
   */
  readonly junction: RollingJunction | undefined;
  /** The next junction on the route, prompted or not: not {@link junction} while its choice is final (#3129). */
  readonly next: RollingJunction | undefined;
  /** The pop-up's title on this frame, and the line under it; none while it is not shown (#3129). */
  readonly title: string | undefined;
  readonly lockLine: string | undefined;
  /** For each way of {@link junction}, the view the route would hand out were it taken, and the junction on it. */
  readonly ways: readonly OfferedWay[];
}

/** One way the prompt offers, as a road to ride. */
export interface OfferedWay {
  readonly id: string;
  readonly profile: RouteProfile;
  /** The junction's distance on {@link profile}. */
  readonly fromMetres: number;
}

/** A ride under way. */
export interface OfferedWaysRide {
  /** Every frame kept so far. */
  readonly frames: readonly RiddenFrame[];
  /** Rides on until the odometer reaches `metres`, drawing a frame every `frameMs` of ride time. */
  rideTo(metres: number, frameMs?: number): Promise<void>;
  /** Draws `count` more frames, `frameMs` of ride time apart. */
  ridePumped(count: number, frameMs: number): Promise<void>;
  /** Presses a turn key, as a keyboard would. */
  press(key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'): Promise<void>;
  /** The mounted game screen. */
  readonly mounted: Mounted;
  end(): void;
}

/** The inputs the mocked `sceneFrame` was handed: a test's `vi.mock` of `../scene` pushes to it. */
export const sceneInputs: SceneInput[] = [];

/**
 * Starts an open-world ride on the real game screen over `streets`, from the
 * pin at the fixture pixel `(column, row)`. The caller's file must mock
 * `../scene` so that `sceneFrame` pushes its input to {@link sceneInputs}.
 */
export async function startOfferedWaysRide(
  streets: readonly GraphFixtureStreet[],
  column: number,
  row: number,
  /** How many blocks east of the fixture's the archive holds too: none, unless a ride crosses into one. */
  blocksEast = 0,
): Promise<OfferedWaysRide> {
  sceneInputs.length = 0;
  let pending: FrameRequestCallback[] = [];
  let nowMs = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  // jsdom's `Blob` has no `stream()`, which the fixture archive's gzip uses.
  vi.stubGlobal('Blob', NodeBlob);

  const frames: RiddenFrame[] = [];
  let road: OpenWorldRoad | undefined;
  let mounted: Mounted | undefined;

  const offeredNow = (): string[] =>
    queryAll<HTMLButtonElement>(document, '.oyl-hud__junction-popup button[data-oyl-way]').map(
      (button) => button.textContent ?? '',
    );
  const popupText = (selector: string): string | undefined =>
    document.querySelector(`.oyl-hud__junction-popup ${selector}`)?.textContent ?? undefined;

  const renderer: GameRenderer = {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: true,
      prepare: () => Promise.resolve(),
      render: (frame: SceneFrame) => {
        const input = sceneInputs[sceneInputs.length - 1];
        if (input === undefined || road === undefined) return;
        const odometer = input.state.ride.distance as number;
        // The prompt's own question of the route (`junction-choice.ts`), in
        // ride distance: the scene's input is in the view's.
        const rideDistance = odometer + road.view.origin;
        const junction = promptedJunction(road.route, rideDistance)?.junction;
        const ways: OfferedWay[] = [];
        for (const way of junction?.ways ?? []) {
          const taking = road.route.taking((junction as RollingJunction).distance, way.edge.id);
          if (taking === undefined) continue;
          ways.push({
            id: way.edge.id,
            profile: taking.view(),
            fromMetres: (junction as RollingJunction).distance - taking.origin,
          });
        }
        frames.push({
          // A frame's ground is lent storage the next build writes over.
          frame: retainedFrame(frame),
          input,
          odometer: rideDistance,
          offered: offeredNow(),
          junction,
          next: road.route.nextJunctionAfter(rideDistance),
          title: popupText('.oyl-hud__junction-title'),
          lockLine: popupText('.oyl-hud__junction-lock'),
          ways,
        });
      },
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };

  const source = countingSource(await openWorldFixtureArchive(streets, blocksEast));
  const entry = createOpenWorldEntry();
  entry.hand(fixtureStart(column, row));
  const real = lazyOpenWorldSessions(
    {
      entry,
      basemap: () => ({ archiveUrl: 'https://tiles.example.invalid/a.pmtiles', attribution: '' }),
      mapTilesOn: () => true,
    },
    () =>
      Promise.resolve((start) =>
        createOpenWorldSession({
          start,
          archive: corridorArchiveFrom(source),
          mapTilesOn: () => true,
          yieldToIdle: () => Promise.resolve(),
        }),
      ),
  );
  // The product's sessions, with the ride's road kept as it is handed over.
  const sessions: OpenWorldSessions = {
    ...real,
    take: () => real.take(),
    open: (start) => {
      const session = real.open(start);
      return {
        ...session,
        ready: session.ready.then((ready) =>
          ready.kind !== 'ready'
            ? ready
            : {
                ...ready,
                road: () => {
                  road = ready.road();
                  return road;
                },
              },
        ),
        stop: () => {
          session.stop();
        },
      };
    },
  };
  const port: GamePort = {
    listRoutes: () => Promise.resolve([]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(300), live: true, paired: true },
      cadence: { value: 90, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
    openWorld: sessions,
  };
  mounted = await mount(
    createElement(GameView, { port, renderer: () => Promise.resolve(renderer), now: () => nowMs }),
  );
  const rideButton = (): HTMLButtonElement | undefined =>
    queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
  for (let tries = 0; tries < 400 && rideButton()?.textContent !== 'Ride Open world'; tries++) {
    await settle();
  }
  expect(rideButton()?.textContent).toBe('Ride Open world');
  await act(async () => {
    rideButton()?.click();
    await Promise.resolve();
  });
  await settle();

  const pump = async (frameMs: number): Promise<void> => {
    const next = pending.shift();
    if (next === undefined) return;
    nowMs += frameMs;
    await act(async () => {
      next(nowMs);
      await Promise.resolve();
    });
  };
  const odometer = (): number => {
    const input = sceneInputs[sceneInputs.length - 1];
    return input === undefined || road === undefined
      ? 0
      : (input.state.ride.distance as number) + road.view.origin;
  };

  return {
    frames,
    mounted,
    rideTo: async (metres, frameMs = 500) => {
      for (let frame = 0; frame < 4_000 && odometer() < metres; frame += 1) await pump(frameMs);
      expect(odometer()).toBeGreaterThanOrEqual(metres);
    },
    ridePumped: async (count, frameMs) => {
      for (let frame = 0; frame < count; frame += 1) await pump(frameMs);
    },
    press: async (key) => {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
        await Promise.resolve();
      });
    },
    end: () => {
      mounted?.unmount();
      mounted = undefined;
      pending = [];
      vi.unstubAllGlobals();
    },
  };
}

/** A road's triangles' box in plan, found once a road. */
const boxes = new WeakMap<SideRoad, readonly [number, number, number, number]>();

function boxOf(road: SideRoad): readonly [number, number, number, number] {
  let box = boxes.get(road);
  if (box === undefined) {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    const p = road.mesh.positions;
    for (let at = 0; at + 2 < p.length; at += 3) {
      minX = Math.min(minX, p[at] as number);
      maxX = Math.max(maxX, p[at] as number);
      minZ = Math.min(minZ, p[at + 2] as number);
      maxZ = Math.max(maxZ, p[at + 2] as number);
    }
    box = [minX, maxX, minZ, maxZ];
    boxes.set(road, box);
  }
  return box;
}

function toSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const span = (bx - ax) ** 2 + (bz - az) ** 2;
  const t =
    span > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / span)) : 0;
  return Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az));
}

/** How far `(x, z)` is, in plan, from the nearest TRIANGLE any side road of `frame` draws: 0 inside one. */
export function toDrawnSideRoad(frame: SceneFrame, x: number, z: number, within: number): number {
  let least = Number.POSITIVE_INFINITY;
  for (const road of frame.sideRoads) {
    const [minX, maxX, minZ, maxZ] = boxOf(road);
    if (x < minX - within || x > maxX + within || z < minZ - within || z > maxZ + within) continue;
    const p = road.mesh.positions;
    const index = road.mesh.indices;
    for (let at = 0; at + 2 < index.length; at += 3) {
      const a = (index[at] as number) * 3;
      const b = (index[at + 1] as number) * 3;
      const c = (index[at + 2] as number) * 3;
      const ax = p[a] as number;
      const az = p[a + 2] as number;
      const bx = p[b] as number;
      const bz = p[b + 2] as number;
      const cx = p[c] as number;
      const cz = p[c + 2] as number;
      const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
      const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
      const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
      const negative = d1 < 0 || d2 < 0 || d3 < 0;
      const positive = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(negative && positive)) return 0;
      least = Math.min(
        least,
        toSegment(x, z, ax, az, bx, bz),
        toSegment(x, z, bx, bz, cx, cz),
        toSegment(x, z, cx, cz, ax, az),
      );
    }
  }
  return least;
}

/** How far `(x, z)` is from the centreline of the road `frame` draws. */
export function toDrawnRoad(frame: SceneFrame, x: number, z: number): number {
  let least = Number.POSITIVE_INFINITY;
  const centre = frame.corridor.centre;
  for (let at = 0; at + 1 < centre.length; at += 1) {
    const a = centre[at] as { x: number; z: number };
    const b = centre[at + 1] as { x: number; z: number };
    least = Math.min(least, toSegment(x, z, a.x, a.z, b.x, b.z));
  }
  return least;
}

/** How far out along each offered way it must be drawn, metres: every 5 m to **120**. */
export const OFFERED_WAY_DRAWN_METRES = 120;

/**
 * How far off a point of an offered way the nearest drawn road surface may
 * be, metres: **1**. The point is on the street's mapped line and the surface
 * is a strip at least 3.5 m wide about it, so a drawn way reads 0; a metre is
 * the street graph's own snap (`street-graph.ts` §`SNAP_METRES`).
 */
export const OFFERED_WAY_WITHIN_METRES = 1;

/**
 * The points of `frame`'s offered ways that it does not draw: each as
 * `way@metres`, for every 5 m from the junction out to
 * {@link OFFERED_WAY_DRAWN_METRES} — or to `fogMetres` from the camera's
 * rider, where the view ends — that lies neither on the road nor within
 * {@link OFFERED_WAY_WITHIN_METRES} of a triangle of a side road.
 */
export function undrawnOfferedWays(ridden: RiddenFrame, fogMetres: number): string[] {
  const origin = corridorOrigin(ridden.input.profile);
  const rider = ridden.frame.markers.find((marker) => marker.kind === 'rider');
  if (rider === undefined) throw new Error('no rider drawn');
  const missing: string[] = [];
  for (const way of ridden.ways) {
    for (let out = 5; out <= OFFERED_WAY_DRAWN_METRES; out += 5) {
      const along = way.fromMetres + out;
      if (along > (way.profile.totalDistance as number)) break;
      const { x, z } = localGroundPosition(origin, positionAt(way.profile, along));
      if (Math.hypot(x - rider.x, z - rider.z) > fogMetres) break;
      if (toDrawnRoad(ridden.frame, x, z) <= ROAD_WIDTH_METRES / 2) continue;
      if (
        toDrawnSideRoad(ridden.frame, x, z, OFFERED_WAY_WITHIN_METRES) <= OFFERED_WAY_WITHIN_METRES
      ) {
        continue;
      }
      missing.push(`${way.id}@${String(out)}`);
    }
  }
  return missing;
}
