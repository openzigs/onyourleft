// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A junction's ways out are placed a few a frame** — #3119.
 *
 * An open-world ride draws the scenery along each way out of the junctions in
 * view that its route does not take (#3051), and each way's villages,
 * farmsteads, field boundaries and first cells of scenery are placed on the
 * first frame that carries it, then kept. In a town with a street every
 * 100 m a junction coming into reach hands on some twenty ways at once (its
 * own, and those of the junctions along them), and every one of them was
 * placed inside that frame: 15 to 30 ms of it on a laptop.
 *
 * This rides the real game screen over the product's own session on a dense
 * town (`fixture-testing.ts` §`OPEN_WORLD_TOWN_STREETS`), on frames 4 s of
 * ride apart, short of the view's change at 1 km, and counts **the ways each
 * frame placed for the first time**: the views the scene handed to
 * `settlements.ts` §`structuresOnWay` and to `scatter.ts` §`scatterAt` that
 * no frame before had, each a way whose scenery that frame built. The count
 * is taken where the scene calls the placement, so it is the product's work
 * and not a counter the product keeps.
 *
 * - After the ride's first frame, **no frame places more than
 *   `scatter.ts` §`WAYS_PLACED_A_FRAME`**, though frames are handed twenty.
 * - **Every way handed is placed** within the frames that takes, the nearest
 *   first, and once none waits the frame carries what a frame that placed
 *   every way at once carries.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RouteProfile } from '@onyourleft/domain';

import type { SceneFrame } from '../port';
import { WAYS_PLACED_A_FRAME, WaysOutPlacing, type ScatterWay } from '../scatter';
import type { SceneInput } from '../scene';
import { OPEN_WORLD_TOWN_STREETS, START_COLUMN, START_ROW } from './fixture-testing';
import { sceneInputs, startOfferedWaysRide, type OfferedWaysRide } from './offered-ways-testing';

/** The views of the ways out the scene placed scenery along, this frame. */
const placedNow = new Set<RouteProfile>();

vi.mock('../settlements', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../settlements')>();
  return {
    ...actual,
    structuresOnWay: (way: ScatterWay, ...rest: unknown[]) => {
      placedNow.add(way.profile);
      return (actual.structuresOnWay as (...args: unknown[]) => unknown)(way, ...rest);
    },
  };
});

vi.mock('../scatter', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scatter')>();
  return {
    ...actual,
    scatterAt: (...args: Parameters<typeof actual.scatterAt>) => {
      for (const way of args[8] ?? []) placedNow.add(way.profile);
      return actual.scatterAt(...args);
    },
  };
});

/** The views of the ways out the scene handed to the way roads (#3106), this frame. */
const roadsNow = new Set<RouteProfile>();

vi.mock('../way-roads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../way-roads')>();
  return {
    ...actual,
    wayRoads: (...args: Parameters<typeof actual.wayRoads>) => {
      for (const { way } of args[0]) roadsNow.add(way.profile);
      return actual.wayRoads(...args);
    },
  };
});

/** Each frame the scene built: the ways handed to it, the views it placed scenery along, and those it drew as road. */
const built: {
  readonly input: SceneInput;
  readonly handed: readonly RouteProfile[];
  readonly placed: ReadonlySet<RouteProfile>;
  readonly roads: ReadonlySet<RouteProfile>;
}[] = [];

/** The scene's own `sceneFrame`, unwatched. */
const real = vi.hoisted(() => ({
  sceneFrame: undefined as ((input: SceneInput) => SceneFrame) | undefined,
}));

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  real.sceneFrame = actual.sceneFrame;
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      sceneInputs.push(input);
      placedNow.clear();
      roadsNow.clear();
      const frame = actual.sceneFrame(input);
      built.push({
        input,
        handed: (input.waysOut ?? []).map((way) => way.profile),
        placed: new Set(placedNow),
        roads: new Set(roadsNow),
      });
      return frame;
    },
  };
});

/** Where the road's view is replaced: the ride stops short of it, so each frame is an ordinary one. */
const RIDDEN_TO_METRES = 950;

let ride: OfferedWaysRide | undefined;

beforeAll(async () => {
  built.length = 0;
  ride = await startOfferedWaysRide(OPEN_WORLD_TOWN_STREETS, START_COLUMN, START_ROW, 2);
  await ride.ridePumped(3, 1_000);
  await ride.rideTo(RIDDEN_TO_METRES, 4_000);
  // And on at a tablet's frame rate until no way waits: the ride's last frames.
  for (let frames = 0; frames < 60; frames += 1) {
    await ride.ridePumped(1, 16);
    if (sceneInputs[sceneInputs.length - 1]?.streetScans?.ways.waiting === 0) break;
  }
  await ride.ridePumped(1, 16);
});

afterAll(() => {
  ride?.end();
  ride = undefined;
});

/** The ways first placed on each frame, by the frame's place in {@link built}. */
function firstPlaced(): number[] {
  const seen = new Set<RouteProfile>();
  return built.map(({ placed }) => {
    let fresh = 0;
    for (const profile of placed) {
      if (!seen.has(profile)) fresh += 1;
      seen.add(profile);
    }
    return fresh;
  });
}

describe('an open-world ride places its ways out a few a frame — #3119', () => {
  it('places the scenery of no more than a few ways for the first time on any frame after the first', () => {
    const fresh = firstPlaced();
    for (let index = 1; index < built.length; index += 1) {
      expect(fresh[index], `frame ${String(index)}`).toBeLessThanOrEqual(WAYS_PLACED_A_FRAME);
    }
    // Not vacuous: the ride's first frame placed every way it was handed, and
    // later frames were handed far more new ways than the bound at once.
    const first = built[0];
    expect(first?.handed.length).toBeGreaterThan(WAYS_PLACED_A_FRAME * 4);
    expect(fresh[0]).toBe(first?.handed.length);
    const handedSoFar = new Set<RouteProfile>();
    let mostNew = 0;
    for (const { handed } of built) {
      mostNew = Math.max(mostNew, handed.filter((profile) => !handedSoFar.has(profile)).length);
      for (const profile of handed) handedSoFar.add(profile);
    }
    expect(mostNew).toBeGreaterThan(WAYS_PLACED_A_FRAME * 4);
    // And ways were placed after the first frame: the bound is not met by placing none.
    expect(fresh.slice(1).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(mostNew);
  });

  it('places as many as it may on every frame a way waits, and then draws what placing them at once draws', () => {
    // Every frame places the bound, or every way it was handed that no frame
    // before placed, whichever is fewer: no frame leaves a way waiting that
    // it could have placed, so the ways are placed in as few frames as the
    // bound allows. On frames 4 s of ride apart a junction comes every two
    // or three, so the ways queue; at a tablet's 60 a second they do not.
    const fresh = firstPlaced();
    const placedBefore = new Set<RouteProfile>();
    let waitedOn = 0;
    built.forEach(({ handed, placed }, index) => {
      const unplaced = handed.filter((profile) => !placedBefore.has(profile)).length;
      if (index > 0) {
        expect(fresh[index], `frame ${String(index)}`).toBe(
          Math.min(WAYS_PLACED_A_FRAME, unplaced),
        );
        if (unplaced > WAYS_PLACED_A_FRAME) waitedOn += 1;
      }
      for (const profile of placed) placedBefore.add(profile);
    });
    expect(waitedOn).toBeGreaterThan(0);
    // A way waiting is still drawn as road where nothing else draws it
    // (`way-roads.ts`): the way roads are handed every way in reach, placed
    // or not, so no way the junction prompt offers is a turn into a hedge.
    let roadsUnplaced = 0;
    for (const { handed, placed, roads } of built) {
      for (const profile of roads) {
        expect(handed.includes(profile)).toBe(true);
        if (!placed.has(profile)) roadsUnplaced += 1;
      }
    }
    expect(roadsUnplaced).toBeGreaterThan(0);
    // The last frame was handed every way it carries placed, none waiting.
    const last = built[built.length - 1];
    const scans = last?.input.streetScans;
    const sceneFrame = real.sceneFrame;
    if (last === undefined || scans === undefined || sceneFrame === undefined) {
      throw new Error('the ride built no frame with scans');
    }
    expect(scans.ways.waiting).toBe(0);
    expect(last.handed.length).toBeGreaterThan(WAYS_PLACED_A_FRAME * 4);
    for (const profile of last.handed) expect(last.placed.has(profile)).toBe(true);
    // And it carries what a frame that places every way at once carries: the
    // same input, with a placing whose first call places all.
    const lines = (frame: SceneFrame): string[] =>
      frame.scatter.map((item) => `${item.kind} ${item.x.toFixed(2)} ${item.z.toFixed(2)}`).sort();
    const asHanded = sceneFrame(last.input);
    const atOnce = sceneFrame({
      ...last.input,
      streetScans: { ...scans, ways: new WaysOutPlacing() },
    });
    expect(asHanded.scatter.length).toBeGreaterThan(0);
    expect(lines(asHanded)).toStrictEqual(lines(atOnce));
  });
});
