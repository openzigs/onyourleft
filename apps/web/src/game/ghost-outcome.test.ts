// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The result of racing your own best, and the one case that makes it a latch.
 *
 * ⚠️ **This file is not what proves #259 is fixed.** A unit test of a predicate
 * is exactly what `scene.ts` §`ghostFinished` already had while nothing on the
 * screen said anything — the issue's third criterion asks for an assertion
 * about what a rider can see, and that one lives in `GameView.test.tsx`. What
 * is here is the arithmetic underneath it, and in particular the case that
 * decides the shape of the whole module: a slower rider who carries on past the
 * distance their best attempt covered.
 */

import { describe, expect, it } from 'vitest';

import { settleGhostOutcome } from './ghost-outcome';
import { atStartLine, type GameState } from './simulation';
import {
  altitudeMetres,
  buildGhostTrack,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  routeProfile,
  seconds,
  type GhostTrack,
  type RoutePoint,
} from '@onyourleft/domain';

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 200; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(0),
    });
  }
  return routeProfile(points);
}

/** 1 200 m in 60 s — the attempt every case below is measured against. */
const GHOST: GhostTrack = buildGhostTrack({
  elapsedSeconds: [0, 60],
  distanceMetres: [0, 1_200],
});

/** A ride that has ridden `ridden` seconds and covered `distance` metres. */
function riding(ridden: number, distance: number): GameState {
  const base = atStartLine(route());
  return {
    ...base,
    elapsed: seconds(ridden),
    ridden: seconds(ridden),
    ride: { speed: metresPerSecond(12), distance: metres(distance) },
  };
}

describe('nothing is claimed while the race is still on', () => {
  it('returns undefined while both are short of the attempt’s own distance', () => {
    expect(settleGhostOutcome(undefined, GHOST, riding(30, 400))).toBeUndefined();
  });

  it('returns undefined when the rider chose no attempt at all', () => {
    expect(settleGhostOutcome(undefined, undefined, riding(600, 5_000))).toBeUndefined();
  });
});

describe('a rider who gets there first is told at the moment they do', () => {
  /**
   * ⚠️ Settled while the attempt is still riding, which is the exact instant of
   * the win rather than an approximation of it. Waiting for its clock to run
   * out would decide the same question later — and after a backgrounded phone,
   * up to ten seconds of riding later, which is ten seconds of road credited to
   * a rider who may not have earned it.
   */
  it('says beaten the moment the rider covers its distance inside its time', () => {
    expect(settleGhostOutcome(undefined, GHOST, riding(45, 1_250))).toBe('beaten');
  });
});

describe('the result at the moment the attempt finishes', () => {
  it('says beaten when the rider is further up the road than it ever got', () => {
    expect(settleGhostOutcome(undefined, GHOST, riding(60, 1_500))).toBe('beaten');
  });

  it('says not-beaten when the rider has not reached its distance yet', () => {
    expect(settleGhostOutcome(undefined, GHOST, riding(60, 900))).toBe('not-beaten');
  });

  it('says matched on a dead heat rather than picking a direction', () => {
    expect(settleGhostOutcome(undefined, GHOST, riding(60, 1_200))).toBe('level');
  });
});

describe('the result is settled once and never revisited', () => {
  /**
   * ⚠️ **The case the whole module exists for.**
   *
   * A rider 300 m short when their best crossed the line has lost: 60 s of
   * riding has been and gone and they did not cover 1 200 m in it. They keep
   * pedalling, and at 90 s they are past 1 200 m — at which point the live gap
   * to the stopped attempt is negative, and anything reading the sign of it
   * would congratulate them on a ride they were thirty seconds slower than.
   */
  it('does not flip to beaten when a slower rider later passes its distance', () => {
    const atFinish = settleGhostOutcome(undefined, GHOST, riding(60, 900));
    expect(atFinish).toBe('not-beaten');

    const later = settleGhostOutcome(atFinish, GHOST, riding(90, 1_400));

    expect(later).toBe('not-beaten');
  });

  it('does not flip the other way either, when a rider who won stops', () => {
    const atFinish = settleGhostOutcome(undefined, GHOST, riding(60, 1_500));

    // A rider who beat it and then sat up: the attempt is still behind them in
    // distance, but nothing about a settled result depends on that continuing.
    expect(settleGhostOutcome(atFinish, GHOST, riding(200, 1_505))).toBe('beaten');
  });

  it('keeps a settled result even if the ghost is no longer loaded', () => {
    expect(settleGhostOutcome('beaten', undefined, riding(600, 20))).toBe('beaten');
  });
});

/**
 * ⚠️ **Where this stops working, pinned rather than described.**
 *
 * A phone backgrounded across *both* crossings presents one frame in which the
 * rider is past the attempt's distance **and** its clock has run out, with no
 * evidence left of which happened first. The answer is `beaten`, and it is
 * wrong for a rider who was in fact slower. The window is bounded by
 * `simulation.ts` §`MAXIMUM_STEPS_PER_ADVANCE` — ten seconds of riding — and
 * closing it would mean the simulation recording the rider's odometer at the
 * attempt's finishing time.
 *
 * This test exists so that fixing it turns something red on purpose rather than
 * quietly changing a claim nobody wrote down.
 */
describe('the one case it gets wrong, and the bound on it', () => {
  it('credits a stalled ride with the win it cannot disprove', () => {
    // Ridden time jumps from 55 s to 65 s in one frame, taking the rider from
    // 1 100 m to 1 300 m: both crossings happened somewhere inside the jump.
    expect(settleGhostOutcome(undefined, GHOST, riding(55, 1_100))).toBeUndefined();

    expect(settleGhostOutcome(undefined, GHOST, riding(65, 1_300))).toBe('beaten');
  });
});
