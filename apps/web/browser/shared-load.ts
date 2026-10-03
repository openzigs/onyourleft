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
 * 37131982824), where the measuring took a few milliseconds. This is
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
 * depends on (the page, the viewport and the query at least): two cases that
 * share a key share a page.
 *
 * ## What it holds, and for how long
 *
 * One page, in one context, per worker process. A different key closes the
 * previous context first, so a spec whose cases are grouped by key — every
 * `describe` that uses this is — loads once per group and holds one page at a
 * time. Playwright runs one file's cases in order in one worker (this config is
 * not `fullyParallel`), which is what makes the grouping the ORDER the cases
 * run in. A spec that uses this registers {@link releaseSharedPage} as its
 * `afterAll`, so the page goes when the file's cases do.
 *
 * ⚠️ **Module state, and deliberately not a worker-scoped fixture.** The first
 * version was a worker fixture, and Playwright gives a file that uses a worker
 * fixture of its own a worker of its own: `ride.browser.spec.ts` and
 * `rideview.browser.spec.ts` were queued after every other `chromium` spec, ran
 * beside the `game` group the config queues last, and the game's `?shadow-map`
 * load ran out of its 70 s budget on PR #1075's first run (37155138130). A
 * module-level holder changes no worker hash, so every spec keeps its place in
 * the queue.
 *
 * ⚠️ **A failure does not cascade.** Playwright replaces a worker process after
 * a failing case, and this module's state lives in that process, so the next
 * case in the group loads afresh rather than reading a page a red case left
 * behind. A load that throws is not remembered either: the key is held only
 * once the load has resolved.
 *
 * The context is made with `browser.newContext()` from inside the case that
 * first asks, so it carries that case's options exactly as the `page` fixture's
 * would — `baseURL`, `storageState` (`playwright.config.ts`
 * §`FOLLOW_THE_DEVICE`), `colorScheme`, the viewport — and a case that sets an
 * option the load depends on must put it in the key.
 */

import type { Browser, BrowserContext, Page } from '@playwright/test';

interface Held {
  readonly key: string;
  readonly context: BrowserContext;
  readonly page: Page;
}

let held: Held | undefined;
let loads = 0;
let served = 0;

/**
 * The page `load` left for `key`, loading it first in a new context of
 * `browser` if the page held is for a different key, or there is none.
 */
export async function sharedPage(
  browser: Browser,
  key: string,
  load: (page: Page) => Promise<void>,
): Promise<Page> {
  served += 1;
  if (held?.key === key) {
    return held.page;
  }
  const previous = held;
  held = undefined;
  await previous?.context.close();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await load(page);
    held = { key, context, page };
    loads += 1;
    return page;
  } catch (error) {
    await context.close();
    throw error;
  }
}

/** Close the page held, if any, and say how much loading it saved. For `test.afterAll`. */
export async function releaseSharedPage(): Promise<void> {
  const previous = held;
  held = undefined;
  await previous?.context.close();
  if (served > 0) {
    console.log(
      `#1051 shared loads: ${String(loads)} load(s) served ${String(served)} case(s) in this worker`,
    );
  }
  loads = 0;
  served = 0;
}
