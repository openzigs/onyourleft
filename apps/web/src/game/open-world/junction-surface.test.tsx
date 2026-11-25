// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **A junction the rider turns through is drawn as roads meeting, not as one
 * road bending** — #3133.
 *
 * The owner's open-world tablet ride of 2026-11-24 (build 1124c): "if I pick
 * the roads don't junction quite right, they just turn instead of being a T
 * or cross." After a turn is chosen, the road the frame draws is the route,
 * and the route bends into the street turned into: its edge lines and its
 * centre line ran round the corner, across the mouths of the ways not taken,
 * and nothing drew the corners of the junction between the arms.
 *
 * Each case rides the real game screen over the product's own session, its
 * area reader, decoder, street graph, rolling route, road, junction choice
 * and scene, on fixture streets (`fixture-testing.ts`: lines written there,
 * no map data, no place), presses a right turn at the town's second junction
 * as a rider would (inside the prompt, short of the lock), and reads back
 * **the frames the renderer was handed** (`offered-ways-testing.ts`). On
 * every frame from {@link BEFORE_METRES} short of the junction to
 * {@link AFTER_METRES} past it — as the rider turns — it holds that:
 *
 * - **every arm is drawn**: each street meeting there (four at the
 *   crossroads, three at the T), every 5 m from the junction's mouth out to
 *   the view's reach or the next junction, lies on the road the frame draws
 *   or on a side road's triangle;
 * - **the arms are joined at a junction surface**: the square where the
 *   streets overlap, and a point {@link INTO_CORNER_METRES} into each corner
 *   between two neighbouring arms (road wherever the kerb is rounded by
 *   more than about 3.6 m), are drawn;
 * - **the lines stop at the mouth**: no painted triangle of the road the
 *   frame draws — an edge line or a centre-line mark — has a corner in that
 *   square. A road bending round the corner paints its edge lines through it.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { GraphFixtureStreet } from '@onyourleft/map-features/testing';

import { SIDE_ROAD_WIDTHS, linearColour } from '../cross-streets';
import { NEARBY_STREET_VIEW_METRES } from '../nearby-streets';
import type { SceneFrame } from '../port';
import type { SceneInput } from '../scene';
import {
  corridorOrigin,
  localGroundPosition,
  MARKING_COLOUR,
  ROAD_WIDTH_METRES,
  VIEW_BEHIND_METRES,
} from '../terrain';
import {
  fixturePosition,
  GRID_COLUMNS,
  MAIN_STREET_ROW,
  OPEN_WORLD_GRID_STREETS,
  START_COLUMN,
  START_ROW,
} from './fixture-testing';
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

/** How far short of the junction the frames are held from, ride metres: after the press. */
const BEFORE_METRES = 100;

/** How far past the junction the frames are held to, ride metres: round the corner and on. */
const AFTER_METRES = 100;

/** How far from the drawn rider an arm must be drawn: the fog, less a margin. */
const REACH_METRES = NEARBY_STREET_VIEW_METRES - 20;

/** How far out along each arm it must be drawn, metres: short of the next junction (a block is 230–260 m). */
const ARM_METRES = 200;

/** Where along each arm the reading starts, metres from the junction's node: past any corner's rounding. */
const ARM_FROM_METRES = 15;

/** How far into a corner between two arms, diagonally from where their edges meet, must be road. */
const INTO_CORNER_METRES = 1.5;

/** How close two colours are to be one, per channel. */
const SAME_COLOUR = 1e-4;

/** The road's paint, as the frame's colours carry it: linear. */
const PAINT = linearColour(MARKING_COLOUR);

/**
 * {@link OPEN_WORLD_GRID_STREETS} with the cross street at
 * {@link TURN_COLUMN} running SOUTH of Main street only: the junction turned
 * at is a T, the turn is into its stem, and Main street carries on through it.
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

/** One street meeting at the junction: its heading from the node, and how wide it is drawn. */
interface Arm {
  readonly name: string;
  /** A unit vector in plan, local metres. */
  readonly x: number;
  readonly z: number;
  /** Half its drawn width: the route's road where it is the route, else its street's class. */
  readonly half: number;
}

interface TurnRidden {
  readonly frames: readonly RiddenFrame[];
  /** The junction's ride distance. */
  readonly junction: number;
}

let ride: OfferedWaysRide | undefined;

/** Rides `streets` east, presses right {@link PRESS_SHORT_METRES} short of the second junction, and rides on past it. */
async function rideTheTurn(streets: readonly GraphFixtureStreet[]): Promise<TurnRidden> {
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
  await ride.press('ArrowRight');
  await ride.rideTo(junction + AFTER_METRES);
  return { frames: ride.frames, junction };
}

/** The node and the arms meeting there, in `frame`'s local metres. */
function armsIn(
  frame: RiddenFrame,
  crossroads: boolean,
): { readonly x: number; readonly z: number; readonly arms: readonly Arm[] } {
  const origin = corridorOrigin(frame.input.profile);
  const at = (column: number, row: number): { x: number; z: number } =>
    localGroundPosition(origin, fixturePosition(column, row));
  const node = at(TURN_COLUMN, MAIN_STREET_ROW);
  const arm = (name: string, column: number, row: number, half: number): Arm => {
    const { x, z } = at(column, row);
    const length = Math.hypot(x - node.x, z - node.z);
    return { name, x: (x - node.x) / length, z: (z - node.z) / length, half };
  };
  const road = ROAD_WIDTH_METRES / 2;
  // Main street is a major road, drawn at the road's width either way; the
  // cross street is the route's road south, and a minor street north.
  const arms = [
    arm('west', TURN_COLUMN - 1000, MAIN_STREET_ROW, road),
    arm('east', TURN_COLUMN + 1000, MAIN_STREET_ROW, SIDE_ROAD_WIDTHS.major / 2),
    arm('south', TURN_COLUMN, MAIN_STREET_ROW + 1000, road),
    ...(crossroads
      ? [arm('north', TURN_COLUMN, MAIN_STREET_ROW - 1000, SIDE_ROAD_WIDTHS.minor / 2)]
      : []),
  ];
  return { ...node, arms };
}

/** Whether `frame` draws road at `(x, z)`: the road's surface, or within a metre of a side road's triangle. */
function drawnAt(frame: SceneFrame, x: number, z: number): boolean {
  return (
    toDrawnRoad(frame, x, z) <= ROAD_WIDTH_METRES / 2 ||
    toDrawnSideRoad(frame, x, z, OFFERED_WAY_WITHIN_METRES) <= OFFERED_WAY_WITHIN_METRES
  );
}

/**
 * Each arm's points, every 5 m from {@link ARM_FROM_METRES} to
 * {@link ARM_METRES}, within reach and undrawn. The road behind the rider
 * is drawn `terrain.ts` §`VIEW_BEHIND_METRES` back: short of the junction
 * the road they came along is read only that far out, and past it the road
 * they turned into only from that far back.
 */
function undrawnArms(
  frame: RiddenFrame,
  node: { x: number; z: number },
  arms: readonly Arm[],
  short: number,
): { readonly undrawn: string[]; readonly read: number } {
  const rider = frame.frame.markers.find((marker) => marker.kind === 'rider');
  if (rider === undefined) throw new Error('no rider drawn');
  const undrawn: string[] = [];
  let read = 0;
  for (const arm of arms) {
    const most = arm.name === 'west' && short > 0 ? short + VIEW_BEHIND_METRES - 5 : ARM_METRES;
    // Past it, the road the rider turned into is behind them back to the junction.
    const least = arm.name === 'south' && short < 0 ? -short - VIEW_BEHIND_METRES + 5 : 0;
    for (let out = Math.max(ARM_FROM_METRES, least); out <= Math.min(ARM_METRES, most); out += 5) {
      const x = node.x + arm.x * out;
      const z = node.z + arm.z * out;
      if (Math.hypot(x - rider.x, z - rider.z) > REACH_METRES) continue;
      read += 1;
      if (!drawnAt(frame.frame, x, z)) undrawn.push(`${arm.name} ${String(out)} m`);
    }
  }
  return { undrawn, read };
}

/**
 * The points of the junction's surface `frame` leaves undrawn: a grid every
 * half metre over the square where the two streets overlap, and a point
 * {@link INTO_CORNER_METRES} into each corner between neighbouring arms
 * less than a half-turn apart.
 */
function undrawnSurface(
  frame: RiddenFrame,
  node: { x: number; z: number },
  arms: readonly Arm[],
): string[] {
  const undrawn: string[] = [];
  const [west, east, south] = arms as [Arm, Arm, Arm];
  // The overlap: Main street's width across, the cross street's along.
  const across = Math.min(west.half, east.half);
  const along = south.half;
  for (let u = -along; u <= along + 1e-9; u += 0.5) {
    for (let v = -across; v <= across + 1e-9; v += 0.5) {
      const x = node.x + east.x * u + south.x * v;
      const z = node.z + east.z * u + south.z * v;
      if (!drawnAt(frame.frame, x, z)) {
        undrawn.push(`square ${u.toFixed(1)}, ${v.toFixed(1)}`);
      }
    }
  }
  const sorted = [...arms].sort((a, b) => Math.atan2(a.z, a.x) - Math.atan2(b.z, b.x));
  for (let index = 0; index < sorted.length; index += 1) {
    const a = sorted[index] as Arm;
    const b = sorted[(index + 1) % sorted.length] as Arm;
    // Neighbours a quarter-turn apart: their edges meet at the corner of the overlap.
    if (Math.abs(a.x * b.x + a.z * b.z) > 0.1) continue;
    const cornerX = node.x + a.x * b.half + b.x * a.half;
    const cornerZ = node.z + a.z * b.half + b.z * a.half;
    const into = INTO_CORNER_METRES / Math.SQRT2;
    const x = cornerX + (a.x + b.x) * into;
    const z = cornerZ + (a.z + b.z) * into;
    if (!drawnAt(frame.frame, x, z)) undrawn.push(`corner ${a.name}–${b.name}`);
  }
  return undrawn;
}

/**
 * Each painted triangle of the road `frame` draws — an edge line's or a
 * centre-line mark's, any corner the paint's colour and the triangle not
 * folded to nothing — with a corner inside the overlap square, by where.
 */
function paintInSquare(
  frame: RiddenFrame,
  node: { x: number; z: number },
  arms: readonly Arm[],
): string[] {
  const [west, east, south] = arms as [Arm, Arm, Arm];
  const across = Math.min(west.half, east.half);
  const along = south.half;
  const { vertices, colours, indices } = frame.frame.corridor;
  const painted = (vertex: number): boolean =>
    [0, 1, 2].every(
      (channel) =>
        Math.abs((colours[vertex * 3 + channel] as number) - (PAINT[channel] as number)) <
        SAME_COLOUR,
    );
  const inSquare = (vertex: number): string | undefined => {
    const dx = (vertices[vertex * 3] as number) - node.x;
    const dz = (vertices[vertex * 3 + 2] as number) - node.z;
    const u = dx * east.x + dz * east.z;
    const v = dx * south.x + dz * south.z;
    return Math.abs(u) < along && Math.abs(v) < across
      ? `${u.toFixed(1)}, ${v.toFixed(1)}`
      : undefined;
  };
  const found: string[] = [];
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const corners = [indices[at], indices[at + 1], indices[at + 2]] as [number, number, number];
    if (!corners.some(painted)) continue;
    const [a, b, c] = corners.map((vertex) => [
      vertices[vertex * 3] as number,
      vertices[vertex * 3 + 2] as number,
    ]) as [[number, number], [number, number], [number, number]];
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    if (!(area > 1e-6)) continue;
    for (const vertex of corners) {
      const where = inSquare(vertex);
      if (where !== undefined) {
        found.push(where);
        break;
      }
    }
  }
  return found;
}

/** Holds the turn ridden, and the junction drawn as roads meeting on every frame round it. */
function expectRoadsMeeting(ridden: () => TurnRidden, crossroads: boolean): void {
  const { frames, junction } = ridden();
  expect(junction).toBeGreaterThan(455);
  expect(junction).toBeLessThan(475);
  // The turn was taken, to the right, and was not the default.
  const prompts = frames.filter((frame) => frame.junction?.distance === junction);
  const after = prompts.at(-1)?.junction;
  if (after === undefined) throw new Error('never prompted');
  expect(after.ways).toHaveLength(crossroads ? 3 : 2);
  expect(after.taken).not.toBe(after.defaultWay);
  const taken = after.ways.find((way) => way.edge.id === after.taken);
  expect(taken?.turnDegrees ?? 0).toBeGreaterThan(60);

  const round = frames.filter(
    (frame) =>
      frame.odometer >= junction - BEFORE_METRES && frame.odometer <= junction + AFTER_METRES,
  );
  expect(round.length).toBeGreaterThan(25);
  let read = 0;
  for (const frame of round) {
    const label = `${(frame.odometer - junction).toFixed(0)} m from the junction`;
    const { arms, ...node } = armsIn(frame, crossroads);
    const armsRead = undrawnArms(frame, node, arms, junction - frame.odometer);
    read += armsRead.read;
    expect(armsRead.undrawn, `${label}: arms`).toEqual([]);
    expect(undrawnSurface(frame, node, arms), `${label}: the junction's surface`).toEqual([]);
    expect(paintInSquare(frame, node, arms), `${label}: paint in the junction`).toEqual([]);
  }
  // Not vacuous: most of every arm was in reach on every frame.
  expect(read).toBeGreaterThan(round.length * arms(crossroads) * 25);
}

/** How many arms meet at the junction. */
function arms(crossroads: boolean): number {
  return crossroads ? 4 : 3;
}

describe('a junction the rider turns through is drawn as roads meeting — #3133', () => {
  describe('a right turn at a crossroads', () => {
    let ridden: TurnRidden | undefined;
    beforeAll(async () => {
      ridden = await rideTheTurn(OPEN_WORLD_GRID_STREETS);
    });
    afterAll(() => {
      ride?.end();
      ride = undefined;
    });

    it('draws all four arms, joined at a junction surface, with no line painted across it', () => {
      expectRoadsMeeting(() => ridden as TurnRidden, true);
    });
  });

  describe('a right turn into the stem of a T where the road carries on', () => {
    let ridden: TurnRidden | undefined;
    beforeAll(async () => {
      ridden = await rideTheTurn(T_STREETS);
    });
    afterAll(() => {
      ride?.end();
      ride = undefined;
    });

    it('draws all three arms, joined at a junction surface, with no line painted across it', () => {
      expectRoadsMeeting(() => ridden as TurnRidden, false);
    });
  });
});
