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
 * ⚠️ **`&motion=on`, always.** Every other spec on `reflow.html` gets the
 * fade at no duration (`reflow-harness.tsx` §`applyMotionSetting`), so the
 * layout walks do not pay 200 ms a navigation.
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
    /** Called, once, in the task that starts the next view transition. */
    __oylOnViewTransitionStart?: () => void;
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
    const hook = window.__oylOnViewTransitionStart;
    window.__oylOnViewTransitionStart = undefined;
    hook?.();
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

/** What one animation frame showed, sampled by {@link sampleFrames}. */
interface Frame {
  /**
   * `'commit'` for a sample taken when the DOM changed — a mutation observer's
   * callback, which runs at the end of the task React committed in, after its
   * layout effects and before any passive effect it schedules — and `'frame'`
   * for one taken in an animation frame.
   */
  source: 'commit' | 'frame';
  /** Since the navigation. */
  ms: number;
  /** Whether a view transition was live just BEFORE the navigation (first frame only). */
  fadingBefore: boolean;
  heading: string;
  focus: string;
  title: string;
  fading: boolean;
  /**
   * Animations still RUNNING on a `::view-transition` pseudo-element. A skipped
   * transition's animations stay in `getAnimations()` for a frame as
   * `finished`, so the play state is what says the tree is still drawn.
   */
  pseudoAnimations: number;
  /** The first control in `main` whose centre is in the viewport, by its text. */
  control: string;
  /** Whether that control hit-tests as itself at its own centre. */
  hitsControl: boolean;
}

/**
 * Runs in the page: navigates to `hash`, then records what the page shows at
 * every change to the DOM and in every animation frame until `untilMs` have
 * passed.
 */
async function sampleFrames({
  hash,
  untilMs,
  inside,
}: {
  hash: string;
  untilMs: number;
  /**
   * A menu route to navigate to FIRST: `hash` is then asked for in the task
   * in which that navigation's view transition starts, while it is still
   * preparing — the old page captured, the update not yet run.
   */
  inside?: string;
}): Promise<Frame[]> {
  const frames: Frame[] = [];
  let fadingBefore = false;
  let started = performance.now();
  const navigate = (): void => {
    fadingBefore = document.activeViewTransition !== null;
    started = performance.now();
    window.location.hash = hash;
  };
  if (inside === undefined) {
    navigate();
  } else {
    // In a microtask, so React has finished the commit that started the
    // transition. The browser fires `hashchange` in a task of its own, which
    // may come after the transition has finished preparing, so it is fired
    // here as well: the router reads the new address while the transition is
    // certainly still preparing, and the browser's own event finds nothing
    // left to change.
    window.__oylOnViewTransitionStart = () => {
      queueMicrotask(() => {
        navigate();
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
    };
    window.location.hash = inside;
  }
  await new Promise<void>((resolve) => {
    const sample = (source: Frame['source']): void => {
      const control = [
        ...document.querySelectorAll<HTMLElement>('main button, main a[href], main input'),
      ].find((element) => {
        const box = element.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        return box.width > 0 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
      });
      let hitsControl = false;
      if (control !== undefined) {
        const box = control.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        hitsControl = hit !== null && control.contains(hit);
      }
      frames.push({
        source,
        ms: performance.now() - started,
        fadingBefore,
        heading: document.querySelector('h1')?.textContent ?? '',
        focus: document.activeElement?.id ?? '',
        title: document.title,
        fading: document.activeViewTransition !== null,
        pseudoAnimations: document
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === 'running' &&
              (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
                '::view-transition',
              ) === true,
          ).length,
        control: control?.textContent?.trim() ?? '',
        hitsControl,
      });
    };
    const observer = new MutationObserver(() => {
      sample('commit');
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    const frame = (): void => {
      sample('frame');
      if (performance.now() - started > untilMs) {
        observer.disconnect();
        resolve();
      } else {
        requestAnimationFrame(frame);
      }
    };
    requestAnimationFrame(frame);
  });
  return frames;
}

/** What one frame showed of a list–detail route's focus, sampled by {@link watchFocus}. */
interface FocusFrame {
  ms: number;
  selectedHeading: boolean;
  focusedHeading: boolean;
  listShown: boolean;
  /** The `data-oyl-select` of the focused element, or null. */
  focusedItem: string | null;
  fading: boolean;
}

declare global {
  interface Window {
    __oylFocusFrames?: Promise<FocusFrame[]>;
  }
}

/**
 * Runs in the page: starts recording what every animation frame shows of a
 * list–detail route's focus for 600 ms, so the navigation can be made by real
 * input after it returns. {@link focusFrames} reads the result.
 */
function watchFocus(): void {
  const frames: FocusFrame[] = [];
  const started = performance.now();
  window.__oylFocusFrames = new Promise((resolve) => {
    const sample = (): void => {
      const heading = document.getElementById('oyl-selected-heading');
      const list = document.querySelector<HTMLElement>('[data-oyl-pane="list"]');
      frames.push({
        ms: performance.now() - started,
        selectedHeading: heading !== null,
        focusedHeading: heading !== null && document.activeElement === heading,
        listShown: list !== null && !list.hidden,
        focusedItem: document.activeElement?.getAttribute('data-oyl-select') ?? null,
        fading: document.activeViewTransition !== null,
      });
      if (performance.now() - started > 600) {
        resolve(frames);
      } else {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  });
}

async function focusFrames(page: Page): Promise<FocusFrame[]> {
  const frames = await page.evaluate(() => window.__oylFocusFrames);
  if (frames === undefined) {
    throw new Error('no focus frames were recorded');
  }
  return frames;
}

async function open(page: Page, query: string): Promise<void> {
  await page.addInitScript(recordViewTransitions);
  await page.setViewportSize({ width: 1280, height: 800 });
  const response = await page.goto(`/reflow.html?data=populated&motion=on${query}#/`);
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
    // ⚠️ Every transition measured, and at least one: `every` over an empty
    // list is true, so a page that animated nothing would otherwise pass.
    expect(started).toBe(1);
    expect(longest).toHaveLength(started);
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

  test('focus and the title move in the commit that changes the route, while the fade still runs', async ({
    page,
  }) => {
    // #945's review: under a transition React runs PASSIVE effects only once
    // the fade has finished, so focus and the title must be layout effects
    // (`AppShell.tsx`). Sampled every frame from the navigation: the first
    // frame that shows the new route's heading must already have both, and
    // must be inside the fade — or this measured nothing a rider waits for.
    await open(page, '');
    const target = routeById('activities');
    const frames = await page.evaluate(sampleFrames, {
      hash: hrefFor(target),
      untilMs: 3 * MOTION_DURATION_MS.medium,
    });
    // The moment the heading changed: the commit itself, not a later frame —
    // a frame can come after a long task in which passive effects ran too.
    const first = frames.find(
      (frame) => frame.source === 'commit' && frame.heading === target.title,
    );
    expect(first, 'the new route never showed its heading').toBeDefined();
    console.log(`#945: the route changed ${String(first?.ms)} ms after the navigation`, first);
    expect(first?.fading, 'no fade was running when the route changed').toBe(true);
    expect(first?.focus).toBe('oyl-main');
    expect(first?.title.startsWith(target.title)).toBe(true);
  });

  for (const phase of ['preparing', 'animating'] as const) {
    test(`a ride route asked for while a menu fade is ${phase} ends the fade, so Ride is pressed as itself`, async ({
      page,
    }) => {
      // #945's review (safety). While a menu fade runs the page is a
      // snapshot. A synchronous navigation to Ride must not wait behind it or
      // commit under it: `useRoute.ts` §`endRunningFade` skips it first.
      // Measured on Chromium 153, without that skip: asked for while the fade
      // is PREPARING, Ride committed only after hundreds of ms, after the
      // fade; while it is ANIMATING the browser had already ended it by the
      // commit. Both are held, the first is the one the skip is for.
      await open(page, '');
      const ride = routeById('ride');
      const menu = hrefFor(routeById('activities'));
      // The race is the browser's and React's, not ours: without the skip,
      // Ride asked for while the fade prepares waited for it in about two
      // attempts in three (8 of 12 single-attempt runs, locally). So it is
      // tried six times over, from Home each time.
      const attempts = phase === 'preparing' ? 6 : 1;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) {
          await page.evaluate(
            (hash) => {
              window.location.hash = hash;
            },
            hrefFor(routeById('home')),
          );
          await expect(page.locator('h1')).toHaveText(routeById('home').title);
        }
        let frames: Frame[];
        if (phase === 'preparing') {
          frames = await page.evaluate(sampleFrames, {
            hash: hrefFor(ride),
            untilMs: 3 * MOTION_DURATION_MS.medium,
            inside: menu,
          });
        } else {
          await page.evaluate((hash) => {
            window.location.hash = hash;
          }, menu);
          await page.waitForFunction(
            () =>
              document
                .getAnimations()
                .some(
                  (animation) =>
                    animation.playState === 'running' &&
                    (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
                      '::view-transition',
                    ) === true,
                ),
            undefined,
            { polling: 'raf' },
          );
          frames = await page.evaluate(sampleFrames, {
            hash: hrefFor(ride),
            untilMs: 3 * MOTION_DURATION_MS.medium,
          });
        }
        expect(
          frames.at(-1)?.fadingBefore,
          'no menu fade was running when Ride was asked for',
        ).toBe(true);
        // Held twice: at the COMMIT that puts Ride in the DOM — the first frame
        // can come after a long task, by which time a 200 ms fade has ended by
        // itself and the check would pass over the defect — and in the first
        // FRAME that shows Ride, which is what a rider sees and presses.
        for (const source of ['commit', 'frame'] as const) {
          const first = frames.find(
            (frame) => frame.source === source && frame.heading === ride.title,
          );
          expect(first, `Ride never showed its heading (${source})`).toBeDefined();
          console.log(
            `#945: Ride showed ${String(first?.ms)} ms after it was asked for (${phase}, ${source})`,
            first,
          );
          if (source === 'commit') {
            // Before the menu's fade would have ended by itself: without the skip,
            // Ride is not committed until it has.
            expect(first?.ms ?? Infinity, 'Ride waited for the menu fade').toBeLessThan(
              MOTION_DURATION_MS.medium,
            );
          }
          expect(first?.fading, `a view transition was still live over Ride (${source})`).toBe(
            false,
          );
          expect(
            first?.pseudoAnimations,
            `::view-transition animations still running (${source})`,
          ).toBe(0);
          expect(first?.control, `Ride rendered no control in the viewport (${source})`).not.toBe(
            '',
          );
          expect(
            first?.hitsControl,
            `Ride's first control (${first?.control ?? ''}) hit-tests as something else (${source})`,
          ).toBe(true);
        }
      }
    });
  }

  test('#670 with motion on: Enter on a card focuses its heading, and Back the card, in the frame each lands, with no fade', async ({
    page,
  }) => {
    // The list–detail focus cases in `list-detail.browser.spec.ts` run with
    // the fade at no duration (`reflow-harness.tsx` §`applyMotionSetting`).
    // This is one of them with the fade at the 200 ms a rider gets. Choosing
    // an item, and Back, stay on ONE route, and `AppShell`'s
    // `<ViewTransition>` is keyed by route with `update="none"`: so neither
    // fades, and `ListDetail`'s focus moves (passive effects) are not held
    // back behind one. Measured, not assumed — the count below is zero, and
    // focus is where #670 puts it in the frame each lands. A change that made
    // a selection cross-fade would fail both.
    await page.addInitScript(recordViewTransitions);
    await page.setViewportSize({ width: 390, height: 844 });
    const activities = routeById('activities');
    const response = await page.goto(`/reflow.html?data=populated&motion=on${hrefFor(activities)}`);
    expect(response?.status()).toBe(200);
    await page.waitForFunction(() => window.__oylReflow !== undefined);
    const item = page.locator('[data-oyl-pane="list"] a[data-oyl-select]').first();
    await expect(item).toBeVisible();
    const id = await item.getAttribute('data-oyl-select');
    expect(id).not.toBeNull();
    await item.focus();
    const before = (await log(page)).started;

    // Enter on the card.
    await page.evaluate(watchFocus);
    await page.keyboard.press('Enter');
    const chosen = await focusFrames(page);
    const opened = chosen.find((frame) => frame.selectedHeading);
    expect(opened, 'the chosen item never showed its heading').toBeDefined();
    console.log(`#945/#670: the detail showed ${String(opened?.ms)} ms after Enter`, opened);
    expect(opened?.focusedHeading, 'focus was not on the heading when it appeared').toBe(true);

    // Back to the list.
    await page.evaluate(watchFocus);
    await page.goBack();
    const back = await focusFrames(page);
    const listed = back.find((frame) => !frame.selectedHeading && frame.listShown);
    expect(listed, 'the list never came back').toBeDefined();
    console.log(`#945/#670: the list showed ${String(listed?.ms)} ms after Back`, listed);
    expect(listed?.focusedItem, 'focus was not on the card when the list came back').toBe(id);

    // Neither is a cross-fade: a selection is an update inside the route's
    // `<ViewTransition>`, which animates no update.
    expect((await log(page)).started - before).toBe(0);
    expect(opened?.fading).toBe(false);
    expect(listed?.fading).toBe(false);
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
