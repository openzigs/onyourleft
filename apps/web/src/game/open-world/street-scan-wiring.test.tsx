// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **No frame reads every street: a new area's streets are read a slice a
 * frame** — #3107.
 *
 * The owner's open-world tablet ride of 2026-11-23 stalled for half a second
 * to a second "when loading new areas". Part of each stall was the frame
 * builder reading every street the ride holds against the road again, inside
 * one frame, whenever the road's view or the blocks held changed
 * (`nearby-streets.ts` §`nearbyStreets`, `cross-streets.ts`
 * §`mappedJunctions`, and the footways' reading of the junctions).
 *
 * This rides the real game screen over the product's own session on a dense
 * town three blocks long, through a change of the road's view and a change of
 * block, and counts **the work the frame builder did on each frame**: the
 * times it asked the corridor whether a point of a street is on land that was
 * read, which every reading of a street does once a point. The count is taken
 * at the corridor itself (`world-data/corridor.ts` §`coveredLookup`), so it
 * measures the product's work and not a counter the product keeps.
 *
 * - After the ride's first frame, **no frame asks more than
 *   {@link MOST_POINTS_A_FRAME}**, through every change. Read whole, as it
 *   was, the frame of a view's change asked 219 000.
 * - **The streets are never missing meanwhile**: every frame draws side
 *   roads, the ones read last until the new reading is whole.
 * - **The reading comes whole**: read on a slice a call from where the ride
 *   left it, what the ride draws from is what a whole reading of that
 *   corridor and view gives.
 *
 * ⚠️ **The scene is built round each change and not between them**
 * ({@link approach}). The view changes 1 km on and the block 1.65 km on, and
 * a dense town's scene costs this suite about a third of a millisecond a
 * metre ridden: built all the way, and on for hundreds of frames until the
 * last reading was whole, the hook took 2 s on a laptop, 5.7 s in the
 * required gate and more than its ten seconds under the nightly's
 * instrumentation (PR #3117's review). No timeout was raised: the ride does
 * less.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { mappedJunctions } from '../cross-streets';
import { NO_LAND_CLASS } from '../land-class';
import { NEARBY_STREET_SLICE_UNITS, nearbyStreets } from '../nearby-streets';
import type { SceneFrame } from '../port';
import { scatterSeed } from '../scatter';
import type { SceneInput } from '../scene';
import { sceneryAnchor } from '../scenery-anchor';
import { OPEN_WORLD_TOWN_STREETS, START_COLUMN, START_ROW } from './fixture-testing';
import { sceneInputs, startOfferedWaysRide, type OfferedWaysRide } from './offered-ways-testing';

/** How many times the corridor was asked whether a point is on land that was read. */
const asked = { points: 0 };

vi.mock('../world-data/corridor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../world-data/corridor')>();
  return {
    ...actual,
    coveredLookup: (...args: Parameters<typeof actual.coveredLookup>) => {
      const covered = actual.coveredLookup(...args);
      return (x: number, z: number) => {
        asked.points += 1;
        return covered(x, z);
      };
    },
  };
});

/** Each frame the scene built: its input, the points it asked the corridor about, and the side roads it drew. */
const built: {
  readonly input: SceneInput;
  readonly points: number;
  readonly sideRoads: number;
}[] = [];

/** Whether the scene builds the frames it is asked for, or hands on the one before. @see approach */
const building = { on: true };
let handedOn: SceneFrame | undefined;

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      // Every input is kept, built or not: the ride's odometer is read from the last.
      sceneInputs.push(input);
      if (!building.on && handedOn !== undefined) return handedOn;
      const before = asked.points;
      const frame = actual.sceneFrame(input);
      built.push({ input, points: asked.points - before, sideRoads: frame.sideRoads.length });
      handedOn = frame;
      return frame;
    },
  };
});

/**
 * The most points of streets a frame may ask the corridor about, after the
 * ride's first: **6 000**. A slice of the nearby streets and one of the
 * junctions are {@link NEARBY_STREET_SLICE_UNITS} and `cross-streets.ts`
 * §`JUNCTION_SLICE_UNITS` units, 2 000 together; a unit is a point or a
 * sixteenth of one, a slice ends with the street that passes it, and a point
 * of a junction's arm is asked about again as the arm is walked. Measured on
 * 2026-11-23 over this ride: 3 671 at the most. Read whole, as it was before
 * #3107, the frame of the view's change asked 219 340; the ride's first
 * frame, which still reads whole, asks 165 247.
 */
const MOST_POINTS_A_FRAME = 6_000;

/** Where the road's view is replaced, and where the rider crosses into the next block, metres of ride. */
const VIEW_CHANGES_AT = 1_008;
const BLOCK_CHANGES_AT = 1_652;

/** How far short of a change the scene's frames are built again, and how far past it they are built, metres. */
const BEFORE_A_CHANGE_METRES = 60;
const PAST_A_CHANGE_METRES = 50;

let ride: OfferedWaysRide | undefined;

/** The places in {@link built} of the first frame built after each stretch whose frames were not. */
const resumed = new Set<number>();

/**
 * Rides on to `metres` with no frame built: the frame before is handed on,
 * on frames 4 s long. The scans are the scene's to call, so none is read
 * meanwhile, and the reading in hand is as the last built frame left it.
 *
 * The first frame built after it has come hundreds of metres since the last:
 * it is where the scene catches up on that road, not a frame of a ride, and
 * the bound is not held on it. It stands {@link BEFORE_A_CHANGE_METRES} short
 * of the change, so the frames of the change itself are a ride's.
 */
async function approach(metres: number): Promise<void> {
  if (ride === undefined) throw new Error('no ride');
  building.on = false;
  await ride.rideTo(metres, 4_000);
  building.on = true;
  resumed.add(built.length);
}

const lastInput = (): SceneInput | undefined => sceneInputs[sceneInputs.length - 1];

beforeAll(async () => {
  built.length = 0;
  resumed.clear();
  building.on = true;
  handedOn = undefined;
  ride = await startOfferedWaysRide(OPEN_WORLD_TOWN_STREETS, START_COLUMN, START_ROW, 2);
  // The ride's first frames: the first reads whole.
  await ride.ridePumped(3, 1_000);
  // Through the view's change 1 km on, a frame a second of ride.
  await approach(VIEW_CHANGES_AT - BEFORE_A_CHANGE_METRES);
  await ride.rideTo(VIEW_CHANGES_AT + PAST_A_CHANGE_METRES, 1_000);
  // And through the block's, 1.65 km on. The next block's tiles are read
  // between frames, off this ride's clock, so the ride goes on until the
  // streets held have changed, and some frames past it.
  await approach(BLOCK_CHANGES_AT - BEFORE_A_CHANGE_METRES);
  const held = lastInput()?.worldCorridor;
  for (let frames = 0; frames < 60 && lastInput()?.worldCorridor === held; frames += 1) {
    await ride.ridePumped(1, 1_000);
  }
  await ride.ridePumped(5, 1_000);
});

afterAll(() => {
  ride?.end();
  ride = undefined;
});

describe('an open-world ride reads its streets a slice a frame — #3107', () => {
  it('asks the corridor about no more than a slice of points on any frame after the first', () => {
    const changes = { view: 0, corridor: 0 };
    let most = 0;
    for (let index = 1; index < built.length; index += 1) {
      const before = (built[index - 1] as (typeof built)[number]).input;
      const { input, points } = built[index] as (typeof built)[number];
      // The frame the scene catches up on is not a frame of a ride. @see approach
      if (resumed.has(index)) {
        // And it is not the frame of a change: those are held below.
        expect(input.profile === before.profile, `frame ${String(index)}`).toBe(true);
        expect(input.worldCorridor === before.worldCorridor, `frame ${String(index)}`).toBe(true);
        continue;
      }
      if (input.profile !== before.profile) changes.view += 1;
      if (input.worldCorridor !== before.worldCorridor) changes.corridor += 1;
      most = Math.max(most, points);
      expect(points, `frame ${String(index)}`).toBeLessThanOrEqual(MOST_POINTS_A_FRAME);
    }
    // Not vacuous: the ride went through a change of view and a change of
    // block, and the first frame, which reads whole, asked far more.
    expect(changes.view).toBeGreaterThanOrEqual(1);
    expect(changes.corridor).toBeGreaterThanOrEqual(1);
    expect((built[0] as (typeof built)[number]).points).toBeGreaterThan(MOST_POINTS_A_FRAME * 3);
    // And the slices were read: the bound is not met by reading nothing.
    expect(most).toBeGreaterThan(NEARBY_STREET_SLICE_UNITS / 2);
  });

  it('draws the streets on every frame meanwhile, and from a whole reading some slices after the last change', () => {
    for (const { input, sideRoads } of built) {
      expect(sideRoads, `at ${(input.state.ride.distance as number).toFixed(0)} m`).toBeGreaterThan(
        20,
      );
    }
    // The ride ended some frames past the block's change, with the readings
    // begun there in hand. Read on from where the ride left them, as its next
    // frames would, a slice a call, they come whole — and what they give is
    // what a whole reading of the corridor and view gives. A copy of the
    // corridor is read whole, since the ride's own carries the ride's reading.
    const last = (built[built.length - 1] as (typeof built)[number]).input;
    const { worldCorridor, streetScans, profile, origin } = last;
    if (worldCorridor === undefined || streetScans === undefined) {
      throw new Error('the ride was handed no corridor or no scans');
    }
    // The ride left a reading unfinished: this reads on, not again.
    expect(streetScans.nearby.lastUnits).toBeGreaterThan(0);
    const lines = (pieces: readonly { readonly line: Float32Array }[]): string[] =>
      pieces.map((piece) => Array.from(piece.line, (value) => value.toFixed(1)).join(' ')).sort();
    const whole = nearbyStreets({ ...worldCorridor }, profile, origin);
    let ridden = streetScans.nearby.streets(worldCorridor, profile, origin);
    let calls = 1;
    for (; calls < 600 && streetScans.nearby.lastUnits !== 0; calls += 1) {
      const before = asked.points;
      ridden = streetScans.nearby.streets(worldCorridor, profile, origin);
      expect(asked.points - before, `call ${String(calls)}`).toBeLessThanOrEqual(
        MOST_POINTS_A_FRAME,
      );
    }
    expect(streetScans.nearby.lastUnits).toBe(0);
    expect(calls).toBeGreaterThan(10);
    expect(ridden.pieces.length).toBeGreaterThan(500);
    expect(lines(ridden.pieces)).toStrictEqual(lines(whole.pieces));

    const seed = scatterSeed(profile);
    const junctions = mappedJunctions({ ...worldCorridor }, profile, origin, seed, NO_LAND_CLASS);
    // Where the scene says the view is on the ride, and the rider on it. @see scene.ts
    const at = {
      rideOrigin: sceneryAnchor(profile)?.origin ?? 0,
      riderMetres: last.state.ride.distance as number,
    };
    const read = (): ReturnType<typeof streetScans.junctions.junctions> =>
      streetScans.junctions.junctions(worldCorridor, profile, origin, seed, NO_LAND_CLASS, at);
    let found = read();
    for (let more = 0; more < 600 && streetScans.junctions.lastUnits !== 0; more += 1) {
      const before = asked.points;
      found = read();
      expect(asked.points - before, `call ${String(more)}`).toBeLessThanOrEqual(
        MOST_POINTS_A_FRAME,
      );
    }
    expect(streetScans.junctions.lastUnits).toBe(0);
    expect(found.length).toBeGreaterThan(10);
    expect(found.map((junction) => junction.along.toFixed(1))).toStrictEqual(
      junctions.map((junction) => junction.along.toFixed(1)),
    );
    expect(found.map((junction) => junction.arms.length)).toStrictEqual(
      junctions.map((junction) => junction.arms.length),
    );
  });
});
