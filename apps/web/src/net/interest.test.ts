// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DRAWN_RIDERS,
  INTEREST_DWELL_MS,
  INTEREST_HYSTERESIS_RIDERS,
  InterestSet,
  MAXIMUM_DRAWN_RIDERS,
  MAXIMUM_DRAWN_SET,
  type InterestCandidate,
} from './interest';

/** `count` riders, rider `i` at `i + 1` metres ahead of a rider at 0. */
function field(count: number): InterestCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    riderId: index,
    distanceMetres: index + 1,
  }));
}

describe('which other riders are drawn — #783 interest management', () => {
  it('draws the nearest K, K defaulting to 50 and capped at 100 (ruling Q4)', () => {
    expect(DEFAULT_DRAWN_RIDERS).toBe(50);
    expect(new InterestSet().k).toBe(50);
    expect(new InterestSet(250).k).toBe(MAXIMUM_DRAWN_RIDERS);
    expect(MAXIMUM_DRAWN_RIDERS).toBe(100);
    const drawn = new InterestSet(3).update(field(10), 0, 0);
    expect(drawn).toEqual([0, 1, 2]);
    expect(new InterestSet().update(field(80), 0, 0)).toHaveLength(50);
  });

  it('ranks behind and ahead alike, by distance from this rider', () => {
    const drawn = new InterestSet(2).update(
      [
        { riderId: 1, distanceMetres: 100 },
        { riderId: 2, distanceMetres: 95 },
        { riderId: 3, distanceMetres: 140 },
      ],
      100,
      0,
    );
    expect(drawn).toEqual([1, 2]);
  });

  it('lets a drawn rider stay until they fall beyond K + h', () => {
    const set = new InterestSet(3);
    const riders = field(10);
    set.update(riders, 0, 0);
    // Rider 2 drifts to rank 3 + h − 1: still drawn.
    const drifted = riders.map((r) =>
      r.riderId === 2 ? { ...r, distanceMetres: 3 + INTEREST_HYSTERESIS_RIDERS + 0.5 } : r,
    );
    expect(set.update(drifted, 0, INTEREST_DWELL_MS)).toContain(2);
    // Beyond K + h: gone.
    const far = riders.map((r) => (r.riderId === 2 ? { ...r, distanceMetres: 500 } : r));
    expect(set.update(far, 0, 2 * INTEREST_DWELL_MS)).not.toContain(2);
  });

  it('does not change a rider oscillating across the boundary more than once per dwell', () => {
    const set = new InterestSet(3);
    const base = field(12);
    // Rider 9 swings between rank 0 and far beyond K + h every 100 ms for 10 s.
    let changes = 0;
    let last: boolean | undefined;
    const changedAt: number[] = [];
    for (let at = 0; at <= 10_000; at += 100) {
      const near = Math.floor(at / 100) % 2 === 0;
      const riders = base.map((r) =>
        r.riderId === 9 ? { ...r, distanceMetres: near ? 0.1 : 1_000 } : r,
      );
      const drawn = set.update(riders, 0, at).includes(9);
      if (last !== undefined && drawn !== last) {
        changes += 1;
        changedAt.push(at);
      }
      last = drawn;
    }
    // At most one change per dwell interval over ten seconds.
    expect(changes).toBeLessThanOrEqual(Math.floor(10_000 / INTEREST_DWELL_MS) + 1);
    for (let i = 1; i < changedAt.length; i += 1) {
      expect((changedAt[i] as number) - (changedAt[i - 1] as number)).toBeGreaterThanOrEqual(
        INTEREST_DWELL_MS,
      );
    }
    expect(changes).toBeGreaterThan(0);
  });

  it('never holds more than K + h, and drops a rider who left the room at once', () => {
    const set = new InterestSet(MAXIMUM_DRAWN_RIDERS);
    const drawn = set.update(field(300), 0, 0);
    expect(drawn.length).toBeLessThanOrEqual(MAXIMUM_DRAWN_SET);
    const without = field(300).filter((r) => r.riderId !== 5);
    expect(set.update(without, 0, 1)).not.toContain(5);
  });

  it('returns the set by rider id, never by who is ahead', () => {
    const drawn = new InterestSet(3).update(
      [
        { riderId: 8, distanceMetres: 3 },
        { riderId: 2, distanceMetres: 1 },
        { riderId: 5, distanceMetres: 2 },
      ],
      0,
      0,
    );
    expect(drawn).toEqual([2, 5, 8]);
  });
});
