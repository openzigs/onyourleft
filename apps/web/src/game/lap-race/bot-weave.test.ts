// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2665: a lap race's bots ride a line, not a weave. The owner's report of
 * 2026-11-15 from the tablet: *"the riders in lap race are still a bit
 * sporadic in their movements … side to side weaving"*.
 *
 * A gate over whole races, read the way the screen reads them: the game's own
 * race step (`stepLapRaceRide`) at its 20 Hz tick, the drawing `GameView` is
 * handed (`lapRaceDrawing`) on every frame at 60 a second, a part-tick behind
 * the newest as `simulation.ts` §`drawnAt` draws it, and each bot's marker as
 * `scene.ts` §`placedRiders` turns it. Per race it bounds:
 *
 * - **lane changes**, the race's own, per bot-minute;
 * - **reversals** of a bot's drawn place across the road, and **weaves**, a
 *   reversal soon after another, per bot-minute;
 * - a bot's **sideways speed**, frame to frame, and its **sideways
 *   acceleration** over each tick's frames: eased at a rider's pace on all but
 *   a sliver of frames, and never more than the pack's step out of someone's
 *   way (`pack-layout.ts` §`PACK_CLEAR_SIDEWAYS_METRES_PER_SECOND`), which
 *   keeps the rider and the bots out of one another (the owner's ruling on
 *   #2544) where an eased move cannot;
 * - how far a bot's drawn **heading turns in one frame**.
 *
 * Every bound is written here, not imported, so a layout or a strategy that
 * moved one is red rather than a gate that moved with it. What the code
 * before #2665 read on these races is beside each.
 *
 * Each race is ridden once, by the first case that asks, and read by the
 * others. No case sets its own timeout (#1688).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { kilograms, metres } from '@onyourleft/domain';

import { DEFAULT_RIDING_POSITION, rideConditionsFor } from '../rider';
import { circuitRoute } from '../route-fixtures-testing';
import { placedRiders, type SceneInput } from '../scene';
import { atStartLine } from '../simulation';
import { corridorOrigin, roadCorridor, type CorridorPoint, type RoadCorridor } from '../terrain';
import { LAP_RACE_MOST_BOTS } from './choice';
import {
  LAP_RACE_RIDER_ID,
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  lapRaceDrawing,
  startLapRaceRide,
  stepLapRaceRide,
} from './ride-race';

/** A level 100 m-radius circuit, 628 m round. */
const LOOP = circuitRoute(100, () => 0);
const ORIGIN = corridorOrigin(LOOP);
const FRAME_SECONDS = 1 / 60;
/** A tick's worth of frames, over which the acceleration is read. */
const SPAN = Math.round(LAP_RACE_TICK_SECONDS / FRAME_SECONDS);

/** The races: two seeds, each with items on and off. */
const RACES = [
  { seed: 1, itemsOn: true },
  { seed: 1, itemsOn: false },
  { seed: 2, itemsOn: true },
  { seed: 2, itemsOn: false },
] as const;
/** How long each race is ridden, seconds: off the grid, the pack forming, and a lap and more. */
const RIDDEN_SECONDS = 75;
/** The rider rides a steady line at the field's pace, metres a second, and power. */
const RIDER_SPEED = 8;
const RIDER_WATTS = 200;
/** How often the frame's corridor is built again, in frames: every bot in it is tens of metres from its ends. */
const CORRIDOR_EVERY = 30;

/**
 * How far a drawn bot must come back across the road from the furthest it
 * went one way for that to count as a reversal, metres: **0.1**, under a fifth
 * of a place abreast.
 */
const REVERSAL_METRES = 0.1;
/** A reversal within this long of the one before is a weave, seconds: **3**. */
const WEAVE_SECONDS = 3;

/** Before #2665, on these races: 12 to 16. */
const MOST_LANE_CHANGES_PER_BOT_MINUTE = 3;
/** Before #2665: 10 to 14. */
const MOST_REVERSALS_PER_BOT_MINUTE = 3;
/** Before #2665: 2.1 to 3.3. */
const MOST_WEAVES_PER_BOT_MINUTE = 0.5;
/** A rider's change of line, metres a second: the issue's 1.2 to 1.5, and a little over. */
const EASED_SIDEWAYS_METRES_PER_SECOND = 1.6;
/** Metres a second squared over a tick's frames: the issue's 1.5 to 2, and a little over. */
const EASED_SIDEWAYS_METRES_PER_SECOND_SQUARED = 2.5;
/** Degrees in a frame at 60 a second that a bot easing across turns by at most. */
const EASED_YAW_DEGREES_PER_FRAME = 1;
/**
 * The share of bot-frames that may be over any one of the three eased bounds
 * above: **0.2 %**, where a bot steps out of the rider's or another bot's way.
 * Before #2665, 2.3 to 3.6 % of all bot-frames were over the first and 1.1 to
 * 1.9 % over the third: a move across ran at 4.375 m/s from its first tick,
 * drawn as a jump on one frame in three.
 */
const MOST_UNEASED_SHARE = 0.002;
/** The most a bot moves across in any frame, metres a second: the step, 4.375, and a hair. Before #2665: 13.1. */
const MOST_SIDEWAYS_METRES_PER_SECOND = 4.4;
/** The most its sideways speed changes over a tick's frames, metres a second squared. Before #2665: 175. */
const MOST_SIDEWAYS_METRES_PER_SECOND_SQUARED = 120;
/** The most its heading turns in a frame, degrees: under the 12° a bicycle is turned at most. Before #2665: 23. */
const MOST_YAW_DEGREES_PER_FRAME = 12;

/** How near a marker stands to where its bot is drawn to be that bot's, metres. */
const MATCHED_WITHIN_METRES = 0.25;

/** What one race read. */
interface Read {
  readonly botMinutes: number;
  readonly laneChanges: number;
  readonly reversals: number;
  readonly weaves: number;
  /** Bot-frames read for speed, and how many were over the eased bound. */
  readonly speedFrames: number;
  readonly fastFrames: number;
  readonly peakSpeed: number;
  /** Bot-frames read for acceleration, and how many were over the eased bound. */
  readonly accelerationFrames: number;
  readonly hardFrames: number;
  readonly peakAcceleration: number;
  /** Bot-frames read for heading, and how many turned over the eased bound. */
  readonly yawFrames: number;
  readonly turnedFrames: number;
  readonly peakYawDegrees: number;
}

/**
 * Where on the corridor `along` is, and `lateral` across the road along its
 * normal `(−headingZ, headingX)`, as `scene.ts` §`markerAt` puts a marker.
 */
function placeAt(corridor: RoadCorridor, along: number, lateral: number): { x: number; z: number } {
  const points = corridor.centre;
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index] as CorridorPoint;
    if (to.along < along) continue;
    const from = points[index - 1] as CorridorPoint;
    const t = to.along > from.along ? (along - from.along) / (to.along - from.along) : 0;
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const headingX = length > 0 ? (to.x - from.x) / length : 0;
    const headingZ = length > 0 ? (to.z - from.z) / length : 1;
    return {
      x: from.x + (to.x - from.x) * t - headingZ * lateral,
      z: from.z + (to.z - from.z) * t + headingX * lateral,
    };
  }
  throw new Error('a place in view is on the corridor');
}

/** One bot's drawn place across the road, frame by frame, and its reversals so far. */
interface Track {
  readonly lateral: number[];
  /** The way it last moved, ±1, or 0 before it has moved {@link REVERSAL_METRES}. */
  way: number;
  /** The furthest it went that way. */
  extreme: number;
  reversedAt: number | undefined;
  /** Whether the last reversal was already counted in a weave. */
  weaving: boolean;
  /** Its heading on the frame before, radians, when its marker was found. */
  yaw: number | undefined;
}

/** Ride one race at 60 frames a second and read it. */
function ride(seed: number, itemsOn: boolean): Read {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = seed;
      return array;
    },
  );
  let race = startLapRaceRide({
    choice: { laps: 3, bots: LAP_RACE_MOST_BOTS, tier: 'brisk', itemsOn },
    profile: LOOP,
    conditions: lapRaceBotConditions(
      LOOP,
      rideConditionsFor(kilograms(75), DEFAULT_RIDING_POSITION),
    ),
    riderDistance: 50,
    lineOffset: 0,
    storage: undefined,
    draft: true,
    riderMassKilograms: 75,
  });
  vi.restoreAllMocks();
  if (race === undefined) throw new Error('a circuit starts a race');
  const start = atStartLine(LOOP);
  const read = {
    laneChanges: 0,
    reversals: 0,
    weaves: 0,
    speedFrames: 0,
    fastFrames: 0,
    peakSpeed: 0,
    accelerationFrames: 0,
    hardFrames: 0,
    peakAcceleration: 0,
    yawFrames: 0,
    turnedFrames: 0,
    peakYaw: 0,
  };
  let along = race.startAlong;
  let pending = 0;
  let lanes = race.race.racers.map((entry) => entry.lane);
  const tracks = race.bots.map((): Track => ({
    lateral: [],
    way: 0,
    extreme: Number.NaN,
    reversedAt: undefined,
    weaving: false,
    yaw: undefined,
  }));
  let corridor: RoadCorridor | undefined;
  const frames = Math.round(RIDDEN_SECONDS / FRAME_SECONDS);
  for (let frame = 1; frame <= frames; frame += 1) {
    const second = frame * FRAME_SECONDS;
    pending += FRAME_SECONDS;
    let ticks = 0;
    while (pending >= LAP_RACE_TICK_SECONDS - 1e-12) {
      pending -= LAP_RACE_TICK_SECONDS;
      ticks += 1;
    }
    along += ticks * LAP_RACE_TICK_SECONDS * RIDER_SPEED;
    race = stepLapRaceRide(race, { ticks, along, riderWatts: RIDER_WATTS });
    const racers = race.race.racers;
    const now = racers.map((entry) => entry.lane);
    now.forEach((lane, at) => {
      if (racers[at]?.racer.id !== LAP_RACE_RIDER_ID && lane !== lanes[at]) read.laneChanges += 1;
    });
    lanes = now;

    // As `GameView` hands it over: a part-tick behind the newest.
    const behind = LAP_RACE_TICK_SECONDS - pending;
    const drawnAlong = along - RIDER_SPEED * behind;
    const drawing = lapRaceDrawing(race, drawnAlong, behind, false);
    if (corridor === undefined || frame % CORRIDOR_EVERY === 0) {
      corridor = roadCorridor(LOOP, ORIGIN, drawing.riderDistance);
    }
    const road = corridor;
    const input: SceneInput = {
      profile: LOOP,
      origin: ORIGIN,
      state: { ...start, ride: { ...start.ride, distance: metres(drawnAlong) } },
      riderDistance: drawing.riderDistance,
      steeredLateral: drawing.steeredLateral,
      raceBots: drawing.raceBots,
    };
    const markers = placedRiders(input, road)
      .map((placed) => placed.marker)
      .filter((marker) => marker.racer === true);
    const first = (road.centre[0] as CorridorPoint).along;
    const last = (road.centre.at(-1) as CorridorPoint).along;

    drawing.raceBots.forEach((bot, at) => {
      const track = tracks[at] as Track;
      const lateral = bot.lateralMetres;
      track.lateral.push(lateral);
      const seen = track.lateral.length;
      if (seen >= 2) {
        const speed = Math.abs(lateral - (track.lateral[seen - 2] as number)) / FRAME_SECONDS;
        read.speedFrames += 1;
        if (speed > EASED_SIDEWAYS_METRES_PER_SECOND) read.fastFrames += 1;
        read.peakSpeed = Math.max(read.peakSpeed, speed);
      }
      if (seen > 2 * SPAN) {
        const tick = SPAN * FRAME_SECONDS;
        const mid = track.lateral[seen - 1 - SPAN] as number;
        const was = track.lateral[seen - 1 - 2 * SPAN] as number;
        const acceleration = Math.abs((lateral - mid) / tick - (mid - was) / tick) / tick;
        read.accelerationFrames += 1;
        if (acceleration > EASED_SIDEWAYS_METRES_PER_SECOND_SQUARED) read.hardFrames += 1;
        read.peakAcceleration = Math.max(read.peakAcceleration, acceleration);
      }
      // Reversals, with REVERSAL_METRES of hysteresis.
      if (Number.isNaN(track.extreme)) track.extreme = lateral;
      const moved = lateral - track.extreme;
      if (track.way === 0) {
        if (Math.abs(moved) >= REVERSAL_METRES) {
          track.way = Math.sign(moved);
          track.extreme = lateral;
        }
      } else if (Math.sign(moved) === track.way) {
        track.extreme = lateral;
      } else if (Math.abs(moved) >= REVERSAL_METRES) {
        read.reversals += 1;
        const quick = track.reversedAt !== undefined && second - track.reversedAt <= WEAVE_SECONDS;
        if (quick && !track.weaving) read.weaves += 1;
        track.weaving = quick;
        track.reversedAt = second;
        track.way = -track.way;
        track.extreme = lateral;
      }
      // Its heading, off its marker on the road the frame draws.
      const wanted =
        bot.distanceMetres < first || bot.distanceMetres > last
          ? undefined
          : placeAt(road, bot.distanceMetres, lateral);
      const marker =
        wanted === undefined
          ? undefined
          : markers.find(
              (each) => Math.hypot(each.x - wanted.x, each.z - wanted.z) < MATCHED_WITHIN_METRES,
            );
      if (marker === undefined) {
        track.yaw = undefined;
        return;
      }
      const yaw = Math.atan2(marker.headingX, marker.headingZ);
      if (track.yaw !== undefined) {
        const step = Math.abs(Math.atan2(Math.sin(yaw - track.yaw), Math.cos(yaw - track.yaw)));
        read.yawFrames += 1;
        if ((step * 180) / Math.PI > EASED_YAW_DEGREES_PER_FRAME) read.turnedFrames += 1;
        read.peakYaw = Math.max(read.peakYaw, step);
      }
      track.yaw = yaw;
    });
  }
  return {
    ...read,
    botMinutes: (tracks.length * RIDDEN_SECONDS) / 60,
    peakYawDegrees: (read.peakYaw * 180) / Math.PI,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(RACES)(
  'a lap race’s bots ride a line, not a weave — #2665 (seed $seed, items on: $itemsOn)',
  ({ seed, itemsOn }) => {
    let read: Read | undefined;
    /** The race, ridden the first time a case asks. */
    const race = (): Read => {
      read ??= ride(seed, itemsOn);
      return read;
    };

    it('changes lane no more than a few times a bot-minute', () => {
      // Not vacuous: the race was ridden, its bots read on every frame, and
      // they did move across.
      expect(race().botMinutes).toBeGreaterThan(8);
      expect(race().speedFrames).toBeGreaterThan(30_000);
      expect(race().yawFrames).toBeGreaterThan(10_000);
      expect(race().peakSpeed).toBeGreaterThan(1);
      expect(race().laneChanges / race().botMinutes).toBeLessThanOrEqual(
        MOST_LANE_CHANGES_PER_BOT_MINUTE,
      );
    });

    it('reverses across the road seldom, and weaves hardly ever', () => {
      expect(race().reversals / race().botMinutes).toBeLessThanOrEqual(
        MOST_REVERSALS_PER_BOT_MINUTE,
      );
      expect(race().weaves / race().botMinutes).toBeLessThanOrEqual(MOST_WEAVES_PER_BOT_MINUTE);
    });

    it('moves across at a rider’s pace, eased in and out, on all but a sliver of frames, and never jumps', () => {
      const { speedFrames, fastFrames, accelerationFrames, hardFrames } = race();
      expect(fastFrames / speedFrames).toBeLessThanOrEqual(MOST_UNEASED_SHARE);
      expect(hardFrames / accelerationFrames).toBeLessThanOrEqual(MOST_UNEASED_SHARE);
      expect(race().peakSpeed).toBeLessThanOrEqual(MOST_SIDEWAYS_METRES_PER_SECOND);
      expect(race().peakAcceleration).toBeLessThanOrEqual(MOST_SIDEWAYS_METRES_PER_SECOND_SQUARED);
    });

    it('turns its heading smoothly: under a degree a frame on all but a sliver of frames', () => {
      const { yawFrames, turnedFrames, peakYawDegrees } = race();
      expect(turnedFrames / yawFrames).toBeLessThanOrEqual(MOST_UNEASED_SHARE);
      expect(peakYawDegrees).toBeLessThanOrEqual(MOST_YAW_DEGREES_PER_FRAME);
    });
  },
);
