// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page in the mixed town in the winter lights — #1626:
 * every mapped front door wears a wreath, drawn by the facade's program on
 * the door's own quad (`three-renderer.ts` §`WREATH_GLSL`), so it costs no
 * call and no triangle. With `levers=-facade-wreath` the wreath's uniform is
 * 0 whatever the holiday, and the frame must draw exactly what it drew.
 *
 * The control that the frame has mapped doors at all is #1657's, on this very
 * hold (`realistic-town.browser.spec.ts` §"the mapped-blobs lever"): its
 * mapped buildings' ground blobs come off with `-mapped-blobs`.
 *
 * ⚠️ **A file of its own, run in the trees' nightly shard**, because the
 * town's shard holds as many loads of the page as its stop allows
 * (`nightly-split.test.ts`, #1698; docs/agents/ci.md §4c §"Four nightly
 * browser shards — #1698").
 */

import { expect, test } from '@playwright/test';

import { NIGHTLY } from './nightly';
import { REALISTIC_LOAD_BUDGET_MS, ride } from './realistic-ride';

/** #1657's hold in the mixed town, the people off, on 20 Dec. */
const WREATHED = '?ladder=0&panel=0&seconds=1&town=mixed&at=1300&date=2026-12-20&levers=-people';

test.describe('the realistic page’s mapped doors’ wreath — #1626', { tag: NIGHTLY }, () => {
  test('draws the wreath on every mapped front door in no call and no triangle', async ({
    page,
  }) => {
    test.setTimeout(2 * REALISTIC_LOAD_BUDGET_MS);
    const wreathed = await ride(page, WREATHED);
    const bare = await ride(page, `${WREATHED},-facade-wreath`);
    console.log(
      `#1626 town=mixed: ${String(wreathed.result.lastFrame.calls)} draw calls and ` +
        `${String(wreathed.result.lastFrame.triangles)} triangles wreathed, ` +
        `${String(bare.result.lastFrame.calls)} and ${String(bare.result.lastFrame.triangles)} ` +
        'with `-facade-wreath`',
    );
    expect(wreathed.result.leversOff).toEqual(['people']);
    expect(bare.result.leversOff).toEqual(['facade-wreath', 'people']);
    expect(bare.result.rung).toBe(wreathed.result.rung);
    expect(wreathed.result.lastFrame.calls).toBe(bare.result.lastFrame.calls);
    expect(wreathed.result.lastFrame.triangles).toBe(bare.result.lastFrame.triangles);
  });
});
