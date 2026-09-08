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
import { GameSimulation, atStartLine, type SimulationSetup } from './simulation';
import {
  altitudeMetres,
  buildGhostTrack,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
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
      centre: [{ x: 0, y: 0, z: 0, distance: 0 }],
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
