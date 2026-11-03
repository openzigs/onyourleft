// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The riders on their line, leaning — #499, from `scene.ts`'s side: where the
 * rider, the bot and the ghost are drawn, what the camera follows, and that
 * none of it moves anything measured along the road.
 *
 * `racing-line.test.ts` holds the line and the lean to their arithmetic; this
 * file holds the FRAME to them, because a line computed correctly and handed
 * to nothing is #278's defect shape, and a marker is what the renderer draws.
 */

import { describe, expect, it } from 'vitest';

import {
  buildGhostTrack,
  ghostDistanceAt,
  gradePercent,
  kilograms,
  metres,
  metresPerSecond,
  seconds,
  watts,
  type RouteProfile,
} from '@onyourleft/domain';
import type { SimulationParameters } from '@onyourleft/sensors/protocol';

import {
  BICYCLE_FRONT_METRES,
  BICYCLE_LENGTH_METRES,
  CRANK_PARKING_LEAN_RADIANS,
  RIDER_HALF_WIDTH_METRES,
  combinedLean,
  lowestPedalHeight,
  pedallingShare,
} from './bicycle';
import { easedPlace } from './bend-easing';
import { CAMERA_BEHIND_METRES, cameraRig } from './camera';
import { createGradientSession } from './gradient';
import type { RiderMarker, SceneFrame } from './port';
import {
  LINE_LIMIT_METRES,
  leanAt,
  lineOffsetAt,
  lineSlopeAt,
  racingLine,
  type RacingLine,
} from './racing-line';
import {
  circuitRoute,
  cornerRoute,
  hairpinRoute,
  northRoute,
  sBendRoute,
} from './route-fixtures-testing';
import {
  FACING_TURN_LIMIT_RADIANS,
  drawnRiderDistance,
  facingTurn,
  placedRiders,
  sceneFrame,
} from './scene';
import { GameSimulation, atStartLine, type GameState } from './simulation';
import { ROAD_WIDTH_METRES, corridorOrigin, roadCorridor } from './terrain';

const RADIUS = 20;
const hairpin = hairpinRoute(RADIUS);
const APEX = 400 + (Math.PI * RADIUS) / 2;

/** A state `distance` along the route, at `speed`, with a bot beside it if asked. */
function stateAt(
  profile: RouteProfile,
  distance: number,
  speed: number,
  bot?: { readonly distance: number; readonly speed: number },
  ridden = 0,
): GameState {
  const start = atStartLine(profile);
  return {
    ...start,
    ride: { speed: metresPerSecond(speed), distance: metres(distance) },
    ridden: seconds(ridden),
    ...(bot === undefined
      ? {}
      : {
          bot: {
            state: { speed: metresPerSecond(bot.speed), distance: metres(bot.distance) },
            distanceOnRoute: metres(bot.distance),
            grade: gradePercent(0),
            power: watts(200),
          },
        }),
  };
}

function frameOf(
  profile: RouteProfile,
  state: GameState,
  extra: Partial<Parameters<typeof sceneFrame>[0]> = {},
): SceneFrame {
  return sceneFrame({ profile, origin: corridorOrigin(profile), state, ...extra });
}

function markerOf(frame: SceneFrame, kind: RiderMarker['kind']): RiderMarker {
  const found = frame.markers.find((marker) => marker.kind === kind);
  if (found === undefined) throw new Error(`no ${kind} in the frame`);
  return found;
}

/**
 * Where a distance falls on the centreline, found by this test from the
 * corridor's own points rather than through `scene.ts`.
 */
function centreAt(frame: SceneFrame, distance: number): { x: number; z: number } {
  const centre = frame.corridor.centre;
  for (let index = 0; index < centre.length - 1; index += 1) {
    const from = centre[index];
    const to = centre[index + 1];
    if (from === undefined || to === undefined) continue;
    if (to.along >= distance) {
      const t = (distance - from.along) / (to.along - from.along);
      return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
    }
  }
  throw new Error('outside the corridor');
}

/**
 * Which way the ROAD runs at a distance, as a unit vector: the corridor
 * segment that starts at or before it, which is the one `scene.ts` places a
 * marker on. ⚠️ Not a marker's own heading, which since #1995 is the LINE's
 * and is turned off the road wherever the line crosses it.
 */
function roadHeadingAt(
  frame: SceneFrame,
  distance: number,
): { headingX: number; headingZ: number } {
  const centre = frame.corridor.centre;
  let index = 0;
  for (let candidate = 0; candidate < centre.length - 1; candidate += 1) {
    if ((centre[candidate] as (typeof centre)[number]).along > distance) break;
    index = candidate;
  }
  const from = centre[index] as (typeof centre)[number];
  const to = centre[index + 1] as (typeof centre)[number];
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  return { headingX: (to.x - from.x) / length, headingZ: (to.z - from.z) / length };
}

/** How far a marker is across the road from the centreline, positive on the normal's side. */
function across(frame: SceneFrame, marker: RiderMarker, distance: number): number {
  const centre = centreAt(frame, distance);
  const road = roadHeadingAt(frame, distance);
  return (marker.x - centre.x) * -road.headingZ + (marker.z - centre.z) * road.headingX;
}

describe('the rider rides the line — #499', () => {
  it('is drawn off-centre at the apex, exactly as far as the line is', () => {
    const frame = frameOf(hairpin, stateAt(hairpin, APEX, 8));
    const rider = markerOf(frame, 'rider');
    const expected = lineOffsetAt(racingLine(hairpin), APEX);
    // The hairpin turns right, and the apex is on its inside: the normal's
    // side since #583, the other one before it.
    expect(expected).toBeGreaterThan(2);
    expect(across(frame, rider, APEX)).toBeCloseTo(expected, 6);
  });

  it('leans into the bend at its own speed', () => {
    const frame = frameOf(hairpin, stateAt(hairpin, APEX, 8));
    const rider = markerOf(frame, 'rider');
    // #546: the physics fixes the COMBINED lean; the bicycle leans more and
    // the body less, and the two together are exactly `leanAt`.
    expect(combinedLean(rider.lean, rider.bodyLean)).toBeCloseTo(
      leanAt(racingLine(hairpin), APEX, 8),
      12,
    );
    // Into a right-hand bend: toward the normal, positive, since #583.
    expect(rider.lean).toBeGreaterThan(0.1);
  });

  it('is upright at rest, whatever the bend', () => {
    const frame = frameOf(hairpin, stateAt(hairpin, APEX, 0));
    expect(markerOf(frame, 'rider').lean).toBe(0);
  });

  it('is on the centreline and upright with the line switched off — the browser gate’s control', () => {
    const frame = frameOf(hairpin, stateAt(hairpin, APEX, 8), { centreline: true });
    const rider = markerOf(frame, 'rider');
    expect(Math.abs(across(frame, rider, APEX))).toBeLessThan(1e-9);
    expect(rider.lean).toBe(0);
  });

  it('keeps its place ALONG the road: only the sideways offset is the line’s', () => {
    // The marker, moved back across the road by its own offset, is the
    // centreline point at the rider's odometer.
    const frame = frameOf(hairpin, stateAt(hairpin, APEX, 8));
    const rider = markerOf(frame, 'rider');
    const sideways = across(frame, rider, APEX);
    const centre = centreAt(frame, APEX);
    const road = roadHeadingAt(frame, APEX);
    expect(rider.x + road.headingZ * sideways).toBeCloseTo(centre.x, 6);
    expect(rider.z - road.headingX * sideways).toBeCloseTo(centre.z, 6);
  });
});

describe('the bot and the ghost ride it too, at their own speeds — #499', () => {
  it('puts the bot on the line at its own distance, leaning at its own speed', () => {
    const botAt = APEX + 40;
    const frame = frameOf(hairpin, stateAt(hairpin, APEX - 40, 6, { distance: botAt, speed: 11 }), {
      botDistance: botAt,
    });
    const bot = markerOf(frame, 'bot');
    const line = racingLine(hairpin);
    // #1998: at the place and speed its OWN odometer and speed are eased to,
    // by the one rule the rider is — eased back here, coming out of the bend.
    const place = easedPlace(line, botAt, 11);
    expect(place.distance).toBeLessThan(botAt - 1);
    expect(across(frame, bot, place.distance)).toBeCloseTo(lineOffsetAt(line, place.distance), 6);
    expect(combinedLean(bot.lean, bot.bodyLean)).toBeCloseTo(
      leanAt(line, place.distance, place.speed),
      12,
    );
    // …and not at the rider's speed, which would be a different lean here.
    expect(combinedLean(bot.lean, bot.bodyLean)).not.toBeCloseTo(
      leanAt(line, place.distance, 6),
      3,
    );
  });

  it('leans the ghost at the speed its replay was ridden at', () => {
    // An attempt ridden at a steady 10 m/s.
    const ghost = buildGhostTrack({ elapsedSeconds: [0, 200], distanceMetres: [0, 2_000] });
    const clock = (APEX + 20) / 10;
    const ghostAt = clock * 10;
    const frame = frameOf(hairpin, stateAt(hairpin, APEX - 100, 5, undefined, clock), { ghost });
    const drawn = markerOf(frame, 'ghost');
    const line = racingLine(hairpin);
    // #1998: eased from its own odometer and replayed speed, as the rider is.
    const place = easedPlace(line, ghostAt, 10);
    expect(across(frame, drawn, place.distance)).toBeCloseTo(lineOffsetAt(line, place.distance), 6);
    expect(combinedLean(drawn.lean, drawn.bodyLean)).toBeCloseTo(
      leanAt(line, place.distance, place.speed),
      9,
    );
  });

  it('leaves a ghost that has finished upright, because it has stopped', () => {
    const ghost = buildGhostTrack({ elapsedSeconds: [0, 50], distanceMetres: [0, APEX] });
    const frame = frameOf(hairpin, stateAt(hairpin, APEX - 20, 8, undefined, 500), { ghost });
    expect(markerOf(frame, 'ghost').lean).toBe(0);
  });
});

describe('two riders level on the road are not drawn inside each other — #499', () => {
  /**
   * Whether two markers overlap: closer along the road than a bicycle's
   * length AND closer across it than two half-handlebars and a little air.
   */
  function overlapping(a: RiderMarker, b: RiderMarker): boolean {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const along = Math.abs(dx * a.headingX + dz * a.headingZ);
    const sideways = Math.abs(dx * -a.headingZ + dz * a.headingX);
    return along < BICYCLE_LENGTH_METRES && sideways < 2 * RIDER_HALF_WIDTH_METRES + 0.2;
  }

  it.each([
    ['on a straight', northRoute(2_000, () => 0), 1_000],
    ['at the hairpin’s apex, where the line is at the edge', hairpin, APEX],
    ['on the way in, where the line is wide', hairpin, 390],
  ] as const)('keeps the rider, the bot and the ghost apart %s', (_, route, at) => {
    const ghost = buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, 10_000] });
    for (let gap = -6; gap <= 6; gap += 0.1) {
      // The bot `gap` ahead, and the ghost level with the rider throughout.
      const frame = frameOf(
        route,
        stateAt(route, at, 8, { distance: at + gap, speed: 8 }, at / 10),
        {
          botDistance: at + gap,
          ghost,
        },
      );
      const [rider, bot, ghostMarker] = [
        markerOf(frame, 'rider'),
        markerOf(frame, 'bot'),
        markerOf(frame, 'ghost'),
      ];
      expect(overlapping(rider, bot)).toBe(false);
      expect(overlapping(rider, ghostMarker)).toBe(false);
      expect(overlapping(bot, ghostMarker)).toBe(false);
      // And every one of them is still on the road, a handlebar inside its edge.
      for (const [marker, distance] of [
        [rider, at],
        [bot, at + gap],
        [ghostMarker, at],
      ] as const) {
        expect(Math.abs(across(frame, marker, distance))).toBeLessThanOrEqual(
          ROAD_WIDTH_METRES / 2 - RIDER_HALF_WIDTH_METRES + 1e-9,
        );
      }
    }
  });

  // ⚠️ **8 s, a ceiling rather than a budget — #682.** Vitest's default 5 s was nobody's choice for
  // this case: under coverage on CI it took 0.9 s to 2.5 s over thirteen green `main` runs on
  // 2026-09-28 (36370135206 to 36405580515), the slowest on 36405580515 (the slower of the two
  // runners, a job over 1 000 s) — 49 % of that default. 8 s is about three times the slowest, so a
  // slow-down is red. It is not a hang guard: this case is synchronous and Vitest cannot interrupt
  // one, so a genuine hang is caught only by the job’s own stop (docs/agents/ci.md §4c).
  it('eases a rider aside rather than jumping it as another passes', () => {
    // The bot's sideways place, as it closes from 6 m behind to 6 m ahead in
    // 5 cm steps: no step is more than 10 cm.
    const route = northRoute(2_000, () => 0);
    let previous: number | undefined;
    for (let gap = -6; gap <= 6; gap += 0.05) {
      const frame = frameOf(route, stateAt(route, 1_000, 8, { distance: 1_000 + gap, speed: 8 }), {
        botDistance: 1_000 + gap,
      });
      const sideways = across(frame, markerOf(frame, 'bot'), 1_000 + gap);
      if (previous !== undefined) {
        expect(Math.abs(sideways - previous)).toBeLessThan(0.1);
      }
      previous = sideways;
    }
  }, 8_000);

  it('leaves a lone rider on the line', () => {
    const frame = frameOf(hairpin, stateAt(hairpin, APEX, 8, { distance: APEX + 30, speed: 8 }), {
      botDistance: APEX + 30,
    });
    expect(across(frame, markerOf(frame, 'rider'), APEX)).toBeCloseTo(
      lineOffsetAt(racingLine(hairpin), APEX),
      9,
    );
  });
});

describe('a rider a Delivery round steered, and the riders level with them — #1853', () => {
  /** #499's separation: a handlebar clear, between two riders level on the road. */
  const SIDE_BY_SIDE = 1.2;
  /** How far from the centre a rider is ever drawn: half a handlebar and 0.1 m inside the edge. */
  const DRAWN_LIMIT = ROAD_WIDTH_METRES / 2 - RIDER_HALF_WIDTH_METRES - 0.1;
  /** How level two riders `gap` apart are: `scene.ts`' fade, restated. */
  const levelAt = (gap: number): number =>
    Math.min(1, Math.max(0, (BICYCLE_LENGTH_METRES + 2 - Math.abs(gap)) / 2));
  const ghost = buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, 10_000] });

  /** The rider steered to `steered`, the bot `gap` ahead and the ghost level with the rider, placed. */
  function placed(
    route: RouteProfile,
    at: number,
    gap: number,
    steered: number | undefined,
  ): { rider: number; bot: number; ghost: number } {
    const input = {
      profile: route,
      origin: corridorOrigin(route),
      state: stateAt(route, at, 8, { distance: at + gap, speed: 8 }, at / 10),
      botDistance: at + gap,
      ghost,
      steeredLateral: steered,
    };
    const riders = placedRiders(input, roadCorridor(route, corridorOrigin(route), at));
    const of = (kind: RiderMarker['kind']): number => {
      const found = riders.find((each) => each.marker.kind === kind);
      if (found === undefined) throw new Error(`no ${kind} placed`);
      return found.lateral;
    };
    return { rider: of('rider'), bot: of('bot'), ghost: of('ghost') };
  }

  it.each([
    ['on a straight', northRoute(2_000, () => 0), 1_000],
    ['at the hairpin’s apex, where the line is at the edge', hairpin, APEX],
    ['on the way in, where the line is wide', hairpin, 390],
  ] as const)(
    'draws the rider where it steered and the bot and the ghost a handlebar clear of it %s',
    (_, route, at) => {
      let squeezed = 0;
      for (let steered = -1.75; steered <= 1.75 + 1e-9; steered += 0.25) {
        for (let gap = -6; gap <= 6 + 1e-9; gap += 0.5) {
          const drawn = placed(route, at, gap, steered);
          // Exactly where it steered: the offset `ride-round.ts` hands the obstacles.
          expect(drawn.rider).toBe(steered);
          // The ghost, level, and the bot whenever it is within a bicycle's
          // length (beyond, they are a length apart along the road: #499's
          // rule), kept a handlebar clear across it.
          const botLevel = levelAt(gap) === 1;
          expect(Math.abs(drawn.ghost - drawn.rider)).toBeGreaterThanOrEqual(SIDE_BY_SIDE - 1e-9);
          if (botLevel) {
            expect(Math.abs(drawn.bot - drawn.rider)).toBeGreaterThanOrEqual(SIDE_BY_SIDE - 1e-9);
            expect(Math.abs(drawn.ghost - drawn.bot)).toBeGreaterThanOrEqual(SIDE_BY_SIDE - 1e-9);
          }
          for (const each of [drawn.rider, drawn.bot, drawn.ghost]) {
            expect(Math.abs(each)).toBeLessThanOrEqual(DRAWN_LIMIT + 1e-9);
          }
          // Non-vacuity: count the places the line alone would have put one of them inside the rider.
          const unsteered = placed(route, at, gap, undefined);
          if (
            (botLevel && Math.abs(unsteered.bot - steered) < SIDE_BY_SIDE - 1e-6) ||
            Math.abs(unsteered.ghost - steered) < SIDE_BY_SIDE - 1e-6
          ) {
            squeezed += 1;
          }
          // A bot a fade or more AHEAD of everybody is drawn where it was without
          // steering. Behind, it is held aside until it is behind the camera (#1863).
          if (gap > 0 && levelAt(gap) === 0) expect(drawn.bot).toBe(unsteered.bot);
        }
      }
      expect(squeezed).toBeGreaterThan(10);
    },
  );

  it('moves a level bot and ghost aside smoothly as the rider steers across them, never jumping', () => {
    const route = northRoute(2_000, () => 0);
    const step = 0.05;
    // The bot level, and the bot part-way through the fade.
    for (const gap of [0, BICYCLE_LENGTH_METRES + 1]) {
      let previous: { rider: number; bot: number; ghost: number } | undefined;
      for (let steered = -1.75; steered <= 1.75 + 1e-9; steered += step) {
        const drawn = placed(route, 1_000, gap, steered);
        if (previous !== undefined) {
          expect(Math.abs(drawn.bot - previous.bot)).toBeLessThanOrEqual(step + 1e-9);
          expect(Math.abs(drawn.ghost - previous.ghost)).toBeLessThanOrEqual(step + 1e-9);
        }
        previous = drawn;
      }
    }
  });

  it('eases the bot aside as it closes on a steered rider, rather than jumping it', () => {
    // #499's own sweep, with the rider steered to the centre line, so the bot,
    // alone on the line in the right-hand lane, has to come across to the
    // rider's left: 2.95 m over the 2 m fade, so steeper than #499's 10 cm a
    // step. At its steepest, where it starts to come level, that is
    // `0.5 · (1.75·0.31 + 1.2 + 2.95)` ≈ 2.35 m a metre of gap, 11.7 cm a step.
    const route = northRoute(2_000, () => 0);
    let previous: number | undefined;
    let steepest = 0;
    for (let gap = -6; gap <= 6; gap += 0.05) {
      const { bot } = placed(route, 1_000, gap, 0);
      if (previous !== undefined) steepest = Math.max(steepest, Math.abs(bot - previous));
      previous = bot;
    }
    expect(steepest).toBeLessThan(0.12);
    // Non-vacuity: it did come across.
    expect(steepest).toBeGreaterThan(0.05);
  });
});

describe('a pacer or ghost just behind a steered rider, in front of the camera — #1863', () => {
  /** #499's separation: a handlebar clear, between two riders level on the road. */
  const SIDE_BY_SIDE = 1.2;
  /** How far from the centre a rider is ever drawn: half a handlebar and 0.1 m inside the edge. */
  const DRAWN_LIMIT = ROAD_WIDTH_METRES / 2 - RIDER_HALF_WIDTH_METRES - 0.1;
  /**
   * How far behind the rider a bicycle's front wheel is level with the camera's
   * eye: nearer than this, some of it is in front of the camera.
   */
  const IN_FRONT_OF_THE_EYE = CAMERA_BEHIND_METRES + BICYCLE_FRONT_METRES;
  /** `scene.ts`' fade, over which a held rider eases back to its line. */
  const FADE = 2;
  const track = buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, 10_000] });
  type Who = 'bot' | 'ghost' | 'both';

  /** The input for the rider steered to `steered`, with the bot, the ghost or both `gap` behind (negative) or ahead. */
  function inputFor(
    route: RouteProfile,
    at: number,
    gap: number,
    steered: number | undefined,
    who: Who,
  ): Parameters<typeof sceneFrame>[0] {
    const bot = who !== 'ghost';
    const ghost = who !== 'bot';
    return {
      profile: route,
      origin: corridorOrigin(route),
      // The ghost rides 10 m a second, so a clock of `(at + gap) / 10` puts it at `at + gap`.
      state: stateAt(
        route,
        at,
        8,
        bot ? { distance: at + gap, speed: 8 } : undefined,
        ghost ? (at + gap) / 10 : at / 10,
      ),
      botDistance: bot ? at + gap : undefined,
      ghost: ghost ? track : undefined,
      steeredLateral: steered,
      // #1998: a round is never eased, so the ordinary ride it is compared
      // with is drawn uneased too: what differs is #1863's hold alone.
      uneased: true,
    };
  }

  function placed(
    route: RouteProfile,
    at: number,
    gap: number,
    steered: number | undefined,
    who: Who,
  ): { rider: number; bot: number | undefined; ghost: number | undefined } {
    const riders = placedRiders(
      inputFor(route, at, gap, steered, who),
      roadCorridor(route, corridorOrigin(route), at),
    );
    const of = (kind: RiderMarker['kind']): number | undefined =>
      riders.find((each) => each.marker.kind === kind)?.lateral;
    const rider = of('rider');
    if (rider === undefined) throw new Error('no rider placed');
    return { rider, bot: of('bot'), ghost: of('ghost') };
  }

  const routes = [
    ['on a straight', northRoute(2_000, () => 0), 1_000],
    ['at the hairpin’s apex, where the line is at the edge', hairpin, APEX],
    ['on the way in, where the line is wide', hairpin, 390],
  ] as const;

  it.each(routes)(
    'keeps them a handlebar clear of the camera’s line, on their own side, until their front wheel is behind the eye, %s',
    (_, route, at) => {
      const line = racingLine(route);
      let wouldHaveCrossed = 0;
      for (const who of ['bot', 'ghost', 'both'] as const) {
        for (let steered = -1.75; steered <= 1.75 + 1e-9; steered += 0.25) {
          for (let gap = 0; gap >= -IN_FRONT_OF_THE_EYE - 1e-9; gap -= 0.1) {
            const drawn = placed(route, at, gap, steered, who);
            // The rider, and so the camera (#499 §"the camera follows"), is where it steered.
            expect(drawn.rider).toBe(steered);
            // The bot on the negative side of the camera's line, the ghost on the positive.
            if (drawn.bot !== undefined) {
              expect(drawn.bot).toBeLessThanOrEqual(steered - SIDE_BY_SIDE + 1e-9);
            }
            if (drawn.ghost !== undefined) {
              expect(drawn.ghost).toBeGreaterThanOrEqual(steered + SIDE_BY_SIDE - 1e-9);
            }
            for (const each of [drawn.bot, drawn.ghost]) {
              if (each !== undefined)
                expect(Math.abs(each)).toBeLessThanOrEqual(DRAWN_LIMIT + 1e-9);
            }
            // Non-vacuity: where its own line would have put it within a handlebar of the camera's.
            if (Math.abs(lineOffsetAt(line, at + gap) - steered) < SIDE_BY_SIDE - 1e-6) {
              wouldHaveCrossed += 1;
            }
          }
        }
      }
      expect(wouldHaveCrossed).toBeGreaterThan(100);
    },
  );

  it('holds that in the frame the renderer is handed, measured from the camera’s eye, on a straight', () => {
    const route = northRoute(2_000, () => 0);
    let inFront = 0;
    let behindTheEye = 0;
    // 8 x 21 = 168 frames, not the 15 x 41 = 615 it began as (#1883): this sweep builds
    // a whole frame per step, and it sat at the edge of the 5 s timeout under coverage.
    // The 0.5 grid still puts 176 markers in front of the eye and 160 behind it.
    for (let steered = -1.75; steered <= 1.75 + 1e-9; steered += 0.5) {
      for (let gap = 0; gap >= -10; gap -= 0.5) {
        const frame = sceneFrame(inputFor(route, 1_000, gap, steered, 'both'));
        const { eye } = cameraRig(frame.camera);
        const { headingX, headingZ } = frame.camera;
        for (const kind of ['bot', 'ghost'] as const) {
          const marker = markerOf(frame, kind);
          const dx = marker.x - eye.x;
          const dz = marker.z - eye.z;
          const forward = dx * headingX + dz * headingZ;
          const sideways = dx * -headingZ + dz * headingX;
          if (forward + BICYCLE_FRONT_METRES > 0) {
            inFront += 1;
            expect(Math.abs(sideways)).toBeGreaterThanOrEqual(SIDE_BY_SIDE - 1e-6);
          } else {
            behindTheEye += 1;
          }
        }
      }
    }
    // Non-vacuity: the sweep met both halves.
    expect(inFront).toBeGreaterThan(100);
    expect(behindTheEye).toBeGreaterThan(100);
  });

  it.each(routes)(
    'eases them back to their own line behind the camera, and is their ordinary place beyond, %s',
    (_, route, at) => {
      for (const who of ['bot', 'ghost', 'both'] as const) {
        for (const steered of [-1.75, -0.5, 0, 0.5, 1.75]) {
          for (let gap = -IN_FRONT_OF_THE_EYE - FADE; gap >= -12; gap -= 0.25) {
            const drawn = placed(route, at, gap, steered, who);
            const unsteered = placed(route, at, gap, undefined, who);
            expect(drawn.bot).toBe(unsteered.bot);
            expect(drawn.ghost).toBe(unsteered.ghost);
          }
        }
      }
    },
  );

  it('moves them across without a jump as they drop back', () => {
    // The steepest is the bot behind a rider steered to the left-hand lane:
    // 2.95 m from its place aside back to the line over the 2 m fade, 7.4 cm a step.
    const route = northRoute(2_000, () => 0);
    let steepest = 0;
    for (const steered of [-1.75, 0, 1.75]) {
      let previous: { bot: number | undefined; ghost: number | undefined } | undefined;
      for (let gap = 0; gap >= -12; gap -= 0.05) {
        const drawn = placed(route, 1_000, gap, steered, 'both');
        if (previous !== undefined) {
          for (const kind of ['bot', 'ghost'] as const) {
            const was = previous[kind];
            const now = drawn[kind];
            if (was !== undefined && now !== undefined) {
              steepest = Math.max(steepest, Math.abs(now - was));
            }
          }
        }
        previous = drawn;
      }
    }
    expect(steepest).toBeLessThan(0.12);
    // Non-vacuity: somebody did come back across.
    expect(steepest).toBeGreaterThan(0.05);
  });

  it.each(routes)(
    'draws an ordinary ride, with no round, exactly as #499 did, %s',
    (_, route, at) => {
      // #499's rule, restated: `line·(1 − g·w) + lane·1.2·w`, `w` the levelness
      // with the nearest other rider.
      const line = racingLine(route);
      const given = 1 - (DRAWN_LIMIT - SIDE_BY_SIDE) / LINE_LIMIT_METRES;
      const levelAt = (gap: number): number =>
        Math.min(1, Math.max(0, (BICYCLE_LENGTH_METRES + FADE - Math.abs(gap)) / FADE));
      const expected = (distance: number, lane: number, others: readonly number[]): number => {
        const level = Math.max(0, ...others.map((other) => levelAt(other - distance)));
        return lineOffsetAt(line, distance) * (1 - given * level) + lane * SIDE_BY_SIDE * level;
      };
      let held = 0;
      for (const who of ['bot', 'ghost', 'both'] as const) {
        for (let gap = -10; gap <= 10 + 1e-9; gap += 0.25) {
          const drawn = placed(route, at, gap, undefined, who);
          const ghostAt =
            who === 'bot' ? undefined : ghostDistanceAt(track, seconds((at + gap) / 10));
          const botAt = who === 'ghost' ? undefined : at + gap;
          const riders: { kind: 'rider' | 'bot' | 'ghost'; distance: number; lane: number }[] = [
            { kind: 'rider', distance: at, lane: 0 },
          ];
          if (botAt !== undefined) riders.push({ kind: 'bot', distance: botAt, lane: -1 });
          if (ghostAt !== undefined) riders.push({ kind: 'ghost', distance: ghostAt, lane: 1 });
          for (const each of riders) {
            const others = riders.filter((other) => other !== each).map((other) => other.distance);
            expect(drawn[each.kind]).toBeCloseTo(expected(each.distance, each.lane, others), 12);
          }
          // Non-vacuity: the places #1863 holds a steered round's riders aside.
          if (gap < 0 && gap > -IN_FRONT_OF_THE_EYE && levelAt(gap) < 1) held += 1;
        }
      }
      expect(held).toBeGreaterThan(20);
    },
  );
});

describe('a rider faces the way the line takes them, not the way the road runs — #1995', () => {
  /** The angle between two directions on the ground, in radians, whatever their lengths. */
  function between(
    a: { readonly x: number; readonly z: number },
    b: { readonly x: number; readonly z: number },
  ): number {
    return Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z));
  }

  const facing = (marker: RiderMarker): { x: number; z: number } => ({
    x: marker.headingX,
    z: marker.headingZ,
  });

  /** The signed angle from the road's heading to a direction, positive toward the road's normal. */
  function offRoad(
    road: { readonly headingX: number; readonly headingZ: number },
    v: { readonly x: number; readonly z: number },
  ): number {
    return Math.atan2(
      road.headingX * v.z - road.headingZ * v.x,
      road.headingX * v.x + road.headingZ * v.z,
    );
  }

  /**
   * That a marker faces the way it is drawn moving from its rear wheel's place
   * to its front wheel's, held to the facing limit: turned off the road by
   * `facingTurn` of the angle that moves at off the road.
   */
  function expectFacesItsMotion(
    marker: RiderMarker,
    moved: { readonly x: number; readonly z: number },
    road: { readonly headingX: number; readonly headingZ: number },
  ): void {
    expect(offRoad(road, facing(marker))).toBeCloseTo(facingTurn(offRoad(road, moved)), 2);
  }

  /** Where the line crosses the road fastest between two distances, to the decimetre. */
  function steepest(line: RacingLine, from: number, to: number): number {
    let best = from;
    for (let at = from; at <= to; at += 0.1) {
      if (Math.abs(lineSlopeAt(line, at)) > Math.abs(lineSlopeAt(line, best))) best = at;
    }
    return best;
  }

  /**
   * Half a bicycle: a marker points from its rear wheel to its front wheel, so
   * the way it is drawn moving is read between its places this far behind and
   * ahead, inside one corridor segment.
   */
  const SPAN = BICYCLE_LENGTH_METRES / 2;

  /**
   * Which way the road runs under a bicycle at a distance: the centreline from
   * where its rear wheel is to where its front wheel is, found from the
   * corridor's own points. ⚠️ Not {@link roadHeadingAt}'s segment heading,
   * which in a tight hairpin points up to half a segment's turn, 7° at radius
   * 8, ahead of the road at a corridor point — and the rider is always on one.
   */
  function roadUnderBicycle(
    frame: SceneFrame,
    distance: number,
  ): { headingX: number; headingZ: number } {
    const rear = centreAt(frame, distance - SPAN);
    const front = centreAt(frame, distance + SPAN);
    const length = Math.hypot(front.x - rear.x, front.z - rear.z);
    return { headingX: (front.x - rear.x) / length, headingZ: (front.z - rear.z) / length };
  }

  it('turns the rider to the way it is drawn moving where the line crosses the approach', () => {
    // On the straight before the hairpin the line crosses from the right-hand
    // side to the outside of the bend. A straight, so the corridors built
    // around the rider at each of the three distances lie on one line.
    const line = racingLine(hairpin);
    const at = steepest(line, 300, 370);
    // Not a vacuous crossing: three degrees or more off the road.
    expect(Math.abs(lineSlopeAt(line, at))).toBeGreaterThan(0.05);
    const slope = lineSlopeAt(line, at);
    const frame = frameOf(hairpin, stateAt(hairpin, at, 8));
    const rider = markerOf(frame, 'rider');
    const before = markerOf(frameOf(hairpin, stateAt(hairpin, at - SPAN, 8)), 'rider');
    const after = markerOf(frameOf(hairpin, stateAt(hairpin, at + SPAN, 8)), 'rider');
    const moved = { x: after.x - before.x, z: after.z - before.z };
    const road = roadHeadingAt(frame, at);
    // It faces the way it is drawn moving, held to the limit…
    expectFacesItsMotion(rider, moved, road);
    // …which is the road's heading turned by the line's rate, toward the
    // normal when the line is moving toward it.
    expect(offRoad(road, facing(rider))).toBeCloseTo(facingTurn(Math.atan(slope)), 3);
  });

  it.each(['bot', 'ghost'] as const)(
    'turns the %s the same way, through the bend itself',
    (kind) => {
      // The rider well back on the approach, so the corridor is one and the
      // same in every frame, and the other rider coming out of the hairpin,
      // where the line crosses back from the inside to the right-hand side.
      const riderAt = APEX - 60;
      const line = racingLine(hairpin);
      const at = steepest(line, APEX, 400 + Math.PI * RADIUS + 30);
      expect(Math.abs(lineSlopeAt(line, at))).toBeGreaterThan(0.05);
      // An attempt ridden at a steady 10 m/s, for the ghost.
      const ghost = buildGhostTrack({ elapsedSeconds: [0, 200], distanceMetres: [0, 2_000] });
      const drawnAt = (distance: number): { frame: SceneFrame; marker: RiderMarker } => {
        const frame =
          kind === 'bot'
            ? frameOf(hairpin, stateAt(hairpin, riderAt, 8, { distance, speed: 8 }), {
                botDistance: distance,
              })
            : frameOf(hairpin, stateAt(hairpin, riderAt, 8, undefined, distance / 10), { ghost });
        return { frame, marker: markerOf(frame, kind) };
      };
      const { frame } = drawnAt(at);
      const here = drawnAt(at).marker;
      const before = drawnAt(at - SPAN).marker;
      const after = drawnAt(at + SPAN).marker;
      const moved = { x: after.x - before.x, z: after.z - before.z };
      const road = roadHeadingAt(frame, at);
      expectFacesItsMotion(here, moved, road);
      // And that is not the road's heading: the line is crossing it.
      expect(between(facing(here), { x: road.headingX, z: road.headingZ })).toBeGreaterThan(0.04);
    },
  );

  it('faces a lap-race bot along the road, because its lane stays put where the line crosses', () => {
    // A laned bot is drawn at its lane's place, not on the racing line
    // (#1902), so its place across the road does not move as it rides on and
    // it faces the road, however fast the line crosses there. Far from the
    // rider, so it is not eased aside either.
    const riderAt = APEX - 60;
    const line = racingLine(hairpin);
    const at = steepest(line, APEX, 400 + Math.PI * RADIUS + 30);
    expect(Math.abs(lineSlopeAt(line, at))).toBeGreaterThan(0.05);
    const drawnAt = (distance: number): { frame: SceneFrame; marker: RiderMarker } => {
      const frame = frameOf(hairpin, stateAt(hairpin, riderAt, 8), {
        raceBots: [{ distanceMetres: distance, speedMetresPerSecond: 8, lateralMetres: 1.75 }],
      });
      return { frame, marker: markerOf(frame, 'bot') };
    };
    const { frame, marker } = drawnAt(at);
    const [before, after] = [drawnAt(at - SPAN).marker, drawnAt(at + SPAN).marker];
    const moved = { x: after.x - before.x, z: after.z - before.z };
    expect(between(facing(marker), moved)).toBeLessThan(1e-5);
    const road = roadHeadingAt(frame, at);
    expect(between(facing(marker), { x: road.headingX, z: road.headingZ })).toBeLessThan(1e-5);
  });

  it.each([undefined, -1.75, 0, 1.75])(
    'turns riders level with each other to the way each is drawn moving, the rider steered to %s',
    (steered) => {
      // Three riders riding on together, so how level they are does not
      // change: each one's place is the share of the line it keeps, or a
      // place held clear of a steered rider, and each must face the way that
      // place moves. On the approach's straight, as in the first case.
      const line = racingLine(hairpin);
      const start = steepest(line, 300, 370);
      const ghost = buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, 10_000] });
      let checked = 0;
      for (const gap of [0, 1, 2.5]) {
        const at = start;
        const frameAt = (distance: number): SceneFrame =>
          frameOf(
            hairpin,
            stateAt(hairpin, distance, 8, { distance: distance + gap, speed: 8 }, distance / 10),
            { botDistance: distance + gap, ghost, steeredLateral: steered },
          );
        const [before, here, after] = [frameAt(at - SPAN), frameAt(at), frameAt(at + SPAN)];
        for (const kind of ['rider', 'bot', 'ghost'] as const) {
          const moved = {
            x: markerOf(after, kind).x - markerOf(before, kind).x,
            z: markerOf(after, kind).z - markerOf(before, kind).z,
          };
          expectFacesItsMotion(markerOf(here, kind), moved, roadHeadingAt(here, at));
          checked += 1;
        }
      }
      expect(checked).toBe(9);
    },
  );

  it('never stands side-on where a tight hairpin’s line swings across the road', () => {
    // #1995's review, on the owner's course: coming out of a hairpin the drawn
    // line crossed the road within a few metres, and a rider facing all of
    // that was drawn side-on to a straight road. A tighter hairpin than the
    // file's own, ridden through from approach to exit.
    const tight = hairpinRoute(8);
    const exit = 400 + Math.PI * 8 + 40;
    let steepestMotion = 0;
    for (let at = 360; at <= exit; at += 0.5) {
      const frameAt = (distance: number): SceneFrame => frameOf(tight, stateAt(tight, distance, 9));
      const here = frameAt(at);
      // Since #1998 the rider is drawn eased off for the bend, behind the
      // odometer: the road's heading is read where it is drawn. Since #2017
      // the road under the bicycle, which is what the facing is held to: a
      // corridor segment's heading steps at every point, and a facing held to
      // that stepped with it for every marker not sat on a point.
      const drawn = drawnRiderDistance({
        profile: tight,
        origin: corridorOrigin(tight),
        state: stateAt(tight, at, 9),
      });
      const road = roadUnderBicycle(here, drawn);
      const rider = markerOf(here, 'rider');
      const before = markerOf(frameAt(at - SPAN), 'rider');
      const after = markerOf(frameAt(at + SPAN), 'rider');
      const motion = offRoad(road, { x: after.x - before.x, z: after.z - before.z });
      steepestMotion = Math.max(steepestMotion, Math.abs(motion));
      expect(Math.abs(offRoad(road, facing(rider)))).toBeLessThanOrEqual(
        FACING_TURN_LIMIT_RADIANS + 1e-9,
      );
    }
    // Not vacuous: somewhere the drawn place moves half as far again as the limit off the road.
    expect(steepestMotion).toBeGreaterThan(1.5 * FACING_TURN_LIMIT_RADIANS);
  });

  it.each([8, 12, 20])(
    'turns by a hair, never a step, from one frame to the next through a radius-%i m hairpin',
    (radius) => {
      // #1995's review: the line's derivative was nought where the line is held
      // at the road's edge and the full slope just outside, so the facing
      // jumped by up to 9° in a frame at a hairpin's entry and exit. Walked in
      // 2 cm steps, about a frame's riding at 4 km/h, from the approach to well
      // past the exit, the rider's heading never changes by more than half a
      // degree.
      const route = hairpinRoute(radius);
      const exit = 400 + Math.PI * radius + 40;
      // The corridor built around where the rider is drawn at each step, as
      // `sceneFrame` builds a frame's, and the riders placed on it without the scenery
      // (#588), which a marker does not read.
      const origin = corridorOrigin(route);
      const headingOf = (distance: number): number => {
        const input = { profile: route, origin, state: stateAt(route, distance, 9) };
        const [rider] = placedRiders(input, roadCorridor(route, origin, drawnRiderDistance(input)));
        if (rider === undefined) throw new Error('no rider placed');
        return Math.atan2(rider.marker.headingX, rider.marker.headingZ);
      };
      let previous = headingOf(360);
      let largest = 0;
      for (let at = 360.02; at <= exit; at += 0.02) {
        const heading = headingOf(at);
        let change = Math.abs(heading - previous);
        if (change > Math.PI) change = 2 * Math.PI - change;
        largest = Math.max(largest, change);
        previous = heading;
      }
      expect(largest).toBeLessThan((0.5 * Math.PI) / 180);
    },
  );

  it.each([
    [8, 'right'],
    [12, 'right'],
    [20, 'right'],
    [8, 'left'],
  ] as const)(
    'turns a bot and a ghost off the rider by a hair, never a step, through a radius-%i m %s-hand hairpin — #2017',
    (radius, hand) => {
      // #2001's re-review: the corridor is built around where the rider is
      // drawn, so the rider never crosses one of its points, but a bot or a
      // ghost a metre or more away does, and there the road's segment heading
      // turns by a whole segment's worth — 14° in a radius-8 hairpin. Held to
      // that heading, their facing stepped by up to 7° in one 2 cm step. The
      // same walk as the rider's, with a bot at 8 m/s and a ghost at 10 m/s on
      // the rider's odometer: each is eased for the bend at its own speed
      // (#1998), so it is drawn from level with the rider to a few metres off,
      // and slides past the corridor's points as it goes.
      const route = hairpinRoute(radius, hand);
      const exit = 400 + Math.PI * radius + 40;
      const origin = corridorOrigin(route);
      const ghost = buildGhostTrack({ elapsedSeconds: [0, 200], distanceMetres: [0, 2_000] });
      const headingsAt = (distance: number): { bot: number; ghost: number } => {
        const input = {
          profile: route,
          origin,
          state: stateAt(route, distance, 9, { distance, speed: 8 }, distance / 10),
          botDistance: distance,
          ghost,
        };
        const placed = placedRiders(input, roadCorridor(route, origin, drawnRiderDistance(input)));
        const yaw = (kind: RiderMarker['kind']): number => {
          const found = placed.find((rider) => rider.marker.kind === kind);
          if (found === undefined) throw new Error(`no ${kind} placed`);
          return Math.atan2(found.marker.headingX, found.marker.headingZ);
        };
        return { bot: yaw('bot'), ghost: yaw('ghost') };
      };
      const step = (from: number, to: number): number => {
        const change = Math.abs(to - from);
        return change > Math.PI ? 2 * Math.PI - change : change;
      };
      let previous = headingsAt(360);
      const largest = { bot: 0, ghost: 0 };
      for (let at = 360.02; at <= exit; at += 0.02) {
        const headings = headingsAt(at);
        largest.bot = Math.max(largest.bot, step(previous.bot, headings.bot));
        largest.ghost = Math.max(largest.ghost, step(previous.ghost, headings.ghost));
        previous = headings;
      }
      expect(largest.bot).toBeLessThan((0.5 * Math.PI) / 180);
      expect(largest.ghost).toBeLessThan((0.5 * Math.PI) / 180);
    },
    // About 4,000 frames placed per case: a second alone, and well past the
    // default five on a loaded machine.
    30_000,
  );

  it('faces a bot clamped past the corridor’s far end along the road there — #2017', () => {
    // Both of its wheels are clamped to the far end, so the road under it has
    // no length to take a direction from; it faces the corridor's last
    // segment. Round a corner, where the road runs east, so that is not north,
    // the arbitrary direction a degenerate heading would fall through to; and
    // short of the route's end, where the corridor's last points coincide.
    const corner = cornerRoute(15);
    const frame = frameOf(corner, stateAt(corner, 200, 8, { distance: 50_000, speed: 8 }), {
      botDistance: 50_000,
    });
    const far = frame.corridor.centre[frame.corridor.centre.length - 1];
    if (far === undefined) throw new Error('no corridor');
    const road = roadHeadingAt(frame, far.along);
    expect(Math.abs(road.headingX)).toBeGreaterThan(0.9);
    expect(
      between(facing(markerOf(frame, 'bot')), { x: road.headingX, z: road.headingZ }),
    ).toBeLessThan(1e-9);
  });

  it('points along the road again as the line comes back across it after the bend', () => {
    // The owner's frames: coming out of a hairpin the line swings back across
    // the road within a few metres, and the bicycle was drawn 60–90° across a
    // straight road. From where the road is straight again after the hairpin
    // until the line has settled, the rider is never more than the limit off
    // the road, and points along it, within 2°, once the line stops moving.
    const tight = hairpinRoute(8);
    const out = 400 + Math.PI * 8;
    const line = racingLine(tight);
    let crossing = 0;
    for (let at = out + 2; at <= out + 60; at += 0.5) {
      const state = stateAt(tight, at, 9);
      const frame = frameOf(tight, state);
      // Where the rider is drawn, eased off for the bend since #1998.
      const drawn = drawnRiderDistance({ profile: tight, origin: corridorOrigin(tight), state });
      const off = Math.abs(offRoad(roadHeadingAt(frame, drawn), facing(markerOf(frame, 'rider'))));
      expect(off).toBeLessThanOrEqual(FACING_TURN_LIMIT_RADIANS + 1e-9);
      if (Math.abs(lineSlopeAt(line, drawn)) > 0.05) crossing += 1;
      if (Math.abs(lineSlopeAt(line, drawn)) < 1e-4) {
        expect(off).toBeLessThan((2 * Math.PI) / 180);
      }
    }
    // Not vacuous: the line does come back across the road there.
    expect(crossing).toBeGreaterThan(4);
  });

  it('holds the turn off the road smoothly: the motion’s own angle when small, never past the limit', () => {
    const degree = Math.PI / 180;
    // Small turns are the motion's own, within 3 per cent at 3°.
    expect(facingTurn(3 * degree) / (3 * degree)).toBeGreaterThan(0.97);
    // Large ones are held just under the limit, on both sides.
    for (const angle of [30, 45, 90]) {
      expect(facingTurn(angle * degree)).toBeLessThan(FACING_TURN_LIMIT_RADIANS);
      expect(facingTurn(angle * degree)).toBeGreaterThan(0.75 * FACING_TURN_LIMIT_RADIANS);
      expect(facingTurn(-angle * degree)).toBeCloseTo(-facingTurn(angle * degree), 12);
    }
    // And it only ever grows with the angle: no step where the hold starts.
    for (let angle = 0; angle < 90; angle += 0.5) {
      expect(facingTurn((angle + 0.5) * degree)).toBeGreaterThan(facingTurn(angle * degree));
    }
  });

  it('faces along the road with the line switched off', () => {
    const line = racingLine(hairpin);
    const at = steepest(line, 300, 370);
    const frame = frameOf(hairpin, stateAt(hairpin, at, 8), { centreline: true });
    const road = roadHeadingAt(frame, at);
    expect(
      between(facing(markerOf(frame, 'rider')), { x: road.headingX, z: road.headingZ }),
    ).toBeLessThan(1e-12);
  });
});

describe('the camera follows the rider across the road — #499', () => {
  // ⚠️ **The EYE, since #1994.** Until then these held the pose's `x`/`z` to
  // the rider; the camera now looks at the road through a bend, and its pose
  // is the point on that sight line `CAMERA_BEHIND_METRES` past the eye
  // (`scene.ts` §`cameraPose`), which is the rider only on a straight. What
  // #499 asked — the camera moved across the road with the rider — is where
  // the eye stands: straight back from the rider along the ROAD there.
  // ⚠️ The road's heading, not the rider's: since #1995 a marker faces its
  // wheel-to-wheel line, up to 12° off the road, and the eye never followed
  // that. Read where the rider is DRAWN, which since #1998 can be behind the
  // odometer in a bend.
  it('stands its eye behind the rider, sideways as well as along', () => {
    for (const at of [300, 390, APEX, 470]) {
      const input = {
        profile: hairpin,
        origin: corridorOrigin(hairpin),
        state: stateAt(hairpin, at, 8),
      };
      const frame = sceneFrame(input);
      const rider = markerOf(frame, 'rider');
      const road = roadHeadingAt(frame, drawnRiderDistance(input));
      const eye = cameraRig(frame.camera).eye;
      expect(eye.x).toBeCloseTo(rider.x - road.headingX * CAMERA_BEHIND_METRES, 9);
      expect(eye.z).toBeCloseTo(rider.z - road.headingZ * CAMERA_BEHIND_METRES, 9);
    }
  });

  it('stands it behind the centreline with the line switched off', () => {
    const input = {
      profile: hairpin,
      origin: corridorOrigin(hairpin),
      state: stateAt(hairpin, APEX, 8),
      centreline: true,
    };
    const frame = sceneFrame(input);
    const drawn = drawnRiderDistance(input);
    const centre = centreAt(frame, drawn);
    const road = roadHeadingAt(frame, drawn);
    const eye = cameraRig(frame.camera).eye;
    expect(eye.x).toBeCloseTo(centre.x - road.headingX * CAMERA_BEHIND_METRES, 6);
    expect(eye.z).toBeCloseTo(centre.z - road.headingZ * CAMERA_BEHIND_METRES, 6);
  });

  it('moves across smoothly: never more than 30 cm in a metre of road', () => {
    // The steepest the line crosses the road is between the hairpin's entry
    // and its apex, about 25 cm a metre, measured. A camera placed from a line
    // that was not smooth — or a rider that jumped a lane — is a metre or more.
    let previous: SceneFrame | undefined;
    for (let at = 300; at <= 540; at += 1) {
      const frame = frameOf(hairpin, stateAt(hairpin, at, 8));
      if (previous !== undefined) {
        const before = across(previous, markerOf(previous, 'rider'), at - 1);
        const now = across(frame, markerOf(frame, 'rider'), at);
        expect(Math.abs(now - before)).toBeLessThan(0.3);
      }
      previous = frame;
    }
  });
});

describe('nothing measured along the road moves — #499', () => {
  it('leaves the route it solves exactly as it was', () => {
    // A FRESH route, not the file's shared `hairpin`: the line is cached per
    // profile object, so by the time this test runs every earlier test has
    // already solved `hairpin`, and anything a solve did to it is done on both
    // sides of any comparison made afterwards. Against a fresh one the solve
    // happens HERE, between the two reads.
    const pristine = hairpinRoute(RADIUS);
    const solved = hairpinRoute(RADIUS);
    racingLine(solved);
    expect(solved.grades).toEqual(pristine.grades);
    expect(solved.elevations).toEqual(pristine.elevations);
    expect(solved.positions).toEqual(pristine.positions);
  });

  it('sends a trainer exactly the same grades through the hairpin with and without the line', async () => {
    const ride = async (centreline: boolean): Promise<readonly SimulationParameters[]> => {
      // A fresh route per ride, never the shared `hairpin` — see the test
      // above. With the shared one the line was solved (and any damage done)
      // by an earlier test in this file, before either ride began, so the two
      // rides agreed and this passed with the solve writing into the grades.
      // It went red for that mutation only when run alone.
      const route = hairpinRoute(RADIUS);
      const written: SimulationParameters[] = [];
      const session = createGradientSession({
        profile: route,
        control: {
          setSimulationParameters: async (parameters) => {
            written.push(parameters);
            return Promise.resolve();
          },
          letGo: async () => Promise.resolve({ kind: 'stopped' }),
        },
      });
      const simulation = new GameSimulation({
        profile: route,
        conditions: { totalMass: kilograms(80), airDensityKilogramsPerCubicMetre: 1.2 },
      });
      const origin = corridorOrigin(route);
      // Two minutes at 300 W through the hairpin, advanced and drawn in the
      // order `GameView`'s loop does it, a frame every 200 ms — a slow phone's
      // rate, so the suite stays fast under the coverage run.
      for (let now = 0; now <= 120_000; now += 200) {
        simulation.advanceTo(now, { power: watts(300), live: true });
        session.sample(simulation.state.elapsed, simulation.state.ride.distance);
        sceneFrame({ profile: route, origin, state: simulation.state, centreline });
        await session.settled();
      }
      // Well past the apex, so the ride went through the bend.
      expect(simulation.state.ride.distance).toBeGreaterThan(APEX + 100);
      session.stop();
      return written;
    };
    const withLine = await ride(false);
    const without = await ride(true);
    // The hairpin climbs a steady 4 %, so the driver writes when the grade
    // settles and at its refresh — a dozen or so writes, each compared.
    expect(withLine.length).toBeGreaterThan(10);
    expect(withLine).toEqual(without);
  }, 30_000);

  it('builds the road, the scenery and the ground exactly as it did without the line', () => {
    const state = stateAt(hairpin, APEX, 8);
    const withLine = frameOf(hairpin, state);
    const without = frameOf(hairpin, state, { centreline: true });
    expect(withLine.corridor.vertices).toEqual(without.corridor.vertices);
    expect(withLine.scatter).toEqual(without.scatter);
    expect(roadCorridor(hairpin, corridorOrigin(hairpin), APEX).vertices).toEqual(
      withLine.corridor.vertices,
    );
  });
});

// ---------------------------------------------------------------------------
// #546 — true to physics, and a racer's body in a bend
// ---------------------------------------------------------------------------

describe('the lean drawn is the lean the physics asks for, and no more — #546', () => {
  /**
   * The line's own curvature at a distance on a circuit, found by this test
   * from the corridor: three points of the drawn line a sample apart.
   */
  function lineCurvature(profile: RouteProfile, at: number): number {
    const line = racingLine(profile);
    const frame = frameOf(profile, stateAt(profile, at, 0));
    const point = (distance: number): { x: number; z: number } => {
      const centre = centreAt(frame, distance);
      const ahead = centreAt(frame, distance + 0.01);
      const length = Math.hypot(ahead.x - centre.x, ahead.z - centre.z);
      const normalX = -(ahead.z - centre.z) / length;
      const normalZ = (ahead.x - centre.x) / length;
      const offset = lineOffsetAt(line, distance);
      return { x: centre.x + offset * normalX, z: centre.z + offset * normalZ };
    };
    const a = point(at - 5);
    const b = point(at);
    const c = point(at + 5);
    const ax = b.x - a.x;
    const az = b.z - a.z;
    const bx = c.x - b.x;
    const bz = c.z - b.z;
    const turn = Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    return turn / ((Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2);
  }

  it.each([15, 30, 45])(
    'is atan(v²κ/g) of the line to half a degree, mid-bend at %i km/h',
    (kilometresPerHour) => {
      // A circuit is one steady bend, so the roll limiter is not binding.
      const circuit = circuitRoute(60);
      const speed = kilometresPerHour / 3.6;
      const at = 200;
      const frame = frameOf(circuit, stateAt(circuit, at, speed));
      const rider = markerOf(frame, 'rider');
      const physics = Math.atan((speed * speed * lineCurvature(circuit, at)) / 9.80665);
      expect(Math.abs(physics)).toBeGreaterThan(0.5 * (Math.PI / 180));
      expect(
        Math.abs(combinedLean(rider.lean, rider.bodyLean) - physics) / (Math.PI / 180),
      ).toBeLessThan(0.5);
    },
  );
});

describe('a racer’s cranks in a tight bend — #546', () => {
  const FIXTURES: readonly (readonly [string, RouteProfile, number, number])[] = [
    ['the 10 m hairpin', hairpinRoute(10), 300, 600],
    ['the 20 m hairpin', hairpin, 300, 600],
    ['a 10 m corner', cornerRoute(10), 300, 500],
    ['a 10 m left-hand corner', cornerRoute(10, 90, 'left'), 300, 500],
    ['the S-bend', sBendRoute(20), 300, 600],
    ['a 60 m circuit', circuitRoute(60), 0, 377],
  ];

  it.each(FIXTURES)(
    'never puts a pedal of the rider, the bot or the ghost through the road on %s',
    (_, route, from, to) => {
      // The riders are placed through `placedRiders` — the step `sceneFrame`
      // takes its markers from — rather than through a whole frame, because the
      // scenery, the ground and the water beside the road are nine tenths of a
      // frame and no marker reads them: 924 whole frames a case timed out on CI
      // (#588). Every twentieth sample is ALSO built as a whole frame and must
      // agree to the bit, so a frame that stopped drawing these markers is
      // still red here.
      const origin = corridorOrigin(route);
      let sample = 0;
      let compared = 0;
      for (const speed of [6, 10, 14, 18]) {
        const ghost = buildGhostTrack({
          elapsedSeconds: [0, 1_000],
          distanceMetres: [0, speed * 1_000],
        });
        for (let at = from; at <= to; at += 1.3) {
          const input = {
            profile: route,
            origin,
            state: stateAt(
              route,
              at,
              speed,
              { distance: at + 20, speed },
              Math.max(0, at - 30) / speed,
            ),
            botDistance: at + 20,
            ghost,
            // A cadence reading that has the rider's cranks at every angle in turn.
            crankAngle: at * 1.7,
            // #1998: un-eased, so the leans reach the pedal strike this holds
            // the cranks clear of — as they still do in a round or a race.
            uneased: true,
          };
          const markers = placedRiders(input, roadCorridor(route, origin, at)).map(
            (placed) => placed.marker,
          );
          expect(markers).toHaveLength(3);
          if (sample % 20 === 0) {
            expect(sceneFrame(input).markers).toEqual(markers);
            compared += 1;
          }
          sample += 1;
          for (const marker of markers) {
            const crank = marker.crankAngle ?? 0;
            expect(lowestPedalHeight(marker.lean, crank)).toBeGreaterThanOrEqual(0);
          }
        }
      }
      expect(compared).toBeGreaterThan(5);
    },
  );

  it('parks the OUTSIDE pedal at six o’clock on a bot, a ghost and the rider leaning past the parking lean', () => {
    const route = hairpinRoute(10);
    const ghost = buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, 14_000] });
    let parked = 0;
    for (let at = 380; at <= 460; at += 0.7) {
      const frame = frameOf(
        route,
        stateAt(route, at, 14, { distance: at + 10, speed: 14 }, at / 14),
        {
          botDistance: at + 10,
          ghost,
          crankAngle: at,
          // #1998: un-eased, or nobody leans far enough to park.
          uneased: true,
        },
      );
      for (const marker of frame.markers) {
        if (Math.abs(marker.lean) < CRANK_PARKING_LEAN_RADIANS) continue;
        parked += 1;
        // The outside arm is +X on a positive lean, and at six o'clock at π; on
        // a negative lean it is −X, and at six o'clock at 0.
        const outsideDown = marker.lean > 0 ? Math.PI : 0;
        const crank = marker.crankAngle as number;
        const off = Math.abs(((crank - outsideDown + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        expect(off).toBeLessThanOrEqual(15 * (Math.PI / 180));
      }
    }
    // Non-vacuity: a 10 m hairpin at 14 m/s leans all three past it.
    expect(parked).toBeGreaterThan(30);
  });

  it('draws the rider’s own cadence wherever the bend is not tight enough to park', () => {
    const route = northRoute(2_000, () => 0);
    const frame = frameOf(route, stateAt(route, 1_000, 12), { crankAngle: 1.234 });
    expect(markerOf(frame, 'rider').crankAngle).toBe(1.234);
  });
});

describe('what each rider is drawn pedalling with, and on whose clock — #625', () => {
  it('draws the rider’s stroke exactly when the caller says a reading turns the cranks, and never by default', () => {
    const route = northRoute(2_000, () => 0);
    const state = stateAt(route, 1_000, 10);
    expect(
      markerOf(frameOf(route, state, { crankAngle: 1, pedalling: true }), 'rider').pedalling,
    ).toBe(1);
    expect(
      markerOf(frameOf(route, state, { crankAngle: 1, pedalling: false }), 'rider').pedalling,
    ).toBe(0);
    // Absent is the start line and a harness frame: a rider who is not pedalling.
    expect(markerOf(frameOf(route, state, { crankAngle: 1 }), 'rider').pedalling).toBe(0);
  });

  it('draws the pacer and the ghost pedalling while they move, and still when they do not', () => {
    const route = northRoute(2_000, () => 0);
    const ghost = buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, 9_000] });
    const moving = frameOf(route, stateAt(route, 1_000, 10, { distance: 1_020, speed: 9 }, 100), {
      botDistance: 1_020,
      ghost,
    });
    expect(markerOf(moving, 'bot').pedalling).toBe(1);
    expect(markerOf(moving, 'ghost').pedalling).toBe(1);
    const stopped = frameOf(route, stateAt(route, 1_000, 10, { distance: 1_020, speed: 0 }, 100), {
      botDistance: 1_020,
    });
    expect(markerOf(stopped, 'bot').pedalling).toBe(0);
  });

  it('fades every rider’s stroke as the cranks are parked in a tight bend — #546', () => {
    const route = hairpinRoute(10);
    const ghost = buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, 14_000] });
    let faded = 0;
    for (let at = 380; at <= 460; at += 0.7) {
      const frame = frameOf(
        route,
        stateAt(route, at, 14, { distance: at + 10, speed: 14 }, at / 14),
        // #1998: un-eased, or nobody leans far enough to park.
        { botDistance: at + 10, ghost, crankAngle: at, pedalling: true, uneased: true },
      );
      for (const marker of frame.markers) {
        expect(marker.pedalling).toBeCloseTo(pedallingShare(marker.lean), 12);
        if (Math.abs(marker.lean) >= CRANK_PARKING_LEAN_RADIANS) {
          expect(marker.pedalling).toBe(0);
          faded += 1;
        }
      }
    }
    // Non-vacuity: #546's own hairpin parks all three.
    expect(faded).toBeGreaterThan(30);
  });

  it('carries the ride’s own clock — `ridden`, which a held or paused ride holds — on every marker', () => {
    const route = northRoute(2_000, () => 0);
    const ghost = buildGhostTrack({ elapsedSeconds: [0, 1_000], distanceMetres: [0, 9_000] });
    const state = { ...stateAt(route, 1_000, 10, { distance: 1_020, speed: 9 }, 37.25) };
    // The wall clock of the ride has run on; the ridden time has not.
    const frame = frameOf(
      route,
      { ...state, elapsed: seconds(400) },
      { botDistance: 1_020, ghost },
    );
    expect(frame.markers).toHaveLength(3);
    for (const marker of frame.markers) expect(marker.rideSeconds).toBe(37.25);
  });
});
