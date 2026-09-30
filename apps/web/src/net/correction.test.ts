// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { CORRECTION_THRESHOLD_METRES, roomErrorMetres } from './correction';

describe('how far the room says this rider is out — #782', () => {
  it('carries the room’s position forward at the room’s speed to now', () => {
    const room = { distanceMetres: 100, speedMetresPerSecond: 10, atLocalMs: 1_000 };
    // 1.5 s later the room has them at 115 m; locally at 90 m, they are 25 m behind.
    expect(roomErrorMetres(room, 90, 2_500)).toBeCloseTo(25, 9);
    expect(roomErrorMetres(room, 140, 2_500)).toBeCloseTo(-25, 9);
  });

  it('acts on nothing inside the threshold, either way', () => {
    const room = { distanceMetres: 100, speedMetresPerSecond: 0, atLocalMs: 0 };
    expect(roomErrorMetres(room, 100 - CORRECTION_THRESHOLD_METRES, 0)).toBeUndefined();
    expect(roomErrorMetres(room, 100 + CORRECTION_THRESHOLD_METRES, 0)).toBeUndefined();
    expect(roomErrorMetres(room, 100 - CORRECTION_THRESHOLD_METRES - 0.01, 0)).toBeGreaterThan(0);
  });

  it('never carries a position backwards for a clock that ran backwards', () => {
    const room = { distanceMetres: 100, speedMetresPerSecond: 10, atLocalMs: 5_000 };
    expect(roomErrorMetres(room, 80, 1_000)).toBeCloseTo(20, 9);
  });
});
