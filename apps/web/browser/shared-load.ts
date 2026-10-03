// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One load of a harness page, read by every case that only READS it — #1051.
 *
 * ## Why
 *
 * The browser gate opens a fresh page for nearly every case, and on the CI
 * runner that load is most of a short case's time: `ride.browser.spec.ts`'s
 * nine overlay viewports each ran nine cases that loaded `ride.html` at the same
 * size and then only measured it, at about 0.45 s a case on an EPYC 7763 (run
 * 37131982824), where the measuring took a fraction of that. This is
 * `game.browser.spec.ts`' #456 move — load once, let every case read the
 * result — made small enough to use in any spec: a case asks for a page by a
 * KEY and a load, and gets the page the last case with that key left, or a new
 * one when the key changed.
 *
 * ## The rule a caller keeps
 *
 * ⚠️ **Only a case that changes nothing on the page may share it.** A case that
 * strips a class, sets an inset, scrolls, presses a key, focuses or clicks
 * takes Playwright's own `page` and loads its own, exactly as before — a
 * control above all, because a control that ran on a page an earlier case had
 * already broken would prove nothing. The key must name EVERYTHING the load
 * depends on (the viewport and the query at least): two cases that share a key
 * share a page.
 *
 * ## What it holds, and for how long
 *
 * One page, in one context, per worker. A different key closes the previous
 * context first, so a spec whose cases are grouped by key — every `describe`
 * here is — loads once per group and holds one page at a time. Playwright runs
 * one file's cases in order in one worker (this config is not `fullyParallel`),
 * which is what makes the grouping the ORDER the cases run in.
 *
 * ⚠️ **A failure does not cascade.** Playwright replaces a worker after a
 * failing case, and the holder is worker-scoped, so the next case in the group
 * loads afresh in a new worker rather than reading a page a red case left
 * behind. A load that throws is not remembered either: the key is held only
 * once the load has resolved.
 *
 * The context is made with `browser.newContext()` from inside the case that
 * first asks, so it carries that case's options exactly as the `page` fixture's
 * would — `baseURL`, `storageState` (`playwright.config.ts`
 * §`FOLLOW_THE_DEVICE`), `colorScheme`, the viewport — and a case that sets an
 * option the load depends on must put it in the key.
 */

import { test as base, type BrowserContext, type Page } from '@playwright/test';

/** What a case is handed. */
export interface SharedLoad {
  /**
   * The page `load` left for `key`, loading it first if the worker's current
   * page is for a different key or there is none.
   */
  readonly open: (key: string, load: (page: Page) => Promise<void>) => Promise<Page>;
}

interface Held {
  readonly key: string;
  readonly context: BrowserContext;
  readonly page: Page;
}

interface Holder {
  held: Held | undefined;
  /** How many loads this worker made, and how many cases it served — printed once. */
  loads: number;
  served: number;
}

export const test = base.extend<{ sharedLoad: SharedLoad }, { sharedLoadHolder: Holder }>({
  sharedLoadHolder: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring, and this fixture needs nothing.
    async ({}, use) => {
      const holder: Holder = { held: undefined, loads: 0, served: 0 };
      await use(holder);
      await holder.held?.context.close();
      if (holder.served > 0) {
        console.log(
          `#1051 shared loads: ${String(holder.loads)} load(s) served ${String(holder.served)} case(s) in this worker`,
        );
      }
    },
    { scope: 'worker' },
  ],
  sharedLoad: async ({ browser, sharedLoadHolder: holder }, use) => {
    await use({
      open: async (key, load) => {
        holder.served += 1;
        if (holder.held?.key === key) {
          return holder.held.page;
        }
        const previous = holder.held;
        holder.held = undefined;
        await previous?.context.close();
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await load(page);
          holder.held = { key, context, page };
          holder.loads += 1;
          return page;
        } catch (error) {
          await context.close();
          throw error;
        }
      },
    });
  },
});

export { expect } from '@playwright/test';
