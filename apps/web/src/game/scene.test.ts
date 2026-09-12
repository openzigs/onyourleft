// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where the three markers go, and where the camera looks.
 *
 * This is the half of the renderer that jsdom can check. `three-renderer.ts`
 * turns the result into pixels and the browser gate checks that it can; nothing
 * about *placement* needs a GL context, so none of it is deferred there.
 */

import { describe, expect, it } from 'vitest';

import { cameraPose, ghostFinished, sceneFrame } from './scene';
import { corridorOrigin } from './terrain';
import { GameSimulation, atStartLine, type GameState, type SimulationSetup } from './simulation';
import { squareLoopProfile } from './testing';
import {
  altitudeMetres,
  buildGhostTrack,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  metres,
  metresPerSecond,
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

/**
 * #253: the case every fixture in the pacer work missed.
 *
 * The rider's odometer and the bot's are deliberately **unwrapped** — #237's
 * fourth criterion, argued at length in `pacer/gap.ts` — and the corridor's own
 * points are **wrapped** by `distanceOnRoute`. Matching one against the other
 * puts every marker at the far end of the corridor from lap two onward, which
 * draws two riders in one place for the rest of the ride.
 */
describe('a loop, once the odometers have passed the finish line', () => {
  /** A state on lap two, at `distance` metres of total riding. */
  function riding(profile: ReturnType<typeof squareLoopProfile>, distance: number): GameState {
    return {
      ...atStartLine(profile),
      ride: { speed: metresPerSecond(9), distance: metres(distance) },
    };
  }

  it('draws the rider and the bot in two places, not one', () => {
    const profile = squareLoopProfile();
    const total: number = profile.totalDistance;
    const frame = sceneFrame({
      profile,
      origin: corridorOrigin(profile),
      // 200 m into lap two, with the bot 100 m up the road.
      state: riding(profile, total + 200),
      botDistance: total + 300,
    });

    const rider = frame.markers.find((marker) => marker.kind === 'rider');
    const bot = frame.markers.find((marker) => marker.kind === 'bot');
    expect(rider).toBeDefined();
    expect(bot).toBeDefined();
    expect(
      Math.hypot((bot?.x ?? 0) - (rider?.x ?? 0), (bot?.z ?? 0) - (rider?.z ?? 0)),
    ).toBeCloseTo(100, 0);
  });

  it('puts a rider on lap two exactly where the same road was on lap one', () => {
    const profile = squareLoopProfile();
    const total: number = profile.totalDistance;
    const origin = corridorOrigin(profile);

    const lapOne = sceneFrame({ profile, origin, state: riding(profile, 200) });
    const lapTwo = sceneFrame({ profile, origin, state: riding(profile, total + 200) });

    const at = (frame: typeof lapOne): readonly [number, number] => {
      const rider = frame.markers.find((marker) => marker.kind === 'rider');
      return [rider?.x ?? Number.NaN, rider?.z ?? Number.NaN];
    };
    expect(at(lapTwo)[0]).toBeCloseTo(at(lapOne)[0], 6);
    expect(at(lapTwo)[1]).toBeCloseTo(at(lapOne)[1], 6);
  });

  it('places a ghost on lap two at its own distance rather than on top of the rider', () => {
    const profile = squareLoopProfile();
    const total: number = profile.totalDistance;
    // A ghost that rode two laps in ten minutes, so at 400 s it is on lap two.
    const ghost = buildGhostTrack({
      elapsedSeconds: [0, 600],
      distanceMetres: [0, total * 2],
    });
    const frame = sceneFrame({
      profile,
      origin: corridorOrigin(profile),
      state: { ...riding(profile, total + 100), elapsed: seconds(400) },
      ghost,
    });

    const rider = frame.markers.find((marker) => marker.kind === 'rider');
    const ghostMarker = frame.markers.find((marker) => marker.kind === 'ghost');
    // The ghost is at 2/3 of two laps — a long way past the rider's 100 m into
    // lap two, and nowhere near it.
    expect(
      Math.hypot((ghostMarker?.x ?? 0) - (rider?.x ?? 0), (ghostMarker?.z ?? 0) - (rider?.z ?? 0)),
    ).toBeGreaterThan(50);
  });
});
