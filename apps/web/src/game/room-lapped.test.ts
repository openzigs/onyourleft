// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2531: a room's riders, ridden round a loop with the laps, are drawn on
 * every frame they are in view — a scripted room read through `roomFrame`,
 * the scene's markers and the renderer's own rider belt.
 *
 * The cause it reproduces is #2516's: `scene.ts` drew a room's rider at the
 * room's odometer, and only where that odometer fell on the corridor the
 * frame built. A rider a lap up (or down) is a whole lap of odometer away
 * while they stand on the same stretch of road, so a rider lapped in a room,
 * or lapping one, rode beside an empty road. #2529 moved them by whole laps
 * onto the corridor's lap (`scene.ts` §`onTheCorridorsLap`).
 *
 * ⚠️ **As `GameView` does it, a frame every 100 ms**: the simulation advanced
 * at a steady power, `roomFrame` picking the room's riders to draw, and the
 * scene handed them at the rider's blended odometer. The markers are read
 * through `placedRiders` on the frame's own corridor, which is how
 * `sceneFrame` makes them, and one frame is held to `sceneFrame` itself.
 * Nothing here writes to a trainer: the room's riders are drawn, never ridden
 * against, and the simulation is the same with them as without.
 */

import { describe, expect, it } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';

import type { RoomConnection } from '../net/room-port';
import type { DrawnRemoteRider } from '../net/snapshots';
import { simulatedCrankAngle } from './bicycle';
import { MAX_LAG_METRES } from './bend-easing';
import type { RiderMarker } from './port';
import { roomFrame, roomRideState } from './room-ride';
import { circuitRoute } from './route-fixtures-testing';
import { drawnRiderDistance, placedRiders, sceneFrame, type SceneInput } from './scene';
import { GameSimulation } from './simulation';
import { corridorOrigin, roadCorridor, type CorridorPoint } from './terrain';
import { RiderBelt } from './three-renderer';

/** #2516's loop, about 502 m: longer than the corridor's 460 m, so a rider stands on it once at most. */
const LOOP = circuitRoute(80);
const LAP = LOOP.totalDistance as number;
const ORIGIN = corridorOrigin(LOOP);
const FRAME_MS = 100;

/** How long the rider rides: until one room rider has lapped them and they have lapped the other. */
const RIDDEN_MS = 90_000;

/**
 * The room, scripted: each rider at a steady speed from where they start.
 * One rides fast enough to lap the rider, the other slow enough to be lapped.
 */
const SCRIPT = [
  { riderId: 1, startMetres: 40, speedMetresPerSecond: 22 },
  { riderId: 2, startMetres: 10, speedMetresPerSecond: 2 },
] as const;

function scriptedRoom(): RoomConnection {
  const others = (localMs: number): readonly DrawnRemoteRider[] =>
    SCRIPT.map((rider) => ({
      riderId: rider.riderId,
      distanceMetres: rider.startMetres + (rider.speedMetresPerSecond * localMs) / 1000,
      speedMetresPerSecond: rider.speedMetresPerSecond,
      flags: 0,
      draftPercent: 0,
    }));
  return {
    status: () => ({
      kind: 'joined',
      riderId: 0,
      config: {
        kind: 'ride',
        ridingPosition: 'hoods',
        reportIntervalMs: 500,
        frameIntervalMs: 1000,
        drafting: 'off',
      },
    }),
    others,
    race: () => ({ kind: 'not-a-race' }),
    own: () => undefined,
    standings: () => undefined,
    draftFactor: () => 1,
    lapRace: () => undefined,
    useItem: () => undefined,
    changeLane: () => undefined,
    report: () => Promise.resolve({ kind: 'reported' }),
    leave: () => undefined,
  };
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

/** Where on the loop's lap that starts at `from` an odometer stands. */
function onTheLap(distance: number, from: number): number {
  return from + ((((distance - from) % LAP) + LAP) % LAP);
}

describe('a room’s riders are drawn on every frame they are in view, laps included — #2531', () => {
  it('draws each room rider where they stand on the road while one laps the rider and the rider laps the other', () => {
    const room = scriptedRoom();
    const memory = roomRideState();
    const simulation = new GameSimulation({
      profile: LOOP,
      conditions: { totalMass: kilograms(80), airDensityKilogramsPerCubicMetre: 1.2 },
    });
    const belt = new RiderBelt();
    let inView = 0;
    let lappedInView = 0;
    let heldToTheScene = false;
    for (let now = 0; now <= RIDDEN_MS; now += FRAME_MS) {
      simulation.advanceTo(now, { power: watts(250), live: true });
      const frame = roomFrame(room, memory, simulation, now);
      const input: SceneInput = {
        profile: LOOP,
        origin: ORIGIN,
        state: simulation.state,
        riderDistance: simulation.drawnAt(now).riderDistance,
        remoteRiders: frame.remoteRiders,
      };
      const corridor = roadCorridor(LOOP, ORIGIN, drawnRiderDistance(input));
      const first = (corridor.centre[0] as CorridorPoint).along;
      const last = (corridor.centre.at(-1) as CorridorPoint).along;
      const markers = placedRiders(input, corridor).map((placed) => placed.marker);
      const remotes = markers.filter((marker) => marker.kind === 'remote');
      // The control: the same room with each rider on the corridor's lap.
      // Where a lapped rider is drawn is where one on the rider's lap would be.
      const control = placedRiders(
        {
          ...input,
          remoteRiders: frame.remoteRiders.map((rider) => ({
            ...rider,
            distanceMetres: onTheLap(rider.distanceMetres, first),
          })),
        },
        corridor,
      )
        .map((placed) => placed.marker)
        .filter((marker) => marker.kind === 'remote');
      const label = `at ${String(now)} ms, the rider at ${simulation.state.ride.distance.toFixed(1)} m`;
      expect(remotes.length, label).toBe(control.length);
      control.forEach((wanted, index) => {
        expect(remotes[index]?.x, label).toBeCloseTo(wanted.x, 6);
        expect(remotes[index]?.z, label).toBeCloseTo(wanted.z, 6);
      });

      // In view: a rider whose place on the loop is on the road the frame
      // built, far enough on that the easing's lag cannot draw them off it.
      let inViewHere = 0;
      for (const rider of frame.remoteRiders) {
        const at = onTheLap(rider.distanceMetres, first);
        if (at < first + MAX_LAG_METRES || at > last) continue;
        inViewHere += 1;
        const lapApart = rider.distanceMetres < first || rider.distanceMetres > last;
        if (lapApart) lappedInView += 1;
      }
      expect(remotes.length, label).toBeGreaterThanOrEqual(inViewHere);
      inView += inViewHere;

      // The renderer: the stylised world's belt draws every marker the frame
      // carries, each room rider at the place their marker stands.
      belt.place(markers);
      const drawn = drawnBy(belt);
      expect(drawn.length, label).toBe(markers.length);
      for (const marker of remotes) {
        const instance = drawn.some(
          (place) => Math.hypot(place.x - marker.x, place.z - marker.z) < 1e-3,
        );
        expect(instance, label).toBe(true);
      }

      // Once, the cheap path held to the whole frame `sceneFrame` builds.
      if (!heldToTheScene && remotes.length > 0 && lappedInView > 0) {
        expect(sceneFrame(input).markers, label).toEqual(markers);
        heldToTheScene = true;
      }
    }
    // The controls: the room was seen, and seen a lap apart, on both sides.
    const ridden = simulation.state.ride.distance as number;
    const [fast, slow] = room.others(RIDDEN_MS);
    expect((fast?.distanceMetres ?? 0) - ridden).toBeGreaterThan(LAP);
    expect(ridden - (slow?.distanceMetres ?? 0)).toBeGreaterThan(LAP);
    expect(inView).toBeGreaterThan(100);
    expect(lappedInView).toBeGreaterThan(50);
    expect(heldToTheScene).toBe(true);
    belt.dispose();
  });

  it('draws a room rider a lap apart with their label and their own cranks (#783)', () => {
    const at = (distanceMetres: number): RiderMarker | undefined => {
      const simulation = new GameSimulation({
        profile: LOOP,
        conditions: { totalMass: kilograms(80), airDensityKilogramsPerCubicMetre: 1.2 },
      });
      const input: SceneInput = {
        profile: LOOP,
        origin: ORIGIN,
        state: simulation.state,
        remoteRiders: [
          { riderId: 1, distanceMetres, speedMetresPerSecond: 9, label: 'Bea Ng', followed: true },
        ],
      };
      return sceneFrame(input).markers.find((marker) => marker.kind === 'remote');
    };
    const own = at(30);
    const lapped = at(30 + LAP);
    expect(own).toBeDefined();
    expect(lapped?.x).toBeCloseTo(own?.x ?? Number.NaN, 6);
    expect(lapped?.z).toBeCloseTo(own?.z ?? Number.NaN, 6);
    expect(lapped?.label).toBe('Bea Ng');
    expect(lapped?.followed).toBe(true);
    // Their cranks turn from their own odometer, never the one moved a lap.
    expect(lapped?.crankAngle).toBeCloseTo(simulatedCrankAngle(30 + LAP), 9);
  });
});
