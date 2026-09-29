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
  BICYCLE_LENGTH_METRES,
  CRANK_PARKING_LEAN_RADIANS,
  RIDER_HALF_WIDTH_METRES,
  combinedLean,
  lowestPedalHeight,
  pedallingShare,
} from './bicycle';
import { createGradientSession } from './gradient';
import type { RiderMarker, SceneFrame } from './port';
import { leanAt, lineOffsetAt, racingLine } from './racing-line';
import {
  circuitRoute,
  cornerRoute,
  hairpinRoute,
  northRoute,
  sBendRoute,
} from './route-fixtures-testing';
import { placedRiders, sceneFrame } from './scene';
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

/** How far a marker is across the road from the centreline, positive on the normal's side. */
function across(frame: SceneFrame, marker: RiderMarker, distance: number): number {
  const centre = centreAt(frame, distance);
  return (marker.x - centre.x) * -marker.headingZ + (marker.z - centre.z) * marker.headingX;
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
    expect(rider.x + rider.headingZ * sideways).toBeCloseTo(centre.x, 6);
    expect(rider.z - rider.headingX * sideways).toBeCloseTo(centre.z, 6);
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
    expect(across(frame, bot, botAt)).toBeCloseTo(lineOffsetAt(line, botAt), 6);
    expect(combinedLean(bot.lean, bot.bodyLean)).toBeCloseTo(leanAt(line, botAt, 11), 12);
    // …and not at the rider's speed, which would be a different lean here.
    expect(combinedLean(bot.lean, bot.bodyLean)).not.toBeCloseTo(leanAt(line, botAt, 6), 3);
  });

  it('leans the ghost at the speed its replay was ridden at', () => {
    // An attempt ridden at a steady 10 m/s.
    const ghost = buildGhostTrack({ elapsedSeconds: [0, 200], distanceMetres: [0, 2_000] });
    const clock = (APEX + 20) / 10;
    const ghostAt = clock * 10;
    const frame = frameOf(hairpin, stateAt(hairpin, APEX - 100, 5, undefined, clock), { ghost });
    const drawn = markerOf(frame, 'ghost');
    const line = racingLine(hairpin);
    expect(across(frame, drawn, ghostAt)).toBeCloseTo(lineOffsetAt(line, ghostAt), 6);
    expect(combinedLean(drawn.lean, drawn.bodyLean)).toBeCloseTo(leanAt(line, ghostAt, 10), 9);
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
  // one, so a genuine hang is caught only by the job’s own stop (CLAUDE.md §4c).
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

describe('the camera follows the rider across the road — #499', () => {
  it('stands where the rider is, sideways as well as along', () => {
    for (const at of [300, 390, APEX, 470]) {
      const frame = frameOf(hairpin, stateAt(hairpin, at, 8));
      const rider = markerOf(frame, 'rider');
      expect(frame.camera.x).toBeCloseTo(rider.x, 9);
      expect(frame.camera.z).toBeCloseTo(rider.z, 9);
    }
  });

  it('stays on the centreline with the line switched off', () => {
    const frame = frameOf(hairpin, stateAt(hairpin, APEX, 8), { centreline: true });
    const centre = centreAt(frame, APEX);
    expect(frame.camera.x).toBeCloseTo(centre.x, 6);
    expect(frame.camera.z).toBeCloseTo(centre.z, 6);
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
        { botDistance: at + 10, ghost, crankAngle: at, pedalling: true },
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
