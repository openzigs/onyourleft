// SPDX-License-Identifier: AGPL-3.0-or-later

/** #2882: the scripted ride is the one the issue asks for. */

import { describe, expect, it } from 'vitest';

import {
  degreesLatitude,
  degreesLongitude,
  distanceBetween,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';

import {
  LEG_MAX_METRES,
  LEG_MIN_METRES,
  legEnds,
  moved,
  ridden,
  turningLegs,
} from './turning-ride';

const START = geographicPosition(degreesLatitude(41.9), degreesLongitude(-87.8));

describe('the turning ride (#2882)', () => {
  const legs = turningLegs(3, 60);

  it('turns 90° every 300 to 500 m, and the same seed is the same ride', () => {
    for (const leg of legs) {
      expect(leg.metres).toBeGreaterThanOrEqual(LEG_MIN_METRES);
      expect(leg.metres).toBeLessThanOrEqual(LEG_MAX_METRES);
    }
    for (let index = 1; index < legs.length; index += 1) {
      const turn = ((legs[index]?.heading ?? 0) - (legs[index - 1]?.heading ?? 0) + 360) % 360;
      expect([90, 270]).toContain(turn);
    }
    expect(turningLegs(3, 60)).toEqual(legs);
    expect(turningLegs(4, 60)).not.toEqual(legs);
  });

  it('moves the distance asked for, in the direction asked for', () => {
    const east = moved(START, 90, 400);
    expect(distanceBetween(START, east)).toBeCloseTo(400, -1);
    expect(east.latitude).toBeCloseTo(START.latitude, 6);
    expect(east.longitude).toBeGreaterThan(START.longitude);
  });

  it('rides the legs at the speed asked for, through each junction', () => {
    const path = ridden(START, legs, 30 / 3.6, 1);
    const total = legs.reduce((sum, leg) => sum + leg.metres, 0);
    expect(path.length - 1).toBe(Math.floor(total / (30 / 3.6)));
    const ends = legEnds(START, legs);
    // A step that crosses a junction is shorter than a step along a straight, never longer.
    for (let index = 1; index < path.length; index += 1) {
      const step = distanceBetween(
        path[index - 1] as GeographicPosition,
        path[index] as GeographicPosition,
      );
      expect(step).toBeLessThanOrEqual(30 / 3.6 + 0.05);
    }
    // The tenth step after the first junction is past it, along the second leg.
    const first = ends[0] as GeographicPosition;
    const into = Math.ceil((legs[0]?.metres ?? 0) / (30 / 3.6)) + 10;
    expect(distanceBetween(first, path[into] as GeographicPosition)).toBeLessThan(
      11 * (30 / 3.6) + 1,
    );
  });
});
