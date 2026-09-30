// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { publishRace, type ResultForPublication } from './publication.ts';

/** A seeded generator, so the walk over many results is the same every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

const DURATIONS = [5, 60, 1200, 3600];

/** Every key anywhere in `value`, and every string. */
function walk(value: unknown, keys: string[], strings: string[]): void {
  if (typeof value === 'string') strings.push(value);
  if (Array.isArray(value)) for (const item of value) walk(item, keys, strings);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.push(key);
      walk(item, keys, strings);
    }
  }
}

describe('publishRace — ADR 0028’s publication rule, #785', () => {
  it('never publishes watts beside W/kg, for any rider and any flag, over a thousand races', () => {
    const random = seeded(785);
    for (let race = 0; race < 1_000; race += 1) {
      const riders = 1 + Math.floor(random() * 12);
      const results: ResultForPublication[] = Array.from({ length: riders }, (_, index) => ({
        athleteId: `athlete-${String(index)}`,
        place: random() < 0.8 ? index + 1 : null,
        finishMs: Math.floor(random() * 7_200_000),
        wattsPerKilogram: random() * 8,
        flaggedDurationsSeconds: DURATIONS.filter(() => random() < 0.3),
      }));
      const published = publishRace(results, {
        viewerAthleteId: 'athlete-0',
        nameFor: (athleteId) => `Name of ${athleteId}`,
      });
      const keys: string[] = [];
      const strings: string[] = [];
      walk(published, keys, strings);
      // No field that is a power: every figure per kilogram is named so.
      for (const key of keys) {
        expect(/watt|power/i.test(key) && !/PerKilogram$/.test(key), key).toBe(false);
      }
      // And no text carries a power, a flag's included: a flag is published
      // as its duration and its ceiling in W/kg — the W/kg side.
      for (const text of strings) expect(/\d\s*W\b(?!\/kg)/.test(text), text).toBe(false);
      for (const row of published.rows) {
        for (const flag of row.flags) {
          expect(Object.keys(flag).sort()).toEqual(['durationSeconds', 'overWattsPerKilogram']);
        }
      }
    }
  });

  it('shows every rider’s flags to every rider, by the duration raised for, with the ceiling in W/kg', () => {
    const results: ResultForPublication[] = [
      {
        athleteId: 'ann',
        place: 1,
        finishMs: 3_000_000,
        wattsPerKilogram: 6.61,
        flaggedDurationsSeconds: [1200],
      },
      {
        athleteId: 'bob',
        place: 2,
        finishMs: 3_100_000,
        wattsPerKilogram: 3.49,
        flaggedDurationsSeconds: [],
      },
    ];
    for (const viewer of ['ann', 'bob']) {
      const rows = publishRace(results, { viewerAthleteId: viewer, nameFor: (id) => id }).rows;
      expect(rows[0]?.flags).toEqual([{ durationSeconds: 1200, overWattsPerKilogram: 6.5 }]);
      expect(rows[0]?.wattsPerKilogram).toBe(6.6);
      expect(rows.find((row) => row.you)?.displayName).toBe(viewer);
    }
  });

  it('puts finishers by place, then who did not finish, and shows an erased rider as “a rider” with nothing of theirs', () => {
    const results: ResultForPublication[] = [
      {
        athleteId: 'cat',
        place: 3,
        finishMs: 3_300_000,
        wattsPerKilogram: 3,
        flaggedDurationsSeconds: [],
      },
      {
        athleteId: 'dan',
        place: null,
        finishMs: null,
        wattsPerKilogram: 2,
        flaggedDurationsSeconds: [],
      },
      {
        athleteId: 'ann',
        place: 1,
        finishMs: 3_000_000,
        wattsPerKilogram: 4,
        flaggedDurationsSeconds: [],
      },
    ];
    // Place 2's rider erased their account: their row is gone. And a fifth
    // crossed the line after cat and erased too — only the count says so.
    const rows = publishRace(results, { viewerAthleteId: 'ann', nameFor: (id) => id }, 4).rows;
    expect(rows.map((row) => [row.place, row.displayName])).toEqual([
      [1, 'ann'],
      [2, null],
      [3, 'cat'],
      [4, null],
      [null, 'dan'],
    ]);
    for (const erased of [rows[1], rows[3]]) {
      expect(erased).toEqual({
        place: erased?.place,
        displayName: null,
        you: false,
        finishMs: null,
        wattsPerKilogram: null,
        flags: [],
      });
    }
  });

  it('names nobody the viewer may not see', () => {
    const rows = publishRace(
      [
        {
          athleteId: 'blocked',
          place: 1,
          finishMs: 1,
          wattsPerKilogram: 3,
          flaggedDurationsSeconds: [],
        },
      ],
      { viewerAthleteId: 'ann', nameFor: () => undefined },
    ).rows;
    expect(rows[0]?.displayName).toBeNull();
    expect(rows[0]?.wattsPerKilogram).toBe(3);
  });
});
