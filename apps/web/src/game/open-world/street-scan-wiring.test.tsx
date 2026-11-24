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
 * - **The reading comes whole**: some frames after each change, what the ride
 *   draws from is what a whole reading of that corridor and view gives.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { mappedJunctions } from '../cross-streets';
import { NO_LAND_CLASS } from '../land-class';
import { NEARBY_STREET_SLICE_UNITS, nearbyStreets } from '../nearby-streets';
import { scatterSeed } from '../scatter';
import type { SceneInput } from '../scene';
import { OPEN_WORLD_DENSE_STREETS, START_COLUMN, START_ROW } from './fixture-testing';
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

/** Each frame the scene built: its input, and the points it asked the corridor about. */
const built: { readonly input: SceneInput; readonly points: number }[] = [];

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      sceneInputs.push(input);
      const before = asked.points;
      const frame = actual.sceneFrame(input);
      built.push({ input, points: asked.points - before });
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

let ride: OfferedWaysRide | undefined;

/** How many frames at the frame rate, past the ride, the last readings took to come whole. */
let framesToWhole = 0;

beforeAll(async () => {
  built.length = 0;
  ride = await startOfferedWaysRide(OPEN_WORLD_DENSE_STREETS, START_COLUMN, START_ROW, 2);
  // Past the view's change at 1 km and the block's at 1.65 km, on long frames.
  await ride.rideTo(1_900, 1_000);
  // And on at the frame rate until the readings begun at the last change are
  // whole: each frame reads a slice.
  for (framesToWhole = 0; framesToWhole < 600; framesToWhole += 10) {
    const scans = sceneInputs[sceneInputs.length - 1]?.streetScans;
    if (scans?.nearby.lastUnits === 0 && scans.junctions.lastUnits === 0) break;
    await ride.ridePumped(10, 1000 / 60);
  }
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

  it('draws the streets on every frame meanwhile, and from a whole reading soon after each change', () => {
    if (ride === undefined) throw new Error('no ride');
    // The readings begun at the block's change came whole, a slice a frame.
    expect(framesToWhole).toBeLessThan(600);
    for (const { frame, odometer } of ride.frames) {
      expect(frame.sideRoads.length, `at ${odometer.toFixed(0)} m`).toBeGreaterThan(20);
    }
    // The last frame is well past the last change: what it was drawn from is
    // what a whole reading of its corridor and view gives. A copy of the
    // corridor is read, since the ride's own carries the ride's reading.
    const last = (built[built.length - 1] as (typeof built)[number]).input;
    const { worldCorridor, streetScans, profile, origin } = last;
    if (worldCorridor === undefined || streetScans === undefined) {
      throw new Error('the ride was handed no corridor or no scans');
    }
    const lines = (pieces: readonly { readonly line: Float32Array }[]): string[] =>
      pieces.map((piece) => Array.from(piece.line, (value) => value.toFixed(1)).join(' ')).sort();
    const whole = nearbyStreets({ ...worldCorridor }, profile, origin);
    const ridden = streetScans.nearby.streets(worldCorridor, profile, origin);
    expect(streetScans.nearby.lastUnits).toBe(0);
    expect(ridden.pieces.length).toBeGreaterThan(500);
    expect(lines(ridden.pieces)).toStrictEqual(lines(whole.pieces));
    const seed = scatterSeed(profile);
    const junctions = mappedJunctions({ ...worldCorridor }, profile, origin, seed, NO_LAND_CLASS);
    const found = streetScans.junctions.junctions(
      worldCorridor,
      profile,
      origin,
      seed,
      NO_LAND_CLASS,
      { rideOrigin: 0, riderMetres: 0 },
    );
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
