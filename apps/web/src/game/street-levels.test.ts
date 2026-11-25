// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How far a place is from the nearest street an open-world ride holds — #3094
 * (`street-levels.ts`): what `landform.ts` levels an open-world view's ground
 * beside. Read against the exact distance to the streets handed over.
 */

import { describe, expect, it } from 'vitest';

import { LEVEL_LATTICE_METRES, LEVEL_REACH_METRES, StreetLevels } from './street-levels';

/** A street through `points` (`x, z` pairs). */
const street = (...points: number[]): { readonly line: Float32Array } => ({
  line: Float32Array.from(points),
});

/** The exact distance from `(x, z)` to the segment `a → b`. */
function exact(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}

describe('StreetLevels — how far a place is from the nearest street held (#3094)', () => {
  it('reads the exact distance past a lattice cell’s diagonal of a straight street, either side and at any angle', () => {
    // A street running north-east at an angle the lattice does not share.
    const levels = new StreetLevels(() => [street(-400, -230, 600, 410)]);
    let read = 0;
    for (let x = -300; x <= 400; x += 37.3) {
      for (let z = -200; z <= 300; z += 29.1) {
        const truth = exact(x, z, -400, -230, 600, 410);
        if (truth < 1.5 * LEVEL_LATTICE_METRES || truth > LEVEL_REACH_METRES - 10) continue;
        expect(levels.distance(x, z), `${String(x)}, ${String(z)}`).toBeCloseTo(truth, 3);
        read += 1;
      }
    }
    expect(read).toBeGreaterThan(50);
  });

  it('reads the nearest of several streets, to within a lattice cell’s diagonal near one or between two', () => {
    const streets = [
      street(0, 0, 0, 500),
      street(-200, 230, 300, 230),
      street(170, -100, 170, 600),
    ];
    const levels = new StreetLevels(() => streets);
    for (let x = -150; x <= 250; x += 13.7) {
      for (let z = -50; z <= 450; z += 17.9) {
        const truth = Math.min(
          exact(x, z, 0, 0, 0, 500),
          exact(x, z, -200, 230, 300, 230),
          exact(x, z, 170, -100, 170, 600),
        );
        const read = levels.distance(x, z);
        // Linear between lattice points: within a cell's diagonal of the
        // truth, over it near a street and under it where two are equally near.
        expect(Math.abs(read - truth), `${String(x)}, ${String(z)}`).toBeLessThan(
          Math.SQRT2 * LEVEL_LATTICE_METRES,
        );
      }
    }
  });

  it('reads no further than its reach, and nothing at all while no street is held', () => {
    const far = new StreetLevels(() => [street(0, 0, 10, 0)]);
    expect(far.distance(0, 2_000)).toBe(LEVEL_REACH_METRES);
    expect(new StreetLevels(() => undefined).distance(0, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(new StreetLevels(() => []).distance(0, 0)).toBe(Number.POSITIVE_INFINITY);
  });

  it('reads the streets the source hands over now: a block read changes the distance, a block dropped changes it back', () => {
    const first = [street(0, -500, 0, 500)];
    let held: readonly { readonly line: Float32Array }[] = first;
    const levels = new StreetLevels(() => held);
    expect(levels.distance(100, 0)).toBeCloseTo(100, 3);
    held = [...first, street(150, -500, 150, 500)];
    expect(levels.distance(100, 0)).toBeCloseTo(50, 3);
    held = first;
    expect(levels.distance(100, 0)).toBeCloseTo(100, 3);
  });

  it('is the same number at a place however many other places were read first', () => {
    const streets = [street(-1_000, 37, 1_000, 37), street(400, -1_000, 400, 1_000)];
    const fresh = new StreetLevels(() => streets);
    const worn = new StreetLevels(() => streets);
    // Far more chunks than are kept, so the lattice is dropped and found again.
    for (let x = -20_000; x <= 20_000; x += 300) worn.distance(x, -9_000);
    for (const [x, z] of [
      [120, 90],
      [380, -260],
      [-600, 210],
    ] as const) {
      expect(worn.distance(x, z)).toBe(fresh.distance(x, z));
    }
  });
});
