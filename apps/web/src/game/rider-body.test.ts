// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which rider is drawn — #2839: the one place a missing choice becomes the
 * default, and the seeded mix a field of simulated riders is drawn in.
 */

import { DEFAULT_RIDER_BODY, RIDER_BODIES } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { pacerBodyFor, RIDER_BODY_NAMES, riderBodyFor, seededRiderBody } from './rider-body';

describe('riderBodyFor — #2839', () => {
  it('keeps each of the store’s words', () => {
    for (const body of RIDER_BODIES) expect(riderBodyFor(body)).toBe(body);
  });

  it('draws a rider who never chose as the store’s default — the rider before #2839', () => {
    // The default is restated in `rider-body.ts` (the demo may import no
    // store), so this is what holds the two equal.
    expect(riderBodyFor(undefined)).toBe(DEFAULT_RIDER_BODY);
    expect(riderBodyFor(undefined)).toBe('male');
  });

  it('draws anything else as the default, never as the other body', () => {
    for (const stranger of [
      'Female',
      'f',
      'robot',
      '',
      0,
      1,
      null,
      {},
      [],
      'toString',
      'constructor',
    ]) {
      expect(riderBodyFor(stranger), JSON.stringify(stranger)).toBe(DEFAULT_RIDER_BODY);
    }
  });

  it('names each choice for the settings screen, and names no other', () => {
    expect(Object.keys(RIDER_BODY_NAMES).sort()).toEqual([...RIDER_BODIES].sort());
    expect(RIDER_BODY_NAMES.female).toBe('Female');
    expect(RIDER_BODY_NAMES.male).toBe('Male');
  });
});

describe('seededRiderBody — a seeded mix of both bodies, #2839', () => {
  it('draws the same field for the same seed, every time', () => {
    for (const seed of [0, 1, 7, 2839, 0x7fffffff, -3]) {
      const field = Array.from({ length: 12 }, (_, index) => seededRiderBody(seed, index));
      const again = Array.from({ length: 12 }, (_, index) => seededRiderBody(seed, index));
      expect(again, String(seed)).toEqual(field);
    }
  });

  it('puts BOTH bodies in every field of two or more', () => {
    for (let seed = 0; seed < 500; seed += 1) {
      for (const size of [2, 3, 7]) {
        const field = new Set(
          Array.from({ length: size }, (_, index) => seededRiderBody(seed, index)),
        );
        expect(field.size, `seed ${String(seed)} of ${String(size)}`).toBe(2);
      }
    }
  });

  it('lets the seed decide who is first: about half of all seeds start with each body', () => {
    let female = 0;
    for (let seed = 0; seed < 1000; seed += 1) {
      if (seededRiderBody(seed, 0) === 'female') female += 1;
    }
    expect(female).toBeGreaterThan(400);
    expect(female).toBeLessThan(600);
  });

  it('answers one of the two words for any seed and index at all', () => {
    for (const seed of [Number.NaN, Infinity, -Infinity, 1.5, -0, 2 ** 40]) {
      for (const index of [Number.NaN, -1, 0.5, 1e9]) {
        expect(RIDER_BODIES).toContain(seededRiderBody(seed, index));
      }
    }
    expect(seededRiderBody(Number.NaN, Number.NaN)).toBe(seededRiderBody(0, 0));
  });
});

describe('pacerBodyFor — the solo ride’s pacer, #2839', () => {
  it('draws the same pacer for the same route, every time', () => {
    for (const id of ['route-1', 'circuit:crystal-palace', '']) {
      expect(pacerBodyFor(id)).toBe(pacerBodyFor(id));
      expect(RIDER_BODIES).toContain(pacerBodyFor(id));
    }
  });

  it('is a mix of both across routes', () => {
    const drawn = Array.from({ length: 400 }, (_, index) => pacerBodyFor(`route-${String(index)}`));
    const female = drawn.filter((body) => body === 'female').length;
    expect(female).toBeGreaterThan(140);
    expect(female).toBeLessThan(260);
  });
});
