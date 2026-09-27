// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { HARD_SWAP_TREE_LEVELS, REALISTIC_TREE_LEVELS } from './realistic-budget';
import { bandFade, treeLevelAt, treeSlots, writeKeep, type TreeLevel } from './tree-levels';

/** The level at every rank from 0 to `ranks − 1`. */
function levels(ranks: number, of = REALISTIC_TREE_LEVELS): TreeLevel[] {
  return Array.from({ length: ranks }, (_, rank) => treeLevelAt(rank, of));
}

describe('which level a tree is drawn at, by rank — #617', () => {
  it('is one full, a band, four middle, a band, then the impostors', () => {
    expect(levels(9)).toEqual([
      'full',
      'full-middle',
      'middle',
      'middle',
      'middle',
      'middle',
      'middle-impostor',
      'impostor',
      'impostor',
    ]);
  });

  it('holds exactly as many trees at each mesh level as the slots say', () => {
    const slots = treeSlots(REALISTIC_TREE_LEVELS);
    const all = levels(40);
    const full = all.filter((level) => level === 'full' || level === 'full-middle').length;
    const middle = all.filter((level) => level.includes('middle')).length;
    expect(full).toBe(slots.full);
    expect(middle).toBe(slots.middle);
    expect(slots).toEqual({ full: 2, middle: 6, ranked: 8 });
    // The fade of the last band needs the distance of one tree beyond it.
    expect(all.lastIndexOf('middle-impostor') + 2).toBe(slots.ranked);
  });

  it('has no band and no middle level in the hard swap, which is the control', () => {
    expect(levels(8, HARD_SWAP_TREE_LEVELS)).toEqual([
      ...Array<TreeLevel>(6).fill('full'),
      'impostor',
      'impostor',
    ]);
    expect(treeSlots(HARD_SWAP_TREE_LEVELS)).toEqual({ full: 6, middle: 0, ranked: 6 });
  });
});

describe('a band tree’s fade — #617', () => {
  it('is where the tree sits between its neighbours', () => {
    expect(bandFade(1, [10, 12, 20], 3)).toBeCloseTo(0.2, 12);
    expect(bandFade(1, [10, 18, 20], 3)).toBeCloseTo(0.8, 12);
  });

  it('is continuous across a swap with the tree in front, and with the tree behind', () => {
    // Tree B at rank 1 closes on tree A at rank 0: its fade goes to 0 — drawn
    // as A is — and after they swap A is at rank 1 with the same fade.
    const before = bandFade(1, [10, 10.001, 20], 3);
    const after = bandFade(1, [10.001, 10.002, 20], 3);
    expect(before).toBeLessThan(0.001);
    expect(after).toBeLessThan(0.001);
    // And at the far side: closing on the tree behind, the fade goes to 1.
    expect(bandFade(1, [10, 19.999, 20], 3)).toBeGreaterThan(0.999);
    expect(bandFade(1, [10, 20, 20.001], 3)).toBeGreaterThan(0.999);
  });

  it('is 0 for the nearest band and measures from the rider when it is rank 0', () => {
    expect(bandFade(0, [5, 10], 2)).toBeCloseTo(0.5, 12);
  });

  it('is 0 where no tree stands behind it, or where its neighbours stand together', () => {
    expect(bandFade(1, [10, 15], 2)).toBe(0);
    expect(bandFade(1, [10, 10, 10], 3)).toBe(0);
  });
});

describe('what a level keeps of the screen — #617', () => {
  const kept = (keep: 'all' | 'nearer' | 'further', fade: number): ((h: number) => boolean) => {
    const into = new Float32Array(3);
    writeKeep(into, 0, keep, fade);
    const [low, high] = [into[0] ?? 0, into[1] ?? 0];
    // The shader's rule: low >= high keeps everything.
    return (h) => !(high > low) || (h >= low && h < high);
  };

  it('keeps every fragment for a tree at one level', () => {
    for (const h of [0, 0.3, 0.999]) expect(kept('all', 0.4)(h)).toBe(true);
  });

  it('splits the screen between a band tree’s two levels, exactly once each', () => {
    for (const fade of [0, 0.25, 0.5, 0.9, 1]) {
      const nearer = kept('nearer', fade);
      const further = kept('further', fade);
      for (let h = 0; h < 1; h += 1 / 64) {
        expect(nearer(h) !== further(h), `fade ${String(fade)}, hash ${String(h)}`).toBe(true);
      }
    }
  });

  it('draws the nearer level whole at a fade of 0 and the further one whole at 1', () => {
    for (let h = 0; h < 1; h += 1 / 16) {
      expect(kept('nearer', 0)(h)).toBe(true);
      expect(kept('further', 1)(h)).toBe(true);
    }
  });

  it('writes into its own instance and no other', () => {
    const into = new Float32Array(9).fill(7);
    writeKeep(into, 1, 'nearer', 0.25);
    expect([...into]).toEqual([7, 7, 7, 0.25, 2, 0, 7, 7, 7]);
  });
});
