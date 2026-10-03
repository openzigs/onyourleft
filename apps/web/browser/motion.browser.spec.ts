// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The route cross-fade — #945.
 *
 * The menus cross-fade between routes with React 19.3's `<ViewTransition>`
 * (`shell/AppShell.tsx`), which runs the browser's own View Transition API.
 * This spec counts the transitions the PAGE starts: an init script wraps
 * `Document.prototype.startViewTransition` before any application module runs,
 * and records each call, whether its `finished` settled, and the duration of
 * every animation the document holds once the transition is `ready`.
 *
 * ## Why counting, and why a control
 *
 * React starts a view transition only for an update inside `startTransition`
 * (or a Suspense reveal). The router used to apply every change of fragment
 * through `useSyncExternalStore`, whose updates are synchronous — so wrapping
 * the routes in `<ViewTransition>` alone animates nothing, and passes every
 * test that does not count. `reflow.html?routes=synchronous` is that router
 * (`shell/useRoute.ts` §`RouteUpdates`), and the same navigation must count
 * ZERO there: without it, "one transition" could be a transition some other
 * update started.
 *
 * ## Never on a ride route
 *
 * While a transition runs the page is a snapshot and a press does not reach
 * the control under it (`shell/route-motion.ts`). Home → Ride, Ride → Home,
 * Home → game and game → Home must each start none.
 *
 * ## What it does NOT prove
 *
 * That the fade looks right — there is no reference image (ADR 0009), and the
 * duration is read off the animations rather than off pixels. Nothing about
 * the Android WebView, where #945 says the API has been available since
 * Chrome 111; the owner's tablet is WebView 153.
 */

import { expect, test, type Page } from '@playwright/test';

import { MOTION_DURATION_MS } from '../src/design/tokens';
import { hrefFor, routeById, type RouteId } from '../src/shell/routes';

interface TransitionLog {
  started: number;
  settled: number;
  /** The longest animation `document.getAnimations()` held at each `ready`, in ms. */
  longest: number[];
}

declare global {
  interface Window {
    __oylViewTransitions?: TransitionLog;
  }
}

/** Runs before any page script: wraps the one call React makes to start a transition. */
function recordViewTransitions(): void {
  const log: TransitionLog = { started: 0, settled: 0, longest: [] };
  window.__oylViewTransitions = log;
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with `apply` below, on the document it was called on.
  const original = Document.prototype.startViewTransition;
  Document.prototype.startViewTransition = function (
    this: Document,
    ...parameters: Parameters<Document['startViewTransition']>
  ): ViewTransition {
    const transition = original.apply(this, parameters);
    log.started += 1;
    const settle = (): void => {
      log.settled += 1;
    };
    transition.finished.then(settle, settle);
    transition.ready.then(
      () => {
        const durations = document.getAnimations().map((animation) => {
          const duration = animation.effect?.getComputedTiming().duration;
          return typeof duration === 'number' ? duration : 0;
        });
        log.longest.push(Math.max(0, ...durations));
      },
      () => undefined,
    );
    return transition;
  };
}

async function open(page: Page, query: string): Promise<void> {
  await page.addInitScript(recordViewTransitions);
  await page.setViewportSize({ width: 1280, height: 800 });
  const response = await page.goto(`/reflow.html?data=populated${query}#/`);
  expect(response?.status()).toBe(200);
  await page.waitForFunction(() => window.__oylReflow !== undefined);
  expect(await page.evaluate(() => window.__oylReflow?.errors)).toEqual([]);
  await expect(page.locator('h1')).toHaveText(routeById('home').title);
}

async function log(page: Page): Promise<TransitionLog> {
  const read = await page.evaluate(() => window.__oylViewTransitions);
  if (read === undefined) {
    throw new Error('the init script did not run: no transition log on the page');
  }
  return read;
}

/** Navigates by setting the fragment, waits for the route's heading, and for any transition to end. */
async function go(page: Page, id: RouteId): Promise<TransitionLog> {
  await page.evaluate(
    (hash) => {
      window.location.hash = hash;
    },
    hrefFor(routeById(id)),
  );
  await expect(page.locator('h1')).toHaveText(routeById(id).title);
  await expect
    .poll(async () => {
      const now = await log(page);
      return now.settled === now.started;
    })
    .toBe(true);
  return log(page);
}

async function counted(page: Page, id: RouteId): Promise<number> {
  const before = (await log(page)).started;
  return (await go(page, id)).started - before;
}

test.describe('the route cross-fade — #945', () => {
  test('Home → Activities starts exactly one view transition', async ({ page }) => {
    await open(page, '');
    expect(await counted(page, 'activities')).toBe(1);
  });

  test('control: with every change applied outside startTransition, none starts', async ({
    page,
  }) => {
    await open(page, '&routes=synchronous');
    expect(await counted(page, 'activities')).toBe(0);
  });

  test('never to or from a ride route', async ({ page }) => {
    await open(page, '');
    const counts = {
      'home → ride': await counted(page, 'ride'),
      'ride → home': await counted(page, 'home'),
      'home → game': await counted(page, 'game'),
      'game → home': await counted(page, 'home'),
    };
    expect(counts).toEqual({
      'home → ride': 0,
      'ride → home': 0,
      'home → game': 0,
      'game → home': 0,
    });
    // And the same harness still animates a menu navigation, so the zeros
    // above are the exclusion's and not a page that animates nothing.
    expect(await counted(page, 'activities')).toBe(1);
  });

  test('with each view’s chunk fetched on its first visit, as the product does', async ({
    page,
  }) => {
    // A chunk arriving is a Suspense reveal, which React animates too: a menu
    // navigation must still be ONE transition, not a second for the reveal,
    // and a ride route's reveal after an unanimated navigation must be none.
    await open(page, '&chunks=lazy');
    expect(await counted(page, 'ride')).toBe(0);
    expect(await counted(page, 'home')).toBe(0);
    expect(await counted(page, 'activities')).toBe(1);
  });

  test('is short: every animation it runs lasts the medium motion token', async ({ page }) => {
    await open(page, '');
    await go(page, 'activities');
    const { longest } = await log(page);
    console.log(`#945: the longest view-transition animation ran ${String(longest)} ms`);
    expect(longest).toHaveLength(1);
    expect(longest[0]).toBe(MOTION_DURATION_MS.medium);
  });

  test('reduced motion: at most one transition, and no animation over 1 ms', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '');
    const { started, longest } = await go(page, 'activities');
    expect(started).toBeLessThanOrEqual(1);
    expect(longest.every((ms) => ms <= 1)).toBe(true);
  });

  test('control: with the reduced-motion block deleted, the token’s duration is back', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '');
    const deleted = await page.evaluate(() => {
      let removed = 0;
      for (const sheet of document.styleSheets) {
        const rules = sheet.cssRules;
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          const rule = rules[index];
          if (
            rule instanceof CSSMediaRule &&
            rule.conditionText.includes('prefers-reduced-motion: reduce')
          ) {
            sheet.deleteRule(index);
            removed += 1;
          }
        }
      }
      return removed;
    });
    expect(deleted).toBeGreaterThan(0);
    const { longest } = await go(page, 'activities');
    expect(longest).toContain(MOTION_DURATION_MS.medium);
  });

  test('keeps focus: after Home → Activities it is on main, as before', async ({ page }) => {
    await open(page, '');
    await go(page, 'activities');
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('oyl-main');
  });

  test('a view whose chunk fails still offers Reload, and leaves no transition hanging', async ({
    page,
  }) => {
    await open(page, '&chunks=lazy');
    // After the page has started, so only the History group's own chunk —
    // fetched on its first visit under `?chunks=lazy` — is refused.
    const refused: string[] = [];
    await page.route(/\/assets\/history-[^/]*\.js$/, async (route) => {
      refused.push(route.request().url());
      await route.abort();
    });
    await page.evaluate(
      (hash) => {
        window.location.hash = hash;
      },
      hrefFor(routeById('activities')),
    );
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
    expect(
      refused.length,
      'no History chunk was asked for: nothing was made to fail',
    ).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const now = await log(page);
        return now.settled === now.started;
      })
      .toBe(true);
    const { started, settled } = await log(page);
    expect(started, 'no transition started, so none could have hung').toBeGreaterThan(0);
    console.log(
      `#945: a failed chunk started ${String(started)} transition(s), ${String(settled)} settled`,
    );
  });
});
