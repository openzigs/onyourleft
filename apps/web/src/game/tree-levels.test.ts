// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { HARD_SWAP_TREE_LEVELS, REALISTIC_TREE_LEVELS } from './realistic-budget';
import {
  bandFade,
  HAND_OVER_PATIENCE_FRAMES,
  highBound,
  lowBound,
  treeLevelAt,
  treeSlots,
  TreeHandOver,
  writeInterval,
  type TreeLevel,
  type TreeLevels,
} from './tree-levels';

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
  const kept = (from: number, to: number): ((h: number) => boolean) => {
    const into = new Float32Array(3);
    writeInterval(into, 0, from, to);
    const [low, high] = [into[0] ?? 0, into[1] ?? 0];
    // The shader's rule: low >= high keeps everything.
    return (h) => !(high > low) || (h >= low && h < high);
  };

  it('keeps every fragment for a tree at one level', () => {
    for (const h of [0, 0.3, 0.999]) expect(kept(0, 1)(h)).toBe(true);
  });

  it('splits the screen between a tree’s levels, exactly once each', () => {
    for (const [low, high] of [
      [0, 0.25],
      [0.5, 1],
      [0.2, 0.7],
      [0, 0],
      [1, 1],
      [0.3, 0.3],
    ] as const) {
      const levels = [kept(0, low), kept(low, high), kept(high, 1)];
      const present = [low > 0, high > low, high < 1];
      for (let h = 0; h < 1; h += 1 / 64) {
        const owners = levels.filter((keeps, at) => present[at] === true && keeps(h)).length;
        expect(owners, `[${String(low)}, ${String(high)}), hash ${String(h)}`).toBe(1);
      }
    }
  });

  it('writes a band tree’s keeps as the shader has always read them', () => {
    const into = new Float32Array(9).fill(7);
    writeInterval(into, 1, 0.25, 1);
    expect([...into]).toEqual([7, 7, 7, 0.25, 2, 0, 7, 7, 7]);
    writeInterval(into, 1, 0, 0.25);
    expect([...into]).toEqual([7, 7, 7, -1, 0.25, 0, 7, 7, 7]);
    writeInterval(into, 1, 0, 1);
    expect([...into]).toEqual([7, 7, 7, 0, 0, 0, 7, 7, 7]);
  });

  it('puts each level’s split where the table says', () => {
    expect([lowBound('full', 0.3), highBound('full', 0.3)]).toEqual([0, 0]);
    expect([lowBound('full-middle', 0.3), highBound('full-middle', 0.3)]).toEqual([0, 0.3]);
    expect([lowBound('middle', 0.3), highBound('middle', 0.3)]).toEqual([0, 1]);
    expect([lowBound('middle-impostor', 0.3), highBound('middle-impostor', 0.3)]).toEqual([0.3, 1]);
    expect([lowBound('impostor', 0.3), highBound('impostor', 0.3)]).toEqual([1, 1]);
  });
});

/** A tree in a {@link frame}: its name, which stands in for its position, and its distance. */
interface Tree {
  readonly id: number;
  readonly d: number;
}

/**
 * One frame of the belt's own sequence, without the belt: rank the trees
 * nearest first, aim each ranked one at its level, carry the rest, settle.
 * Returns every tree's split, `[low, high]`, by name.
 */
function frame(
  handOver: TreeHandOver,
  trees: readonly Tree[],
  levels: TreeLevels = REALISTIC_TREE_LEVELS,
): Map<number, readonly [number, number]> {
  const sorted = [...trees].sort((a, b) => a.d - b.d);
  const { ranked } = treeSlots(levels);
  const ranks = sorted.slice(0, ranked);
  const distances = ranks.map((tree) => tree.d);
  handOver.begin();
  const entries = ranks.map((tree, rank) => {
    const level = treeLevelAt(rank, levels);
    const fade =
      level === 'full-middle' || level === 'middle-impostor'
        ? bandFade(rank, distances, distances.length)
        : 0;
    return handOver.aim(tree.id, 0, lowBound(level, fade), highBound(level, fade));
  });
  for (const tree of sorted.slice(ranked)) handOver.carry(tree.id, 0);
  handOver.settle();
  const out = new Map<number, readonly [number, number]>();
  sorted.forEach((tree, at) => {
    const entry = at < ranked ? (entries[at] ?? -1) : handOver.find(tree.id, 0);
    out.set(tree.id, entry < 0 ? [1, 1] : [handOver.low(entry), handOver.high(entry)]);
  });
  return out;
}

/** The largest change in any tree's split between two frames, over the trees in both. */
function largestChange(
  before: Map<number, readonly [number, number]>,
  after: Map<number, readonly [number, number]>,
): number {
  let largest = 0;
  for (const [id, [low, high]] of after) {
    const was = before.get(id);
    if (was === undefined) continue;
    largest = Math.max(largest, Math.abs(low - was[0]), Math.abs(high - was[1]));
  }
  return largest;
}

/** How many trees draw the full mesh, and how many the middle one. */
function using(splits: Map<number, readonly [number, number]>): {
  full: number;
  middle: number;
} {
  let full = 0;
  let middle = 0;
  for (const [low, high] of splits.values()) {
    if (high < 1) full += 1;
    if (high > low) middle += 1;
  }
  return { full, middle };
}

const handOverFor = (levels: TreeLevels = REALISTIC_TREE_LEVELS): TreeHandOver => {
  const slots = treeSlots(levels);
  return new TreeHandOver(slots, 2 * slots.ranked, levels.handOverFrames);
};
const STEP = 1 / REALISTIC_TREE_LEVELS.handOverFrames + 1e-9;

describe('the hand-over when the ranked SET changes — #617’s review', () => {
  // The review's own example: the 8 m tree is band A at (8 − 5)/(12 − 5).
  const trees: Tree[] = [5, 8, 12, 17, 23, 30, 38, 47, 57].map((d) => ({ id: d, d }));
  const withoutNearest = trees.slice(1);

  it('walks every tree to its new level when the nearest leaves, a step a frame', () => {
    const handOver = handOverFor();
    let last = frame(handOver, trees);
    expect(last.get(8)?.[1]).toBeCloseTo(3 / 7, 12);
    let largest = 0;
    for (let at = 0; at < 40; at += 1) {
      const next = frame(handOver, withoutNearest);
      largest = Math.max(largest, largestChange(last, next));
      last = next;
    }
    expect(largest).toBeLessThanOrEqual(STEP);
    // And it arrives: the 8 m tree is the full mesh, the 12 m one the band.
    expect(last.get(8)).toEqual([0, 0]);
    expect(last.get(12)?.[1]).toBeCloseTo((12 - 8) / (17 - 8), 12);
  });

  it('jumps in one frame when it is not paced, which is the control', () => {
    const control = { ...REALISTIC_TREE_LEVELS, handOverFrames: 1 };
    const handOver = handOverFor(control);
    const first = frame(handOver, trees, control);
    const next = frame(handOver, withoutNearest, control);
    expect(largestChange(first, next)).toBeGreaterThan(0.4);
  });

  it('walks a tree in when one appears nearest, inside the slots', () => {
    const handOver = handOverFor();
    const slots = treeSlots(REALISTIC_TREE_LEVELS);
    let last = frame(handOver, trees);
    let largest = 0;
    for (let at = 0; at < 80; at += 1) {
      const next = frame(handOver, [{ id: 3, d: 3 }, ...trees]);
      largest = Math.max(largest, largestChange(last, next));
      const { full, middle } = using(next);
      expect(full).toBeLessThanOrEqual(slots.full);
      expect(middle).toBeLessThanOrEqual(slots.middle);
      last = next;
    }
    expect(largest).toBeLessThanOrEqual(STEP);
    // A tree seen for the first time mid-ride starts as its impostor, and
    // walks in to the full mesh…
    expect(last.get(3)).toEqual([0, 0]);
    // …and the tree it displaced has reached the band.
    expect(last.get(5)?.[1]).toBeCloseTo((5 - 3) / (8 - 3), 12);
  });

  it('keeps walking a tree out after it has been pushed past the ranks', () => {
    // Two trees appear nearest at once, so the band-B tree — 38 m, part
    // middle — is pushed two ranks out, past the last one ranked.
    const handOver = handOverFor();
    let last = frame(handOver, trees);
    expect(last.get(38)?.[0]).toBeGreaterThan(0);
    expect(last.get(38)?.[1]).toBe(1);
    const crowded = [{ id: 3, d: 3 }, { id: 4, d: 4 }, ...trees];
    let largest = 0;
    for (let at = 0; at < 80; at += 1) {
      const next = frame(handOver, crowded);
      largest = Math.max(largest, largestChange(last, next));
      last = next;
    }
    expect(largest).toBeLessThanOrEqual(STEP);
    expect(last.get(38)).toEqual([1, 1]);
  });

  it('starts every tree where it belongs on a view’s first frame', () => {
    const first = frame(handOverFor(), trees);
    expect(first.get(5)).toEqual([0, 0]);
    expect(first.get(12)).toEqual([0, 1]);
    expect(first.get(57)).toEqual([1, 1]);
  });

  it('never draws more trees at a level than its slots, on a road that keeps changing', () => {
    const slots = treeSlots(REALISTIC_TREE_LEVELS);
    const handOver = handOverFor();
    // A seeded road: every tree closes 0.3 m a frame and leaves at 2 m; new
    // ones appear anywhere from 3 m to 80 m.
    let seed = 617;
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    let next = 1;
    let road: Tree[] = Array.from({ length: 12 }, () => ({ id: next++, d: 3 + random() * 77 }));
    let last = frame(handOver, road);
    let largest = 0;
    for (let at = 0; at < 600; at += 1) {
      road = road.map((tree) => ({ ...tree, d: tree.d - 0.3 })).filter((tree) => tree.d > 2);
      if (random() < 0.15) road.push({ id: next++, d: 3 + random() * 77 });
      const splits = frame(handOver, road);
      const { full, middle } = using(splits);
      expect(full, `frame ${String(at)}`).toBeLessThanOrEqual(slots.full);
      expect(middle, `frame ${String(at)}`).toBeLessThanOrEqual(slots.middle);
      largest = Math.max(largest, largestChange(last, splits));
      last = splits;
    }
    expect(largest).toBeLessThanOrEqual(STEP);
  });

  it('ends a wait on a slot another tree waits on, through the impostor', () => {
    // One full slot and one middle slot: A holds the full mesh and wants the
    // middle one, B the other way round. Each waits on the other.
    const handOver = new TreeHandOver(
      { full: 1, middle: 1 },
      4,
      REALISTIC_TREE_LEVELS.handOverFrames,
    );
    const aim = (a: readonly [number, number], b: readonly [number, number]): void => {
      handOver.begin();
      handOver.aim(1, 0, a[0], a[1]);
      handOver.aim(2, 0, b[0], b[1]);
      handOver.settle();
    };
    aim([0, 0], [0, 1]);
    for (let at = 0; at < HAND_OVER_PATIENCE_FRAMES + 60; at += 1) aim([0, 1], [0, 0]);
    expect([handOver.low(0), handOver.high(0)]).toEqual([0, 1]);
    expect([handOver.low(1), handOver.high(1)]).toEqual([0, 0]);
  });
});

describe('the hand-over’s promises, over seeded roads — #617’s second review', () => {
  /** A seeded stream in [0, 1). */
  const stream = (seed: number): (() => number) => {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  };
  const slots = treeSlots(REALISTIC_TREE_LEVELS);

  it('keeps inside the slots, keeps its edges in order and steps at most a step', () => {
    // 300 roads of 400 frames: trees closing, jumping ±30 m at random (a rank
    // jump), appearing anywhere and leaving — every kind of change to the
    // ranked set, and the patience escape reached over and over.
    const failures: string[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = stream(seed);
      const handOver = handOverFor();
      let next = 1;
      let road: Tree[] = Array.from({ length: 4 + Math.floor(random() * 14) }, () => ({
        id: next++,
        d: 2 + random() * 60,
      }));
      let last = frame(handOver, road);
      for (let at = 0; at < 400; at += 1) {
        road = road
          .map((tree) => {
            const jump = random() < 0.02 ? (random() - 0.5) * 60 : 0;
            return { ...tree, d: Math.max(0.1, tree.d - 0.2 + jump) };
          })
          .filter(() => random() > 0.01);
        if (random() < 0.1) road.push({ id: next++, d: 2 + random() * 60 });
        const splits = frame(handOver, road);
        // Plain comparisons, and one assertion at the end: 120 000 frames.
        const { full, middle } = using(splits);
        let broken = full > slots.full ? `${String(full)} full` : '';
        if (middle > slots.middle) broken = `${String(middle)} middle`;
        for (const [low, high] of splits.values()) {
          if (!(low >= 0 && low <= high && high <= 1)) broken = `[${String(low)}, ${String(high)}]`;
        }
        const step = largestChange(last, splits);
        if (step > STEP) broken = `a step of ${String(step)}`;
        if (broken !== '') failures.push(`seed ${String(seed)}, frame ${String(at)}: ${broken}`);
        last = splits;
      }
    }
    expect(failures.slice(0, 5)).toEqual([]);
  }, 60_000);

  it('arrives where the rank says once the ranking stands still', () => {
    const failures: string[] = [];
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = stream(seed);
      const handOver = handOverFor();
      const road = (): Tree[] =>
        Array.from({ length: 12 }, (_, id) => ({ id, d: 2 + random() * 60 }));
      // Two unrelated rankings in turn, so every tree starts somewhere else.
      frame(handOver, road());
      const settled = road();
      let splits = frame(handOver, settled);
      for (let at = 0; at < 200; at += 1) splits = frame(handOver, settled);
      const sorted = [...settled].sort((a, b) => a.d - b.d);
      const distances = sorted.slice(0, slots.ranked).map((tree) => tree.d);
      sorted.forEach((tree, rank) => {
        const level = treeLevelAt(rank, REALISTIC_TREE_LEVELS);
        const fade =
          level === 'full-middle' || level === 'middle-impostor'
            ? bandFade(rank, distances, distances.length)
            : 0;
        const want: readonly [number, number] =
          rank < slots.ranked ? [lowBound(level, fade), highBound(level, fade)] : [1, 1];
        const got = splits.get(tree.id) ?? [Number.NaN, Number.NaN];
        if (!(Math.abs(got[0] - want[0]) < 1e-12 && Math.abs(got[1] - want[1]) < 1e-12)) {
          failures.push(
            `seed ${String(seed)}, rank ${String(rank)}: ${String(got)} for ${String(want)}`,
          );
        }
      });
    }
    expect(failures.slice(0, 5)).toEqual([]);
  }, 60_000);

  it('waits as its impostor, and takes no slot, when refused both levels for good', () => {
    // A holds the one full slot and B the one middle slot, and neither lets
    // go; C wants a band between the two. Past its patience C must stay its
    // impostor — the escape never walks it into the slots it was refused.
    const handOver = new TreeHandOver({ full: 1, middle: 1 }, 4, 10);
    const aimAll = (withC: boolean): void => {
      handOver.begin();
      handOver.aim(1, 0, 0, 0);
      handOver.aim(2, 0, 0, 1);
      if (withC) handOver.aim(3, 0, 0, 0.5);
      handOver.settle();
    };
    aimAll(false);
    for (let at = 0; at < HAND_OVER_PATIENCE_FRAMES + 40; at += 1) {
      aimAll(true);
      const splits = [0, 1, 2].map((entry) => [handOver.low(entry), handOver.high(entry)]);
      expect(splits.filter(([, high]) => (high ?? 1) < 1).length).toBeLessThanOrEqual(1);
      expect(splits.filter(([low, high]) => (high ?? 1) > (low ?? 1)).length).toBeLessThanOrEqual(
        1,
      );
    }
    expect([handOver.low(2), handOver.high(2)]).toEqual([1, 1]);
  });

  it('tells two trees at one place apart, frame to frame', () => {
    // The scatter keeps trees apart, so this is belt and braces: each entry
    // of the frame before is claimed once, so a second tree at the same place
    // does not take the first one's split — and its slot.
    const handOver = new TreeHandOver({ full: 1, middle: 1 }, 4, 10);
    const both = (): [number, number][] => {
      handOver.begin();
      const a = handOver.aim(7, 0, 0, 0);
      const b = handOver.aim(7, 0, 1, 1);
      handOver.settle();
      return [
        [handOver.low(a), handOver.high(a)],
        [handOver.low(b), handOver.high(b)],
      ];
    };
    expect(both()).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(both()).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});
