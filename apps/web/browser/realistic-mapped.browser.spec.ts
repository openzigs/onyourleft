// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page in a mapped town, in the pinned Chromium — #1657
 * and #1636; in a file of their own since the combined PR that brought #1636
 * and #1689 into `realistic-town.browser.spec.ts` together, which took that
 * file past the 7 loads a nightly shard may hold (`nightly-split.test.ts`,
 * #1698).
 *
 * - **The mapped-blobs lever** (#1657): `levers=-mapped-blobs` takes the
 *   mapped buildings' ground blobs out of the mixed town's frame, and nothing
 *   else.
 * - **The city centre** (#1636): `town=city`, held between its two towers,
 *   draws its shop fronts and its tower inside the page's 35 calls.
 *
 * This file's nightly describes are a job of their own (docs/agents/ci.md §4c
 * §"Four nightly browser shards — #1698", whose fifth shard this is);
 * `realistic-ride.ts` is the load it shares with the page's other files.
 */

import { expect, test } from '@playwright/test';

import { GROUND_BLOB_TRIANGLES } from '../src/game/ground-blob';
import { MAPPED_BUILDING_MAX, REALISTIC_WOODED_DRAW_CALLS } from '../src/game/realistic-budget';

import { NIGHTLY } from './nightly';
import { REALISTIC_LOAD_BUDGET_MS, ride } from './realistic-ride';

test.describe('the realistic page’s mapped-blobs lever — #1657', { tag: NIGHTLY }, () => {
  test('grounds the mixed town’s buildings, and with the lever off draws none of their blobs', async ({
    page,
  }) => {
    test.setTimeout(2 * REALISTIC_LOAD_BUDGET_MS);
    // Inside #1581's mixed town, held; the people off, so that nothing but
    // the lever differs between the two frames.
    const town = '?ladder=0&panel=0&seconds=1&town=mixed&at=1300&levers=-people';
    const grounded = await ride(page, town);
    const off = await ride(page, `${town},-mapped-blobs`);
    const added = grounded.result.lastFrame.triangles - off.result.lastFrame.triangles;
    console.log(
      `#1657 town=mixed at=1300: ${String(grounded.result.lastFrame.triangles)} triangles in ` +
        `${String(grounded.result.lastFrame.calls)} draw calls grounded, ` +
        `${String(off.result.lastFrame.triangles)} in ${String(off.result.lastFrame.calls)} ` +
        `with the lever off: ${String(added / GROUND_BLOB_TRIANGLES)} mapped blobs`,
    );
    expect(grounded.result.leversOff).toEqual(['people']);
    expect(off.result.leversOff).toEqual(['mapped-blobs', 'people']);
    // The lever reaches the blobs: off, the frame draws fewer, a quad each,
    // and at most one a mapped building.
    expect(added).toBeGreaterThan(0);
    expect(added % GROUND_BLOB_TRIANGLES).toBe(0);
    expect(added).toBeLessThanOrEqual(MAPPED_BUILDING_MAX * GROUND_BLOB_TRIANGLES);
    // No call of its own: the blobs are the one belt's instances.
    expect(grounded.result.lastFrame.calls - off.result.lastFrame.calls).toBeLessThanOrEqual(1);
    expect(off.result.rung).toBe(grounded.result.rung);
  });
});

test.describe('the realistic page’s city centre — #1636', { tag: NIGHTLY }, () => {
  test('draws a city centre’s shop fronts and its tower inside the page’s 35 calls', async ({
    page,
  }) => {
    test.setTimeout(2 * REALISTIC_LOAD_BUDGET_MS);
    // Inside `cityCentreFixture`'s city, held between its two towers; the
    // people off, so the frame is the city's and the road's.
    for (const at of [1_430, 1_500]) {
      const city = await ride(
        page,
        `?ladder=0&panel=0&seconds=1&town=city&at=${String(at)}&levers=-people`,
      );
      console.log(
        `#1636 town=city at=${String(at)}: ${String(city.result.lastFrame.triangles)} triangles in ` +
          `${String(city.result.lastFrame.calls)} draw calls`,
      );
      expect(city.result.lastFrame.calls).toBeGreaterThan(0);
      expect(city.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    }
    expect(REALISTIC_WOODED_DRAW_CALLS).toBe(35);
  });
});
