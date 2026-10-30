// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The owner's realistic page's tree levers, in the pinned Chromium — #1283,
 * #1294 and #1523; in a file of their own since #1698.
 *
 * `?levers=-generated-trees` loads every tree's scan INSTEAD of the generated
 * ones, and since #1294 `?levers=-generated-conifers` the scanned firs alone —
 * read off the files the page fetches, so a lever that changed a label and
 * loaded the same trees is seen — with each frame's triangles and draw calls
 * printed, which are the figures validation 0002's #1283 and #1294 rows start
 * from. And #1523's `?levers=-fir-prepass` takes the firs' depth pre-passes
 * out of the same held frame, and nothing else.
 *
 * ⚠️ **Until #1698 this describe was in `realistic.browser.spec.ts`**, which
 * one nightly job ran alone until its loads outgrew the job's 840 s stop. This
 * file is a nightly job of its own (docs/agents/ci.md §4c §"Four nightly
 * browser shards — #1698"); `realistic-ride.ts` is the load it shares with the
 * page's other two spec files.
 */

import { expect, test } from '@playwright/test';

import {
  REALISTIC_BROADLEAVES,
  REALISTIC_CONIFERS,
  type RealisticModel,
} from '../src/game/realistic-assets';
import { REALISTIC_WOODED_DRAW_CALLS } from '../src/game/realistic-budget';

import { NIGHTLY } from './nightly';
import { FRAME_DRAW_CALLS_AT_2550, HELD, REALISTIC_LOAD_BUDGET_MS, ride } from './realistic-ride';

/**
 * The most draw calls the owner's page may REPORT held at `at=2550` with the
 * trees a ride draws: **34**, one under `REALISTIC_WOODED_DRAW_CALLS`.
 *
 * ⚠️ **#1294's criterion names 33** — "at or under 33 at `at=2550`", the
 * figure #1289 left it at — and a reviewer who remembers 33 is reading the
 * page before #1523. #1523 draws each fir mesh after a depth-only pre-pass,
 * which is three calls on this frame ({@link FRAME_DRAW_CALLS_AT_2550}); with
 * `levers=-fir-prepass` the frame makes the 31 it made before. It is the
 * page's own `drawCalls`, a mean over its window, and is asserted, as is the
 * frame's own count below.
 */
const PAGE_DRAW_CALLS_AT_2550 = 34;

/**
 * #1523: the same held frame with `levers=-fir-prepass`: **31**, the figure
 * #1294 measured — so the three calls above are the pre-passes and nothing
 * else.
 */
const FRAME_DRAW_CALLS_WITHOUT_PREPASS = 31;

test.describe('the realistic page’s tree levers — #1283, #1294', { tag: NIGHTLY }, () => {
  test('loads the generated trees, or with a lever off the scans it names, and never both', async ({
    page,
  }) => {
    test.setTimeout(3 * REALISTIC_LOAD_BUDGET_MS);

    const fetched: string[] = [];
    page.on('request', (request) => {
      const file = /\/realistic\/([^/?]+)$/.exec(new URL(request.url()).pathname)?.[1];
      if (file !== undefined) fetched.push(file);
    });
    const filesOf = (models: readonly RealisticModel[]): readonly string[] =>
      models.flatMap((model) =>
        [model.file, model.middle, model.impostor, model.impostorNormals].filter(
          (file): file is string => file !== undefined,
        ),
      );
    const treesOf = (set: 'generated' | 'scanned'): readonly string[] =>
      filesOf(REALISTIC_BROADLEAVES[set]);
    const firsOf = (set: 'generated' | 'scanned'): readonly string[] =>
      filesOf(REALISTIC_CONIFERS[set]);

    const generated = await ride(page, HELD);
    const withGenerated = [...fetched];
    // The product's trees: every generated file, and not one of the scans'.
    for (const file of treesOf('generated')) expect(withGenerated, file).toContain(file);
    for (const file of treesOf('scanned')) expect(withGenerated, file).not.toContain(file);
    for (const file of firsOf('generated')) expect(withGenerated, file).toContain(file);
    for (const file of firsOf('scanned')) expect(withGenerated, file).not.toContain(file);
    expect(generated.result.leversOff).toEqual([]);

    // #1294's lever: the scanned firs, beside the generated broadleaves.
    fetched.length = 0;
    const scannedFirs = await ride(page, `${HELD}&levers=-generated-conifers`);
    const withScannedFirs = [...fetched];
    for (const file of firsOf('scanned')) expect(withScannedFirs, file).toContain(file);
    for (const file of firsOf('generated')) expect(withScannedFirs, file).not.toContain(file);
    for (const file of treesOf('generated')) expect(withScannedFirs, file).toContain(file);
    for (const file of treesOf('scanned')) expect(withScannedFirs, file).not.toContain(file);
    expect(scannedFirs.result.leversOff).toEqual(['generated-conifers']);
    expect(scannedFirs.result.rung).toBe(generated.result.rung);

    // #1283's lever: every tree's scan, and no generated tree.
    fetched.length = 0;
    const scanned = await ride(page, `${HELD}&levers=-generated-trees`);
    const withScanned = [...fetched];
    for (const file of treesOf('scanned')) expect(withScanned, file).toContain(file);
    for (const file of treesOf('generated')) expect(withScanned, file).not.toContain(file);
    for (const file of firsOf('scanned')) expect(withScanned, file).toContain(file);
    for (const file of firsOf('generated')) expect(withScanned, file).not.toContain(file);
    expect(scanned.result.leversOff).toEqual(['generated-trees']);
    // The lever chooses trees and nothing else: the rung does not move.
    expect(scanned.result.rung).toBe(generated.result.rung);

    const calls = (run: typeof generated): string =>
      `${String(run.result.lastFrame.calls)} draw calls a frame (the page's mean ${String(run.result.drawCalls)})`;
    console.log(
      `#1294 at=2550, held: ${String(generated.result.lastFrame.triangles)} triangles in ` +
        `${calls(generated)} with every tree generated; ` +
        `${String(scannedFirs.result.lastFrame.triangles)} in ${calls(scannedFirs)} ` +
        `with the scanned firs; ${String(scanned.result.lastFrame.triangles)} in ` +
        `${calls(scanned)} with every tree a scan. Textures held: ` +
        `${String(generated.page.textures?.bytes)} bytes, ${String(scannedFirs.page.textures?.bytes)} ` +
        `and ${String(scanned.page.textures?.bytes)}`,
    );
    // Different trees are different frames — and each step toward generated
    // is lighter, here where most of the trees in view are conifers.
    expect(generated.result.lastFrame.triangles).toBeLessThan(
      scannedFirs.result.lastFrame.triangles,
    );
    expect(scannedFirs.result.lastFrame.triangles).toBeLessThanOrEqual(
      scanned.result.lastFrame.triangles,
    );
    // All inside #639's ceiling, which did not move; and less texture memory
    // held at each step. ⚠️ With THREE seeds a species, as #1283 was first
    // written, the page's mean was 35 of 35 on a Mac and 34 on the CI runner —
    // which is why there are two (#1289's review).
    //
    // #1294: the generated firs are two shapes where the scanned firs were
    // two, so the FRAME makes the calls it made: {@link FRAME_DRAW_CALLS_AT_2550},
    // and at or under the scanned firs' own frame, call for call.
    expect(generated.result.lastFrame.calls).toBeGreaterThan(0);
    expect(generated.result.lastFrame.calls).toBeLessThanOrEqual(FRAME_DRAW_CALLS_AT_2550);
    expect(generated.result.lastFrame.calls).toBeLessThanOrEqual(
      scannedFirs.result.lastFrame.calls,
    );
    // The issue's own criterion, on the figure it names: the page's mean. The
    // rider and the ladder are held, so every frame of the window is this
    // frame, and a mean that is not the frame's count has counted something
    // that is not the window: the warm-up, and the first render in it.
    expect(generated.result.drawCalls).toBeLessThanOrEqual(PAGE_DRAW_CALLS_AT_2550);
    for (const run of [generated, scannedFirs, scanned]) {
      expect(run.result.drawCalls).toBe(run.result.lastFrame.calls);
    }
    expect(scannedFirs.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    expect(scanned.result.lastFrame.calls).toBeLessThanOrEqual(REALISTIC_WOODED_DRAW_CALLS);
    expect(PAGE_DRAW_CALLS_AT_2550).toBeLessThan(REALISTIC_WOODED_DRAW_CALLS);
    expect(generated.page.textures?.bytes ?? Infinity).toBeLessThan(
      scannedFirs.page.textures?.bytes ?? 0,
    );
    expect(scannedFirs.page.textures?.bytes ?? Infinity).toBeLessThan(
      scanned.page.textures?.bytes ?? 0,
    );
  });

  test('draws a depth pre-pass for each fir mesh, and with #1523’s lever off the frame #1294 drew', async ({
    page,
  }) => {
    test.setTimeout(2 * REALISTIC_LOAD_BUDGET_MS);
    const drawn = await ride(page, HELD);
    const off = await ride(page, `${HELD}&levers=-fir-prepass`);
    console.log(
      `#1523 at=2550, held: ${String(drawn.result.lastFrame.calls)} draw calls and ` +
        `${String(drawn.result.lastFrame.triangles)} triangles with the firs' pre-pass; ` +
        `${String(off.result.lastFrame.calls)} and ${String(off.result.lastFrame.triangles)} without`,
    );
    expect(drawn.result.leversOff).toEqual([]);
    expect(off.result.leversOff).toEqual(['fir-prepass']);
    // The lever takes the pre-passes out and nothing else: the frame #1294 drew.
    expect(off.result.lastFrame.calls).toBe(FRAME_DRAW_CALLS_WITHOUT_PREPASS);
    expect(drawn.result.lastFrame.calls).toBe(FRAME_DRAW_CALLS_AT_2550);
    // At most one call for each fir mesh — two shapes at two levels — and the
    // triangles of the firs drawn twice.
    expect(drawn.result.lastFrame.calls - off.result.lastFrame.calls).toBeGreaterThan(0);
    expect(drawn.result.lastFrame.calls - off.result.lastFrame.calls).toBeLessThanOrEqual(
      2 * REALISTIC_CONIFERS.generated.length,
    );
    expect(drawn.result.lastFrame.triangles).toBeGreaterThan(off.result.lastFrame.triangles);
    // The lever chooses the pre-pass and nothing else: the rung does not move.
    expect(off.result.rung).toBe(drawn.result.rung);
  });
});
