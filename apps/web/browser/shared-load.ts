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
 * ⚠️ **A shared case loses Playwright's own failure artefacts, so this attaches
 * one** (#1075's review, #1076). The config's `screenshot: 'only-on-failure'`
 * shoots the `page` FIXTURE, which a shared case never touched: a red shared
 * case reported a blank page, or none. {@link attachSharedPageOnFailure},
 * registered as the spec's `afterEach`, attaches a screenshot of the page the
 * case actually read when the case did not end as expected; and a load that
 * throws attaches the page it left before its context is closed. Attaching
 * never replaces the failure: a screenshot that cannot be taken is skipped.
 *
 * The context is made with `browser.newContext()` from inside the case that
 * first asks, so it carries that case's options exactly as the `page` fixture's
 * would — `baseURL`, `storageState` (`playwright.config.ts`
 * §`FOLLOW_THE_DEVICE`), `colorScheme`, the viewport — and a case that sets an
 * option the load depends on must put it in the key.
 */

import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';

interface Held {
  readonly key: string;
  readonly context: BrowserContext;
  readonly page: Page;
}

let held: Held | undefined;
let loads = 0;
let served = 0;
/** The case that last asked for the page held — the one a screenshot is for. */
let readBy: string | undefined;

/**
 * The page `load` left for `key`, loading it first in a new context of
 * `browser` if the page held is for a different key, or there is none.
 */
export async function sharedPage(
  browser: Browser,
  key: string,
  load: (page: Page) => Promise<void>,
  testInfo: Pick<TestInfo, 'testId' | 'attach'>,
): Promise<Page> {
  served += 1;
  readBy = testInfo.testId;
  if (held?.key === key) {
    return held.page;
  }
  const previous = held;
  held = undefined;
  await previous?.context.close();
  const context = await browser.newContext();
  let page: Page | undefined;
  try {
    page = await context.newPage();
    await load(page);
    held = { key, context, page };
    loads += 1;
    return page;
  } catch (error) {
    if (page !== undefined) {
      await attachScreenshot(page, testInfo, `the shared load of ${key}, which threw`);
    }
    await context.close();
    throw error;
  }
}

/**
 * Attach a screenshot of the page held to a case that did not end as it was
 * expected to. For `test.afterEach`, in every spec that shares a load.
 */
export async function attachSharedPageOnFailure(
  testInfo: Pick<TestInfo, 'testId' | 'status' | 'expectedStatus' | 'attach'>,
): Promise<void> {
  // Only the page THIS case read: a case that took its own `page` has
  // Playwright's own screenshot, and the page held is some other case's.
  if (testInfo.status === testInfo.expectedStatus || held === undefined) return;
  if (readBy !== testInfo.testId) return;
  await attachScreenshot(held.page, testInfo, `the shared page ${held.key}`);
}

async function attachScreenshot(
  page: Page,
  testInfo: Pick<TestInfo, 'attach'>,
  name: string,
): Promise<void> {
  if (page.isClosed()) return;
  let body: Buffer;
  try {
    // Bounded (#1078): `playwright.config.ts` sets no `actionTimeout`, so an
    // unbounded screenshot waits out the whole hook's budget, and a page hung
    // enough to fail a case is the likeliest to hang here as well.
    body = await page.screenshot({ timeout: 5_000 });
  } catch {
    // A page that cannot be drawn any more says nothing a screenshot could;
    // the case's own failure is the report.
    return;
  }
  await testInfo.attach(name, { body, contentType: 'image/png' });
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
  readBy = undefined;
}
