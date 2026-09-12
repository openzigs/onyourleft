// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the three markers go, and where the camera looks.
 *
 * This is the half of the renderer that jsdom can check. `three-renderer.ts`
 * turns the result into pixels and the browser gate checks that it can; nothing
 * about *placement* needs a GL context, so none of it is deferred there.
 */

import { describe, expect, it } from 'vitest';

import { gapAgainst } from './hud/fields';
import type { RiderMarker, SceneFrame } from './port';
import { cameraPose, ghostFinished, sceneFrame } from './scene';
import { corridorOrigin } from './terrain';
import { GameSimulation, atStartLine, type SimulationSetup } from './simulation';
import {
  altitudeMetres,
  buildGhostTrack,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  metres,
  pacerGap,
  routeProfile,
  seconds,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';
import { airDensityKilogramsPerCubicMetre } from '@onyourleft/physics';

function straightRoute(): SimulationSetup {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index * 0.2),
    });
  }
  return {
    profile: routeProfile(points),
    conditions: {
      totalMass: kilograms(80),
      airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
        altitudeMetres(0),
        degreesCelsius(15),
      ),
    },
  };
}

/**
 * A square loop, so an odometer past `totalDistance` has somewhere to wrap to.
 *
 * ⚠️ **The fixture this file did not have, and #253 is what that cost.** Every
 * route fixture in the pacer work is point-to-point — `routeProfile` defaults
 * `loop` to `false` — so the wrap the corridor and the odometers disagree about
 * was exercised nowhere, and the bot and the rider collapsed onto one point from
 * lap two of a real loop onward. Four hundred metres a side is long enough that
 * a hundred metres of separation is unambiguous and short enough that lap two
 * arrives in one test.
 */
function loopRoute(): SimulationSetup {
  const side = 400;
  const spacing = 10;
  const corners: [number, number][] = [
    [0, 0],
    [0, side],
    [side, side],
    [side, 0],
  ];
  const perDegreeLongitude = 111_320 * Math.cos((51.5 * Math.PI) / 180);
  const points: RoutePoint[] = [];
  for (let leg = 0; leg < corners.length; leg += 1) {
    const from = corners[leg] as [number, number];
    const to = corners[(leg + 1) % corners.length] as [number, number];
    const steps = side / spacing;
    for (let step = 0; step < steps; step += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + (from[0] + ((to[0] - from[0]) * step) / steps) / 111_320),
          degreesLongitude(
            -0.12 + (from[1] + ((to[1] - from[1]) * step) / steps) / perDegreeLongitude,
          ),
        ),
        elevation: altitudeMetres(0),
      });
    }
  }
  return {
    profile: routeProfile(points, { loop: true }),
    conditions: {
      totalMass: kilograms(80),
      airDensityKilogramsPerCubicMetre: airDensityKilogramsPerCubicMetre(
        altitudeMetres(0),
        degreesCelsius(15),
      ),
    },
  };
}

const GHOST = buildGhostTrack({
  elapsedSeconds: [0, 10, 20, 30, 40],
  distanceMetres: [0, 60, 130, 210, 300],
});

describe('the frame carries every rider that is in play', () => {
  it('always places the rider', () => {
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
    });

    expect(frame.markers.map((marker) => marker.kind)).toEqual(['rider']);
  });

  it('places the bot and the ghost when both are chosen', () => {
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
      botDistance: 120,
      ghost: GHOST,
    });

    expect(frame.markers.map((marker) => marker.kind).sort()).toEqual(['bot', 'ghost', 'rider']);
  });

  it('omits the ghost entirely when the rider has no previous attempt', () => {
    // #93's fourth criterion: no ghost rather than an empty one sitting on the
    // start line pretending to be a rider.
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
      ghost: undefined,
    });

    expect(frame.markers.some((marker) => marker.kind === 'ghost')).toBe(false);
  });

  it('gives every marker a finite position', () => {
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
      botDistance: 5_000,
      ghost: GHOST,
    });

    for (const marker of frame.markers) {
      expect(Number.isFinite(marker.x)).toBe(true);
      expect(Number.isFinite(marker.y)).toBe(true);
      expect(Number.isFinite(marker.z)).toBe(true);
    }
  });
});

describe('the ghost is raced, not merely replayed alongside', () => {
  it('moves the ghost to where it was at this elapsed time', () => {
    const setup = straightRoute();
    const origin = corridorOrigin(setup.profile);
    const simulation = new GameSimulation(setup);
    simulation.advanceTo(0, { power: watts(200), live: true });

    const early = sceneFrame({
      profile: setup.profile,
      origin,
      state: { ...simulation.state, elapsed: seconds(5) },
      ghost: GHOST,
    });
    const later = sceneFrame({
      profile: setup.profile,
      origin,
      state: { ...simulation.state, elapsed: seconds(30) },
      ghost: GHOST,
    });

    const earlyGhost = early.markers.find((marker) => marker.kind === 'ghost');
    const laterGhost = later.markers.find((marker) => marker.kind === 'ghost');
    // The ghost covered ground between the two moments, so its marker moved.
    expect(laterGhost?.z).toBeGreaterThan(earlyGhost?.z ?? 0);
  });

  it('leaves the ghost at its finishing distance rather than removing it', () => {
    const setup = straightRoute();
    const state = { ...atStartLine(setup.profile), elapsed: seconds(600) };
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state,
      ghost: GHOST,
    });

    expect(frame.markers.some((marker) => marker.kind === 'ghost')).toBe(true);
    expect(ghostFinished(GHOST, state)).toBe(true);
  });
});

describe('the chase camera', () => {
  it('faces the way the road goes', () => {
    const setup = straightRoute();
    const frame = sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: atStartLine(setup.profile),
    });

    // The route runs due north, so the heading is +z and not -z.
    expect(frame.camera.headingZ).toBeGreaterThan(0.9);
    expect(Math.abs(frame.camera.headingX)).toBeLessThan(0.1);
  });

  it('faces the way the road goes on a route that does not run north', () => {
    // ⚠️ **The test above passes for the wrong reason and cannot notice.** Its
    // fixture runs due north, which is also the arbitrary heading `cameraPose`
    // falls back to when it has no next point to take a direction from — so a
    // camera that had given up and a camera that had read the road were
    // indistinguishable in it.
    //
    // They were not the same thing. Before #253 every corridor point behind a
    // point-to-point route's start clamped to a route distance of nought, so
    // the search for the rider's own odometer stopped at the FIRST of them and
    // `centre[index + 1]` was the identical clamped point. A rider on an
    // east-running route was given a camera looking north — sideways at the
    // road — for the first sixty metres of every ride. Matching on the
    // unwrapped odometer picks the point the rider is actually at, and its
    // neighbour is a real one.
    const perDegreeLongitude = 111_320 * Math.cos((51.5 * Math.PI) / 180);
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 200; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5),
          degreesLongitude(-0.12 + (index * 10) / perDegreeLongitude),
        ),
        elevation: altitudeMetres(0),
      });
    }
    const profile = routeProfile(points);

    const frame = sceneFrame({
      profile,
      origin: corridorOrigin(profile),
      state: atStartLine(profile),
    });

    expect(frame.camera.headingX).toBeGreaterThan(0.9);
    expect(Math.abs(frame.camera.headingZ)).toBeLessThan(0.1);
  });

  it('never produces a degenerate heading, which renders as a black screen', () => {
    // A corridor of one point has no next point to take a direction from. `three`
    // resolves a zero-length look-at to NaN and draws nothing.
    const setup = straightRoute();
    const corridor = {
      centre: [{ x: 0, y: 0, z: 0, distance: 0, along: 0 }],
      vertices: new Float32Array(6),
      quadCount: 0,
    };
    const pose = cameraPose(corridor, 0);

    expect(Number.isFinite(pose.headingX)).toBe(true);
    expect(Number.isFinite(pose.headingZ)).toBe(true);
    expect(Math.hypot(pose.headingX, pose.headingZ)).toBeCloseTo(1, 6);
    expect(setup.profile.totalDistance).toBeGreaterThan(0);
  });
});

describe('a loop, once the rider has been round once (#253)', () => {
  /** Where a marker of a kind ended up, in the corridor's local metres. */
  function placed(frame: SceneFrame, kind: RiderMarker['kind']): readonly [number, number] {
    const marker = frame.markers.find((each) => each.kind === kind);
    expect(marker).toBeDefined();
    return [marker?.x ?? Number.NaN, marker?.z ?? Number.NaN];
  }

  /** How far apart two placements are, on the ground. */
  function apart(a: readonly [number, number], b: readonly [number, number]): number {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  }

  /** The rider `odometer` metres in, with a bot a hundred metres up the road. */
  function frameAt(setup: SimulationSetup, odometer: number): SceneFrame {
    const base = atStartLine(setup.profile);
    return sceneFrame({
      profile: setup.profile,
      origin: corridorOrigin(setup.profile),
      state: { ...base, ride: { ...base.ride, distance: metres(odometer) } },
      botDistance: odometer + 100,
    });
  }

  it('draws the rider and the bot in two places, not one', () => {
    // ⚠️ The defect in one assertion. Both odometers are unwrapped and every
    // corridor point's route distance was wrapped, so from lap two onward every
    // point compared smaller than the value being searched for and BOTH markers
    // landed on the corridor's far end — two riders, one place, for the rest of
    // the ride.
    const setup = loopRoute();
    const total: number = setup.profile.totalDistance;

    const frame = frameAt(setup, total + 200);

    const between = apart(placed(frame, 'rider'), placed(frame, 'bot'));
    expect(between).toBeGreaterThan(50);
    expect(between).toBeLessThan(150);
  });

  it('draws them where lap one drew them, because a loop comes back round', () => {
    const setup = loopRoute();
    const total: number = setup.profile.totalDistance;

    const lapOne = frameAt(setup, 200);
    const lapTwo = frameAt(setup, total + 200);

    expect(apart(placed(lapOne, 'rider'), placed(lapTwo, 'rider'))).toBeLessThan(1);
    expect(apart(placed(lapOne, 'bot'), placed(lapTwo, 'bot'))).toBeLessThan(1);
    // And the camera goes with them, rather than being left at the far end of
    // the corridor looking at road the rider is nowhere near. It is placed by
    // the same lookup, so it failed in the same way and is fixed by the same
    // line — which is exactly why it is asserted here rather than assumed.
    expect(
      Math.hypot(lapOne.camera.x - lapTwo.camera.x, lapOne.camera.z - lapTwo.camera.z),
    ).toBeLessThan(1);
  });

  it('leaves the odometers unwrapped, so the HUD still reads a lap as a lap', () => {
    // ⚠️ #253's second acceptance criterion, and the same bug facing the other
    // way: wrapping the odometer would place the markers correctly and make a
    // bot about to lap the rider read as level with them. `pacer/gap.ts`'s
    // header argues the whole case; this is the assertion that stops the fix
    // being applied on the wrong side of the seam, in the package that would
    // apply it.
    const setup = loopRoute();
    const total: number = setup.profile.totalDistance;
    const base = atStartLine(setup.profile);
    const state = { ...base, ride: { ...base.ride, distance: metres(200) } };

    const gap = pacerGap(gapAgainst(state, 200 + total));

    expect(gap.metres).toBeCloseTo(total, 6);
  });
});
