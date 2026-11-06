// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1897: the lap race counts laps by the game's own arithmetic. The model is
 * `@onyourleft/domain` §`lapsAt`, the game's count is `course-laps.ts`
 * §`courseLapsDone`, and this calls both over the same loop and the same
 * odometer readings, so the two arithmetics cannot drift apart. The HUD and
 * the race are not handed the same reading — the HUD counts at the effort
 * distance and the race at the drawn distance (ADR 0060 D-3.3) — so within B
 * of a lap line their laps may differ by one, by design.
 */

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  lapsAt,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { courseLapsDone } from '../course-laps';

/** A kilometre out and back, so its two ends meet and it is a loop (as `course-laps.test.ts`). */
function loop(): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 100; index += 1) {
    const out = index <= 50 ? index : 100 - index;
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (out * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(out * 0.8),
    });
  }
  return routeProfile(points, { loop: true });
}

describe('lap-race laps equal the game’s course laps (#1897)', () => {
  it('agrees with courseLapsDone at every odometer reading over five laps, the lines included', () => {
    const profile = loop();
    expect(profile.loop).toBe(true);
    const length = profile.totalDistance as number;
    const readings = [-10, 0, 0.001, length - 0.001, length, length + 0.001];
    for (let distance = 0; distance <= length * 5; distance += length / 37) {
      readings.push(distance);
    }
    for (let lap = 1; lap <= 5; lap += 1) {
      readings.push(lap * length - 1e-9, lap * length, lap * length + 1e-9);
    }
    for (const distance of readings) {
      expect(lapsAt(length, distance), String(distance)).toBe(courseLapsDone(profile, distance));
    }
  });
});
