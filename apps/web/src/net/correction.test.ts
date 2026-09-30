// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  admittedRoomSpeed,
  CORRECTION_THRESHOLD_METRES,
  explainableMetres,
  roomErrorMetres,
} from './correction';

/** The local simulation at `metres`, going `speed`, with the frame before at `sinceMs`. */
const local = (metres: number, speed = 0, sinceMs = -60_000) => ({
  distanceMetres: metres,
  speedMetresPerSecond: speed,
  sinceLocalMs: sinceMs,
});

describe('how far the room says this rider is out — #782', () => {
  it('carries the room’s position forward at the room’s speed to now', () => {
    const room = { distanceMetres: 100, speedMetresPerSecond: 10, atLocalMs: 1_000 };
    // 1.5 s later the room has them at 115 m; locally at 90 m, they are 25 m behind.
    expect(roomErrorMetres(room, local(90), 2_500)).toBeCloseTo(25, 9);
    expect(roomErrorMetres(room, local(140), 2_500)).toBeCloseTo(-25, 9);
  });

  it('acts on nothing inside the threshold, either way', () => {
    const room = { distanceMetres: 100, speedMetresPerSecond: 0, atLocalMs: 0 };
    expect(roomErrorMetres(room, local(100 - CORRECTION_THRESHOLD_METRES, 10), 0)).toBeUndefined();
    expect(roomErrorMetres(room, local(100 + CORRECTION_THRESHOLD_METRES, 10), 0)).toBeUndefined();
    expect(
      roomErrorMetres(room, local(100 - CORRECTION_THRESHOLD_METRES - 0.01, 10), 0),
    ).toBeGreaterThan(0);
  });

  it('never carries a position backwards for a clock that ran backwards', () => {
    const room = { distanceMetres: 100, speedMetresPerSecond: 10, atLocalMs: 5_000 };
    expect(roomErrorMetres(room, local(80), 1_000)).toBeCloseTo(20, 9);
  });
});

describe('how far a room may move the rider — #922', () => {
  it('leaves the local odometer alone for a frame 50 km out', () => {
    // One frame a second at 10 m/s: the room cannot have come 50 km apart.
    const room = { distanceMetres: 50_000 + 1_000, speedMetresPerSecond: 10, atLocalMs: 10_000 };
    expect(roomErrorMetres(room, local(1_000, 10, 9_000), 10_000)).toBeUndefined();
    expect(
      roomErrorMetres({ ...room, distanceMetres: 1_000 - 50_000 }, local(1_000, 10, 9_000), 10_000),
    ).toBeUndefined();
  });

  it('still corrects a few hundred metres after a legitimate 55 s drop', () => {
    // No frame for 55 s, and the two came apart by 550 m at 10 m/s, either way.
    const room = { distanceMetres: 1_550, speedMetresPerSecond: 10, atLocalMs: 65_000 };
    expect(roomErrorMetres(room, local(1_000, 10, 10_000), 65_000)).toBeCloseTo(550, 9);
    expect(
      roomErrorMetres(
        { ...room, distanceMetres: 1_000, speedMetresPerSecond: 0 },
        local(1_550, 10, 10_000),
        65_000,
      ),
    ).toBeCloseTo(-550, 9);
  });

  it('holds a correction to what the faster of the two speeds explains, and no more', () => {
    const since = 1; // a second since the frame before
    const bound = explainableMetres(10, since);
    expect(bound).toBeCloseTo(CORRECTION_THRESHOLD_METRES + 10 * (since + 2), 9);
    const room = (ahead: number) => ({
      distanceMetres: 1_000 + ahead,
      speedMetresPerSecond: 10,
      atLocalMs: 2_000,
    });
    expect(roomErrorMetres(room(bound), local(1_000, 8, 1_000), 2_000)).toBeCloseTo(bound, 9);
    expect(roomErrorMetres(room(bound + 0.01), local(1_000, 8, 1_000), 2_000)).toBeUndefined();
    // A rider going faster locally than the room says explains the same.
    expect(
      roomErrorMetres({ ...room(-bound), speedMetresPerSecond: 0 }, local(1_000, 10, 1_000), 2_000),
    ).toBeCloseTo(-bound, 9);
  });

  it('does not let the room choose its own ceiling — #928 review', () => {
    // A room reporting the wire's 100 m/s for a rider riding at 10 m/s is
    // believed to 10 × 1.25 + 2 = 14.5 m/s, and no further.
    expect(admittedRoomSpeed(100, 10)).toBeCloseTo(14.5, 9);
    expect(admittedRoomSpeed(9, 10)).toBe(9);
    // And from a standstill, to 2 m/s.
    expect(admittedRoomSpeed(100, 0)).toBe(2);
    const bound = explainableMetres(14.5, 1);
    const room = (ahead: number) => ({
      distanceMetres: 1_000 + ahead,
      speedMetresPerSecond: 100,
      // Carried nowhere: the frame describes now.
      atLocalMs: 2_000,
    });
    expect(roomErrorMetres(room(bound), local(1_000, 10, 1_000), 2_000)).toBeCloseTo(bound, 9);
    // 300 m in a second: what 100 m/s would have explained, refused.
    expect(roomErrorMetres(room(300), local(1_000, 10, 1_000), 2_000)).toBeUndefined();
    expect(roomErrorMetres(room(bound + 0.01), local(1_000, 10, 1_000), 2_000)).toBeUndefined();
    // On the first frame of a ride, 110 s in, a stopped rider cannot be carried 11 km.
    expect(roomErrorMetres(room(11_000), local(1_000, 0, -108_000), 2_000)).toBeUndefined();
  });
});
