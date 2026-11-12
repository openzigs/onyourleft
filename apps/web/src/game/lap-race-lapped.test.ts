// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2516: a lap race's bots, ridden round a loop with the laps, are drawn on
 * every frame they are in view — read back through the scene's markers and
 * the renderer's own rider belt.
 *
 * The cause it reproduces: `scene.ts` drew a race bot at its race position as
 * an odometer on the rider's road, and only where that odometer fell on the
 * corridor the frame built. A bot a lap down (or a lap up) is a whole lap of
 * odometer away from the rider while it stands on the same stretch of road,
 * so a rider coming up to lap the field saw an empty road where the bots were,
 * and the standings named them a few seconds ahead.
 *
 * And the ride's first frames: a bot is drawn back from its newest step along
 * its speed, so just off the line it stands a few centimetres behind it, a
 * negative odometer, and the grade under it was read through `metres`, which
 * refuses one. The frame threw.
 *
 * ⚠️ **Every frame, at 60 a second, through the markers `sceneFrame` draws**
 * (`placedRiders` on the frame's own corridor, which is how `sceneFrame`
 * makes them; one frame is held to `sceneFrame` itself below). The scenery
 * beside the road is nine tenths of a frame and no marker reads it: the 2 700
 * frames took 0.6 s, and 1.1 s under coverage, when written.
 *
 * The realistic world's own bodies need the model files, which the browser
 * gate's nightly realistic race loads; here the split is read back as the
 * renderer makes it (`realisticRemoteSplit`), and the stylised half through
 * the real `RiderBelt`'s instance matrices.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { kilograms, metres } from '@onyourleft/domain';

import { CAMERA_BEHIND_METRES } from './camera';
import {
  LAP_RACE_TICK_SECONDS,
  lapRaceBotConditions,
  lapRaceDrawing,
  startLapRaceRide,
  stepLapRaceRide,
  type LapRaceRide,
} from './lap-race/ride-race';
import { LAP_RACE_MOST_BOTS } from './lap-race/choice';
import type { RiderMarker } from './port';
import { DEFAULT_RIDING_POSITION, rideConditionsFor } from './rider';
import { circuitRoute } from './route-fixtures-testing';
import { placedRiders, sceneFrame, type SceneInput } from './scene';
import { atStartLine } from './simulation';
import {
  VIEW_AHEAD_METRES,
  VIEW_BEHIND_METRES,
  corridorOrigin,
  roadCorridor,
  type CorridorPoint,
  type RoadCorridor,
} from './terrain';
import { REALISTIC_REMOTE_RIDERS } from './realistic-budget';
import { RiderBelt, realisticRemoteSplit } from './three-renderer';

/** A loop of about 502 m: longer than the corridor's 460 m, so a bot stands on it once at most. */
const LOOP = circuitRoute(80);
const LAP = LOOP.totalDistance as number;
const ORIGIN = corridorOrigin(LOOP);
const FRAME_SECONDS = 1 / 60;

/**
 * The rider's pace: fast enough to ride up through the whole field and lap
 * it in the frames below. The bots ride their own steady race.
 */
const RIDER_METRES_PER_SECOND = 18;

/** How long the rider rides: until the last bot of the field is lapped and behind. */
const RIDDEN_SECONDS = 45;

afterEach(() => {
  vi.restoreAllMocks();
});

/** The owner's race (#2516): seven Steady bots, three laps, items on, from a seeded draw. */
function started(): LapRaceRide {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 2_516;
      return array;
    },
  );
  const ride = startLapRaceRide({
    choice: { laps: 3, bots: LAP_RACE_MOST_BOTS, tier: 'steady', itemsOn: true },
    profile: LOOP,
    conditions: lapRaceBotConditions(
      LOOP,
      rideConditionsFor(kilograms(70), DEFAULT_RIDING_POSITION),
    ),
    riderDistance: 0,
    lineOffset: 0,
    storage: undefined,
  });
  if (ride === undefined) throw new Error('a loop starts a race');
  return ride;
}

/** Where on the corridor `along` is, between its points. */
function centreAt(corridor: RoadCorridor, along: number): { x: number; z: number } {
  const points = corridor.centre;
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index] as CorridorPoint;
    if (to.along < along) continue;
    const from = points[index - 1] as CorridorPoint;
    const t = to.along > from.along ? (along - from.along) / (to.along - from.along) : 0;
    return { x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t };
  }
  throw new Error('a place in view is on the corridor');
}

/**
 * The places one belt draws its riders at, read back off its bodies' instance
 * matrices: a column-major 4 × 4 a slot, the translation in 12 to 14.
 */
function drawnBy(belt: RiderBelt): readonly { x: number; z: number }[] {
  const bodies = belt.meshes.bodies;
  const matrices = bodies.instanceMatrix.array;
  return Array.from({ length: bodies.count }, (_, slot) => ({
    x: matrices[slot * 16 + 12] as number,
    z: matrices[slot * 16 + 14] as number,
  }));
}

describe('a lap race’s bots are drawn on every frame they are in view, laps included — #2516', () => {
  it('draws every bot within the view on every frame while the rider rides up through the field and laps it', () => {
    let ride = started();
    const belt = new RiderBelt();
    const start = atStartLine(LOOP);
    let along = 0;
    let pending = 0;
    let checked = 0;
    let lappedInView = 0;
    let heldToTheScene = false;
    for (let frame = 0; frame * FRAME_SECONDS < RIDDEN_SECONDS; frame += 1) {
      pending += FRAME_SECONDS;
      let ticks = 0;
      while (pending >= LAP_RACE_TICK_SECONDS) {
        pending -= LAP_RACE_TICK_SECONDS;
        ticks += 1;
      }
      along += ticks * LAP_RACE_TICK_SECONDS * RIDER_METRES_PER_SECOND;
      ride = stepLapRaceRide(ride, { ticks, along });
      // As `GameView` hands it over: the drawn frame a part-step behind the newest.
      const drawing = lapRaceDrawing(ride, along, LAP_RACE_TICK_SECONDS - pending, false);
      const input: SceneInput = {
        profile: LOOP,
        origin: ORIGIN,
        state: { ...start, ride: { ...start.ride, distance: metres(along) } },
        riderDistance: drawing.riderDistance,
        steeredLateral: drawing.steeredLateral,
        raceBots: drawing.raceBots,
      };
      const corridor = roadCorridor(LOOP, ORIGIN, drawing.riderDistance);
      const markers = placedRiders(input, corridor).map((placed) => placed.marker);
      const racers = markers.filter((marker) => marker.racer === true);

      // What is in view: each bot whose place on the loop is in front of the
      // camera's eye and on the road the frame draws, whichever lap it is on.
      // A lap apart is a bot whose own odometer is off that road.
      const eye = drawing.riderDistance - CAMERA_BEHIND_METRES;
      const first = (corridor.centre[0] as CorridorPoint).along;
      const last = (corridor.centre.at(-1) as CorridorPoint).along;
      const inView = drawing.raceBots
        .map((bot) => ({
          ahead: (((bot.distanceMetres - eye) % LAP) + LAP) % LAP,
          lapApart: bot.distanceMetres < first || bot.distanceMetres > last,
        }))
        .filter((bot) => eye + bot.ahead <= last);
      const label = `frame ${String(frame)}, the rider at ${along.toFixed(1)} m`;

      // The scene: one racer marker for each bot in view, standing on the road where that bot is.
      expect(racers.length, label).toBeGreaterThanOrEqual(inView.length);
      for (const bot of inView) {
        const wanted = centreAt(corridor, eye + bot.ahead);
        const near = racers.some(
          (marker) => Math.hypot(marker.x - wanted.x, marker.z - wanted.z) < 4,
        );
        expect(near, `${label}: a bot ${bot.ahead.toFixed(1)} m up the road`).toBe(true);
        if (bot.lapApart) lappedInView += 1;
      }

      // The renderer: the nearest racers wear the realistic bodies, the rest
      // ride in the stylised belt's instances, and none is left out of both.
      const split = realisticRemoteSplit(markers);
      belt.place(split.stylised);
      const realistic = split.realistic.filter((marker: RiderMarker) => marker.racer === true);
      expect(realistic.length, label).toBeLessThanOrEqual(REALISTIC_REMOTE_RIDERS);
      const stylised = drawnBy(belt);
      expect(realistic.length + stylised.length, label).toBe(racers.length);
      for (const marker of split.stylised) {
        const instance = stylised.some(
          (place) => Math.hypot(place.x - marker.x, place.z - marker.z) < 1e-3,
        );
        expect(instance, label).toBe(true);
      }

      // Once, the cheap path held to the whole frame `sceneFrame` builds.
      if (!heldToTheScene && inView.some((bot) => bot.lapApart)) {
        expect(sceneFrame(input).markers, label).toEqual(markers);
        heldToTheScene = true;
      }
      checked += inView.length;
    }
    // The controls: the ride saw the field, and saw it a lap down.
    expect(checked).toBeGreaterThan(10_000);
    expect(lappedInView).toBeGreaterThan(10_000);
    expect(heldToTheScene).toBe(true);
    // The rider lapped every bot by the end.
    const rider = ride.race.racers.find((entry) => entry.racer.id === 'rider');
    for (const entry of ride.race.racers) {
      if (entry === rider) continue;
      expect(entry.racer.effortDistance + LAP).toBeLessThan(rider?.racer.effortDistance ?? 0);
    }
    expect(VIEW_BEHIND_METRES + VIEW_AHEAD_METRES).toBeLessThan(LAP);
    belt.dispose();
  });
});
