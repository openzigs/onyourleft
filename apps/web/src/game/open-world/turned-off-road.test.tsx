// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **After a junction turn, the road turned off carries on where it really
 * does** — #3123.
 *
 * The owner's open-world tablet ride of 2026-11-24: "if you decide to turn I
 * noticed the road you are turning off of disappears at the turn and not
 * continuing if the road does actually continue". After a turn the road the
 * rider came along is drawn by nothing once the rider is a little past the
 * junction: the scene draws the road from `terrain.ts` §`VIEW_BEHIND_METRES`
 * (60 m) behind the rider, the streets' own drawing keeps off the route (so
 * off the road behind the junction, and off the road on past it until it
 * reads the streets again for the new route), and a way out is handed on no
 * further than 60 m behind the rider. Measured on this file's crossroads
 * before the fix: the road back from the junction undrawn from 60 m behind
 * the rider on every frame, and the road on past it undrawn from 62 m to the
 * fog on the frames where its way out was dropped, and in its first 21 m once
 * the junction's stub left the view.
 *
 * Each case rides the real game screen over the product's own session, its
 * area reader, decoder, street graph, rolling route, road, junction choice
 * and scene, on fixture streets (`fixture-testing.ts`: lines written there,
 * no map data, no place), presses a turn at the town's second junction as a
 * rider would (inside the prompt, short of the lock), and reads back **the
 * frames the renderer was handed** (`offered-ways-testing.ts`). On every
 * frame from the junction to {@link PAST_METRES} past it, every point of the
 * road turned off within {@link REACH_METRES} of the drawn rider, on either
 * side of the junction, lies on the road the frame draws or on a triangle of
 * one of its side roads.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { GraphFixtureStreet } from '@onyourleft/map-features/testing';

import { NEARBY_STREET_VIEW_METRES } from '../nearby-streets';
import type { SceneInput } from '../scene';
import { corridorOrigin, localGroundPosition, ROAD_WIDTH_METRES } from '../terrain';
import {
  fixturePosition,
  GRID_COLUMNS,
  MAIN_STREET_ROW,
  OPEN_WORLD_GRID_STREETS,
  START_COLUMN,
  START_ROW,
} from './fixture-testing';
import { JUNCTION_PROMPT_METRES } from './junction-choice';
import {
  OFFERED_WAY_WITHIN_METRES,
  sceneInputs,
  startOfferedWaysRide,
  toDrawnRoad,
  toDrawnSideRoad,
  type OfferedWaysRide,
  type RiddenFrame,
} from './offered-ways-testing';

vi.mock('../scene', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../scene')>();
  return {
    ...actual,
    sceneFrame: (input: SceneInput) => {
      sceneInputs.push(input);
      return actual.sceneFrame(input);
    },
  };
});

/** The column of the junction turned at: the second a ride east along Main street meets. */
const TURN_COLUMN = GRID_COLUMNS[2] as number;

/** How far short of the junction the turn is pressed, ride metres: inside the prompt, past the lock's 100 m. */
const PRESS_SHORT_METRES = 115;

/** How far past the junction the frames are held, ride metres. */
const PAST_METRES = 300;

/** How far from the drawn rider the road turned off must be drawn: the fog, less a margin. */
const REACH_METRES = NEARBY_STREET_VIEW_METRES - 20;

/** How far apart the road turned off is read, in fixture pixels: 22, about 5 m. */
const READ_EVERY_PIXELS = 22;

/** About how many metres a fixture pixel is along a row, for naming a point. */
const METRES_PER_PIXEL = 0.2335;

/**
 * {@link OPEN_WORLD_GRID_STREETS} with the cross street at
 * {@link TURN_COLUMN} running SOUTH of Main street only: the junction turned
 * at is a T, and Main street carries on through it.
 */
const T_STREETS: readonly GraphFixtureStreet[] = OPEN_WORLD_GRID_STREETS.map((street) => {
  const [first, last] = [street.line[0], street.line[street.line.length - 1]];
  return first?.[0] === TURN_COLUMN && last?.[0] === TURN_COLUMN
    ? {
        ...street,
        line: [
          [TURN_COLUMN, MAIN_STREET_ROW],
          [TURN_COLUMN, 7900],
        ] as const,
      }
    : street;
});

interface TurnRidden {
  readonly frames: readonly RiddenFrame[];
  /** The junction's ride distance. */
  readonly junction: number;
}

let ride: OfferedWaysRide | undefined;

/**
 * Rides `streets` east from the start pin, presses `key` {@link PRESS_SHORT_METRES}
 * short of the second junction, and rides on to {@link PAST_METRES} past it.
 */
async function rideTheTurn(
  streets: readonly GraphFixtureStreet[],
  key: 'ArrowLeft' | 'ArrowRight',
): Promise<TurnRidden> {
  ride = await startOfferedWaysRide(streets, START_COLUMN, START_ROW);
  const prompted = (): number[] =>
    [
      ...new Set(
        (ride as OfferedWaysRide).frames.flatMap((frame) =>
          frame.junction === undefined ? [] : [frame.junction.distance],
        ),
      ),
    ].sort((a, b) => a - b);
  let junction: number | undefined;
  for (let frame = 0; frame < 400 && junction === undefined; frame += 1) {
    await ride.ridePumped(1, 500);
    const second = prompted()[1];
    const at = ride.frames.at(-1)?.odometer ?? 0;
    if (second !== undefined && at >= second - PRESS_SHORT_METRES) junction = second;
  }
  if (junction === undefined) throw new Error('the second junction was never prompted');
  await ride.press(key);
  await ride.rideTo(junction + PAST_METRES);
  return { frames: ride.frames, junction };
}

/**
 * The points of Main street, every {@link READ_EVERY_PIXELS}, within
 * {@link REACH_METRES} of `frame`'s drawn rider that it draws as neither road
 * nor side road, each as `far 25 m` or `near 25 m` from the junction; and how
 * many points of each side were read.
 */
function undrawnRoadTurnedOff(frame: RiddenFrame): {
  readonly undrawn: string[];
  readonly far: number;
  readonly near: number;
} {
  const origin = corridorOrigin(frame.input.profile);
  const rider = frame.frame.markers.find((marker) => marker.kind === 'rider');
  if (rider === undefined) throw new Error('no rider drawn');
  const undrawn: string[] = [];
  let far = 0;
  let near = 0;
  for (
    let column = START_COLUMN;
    column <= (GRID_COLUMNS[6] as number);
    column += READ_EVERY_PIXELS
  ) {
    const { x, z } = localGroundPosition(origin, fixturePosition(column, MAIN_STREET_ROW));
    if (Math.hypot(x - rider.x, z - rider.z) > REACH_METRES) continue;
    const side = column >= TURN_COLUMN ? 'far' : 'near';
    if (side === 'far') far += 1;
    else near += 1;
    if (toDrawnRoad(frame.frame, x, z) <= ROAD_WIDTH_METRES / 2) continue;
    if (
      toDrawnSideRoad(frame.frame, x, z, OFFERED_WAY_WITHIN_METRES) <= OFFERED_WAY_WITHIN_METRES
    ) {
      continue;
    }
    const metres = Math.abs(column - TURN_COLUMN) * METRES_PER_PIXEL;
    undrawn.push(`${side} ${metres.toFixed(0)} m`);
  }
  return { undrawn, far, near };
}

/** Holds the turn ridden, and the road turned off drawn on every frame from the junction on. */
function expectRoadTurnedOffDrawn(
  ridden: () => TurnRidden,
  side: 'left' | 'right',
  ways: number,
): void {
  const { frames, junction } = ridden();
  // The second junction a fixture block on, at the turn column.
  expect(junction).toBeGreaterThan(455);
  expect(junction).toBeLessThan(475);
  // The prompt for it, before the press and after it, read off the ride's own route.
  const prompts = frames.filter((frame) => frame.junction?.distance === junction);
  const before = prompts[0]?.junction;
  const after = prompts.at(-1)?.junction;
  if (before === undefined || after === undefined) throw new Error('never prompted');
  expect(before.ways).toHaveLength(ways);
  expect(before.taken).toBe(before.defaultWay);
  // Main street on is the way the route would take: straight on.
  const onward = before.ways.find((way) => way.edge.id === before.defaultWay);
  expect(Math.abs(onward?.turnDegrees ?? 90)).toBeLessThan(5);
  // The turn was taken: the route leaves Main street there, to the side pressed.
  expect(after.taken).not.toBe(after.defaultWay);
  const taken = after.ways.find((way) => way.edge.id === after.taken);
  expect(Math.sign(taken?.turnDegrees ?? 0)).toBe(side === 'right' ? 1 : -1);
  expect(prompts[0]?.odometer).toBeLessThan(junction - JUNCTION_PROMPT_METRES / 2);

  const past = frames.filter(
    (frame) => frame.odometer >= junction && frame.odometer <= junction + PAST_METRES,
  );
  expect(past.length).toBeGreaterThan(40);
  let far = 0;
  let near = 0;
  for (const frame of past) {
    const read = undrawnRoadTurnedOff(frame);
    far += read.far;
    near += read.near;
    expect(read.undrawn, `${(frame.odometer - junction).toFixed(0)} m past the junction`).toEqual(
      [],
    );
  }
  // Not vacuous: both sides of the junction were in reach on every frame.
  expect(far).toBeGreaterThan(past.length * 50);
  expect(near).toBeGreaterThan(past.length * 30);
}

describe('after a junction turn, the road turned off is drawn on past the junction and back from it — #3123', () => {
  describe('a right turn at a crossroads', () => {
    let ridden: TurnRidden | undefined;
    beforeAll(async () => {
      ridden = await rideTheTurn(OPEN_WORLD_GRID_STREETS, 'ArrowRight');
    });
    afterAll(() => {
      ride?.end();
      ride = undefined;
    });

    it('draws the road turned off to the view’s reach, on both sides of the junction, on every frame', () => {
      expectRoadTurnedOffDrawn(() => ridden as TurnRidden, 'right', 3);
    });
  });

  describe('a left turn at a crossroads', () => {
    let ridden: TurnRidden | undefined;
    beforeAll(async () => {
      ridden = await rideTheTurn(OPEN_WORLD_GRID_STREETS, 'ArrowLeft');
    });
    afterAll(() => {
      ride?.end();
      ride = undefined;
    });

    it('draws the road turned off to the view’s reach, on both sides of the junction, on every frame', () => {
      expectRoadTurnedOffDrawn(() => ridden as TurnRidden, 'left', 3);
    });
  });

  describe('a turn off at a T where the road carries on', () => {
    let ridden: TurnRidden | undefined;
    beforeAll(async () => {
      ridden = await rideTheTurn(T_STREETS, 'ArrowRight');
    });
    afterAll(() => {
      ride?.end();
      ride = undefined;
    });

    it('draws the road turned off to the view’s reach, on both sides of the junction, on every frame', () => {
      expectRoadTurnedOffDrawn(() => ridden as TurnRidden, 'right', 2);
    });
  });
});
