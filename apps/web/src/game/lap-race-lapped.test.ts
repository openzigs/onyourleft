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
import { BIKE_LENGTH_METRES, PACK_ABREAST_METRES } from './lap-race/pack-layout';
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

/**
 * How near a marker stands to the place its bot is at to be that bot's, along
 * the road and across it: under half the pack's least spacing (#2544,
 * `PACK_ABREAST_METRES` 0.55 m abreast, `BIKE_LENGTH_METRES` 1.75 m a row), so
 * a marker beside or behind its bot is never taken for it.
 */
const MATCHED_WITHIN_METRES = 0.25;

/**
 * How far under a bike length along and a place across two racers may be and
 * still be clear, metres: **1 mm**, the rounding in adding up a drawn place.
 */
const CLEAR_WITHIN_METRES = 1e-3;

/** A racer as the frame draws it on the road: how far along the corridor's lap, and across. */
interface OnTheRoad {
  readonly at: number;
  readonly lateral: number;
  /** Whether it is a bot whose own odometer is off the frame's road: a lap apart from it. */
  readonly lapApart: boolean;
}

/**
 * Every racer one drawing puts on the road the frame draws, the rider first:
 * each bot at its place on the loop in front of the camera's eye, whichever
 * lap it is on.
 */
function onTheRoad(
  drawing: ReturnType<typeof lapRaceDrawing>,
  corridor: RoadCorridor,
): OnTheRoad[] {
  const eye = drawing.riderDistance - CAMERA_BEHIND_METRES;
  const first = (corridor.centre[0] as CorridorPoint).along;
  const last = (corridor.centre.at(-1) as CorridorPoint).along;
  return [
    { at: drawing.riderDistance, lateral: drawing.steeredLateral, lapApart: false },
    ...drawing.raceBots
      .map((bot) => ({
        at: eye + ((((bot.distanceMetres - eye) % LAP) + LAP) % LAP),
        lateral: bot.lateralMetres,
        lapApart: bot.distanceMetres < first || bot.distanceMetres > last,
      }))
      .filter((bot) => bot.at <= last),
  ];
}

/**
 * The pairs drawn inside each other with a bot a lap apart among them, by the
 * pack's own rule (`pack-layout.ts`): under a bike length along AND under a
 * place across. Each is how far under a place across it is.
 */
function insideALapApart(drawn: readonly OnTheRoad[]): number[] {
  const inside: number[] = [];
  drawn.forEach((one, index) => {
    for (const other of drawn.slice(index + 1)) {
      if (!one.lapApart && !other.lapApart) continue;
      const along = Math.abs(one.at - other.at);
      const across = Math.abs(one.lateral - other.lateral);
      if (
        along < BIKE_LENGTH_METRES - CLEAR_WITHIN_METRES &&
        across < PACK_ABREAST_METRES - CLEAR_WITHIN_METRES
      ) {
        inside.push(PACK_ABREAST_METRES - across);
      }
    }
  });
  return inside;
}

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

/**
 * Where on the corridor `along` is, between its points, and `lateral` across
 * the road along its normal `(−headingZ, headingX)`, as `scene.ts` §`markerAt`
 * puts a marker. #2544's pack lays bots out up to 1.75 m to the side and two
 * or three abreast, so a place on the centre line alone no longer says which
 * bot a marker is.
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
    let besideALapApart = 0;
    const ghosted: string[] = [];
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
      // On the tick itself, as well as on this frame between ticks below.
      if (ticks > 0) {
        const onTheTick = lapRaceDrawing(ride, along, 0, false);
        const inside = insideALapApart(
          onTheRoad(onTheTick, roadCorridor(LOOP, ORIGIN, onTheTick.riderDistance)),
        );
        if (inside.length > 0) ghosted.push(`tick at frame ${String(frame)}: ${inside.join(', ')}`);
      }
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
          lateral: bot.lateralMetres,
          lapApart: bot.distanceMetres < first || bot.distanceMetres > last,
        }))
        .filter((bot) => eye + bot.ahead <= last);
      const label = `frame ${String(frame)}, the rider at ${along.toFixed(1)} m`;

      // The scene: one racer marker for each bot in view, standing on the road
      // where that bot is, along it AND across it (#2544's pack).
      expect(racers.length, label).toBeGreaterThanOrEqual(inView.length);
      // One marker for one bot: a marker already matched to a bot is not matched again.
      const matched = new Set<number>();
      for (const bot of inView) {
        const wanted = placeAt(corridor, eye + bot.ahead, bot.lateral);
        let nearest = -1;
        let nearestGap = MATCHED_WITHIN_METRES;
        racers.forEach((marker, index) => {
          const gap = Math.hypot(marker.x - wanted.x, marker.z - wanted.z);
          if (!matched.has(index) && gap < nearestGap) {
            nearest = index;
            nearestGap = gap;
          }
        });
        if (nearest >= 0) matched.add(nearest);
        expect(nearest >= 0, `${label}: a bot ${bot.ahead.toFixed(1)} m up the road`).toBe(true);
        if (bot.lapApart) lappedInView += 1;
      }

      // Never a ghost (the owner's ruling on #2544): no bot a lap apart drawn
      // inside the rider or inside another bot, by the pack's own rule. The
      // pack lays the field out in race places, so this holds only because
      // it keeps clear on the loop (`pack-layout.ts` §"A lap apart").
      const drawnHere = onTheRoad(drawing, corridor);
      drawnHere.forEach((one, index) => {
        for (const other of drawnHere.slice(index + 1)) {
          if (one.lapApart === other.lapApart) continue;
          if (Math.abs(one.at - other.at) < BIKE_LENGTH_METRES) besideALapApart += 1;
        }
      });
      const inside = insideALapApart(drawnHere);
      if (inside.length > 0) ghosted.push(`${label}: ${inside.join(', ')}`);

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
    // And it rode level with racers a lap apart from them, the rider among them.
    expect(besideALapApart).toBeGreaterThan(50);
    // No frame and no tick drew a racer inside one a lap apart. Before #2516's
    // layout kept clear on the loop, 48 frames of the 2 700 did, the worst
    // fully abreast.
    expect(ghosted).toEqual([]);
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
