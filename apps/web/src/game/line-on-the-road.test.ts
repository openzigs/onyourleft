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

import { BICYCLE_LENGTH_METRES, RIDER_HALF_WIDTH_METRES } from './bicycle';
import { createGradientSession } from './gradient';
import type { RiderMarker, SceneFrame } from './port';
import { leanAt, lineOffsetAt, racingLine } from './racing-line';
import { hairpinRoute, northRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
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
    expect(expected).toBeLessThan(-2);
    expect(across(frame, rider, APEX)).toBeCloseTo(expected, 6);
  });

  it('leans into the bend at its own speed', () => {
    const frame = frameOf(hairpin, stateAt(hairpin, APEX, 8));
    const lean = markerOf(frame, 'rider').lean;
    expect(lean).toBe(leanAt(racingLine(hairpin), APEX, 8));
    expect(lean).toBeLessThan(-0.1);
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
    expect(bot.lean).toBe(leanAt(line, botAt, 11));
    // …and not at the rider's speed, which would be a different lean here.
    expect(bot.lean).not.toBeCloseTo(leanAt(line, botAt, 6), 3);
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
    expect(drawn.lean).toBeCloseTo(leanAt(line, ghostAt, 10), 9);
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
  });

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
  it('sends a trainer exactly the same grades through the hairpin with and without the line', async () => {
    const ride = async (centreline: boolean): Promise<readonly SimulationParameters[]> => {
      const written: SimulationParameters[] = [];
      const session = createGradientSession({
        profile: hairpin,
        control: {
          setSimulationParameters: async (parameters) => {
            written.push(parameters);
            return Promise.resolve();
          },
          letGo: async () => Promise.resolve({ kind: 'stopped' }),
        },
      });
      const simulation = new GameSimulation({
        profile: hairpin,
        conditions: { totalMass: kilograms(80), airDensityKilogramsPerCubicMetre: 1.2 },
      });
      const origin = corridorOrigin(hairpin);
      // Two minutes at 300 W through the hairpin, advanced and drawn in the
      // order `GameView`'s loop does it, a frame every 200 ms — a slow phone's
      // rate, so the suite stays fast under the coverage run.
      for (let now = 0; now <= 120_000; now += 200) {
        simulation.advanceTo(now, { power: watts(300), live: true });
        session.sample(simulation.state.elapsed, simulation.state.ride.distance);
        sceneFrame({ profile: hairpin, origin, state: simulation.state, centreline });
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
