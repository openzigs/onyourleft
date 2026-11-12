// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2456: a lane change is drawn turning and leaning into the move, and
 * straight and upright again on arrival — never as the sideways slide the
 * owner saw on the tablet. The first half reads `lane-change-lean.ts`' own
 * arithmetic; the second rides a whole lane change through `scene.ts`
 * §`sceneFrame`, as `GameView`'s loop does it: the steering stepped on the
 * simulation's 20 Hz, the sway damped on a 60 Hz screen, and each frame's
 * rider marker read back.
 */

import { describe, expect, it } from 'vitest';

import { metres, metresPerSecond, seconds, type RouteProfile } from '@onyourleft/domain';

import { MAXIMUM_STEER_RADIANS, WHEELBASE_METRES, combinedLean, steerAngle } from './bicycle';
import { MAXIMUM_LEAN_RADIANS, MAXIMUM_ROLL_RADIANS_PER_SECOND } from './racing-line';
import {
  LANE_CHANGE_LEAN_LIMIT_RADIANS,
  LANE_CHANGE_TURN_SPEED_FLOOR,
  SWAY_ACCELERATION,
  SWAY_SETTLE_SECONDS,
  dampedSway,
  laneChangeLean,
  laneChangeRate,
} from './lane-change-lean';
import {
  LANE_OFFSETS_METRES,
  SIDEWAYS_METRES_PER_SECOND,
  sidewaysSpeedOf,
  startSteer,
  stepSteer,
  steerToward,
  type SteerState,
} from './lanes';
import type { RiderMarker } from './port';
import { hairpinRoute, northRoute } from './route-fixtures-testing';
import { FACING_TURN_LIMIT_RADIANS, sceneFrame } from './scene';
import { SIMULATION_STEP_SECONDS, atStartLine, type GameState } from './simulation';
import { corridorOrigin } from './terrain';

const DEGREE = Math.PI / 180;

describe('the steering’s sideways speed — lanes.ts §sidewaysSpeedOf', () => {
  it('is the steady speed toward the lane steered to, and nought in it', () => {
    const inLane = startSteer(0);
    expect(sidewaysSpeedOf(inLane)).toBe(0);
    expect(sidewaysSpeedOf(steerToward(inLane, 'lane-right'))).toBe(SIDEWAYS_METRES_PER_SECOND);
    expect(sidewaysSpeedOf(steerToward(inLane, 'lane-left'))).toBe(-SIDEWAYS_METRES_PER_SECOND);
    // Still moving on the last step before it arrives, and nought once it has.
    const almost: SteerState = { lane: 2, offset: (LANE_OFFSETS_METRES[2] as number) - 1e-6 };
    expect(sidewaysSpeedOf(almost)).toBe(SIDEWAYS_METRES_PER_SECOND);
    expect(sidewaysSpeedOf(stepSteer(almost, SIMULATION_STEP_SECONDS))).toBe(0);
  });
});

describe('the drawn sway — dampedSway', () => {
  it('moves toward the steering by at most its acceleration a second, and never past it', () => {
    expect(dampedSway(0, SIDEWAYS_METRES_PER_SECOND, 0.05)).toBeCloseTo(
      SWAY_ACCELERATION * 0.05,
      12,
    );
    expect(dampedSway(0, -SIDEWAYS_METRES_PER_SECOND, 0.05)).toBeCloseTo(
      -SWAY_ACCELERATION * 0.05,
      12,
    );
    expect(dampedSway(0, SIDEWAYS_METRES_PER_SECOND, 1)).toBe(SIDEWAYS_METRES_PER_SECOND);
    expect(dampedSway(SIDEWAYS_METRES_PER_SECOND, 0, SWAY_SETTLE_SECONDS)).toBeCloseTo(0, 12);
  });

  it('reaches the same sway at 20, 60 and 120 frames a second', () => {
    const after = (fps: number): number => {
      let sway = 0;
      for (let frame = 0; frame < Math.round(fps * 0.1); frame += 1) {
        sway = dampedSway(sway, SIDEWAYS_METRES_PER_SECOND, 1 / fps);
      }
      return sway;
    };
    expect(after(60)).toBeCloseTo(after(20), 9);
    expect(after(120)).toBeCloseTo(after(20), 9);
  });

  it('moves nothing for a time that is not a finite number of seconds above nought', () => {
    for (const time of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(dampedSway(1, 4, time)).toBe(1);
    }
  });
});

describe('what the sway draws — laneChangeLean and laneChangeRate', () => {
  it('leans toward the move, to at most the cap, and not at all at a standstill or in a lane', () => {
    expect(laneChangeLean(SIDEWAYS_METRES_PER_SECOND, 10)).toBeCloseTo(
      LANE_CHANGE_LEAN_LIMIT_RADIANS,
      12,
    );
    expect(laneChangeLean(-SIDEWAYS_METRES_PER_SECOND, 10)).toBeCloseTo(
      -LANE_CHANGE_LEAN_LIMIT_RADIANS,
      12,
    );
    expect(laneChangeLean(SIDEWAYS_METRES_PER_SECOND / 2, 10)).toBeCloseTo(
      LANE_CHANGE_LEAN_LIMIT_RADIANS / 2,
      12,
    );
    // Never past the cap, whatever the sway.
    expect(laneChangeLean(100, 30)).toBeCloseTo(LANE_CHANGE_LEAN_LIMIT_RADIANS, 12);
    expect(laneChangeLean(SIDEWAYS_METRES_PER_SECOND, 0)).toBe(0);
    expect(laneChangeLean(0, 10)).toBe(0);
    // A walking pace leans less than the cap: the lean a 1 rad/s turn holds there.
    const walking = laneChangeLean(SIDEWAYS_METRES_PER_SECOND, 1);
    expect(walking).toBeGreaterThan(0);
    expect(walking).toBeCloseTo(Math.atan(1 / 9.80665), 6);
  });

  it('rolls no faster than racing-line.ts allows a bend to', () => {
    const fastest =
      (LANE_CHANGE_LEAN_LIMIT_RADIANS * SWAY_ACCELERATION) / SIDEWAYS_METRES_PER_SECOND;
    expect(fastest).toBeLessThanOrEqual(MAXIMUM_ROLL_RADIANS_PER_SECOND);
  });

  it('crosses the road per metre ridden as the sway over the speed, the speed taken at no less than the floor', () => {
    expect(laneChangeRate(4, 20)).toBeCloseTo(0.2, 12);
    expect(laneChangeRate(-4, 20)).toBeCloseTo(-0.2, 12);
    expect(laneChangeRate(4, 2)).toBeCloseTo(4 / LANE_CHANGE_TURN_SPEED_FLOOR, 12);
    expect(laneChangeRate(0, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A whole lane change, drawn.
// ---------------------------------------------------------------------------

const ROUTE: RouteProfile = northRoute(2_000, () => 0);
const SPEED = 10;
const START = 600;
const FPS = 60;

function stateAt(distance: number): GameState {
  return {
    ...atStartLine(ROUTE),
    ride: { speed: metresPerSecond(SPEED), distance: metres(distance) },
    ridden: seconds(distance / SPEED),
  };
}

/** The rider's marker on a frame drawn at `distance`, steered to `offset` and swaying at `sway`. */
function riderAt(distance: number, offset: number, sway: number | undefined): RiderMarker {
  const frame = sceneFrame({
    profile: ROUTE,
    origin: corridorOrigin(ROUTE),
    state: stateAt(distance),
    steeredLateral: offset,
    ...(sway === undefined ? {} : { steeredSway: sway }),
  });
  const rider = frame.markers.find((marker) => marker.kind === 'rider');
  if (rider === undefined) throw new Error('no rider in the frame');
  return rider;
}

/** How far `marker` is turned off `road`, toward the rider's right (the road's normal) positive. */
function turnOff(road: RiderMarker, marker: RiderMarker): number {
  const right = marker.headingX * -road.headingZ + marker.headingZ * road.headingX;
  const along = marker.headingX * road.headingX + marker.headingZ * road.headingZ;
  return Math.atan2(right, along);
}

interface Drawn {
  readonly offset: number;
  readonly turn: number;
  readonly lean: number;
  readonly bodyLean: number;
}

/**
 * One lane change, `intent`, from the middle lane, drawn at {@link FPS} for
 * `secondsLong`: the steering stepped on the simulation's step, as
 * `ride-round.ts` and `race-input.ts` step it, and the sway damped by each
 * frame's time, as `GameView` damps it. `swayed` false hands the scene no sway:
 * the frames as they were drawn before #2456.
 */
function laneChange(
  intent: 'lane-left' | 'lane-right',
  swayed: boolean,
  secondsLong = 1,
): readonly Drawn[] {
  let steer = steerToward(startSteer(0), intent);
  let sway = 0;
  let stepped = 0;
  const out: Drawn[] = [];
  for (let frame = 1; frame <= secondsLong * FPS; frame += 1) {
    const time = frame / FPS;
    while (stepped + SIMULATION_STEP_SECONDS <= time + 1e-12) {
      steer = stepSteer(steer, SIMULATION_STEP_SECONDS);
      stepped += SIMULATION_STEP_SECONDS;
    }
    sway = dampedSway(sway, sidewaysSpeedOf(steer), 1 / FPS);
    const distance = START + SPEED * time;
    const straight = riderAt(distance, steer.offset, 0);
    const marker = riderAt(distance, steer.offset, swayed ? sway : undefined);
    out.push({
      offset: steer.offset,
      turn: turnOff(straight, marker),
      lean: marker.lean,
      bodyLean: marker.bodyLean,
    });
  }
  return out;
}

describe('a lane change, drawn frame by frame — #2456', () => {
  it.each([
    ['lane-right', 1],
    ['lane-left', -1],
  ] as const)(
    'turns and leans the bicycle into a move to the %s, and straightens it on arrival',
    (intent, side) => {
      const frames = laneChange(intent, true);
      // Where it is drawn is unchanged: the steered offset, which the obstacles meet.
      expect(frames.at(-1)?.offset).toBe(LANE_OFFSETS_METRES[1 + side]);
      const turns = frames.map((each) => each.turn * side);
      const leans = frames.map((each) => each.lean * side);
      // Into the move, by a turn and a lean the eye reads from the chase camera.
      expect(Math.max(...turns)).toBeGreaterThan(5 * DEGREE);
      expect(Math.max(...leans)).toBeGreaterThan(5 * DEGREE);
      // Never the other way: the move is drawn as one curve across.
      expect(Math.min(...turns)).toBeGreaterThan(-1e-9);
      expect(Math.min(...leans)).toBeGreaterThan(-1e-9);
      // Within the caps: #1995's turn and this issue's lean (the bicycle leans a
      // little more than the pair, `bicycle.ts` §bicycleRoll).
      expect(Math.max(...turns)).toBeLessThanOrEqual(FACING_TURN_LIMIT_RADIANS);
      expect(Math.max(...leans)).toBeLessThan(LANE_CHANGE_LEAN_LIMIT_RADIANS * 1.2);
      // The body is held back toward upright, as in a bend (#546).
      const mid = frames[Math.round(0.25 * FPS)];
      expect(Math.sign(mid?.bodyLean ?? 0)).toBe(-side);
      // Straight and upright once it has arrived and the sway is spent.
      const last = frames.at(-1);
      expect(Math.abs(last?.turn ?? Number.NaN)).toBeLessThan(1e-9);
      expect(Math.abs(last?.lean ?? Number.NaN)).toBeLessThan(1e-9);
    },
  );

  it('turns and leans by a bounded amount a frame: no snap at the start, the arrival or a reversal', () => {
    // A reversal mid-move, the hardest case: right, then back left before arriving.
    let steer = steerToward(startSteer(0), 'lane-right');
    let sway = 0;
    let stepped = 0;
    let previous: Drawn | undefined;
    let largestTurn = 0;
    let largestLean = 0;
    for (let frame = 1; frame <= FPS; frame += 1) {
      const time = frame / FPS;
      if (frame === 12) steer = steerToward(steer, 'lane-left');
      while (stepped + SIMULATION_STEP_SECONDS <= time + 1e-12) {
        steer = stepSteer(steer, SIMULATION_STEP_SECONDS);
        stepped += SIMULATION_STEP_SECONDS;
      }
      sway = dampedSway(sway, sidewaysSpeedOf(steer), 1 / FPS);
      const distance = START + SPEED * time;
      const marker = riderAt(distance, steer.offset, sway);
      const drawn = {
        offset: steer.offset,
        turn: turnOff(riderAt(distance, steer.offset, 0), marker),
        lean: marker.lean,
        bodyLean: marker.bodyLean,
      };
      if (previous !== undefined) {
        largestTurn = Math.max(largestTurn, Math.abs(drawn.turn - previous.turn));
        largestLean = Math.max(largestLean, Math.abs(drawn.lean - previous.lean));
      }
      previous = drawn;
    }
    // 2.5° a frame at 60 fps is 150°/s of turn; the lean's 50°/s is under 1° a frame.
    expect(largestTurn).toBeLessThan(2.5 * DEGREE);
    expect(largestLean).toBeLessThan(1 * DEGREE);
    expect(largestTurn).toBeGreaterThan(0);
  });

  it('draws the slide #2456 was filed about when no sway is handed to the scene: the control', () => {
    const frames = laneChange('lane-right', false);
    // The same offsets…
    expect(frames.map((each) => each.offset)).toEqual(
      laneChange('lane-right', true).map((each) => each.offset),
    );
    // …facing straight down the road and bolt upright the whole way across.
    for (const each of frames) {
      expect(Math.abs(each.turn)).toBeLessThan(1e-12);
      expect(Math.abs(each.lean)).toBeLessThan(1e-12);
    }
  });

  it('never leans past the tyres’ grip with a bend’s lean under it', () => {
    const hairpin = hairpinRoute(20);
    const apex = 400 + (Math.PI * 20) / 2;
    const leans: number[] = [];
    for (const sway of [SIDEWAYS_METRES_PER_SECOND, -SIDEWAYS_METRES_PER_SECOND]) {
      const frame = sceneFrame({
        profile: hairpin,
        origin: corridorOrigin(hairpin),
        state: {
          ...atStartLine(hairpin),
          ride: { speed: metresPerSecond(20), distance: metres(apex) },
          ridden: seconds(apex / 20),
        },
        steeredLateral: 0,
        steeredSway: sway,
      });
      const rider = frame.markers.find((marker) => marker.kind === 'rider');
      if (rider === undefined) throw new Error('no rider in the frame');
      leans.push(Math.abs(combinedLean(rider.lean, rider.bodyLean)));
    }
    // At 20 m/s round a 20 m hairpin the bend alone asks for the most there is;
    // the lane change toward its inside adds nothing past it.
    expect(Math.max(...leans)).toBeCloseTo(MAXIMUM_LEAN_RADIANS, 9);
  });
});

describe('the bars turned into a lane change and through a bend — #2494', () => {
  interface Steered {
    readonly steer: number;
    readonly turn: number;
  }
  /**
   * One move, as {@link laneChange} draws it, with the sway's rate over each
   * frame handed to the scene as `GameView` hands it — what `dampedSway` moved
   * the sway by, over the frame's time — or none, and at `speed`.
   */
  function steeredChange(
    intent: 'lane-left' | 'lane-right',
    withRate: boolean,
    speed = SPEED,
  ): readonly Steered[] {
    let steer = steerToward(startSteer(0), intent);
    let sway = 0;
    let stepped = 0;
    const out: Steered[] = [];
    for (let frame = 1; frame <= FPS; frame += 1) {
      const time = frame / FPS;
      while (stepped + SIMULATION_STEP_SECONDS <= time + 1e-12) {
        steer = stepSteer(steer, SIMULATION_STEP_SECONDS);
        stepped += SIMULATION_STEP_SECONDS;
      }
      const before = sway;
      sway = dampedSway(sway, sidewaysSpeedOf(steer), 1 / FPS);
      const distance = START + speed * time;
      const input = {
        profile: ROUTE,
        origin: corridorOrigin(ROUTE),
        state: {
          ...atStartLine(ROUTE),
          ride: { speed: metresPerSecond(speed), distance: metres(distance) },
          ridden: seconds(time),
        },
        steeredLateral: steer.offset,
      };
      const straight = sceneFrame({ ...input, steeredSway: 0 }).markers.find(
        (marker) => marker.kind === 'rider',
      );
      const marker = sceneFrame({
        ...input,
        steeredSway: sway,
        ...(withRate ? { steeredSwayRate: (sway - before) * FPS } : {}),
      }).markers.find((each) => each.kind === 'rider');
      if (straight === undefined || marker === undefined) throw new Error('no rider');
      out.push({ steer: marker.steer ?? 0, turn: turnOff(straight, marker) });
    }
    return out;
  }

  it.each([
    ['lane-right', 1],
    ['lane-left', -1],
  ] as const)(
    'turns the bars toward a move to the %s while the bicycle turns into it, back as it straightens, and straight in the lane',
    (intent, side) => {
      const frames = steeredChange(intent, true);
      const steers = frames.map((each) => each.steer * side);
      const turns = frames.map((each) => each.turn * side);
      // As the sway starts, the bicycle starts to turn and the bars are turned
      // into the move by what that turn asks for: atan(1.02 × 2.19 / 10), 12.6°.
      expect(steers[0]).toBeGreaterThan(10 * DEGREE);
      // Toward the move for as long as the bicycle is still turning into it…
      const building = Math.round(SWAY_SETTLE_SECONDS * FPS);
      for (const each of steers.slice(0, building)) expect(each).toBeGreaterThan(0);
      // …straight while it holds its heading across the road…
      const holding = frames
        .map((each, index) => ({ each, index }))
        .filter(
          ({ index }) => index > 0 && turns[index] === turns[index - 1] && index < building * 2,
        );
      expect(holding.length).toBeGreaterThan(3);
      for (const { each } of holding) expect(each.steer).toBe(0);
      // …back the other way as it straightens, as a rider steers out of a move…
      expect(Math.min(...steers)).toBeLessThan(-10 * DEGREE);
      // …never past the clamp, and straight once the rider is in the lane.
      expect(Math.max(...steers.map(Math.abs))).toBeLessThanOrEqual(MAXIMUM_STEER_RADIANS);
      expect(frames.at(-1)?.steer).toBe(0);
    },
  );

  it('holds the bars straight when the scene is told no rate: the control', () => {
    for (const each of steeredChange('lane-right', false)) expect(each.steer).toBe(0);
  });

  it('turns them no further than the clamp at a walking pace, and not at all at a standstill', () => {
    const walking = steeredChange('lane-right', true, 2).map((each) => Math.abs(each.steer));
    expect(Math.max(...walking)).toBeCloseTo(MAXIMUM_STEER_RADIANS, 12);
    for (const each of steeredChange('lane-right', true, 0)) expect(each.steer).toBe(0);
    expect(steerAngle(2, 0)).toBe(0);
    expect(steerAngle(Number.NaN, 10)).toBe(0);
    expect(steerAngle(1, 10)).toBeCloseTo(Math.atan(WHEELBASE_METRES / 10), 12);
    expect(steerAngle(-1, 10)).toBeCloseTo(-Math.atan(WHEELBASE_METRES / 10), 12);
    expect(steerAngle(100, 1)).toBe(MAXIMUM_STEER_RADIANS);
  });

  it('turns them a little through a bend, toward it, for every rider on the road', () => {
    const hairpin = hairpinRoute(20);
    const apex = 400 + (Math.PI * 20) / 2;
    const frame = sceneFrame({
      profile: hairpin,
      origin: corridorOrigin(hairpin),
      state: {
        ...atStartLine(hairpin),
        ride: { speed: metresPerSecond(8), distance: metres(apex) },
        ridden: seconds(apex / 8),
      },
    });
    const rider = frame.markers.find((marker) => marker.kind === 'rider');
    if (rider === undefined) throw new Error('no rider in the frame');
    // Toward the bend, the lean's side, by about atan(L / R): a few degrees.
    expect(Math.sign(rider.steer ?? 0)).toBe(Math.sign(rider.lean));
    expect(Math.abs(rider.steer ?? 0)).toBeGreaterThan(0.5 * DEGREE);
    expect(Math.abs(rider.steer ?? 0)).toBeLessThan(5 * DEGREE);
    // And none on a straight.
    expect(riderAt(START, 0, 0).steer).toBeUndefined();
  });
});
