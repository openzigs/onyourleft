// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What each rung of the realistic ladder submits, on a page already loaded —
 * #3282.
 *
 * The ladder has five realistic rungs, each shedding one named thing
 * (`quality.ts` §`REALISTIC_LADDER`). `quality-rungs.test.ts` holds which
 * fields each rung changes and that the view reads them; this holds what that
 * does to a frame the real view draws: the page's held frame is drawn at each
 * rung in turn (`realistic-harness.ts` §`__oylRealisticRungs`), and its draw
 * calls and triangles, counted at the WebGL entry points, may never rise from
 * one rung to the next and must fall where the frame holds what the rung
 * sheds.
 *
 * ⚠️ **No load of its own, and so no case of its own.** A case of its own
 * would be a load of the page, and a load needs more than the 60 s a case is
 * given — and a per-case timeout is ruled out (#1688). So it rides on two
 * loads the nightly shards already make: #616's wooded hold
 * (`realistic.browser.spec.ts`) and #1689's decorated village hold
 * (`realistic-town.browser.spec.ts`). The walk draws at a 320 × 180 canvas,
 * the page's own 16:9 shape, so its frames are the cheap ones: calls and
 * triangles are the shape's to decide, not the size's (`realistic-ride.ts`
 * §`SIXTEENTH_PAGE`).
 *
 * ⚠️ **What it does not prove**: anything about the tablet's frame time, which
 * is what the rungs are FOR — validation 0002 Part AL, taken by the owner on
 * a moving ride, with the owner's screenshots of each rung.
 */

import { expect, type Page } from '@playwright/test';

import type { RungCost } from './realistic-harness';

/**
 * How many times each rung's frame is drawn before it is counted: three times
 * `REALISTIC_TREE_LEVELS.handOverFrames`, so a tree moved down a level by
 * rung 3 has finished its hand-over, and the mapped buildings' refill a reach
 * change asks for has run.
 */
const FRAMES_A_RUNG = 30;

/**
 * How many rungs the realistic ladder has — `quality.ts` §`REALISTIC_LADDER`,
 * written down rather than imported: `quality.ts` reaches the scenery models'
 * PNG, which a spec's loader cannot read. `quality-rungs.test.ts` holds the
 * ladder to the same five.
 */
const REALISTIC_RUNGS = 5;

/**
 * The loaded page's held frame drawn at every realistic rung, and held to
 * what a rung may do: drawn in the realistic world at every rung, in the
 * ladder's order, never more calls or triangles than the rung above, and
 * fewer triangles at every rung named in `falls`.
 */
export async function holdsEveryRung(
  page: Page,
  scene: string,
  falls: readonly number[],
): Promise<readonly RungCost[]> {
  const costs = await page.evaluate(
    (frames) => window.__oylRealisticRungs?.(frames) ?? [],
    FRAMES_A_RUNG,
  );
  console.log(
    `#3282 ${scene}: ` +
      costs
        .map(
          (cost, at) => `${String(at)} ${String(cost.calls)} calls ${String(cost.triangles)} tris`,
        )
        .join(' · '),
  );
  // Every rung, top first, each its own: the page walked the product's ladder.
  expect(costs).toHaveLength(REALISTIC_RUNGS);
  expect(costs[0]?.rung).toBe('realistic');
  expect(costs.at(-1)?.rung).toBe('realistic, reduced resolution and scenery');
  expect(new Set(costs.map((cost) => cost.rung)).size).toBe(REALISTIC_RUNGS);
  for (const cost of costs) expect(cost.world, cost.rung).toBe('realistic');
  // Non-vacuity: the top rung drew a world.
  expect(costs[0]?.triangles ?? 0).toBeGreaterThan(0);
  for (let at = 1; at < costs.length; at += 1) {
    const above = costs[at - 1] as RungCost;
    const below = costs[at] as RungCost;
    expect(below.calls, `${scene} rung ${String(at)}'s calls`).toBeLessThanOrEqual(above.calls);
    expect(below.triangles, `${scene} rung ${String(at)}'s triangles`).toBeLessThanOrEqual(
      above.triangles,
    );
    if (falls.includes(at)) {
      expect(below.triangles, `${scene} rung ${String(at)} sheds nothing it draws`).toBeLessThan(
        above.triangles,
      );
    }
  }
  return costs;
}
