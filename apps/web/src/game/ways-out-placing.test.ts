// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3119: `scatter.ts` §`WaysOutPlacing`, the rule an open-world ride's scene
 * places its ways out by, on ways written here. That the scene hands every
 * way through it, and what a ride's frames then place, is
 * `open-world/ways-out-placing-wiring.test.tsx`'s.
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';

import { JunctionScan } from './cross-streets';
import { NearbyStreetScan } from './nearby-streets';
import { northRoute } from './route-fixtures-testing';
import { WAYS_PLACED_A_FRAME, WaysOutPlacing, type ScatterWay } from './scatter';
import { sceneFrame } from './scene';
import { anchorScenery } from './scenery-anchor';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';

/** A way whose junction is `junctionMetres` of ride from the start, on a view that starts `startsAt` on the ride. */
function wayAt(junctionMetres: number, startsAt = 0): ScatterWay {
  const profile = northRoute(2_000, () => 0);
  anchorScenery(profile, { seed: 1, origin: startsAt });
  return { profile, fromMetres: junctionMetres - startsAt };
}

describe('the ways out an open-world frame places — #3119', () => {
  it('places every way on the first call, and hands back the array it was handed', () => {
    const placing = new WaysOutPlacing();
    const ways = Array.from({ length: 9 }, (_, index) => wayAt(100 * index));
    expect(placing.placing(ways, 0)).toBe(ways);
    expect(placing.waiting).toBe(0);
    // And again, every one placed.
    expect(placing.placing(ways, 50)).toBe(ways);
  });

  it('then places at most a few new ways a call, the nearest the rider first, keeping every one placed before', () => {
    const placing = new WaysOutPlacing();
    const before = [wayAt(0), wayAt(50)];
    placing.placing(before, 0);
    // Five new ways, handed in an order that is not their distance from a
    // rider at 400 m, on views that start at different places on the ride.
    const far = wayAt(900, 300);
    const near = wayAt(420, 100);
    const behind = wayAt(370);
    const middle = wayAt(600, 500);
    const farther = wayAt(1_200);
    const ways = [...before, far, near, farther, behind, middle];
    const named = new Map<ScatterWay, string>([
      [before[0] as ScatterWay, 'before'],
      [before[1] as ScatterWay, 'before too'],
      [far, 'far'],
      [near, 'near'],
      [farther, 'farther'],
      [behind, 'behind'],
      [middle, 'middle'],
    ]);
    const names = (placed: readonly ScatterWay[]): string[] =>
      placed.map((way) => named.get(way) ?? 'another');
    expect(WAYS_PLACED_A_FRAME).toBe(2);
    // 20 m and 30 m from the rider, in the order handed.
    expect(names(placing.placing(ways, 400))).toStrictEqual([
      'before',
      'before too',
      'near',
      'behind',
    ]);
    expect(placing.waiting).toBe(3);
    // Then 200 m and 500 m.
    expect(names(placing.placing(ways, 400))).toStrictEqual([
      'before',
      'before too',
      'far',
      'near',
      'behind',
      'middle',
    ]);
    expect(placing.waiting).toBe(1);
    // Then the last, 800 m off: every way, and the array handed.
    expect(placing.placing(ways, 400)).toBe(ways);
    expect(placing.waiting).toBe(0);
  });

  it('keeps a way placed through the frames it is not handed', () => {
    const placing = new WaysOutPlacing();
    const kept = wayAt(100);
    placing.placing([kept], 0);
    expect(placing.placing([], 0)).toStrictEqual([]);
    const news = [wayAt(200), wayAt(300), wayAt(400)];
    // Handed again with three new ones: it is placed, and two of them are.
    expect(placing.placing([kept, ...news], 0)).toStrictEqual([kept, news[0], news[1]]);
  });

  it('spends the first call on a frame with no ways too, so a later junction is placed a few a frame', () => {
    // PR #3125's review: a ride whose first frames hand no ways (a countryside
    // start, or streets that come late) placed its first junction whole.
    const placing = new WaysOutPlacing();
    for (let frame = 0; frame < 100; frame += 1) expect(placing.placing([], 0)).toStrictEqual([]);
    const ways = Array.from({ length: 20 }, (_, index) => wayAt(100 * index));
    expect(placing.placing(ways, 0)).toHaveLength(WAYS_PLACED_A_FRAME);
    expect(placing.waiting).toBe(20 - WAYS_PLACED_A_FRAME);
  });

  it('is called by the scene on an open-world frame that hands no ways', () => {
    // The scene's half of the same review finding: its first frames with no
    // ways out are the ride's first frames, and they spend the first call.
    const profile = northRoute(2_000, () => 0);
    const streetScans = {
      nearby: new NearbyStreetScan(),
      junctions: new JunctionScan(),
      ways: new WaysOutPlacing(),
    };
    const start = atStartLine(profile);
    for (const waysOut of [undefined, []]) {
      sceneFrame({
        profile,
        origin: corridorOrigin(profile),
        state: { ...start, ride: { ...start.ride, distance: metres(10) } },
        streetScans,
        waysOut,
      });
    }
    const ways = Array.from({ length: 20 }, (_, index) => wayAt(100 * index));
    expect(streetScans.ways.placing(ways, 0)).toHaveLength(WAYS_PLACED_A_FRAME);
  });
});
