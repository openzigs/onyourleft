// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's soak route carries everything validation 0002 Part Z asks the
 * owner to judge on it — #501. It did not: `waterways.ts` laid no lake on its
 * valley floor and `settlements.ts` walled none of its fields in stone, so Z9's
 * walls and Z10's lake were unjudgeable on the page Part Z sends the owner to,
 * and nothing said so. These are asserted over the route itself, through the
 * same generators the page draws with, so a change to `waterways.ts`,
 * `settlements.ts` or the seed cannot take them away again in silence.
 */

import { describe, expect, it } from 'vitest';

import { scatterSeed } from '../../src/game/scatter';
import { structuresAt } from '../../src/game/settlements';
import { corridorOrigin } from '../../src/game/terrain';
import { waterways } from '../../src/game/waterways';
import { realisticRoute } from './route';

const profile = realisticRoute();
const seed = scatterSeed(profile);

describe('the soak route has something for every Part Z step — #501', () => {
  it('crosses a stream on a bridge — Z10', () => {
    expect(waterways(profile, seed).crossings.length).toBeGreaterThanOrEqual(1);
  });

  it('lays a lake beside its valley floor — Z10', () => {
    const { lakes } = waterways(profile, seed);
    expect(lakes.length).toBeGreaterThanOrEqual(1);
    // On the floor, which is level and at the route's lowest.
    for (const lake of lakes) {
      expect(lake.from).toBeGreaterThanOrEqual(780);
      expect(lake.to).toBeLessThanOrEqual(1_900);
    }
  });

  it('walls some of its fields in stone, and hedges and fences others — Z9', () => {
    const counts = new Map<string, number>();
    for (const item of structuresAt(
      profile,
      corridorOrigin(profile),
      seed,
      0,
      profile.totalDistance,
      {
        maxItems: 100_000,
        riderMetres: 0,
      },
    )) {
      counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
    }
    expect(counts.get('wall') ?? 0).toBeGreaterThan(0);
    // The control: walls are not every boundary — the rest are still there to
    // be told apart from them.
    expect(counts.get('hedge') ?? 0).toBeGreaterThan(0);
    expect(counts.get('fence') ?? 0).toBeGreaterThan(0);
    // And there is still somewhere to live.
    expect(counts.get('building') ?? 0).toBeGreaterThan(0);
  });
});
