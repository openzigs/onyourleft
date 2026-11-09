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

import { PRODUCT_ORIGIN } from '../playwright.config';
import { MOTION_DURATION_MS } from '../src/design/tokens';
import { INTRO_ID } from '../src/shell/intro';
import { hrefFor, routeById, type RouteId } from '../src/shell/routes';

import { NIGHTLY } from './nightly';

interface TransitionLog {
  started: number;
  settled: number;
  /** The longest animation `document.getAnimations()` held at each `ready`, in ms. */
  longest: number[];
  /**
   * #2054: at each `ready`, every `view-transition-class` an element of the
   * page carried — what React's `<ViewTransition>` applied — sorted, and the
   * keyframes each `::view-transition-old`/`-new` other than the root's ran,
   * so the class is read both where it was set and where it took effect.
   */
  classes: string[][];
  keyframes: string[][];
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
  const log: TransitionLog = { started: 0, settled: 0, longest: [], classes: [], keyframes: [] };
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
        const classes = new Set<string>();
        for (const element of document.querySelectorAll('*')) {
          const value = getComputedStyle(element).getPropertyValue('view-transition-class').trim();
          if (value !== '' && value !== 'none') classes.add(value);
        }
        log.classes.push([...classes].sort());
        log.keyframes.push(
          document
            .getAnimations()
            .filter(
              (animation) =>
                // Not the root's snapshot, which keeps the browser's own fade.
                /^::view-transition-(old|new)\((?!root\))/.test(
                  (animation.effect as KeyframeEffect | null)?.pseudoElement ?? '',
                ) && animation instanceof CSSAnimation,
            )
            .map((animation) => (animation as CSSAnimation).animationName)
            .sort(),
        );
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
  dispatchNow,
}: {
  hash: string;
  untilMs: number;
  /**
   * A menu route to navigate to FIRST: `hash` is then asked for in the task
   * in which that navigation's view transition starts, while it is still
   * preparing — the old page captured, the update not yet run.
   */
  inside?: string;
  /**
   * Fire `hashchange` in the task that sets `hash`, as `inside` does, so the
   * router hears of the navigation at once (#2239). The browser's own
   * `hashchange` is a task of its own. When the renderer stalls before that
   * task runs, Chromium draws a frame first, and that frame still shows the
   * menu fading, because the router has not heard of Ride yet. That is the
   * browser's scheduling, not the router's.
   */
  dispatchNow?: boolean;
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
    if (dispatchNow === true) {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
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
  /** Animations still RUNNING on a `::view-transition` pseudo-element: a fade being painted. */
  pseudoAnimations: number;
}

declare global {
  interface Window {
    __oylFocusFrames?: Promise<FocusFrame[]>;
  }
}

/**
 * Runs in the page: starts recording what every animation frame shows of a
 * list–detail route's focus for 1.5 s, so the navigation can be made by real
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
        pseudoAnimations: document
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === 'running' &&
              (animation.effect as KeyframeEffect | null)?.pseudoElement?.startsWith(
                '::view-transition',
              ) === true,
          ).length,
      });
      if (performance.now() - started > 1500) {
        resolve(frames);
      } else {
        requestAnimationFrame(sample);
      }
    };
    requestAnimationFrame(sample);
  });
}

/**
 * Focus reached what #670 puts it on, and no fade stood between the change
 * showing and focus arriving: every frame from the one the change first
 * showed in up to the one focus landed in had no view transition live and no
 * `::view-transition` animation running. ⚠️ Not in that same frame —
 * `ListDetail`'s focus moves are passive effects, as they were before #945,
 * and on the CI runner a frame can fall between the commit and them (run
 * 37161938329).
 *
 * #1487: this used to say "within a fade's length" as elapsed milliseconds,
 * and a loaded runner took 422 ms with no fade at all (run 39360199249). What
 * holds focus back is a fade — React runs passive effects only once it has
 * finished — so the frames are what is asserted, not the clock. A fade a
 * starved runner painted in no sampled frame is still caught by the caller's
 * count of view transitions started.
 */
function expectFocusSoonAfter(
  frames: FocusFrame[],
  shown: FocusFrame | undefined,
  focused: (frame: FocusFrame) => boolean,
  what: string,
): void {
  const from = shown === undefined ? -1 : frames.indexOf(shown);
  const landed = from < 0 ? -1 : frames.findIndex((frame, at) => at >= from && focused(frame));
  expect(landed, `focus never reached ${what}`).toBeGreaterThanOrEqual(0);
  const waited = frames.slice(from, landed + 1);
  expect(
    waited.filter((frame) => frame.fading || frame.pseudoAnimations > 0),
    `focus reached ${what} only after a fade`,
  ).toStrictEqual([]);
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

/*
 * The cross-fade itself — that a menu navigation starts exactly one view
 * transition (with its control) and that it lasts the medium motion token —
 * runs NIGHTLY since #1137, on the owner's ruling of 2026-10-05 (`nightly.ts`).
 * Everything else in #945 stays in the required describe below: the
 * reduced-motion pair, the ride routes that must never fade or be pressed
 * through a fade (each with its own count of a menu fade as a control), focus
 * and the title under a fade, and a failed chunk leaving no transition hanging.
 */
test.describe('the route cross-fade — #945, how it runs', { tag: NIGHTLY }, () => {
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

  test('is short: every animation it runs lasts the medium motion token', async ({ page }) => {
    await open(page, '');
    await go(page, 'activities');
    const { longest } = await log(page);
    console.log(`#945: the longest view-transition animation ran ${String(longest)} ms`);
    expect(longest).toHaveLength(1);
    expect(longest[0]).toBe(MOTION_DURATION_MS.medium);
  });
});

test.describe('the route cross-fade — #945', () => {
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
            dispatchNow: true,
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
            // Before the menu's fade would have ended by itself: without the
            // skip, Ride is not committed until it has. Counted in frames, not
            // milliseconds (#2239, as #1487 did for focus above). No frame drawn
            // before Ride's commit may show the fade. A stalled runner then
            // costs time but fails nothing, and a Ride that waited behind the
            // fade is drawn behind it in every frame until it commits.
            const waited = frames
              .slice(0, first === undefined ? 0 : frames.indexOf(first))
              .filter(
                (frame) => frame.source === 'frame' && (frame.fading || frame.pseudoAnimations > 0),
              );
            expect(waited, 'Ride waited for the menu fade').toStrictEqual([]);
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

  test('#670 with motion on: Enter on a card focuses its heading, and Back the card, with no fade', async ({
    page,
  }) => {
    // The list–detail focus cases in `list-detail.browser.spec.ts` run with
    // the fade at no duration (`reflow-harness.tsx` §`applyMotionSetting`).
    // This is one of them with the fade at the 200 ms a rider gets. Choosing
    // an item, and Back, stay on ONE route, and `AppShell`'s
    // `<ViewTransition>` is keyed by route with `update="none"`: so neither
    // fades, and `ListDetail`'s focus moves (passive effects) are not held
    // back behind one. Measured, not assumed — the count below is zero, and
    // focus is where #670 puts it with no fade painted between each change
    // showing and focus arriving (#1487: frames, not elapsed ms). A change
    // that made a selection cross-fade fails both.
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
    expectFocusSoonAfter(chosen, opened, (frame) => frame.focusedHeading, 'the heading');

    // Back to the list.
    await page.evaluate(watchFocus);
    await page.goBack();
    const back = await focusFrames(page);
    const listed = back.find((frame) => !frame.selectedHeading && frame.listShown);
    expect(listed, 'the list never came back').toBeDefined();
    console.log(`#945/#670: the list showed ${String(listed?.ms)} ms after Back`, listed);
    expectFocusSoonAfter(back, listed, (frame) => frame.focusedItem === id, 'the card');

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

/** What the first-paint intro did on one cold load, recorded by {@link recordIntro}. */
interface IntroLog {
  /** Whether `#oyl-intro` was in the document as it loaded. */
  present: boolean;
  /** Every animation on the intro or inside it once its way out began, by name, with its duration in ms. */
  animations: { name: string; ms: number }[];
}

declare global {
  interface Window {
    __oylIntro?: IntroLog;
  }
}

/**
 * Runs before any page script: when anything sets the intro's
 * `data-oyl-intro`, reads every animation on it and inside it from
 * `getAnimations()`. Read there, in the observer's microtask straight after
 * the attribute is set, rather than from `animationstart`: an animation the
 * reduced-motion block collapses to 0.01 ms finishes, and the intro is
 * removed, before the browser dispatches that event, so a listener would see
 * nothing and pass. With `slowerMs`, also lays a rule over the intro's that
 * runs its way out at that duration: the control that says a slow intro is
 * seen.
 */
function recordIntro({ id, slowerMs }: { id: string; slowerMs: number | null }): void {
  const log: IntroLog = { present: false, animations: [] };
  window.__oylIntro = log;
  document.addEventListener('DOMContentLoaded', () => {
    log.present = document.getElementById(id) !== null;
    if (slowerMs !== null) {
      const style = document.createElement('style');
      style.textContent = `#${id}[data-oyl-intro], #${id}[data-oyl-intro] * { animation-duration: ${String(slowerMs)}ms !important; }`;
      document.head.append(style);
    }
  });
  new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      if (!(target instanceof HTMLElement) || target.id !== id) continue;
      for (const animation of target.getAnimations({ subtree: true })) {
        const duration = animation.effect?.getComputedTiming().duration;
        log.animations.push({
          name: animation instanceof CSSAnimation ? animation.animationName : 'not a CSS animation',
          ms: typeof duration === 'number' ? duration : Number.NaN,
        });
      }
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-oyl-intro'] });
}

/** A cold load of the product on `id`, through to the intro having left the page. */
async function coldLoad(
  page: Page,
  id: RouteId,
  slowerMs: number | null = null,
): Promise<IntroLog> {
  await page.addInitScript(recordIntro, { id: INTRO_ID, slowerMs });
  await page.setViewportSize({ width: 1280, height: 800 });
  const response = await page.goto(`${PRODUCT_ORIGIN}/${hrefFor(routeById(id))}`);
  expect(response?.status()).toBe(200);
  await page.waitForFunction((intro) => document.getElementById(intro) === null, INTRO_ID);
  const read = await page.evaluate(() => window.__oylIntro);
  if (read === undefined) throw new Error('the init script did not run: no intro log on the page');
  // ⚠️ Every case below needs the intro to have been THERE: a page without
  // one animates nothing, and would pass the "none runs" cases for that reason.
  expect(read.present, 'index.html carried no intro').toBe(true);
  return read;
}

/** The intro's animations that ran longer than the motion ceiling. */
function overCeiling(log: IntroLog): { name: string; ms: number }[] {
  return log.animations.filter((animation) => !(animation.ms <= MOTION_DURATION_MS.medium));
}

/*
 * The first-paint intro — #2053. Against the PRODUCT build: the intro is in
 * `index.html`, which no harness page carries. `shell/intro.ts` and
 * `theme.css` §"THE FIRST-PAINT INTRO" are the code; these read what the
 * browser actually ran, from `getAnimations()` as each animation started.
 */
test.describe('the first-paint intro — #2053', () => {
  test('a cold load of Home runs it, and every animation is at most 200 ms', async ({ page }) => {
    const log = await coldLoad(page, 'home');
    console.log('#2053: the intro ran', log.animations);
    // The canvas fading and the mark growing: both, so neither goes unmeasured.
    expect(log.animations.map((animation) => animation.name).sort()).toEqual([
      'oyl-intro-mark-out',
      'oyl-intro-out',
    ]);
    expect(log.animations.every((animation) => animation.ms > 0)).toBe(true);
    expect(overCeiling(log)).toEqual([]);
    await expect(page.locator('h1')).toHaveText(routeById('home').title);
  });

  test('control: run at 400 ms, the same reading finds it over the ceiling', async ({ page }) => {
    const log = await coldLoad(page, 'home', 400);
    expect(overCeiling(log).map((animation) => animation.ms)).toEqual([400, 400]);
  });

  test('a cold load of a ride route runs none', async ({ page }) => {
    // The intro was there (`coldLoad`) and has gone, and nothing animated it out.
    expect((await coldLoad(page, 'ride')).animations).toEqual([]);
  });

  test('a cold load of the game runs none', async ({ page }) => {
    expect((await coldLoad(page, 'game')).animations).toEqual([]);
  });

  test('under prefers-reduced-motion: reduce, none runs', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect((await coldLoad(page, 'home')).animations).toEqual([]);
    await expect(page.locator('h1')).toHaveText(routeById('home').title);
  });
});

/** The populated harness's one segment (`testing/populated-shell.tsx`). */
const SEGMENT = hrefFor(routeById('segment-detail'), 'the-drag');

/** Navigates to `hash`, waits for `title` in the `h1`, and for any transition to end. */
async function goTo(page: Page, hash: string, title: string): Promise<TransitionLog> {
  await page.evaluate((next) => {
    window.location.hash = next;
  }, hash);
  await expect(page.locator('h1')).toHaveText(title);
  await expect
    .poll(async () => {
      const now = await log(page);
      return now.settled === now.started;
    })
    .toBe(true);
  return log(page);
}

/** What the transition each navigation started applied: its classes and its keyframes. */
async function applied(
  page: Page,
  hash: string,
  title: string,
): Promise<{ started: number; classes: string[]; keyframes: string[]; longest: number }> {
  const before = (await log(page)).started;
  const after = await goTo(page, hash, title);
  return {
    started: after.started - before,
    classes: after.classes.at(-1) ?? [],
    keyframes: after.keyframes.at(-1) ?? [],
    longest: after.longest.at(-1) ?? Number.NaN,
  };
}

/*
 * Directional route transitions — #2054. Into a page below and back out of it
 * is a short slide; one tab to another stays #945's cross-fade.
 * `shell/route-motion.ts` §`navigationKind` decides, `useRoute.ts` announces
 * it with `addTransitionType`, `AppShell`'s `<ViewTransition>` sets the class
 * and `theme.css` §"THE ROUTE SLIDE" names the keyframes. Read here at each
 * transition's `ready`, both as the class an element carried and as the
 * keyframes the pseudo-elements ran.
 */
test.describe('directional route transitions — #2054', () => {
  test('list to detail, detail back, and tab to tab each apply their own class', async ({
    page,
  }) => {
    await open(page, '');
    const segments = routeById('segments');
    const detail = routeById('segment-detail');
    await goTo(page, hrefFor(segments), segments.title);
    const deeper = await applied(page, SEGMENT, detail.title);
    const back = await applied(page, hrefFor(segments), segments.title);
    const across = await applied(page, hrefFor(routeById('routes')), routeById('routes').title);
    console.log('#2054: deeper, back, across', deeper, back, across);
    for (const navigation of [deeper, back, across]) {
      expect(navigation.started).toBe(1);
      expect(navigation.longest).toBeLessThanOrEqual(MOTION_DURATION_MS.medium);
    }
    expect(deeper.classes).toEqual(['oyl-route-deeper']);
    expect(back.classes).toEqual(['oyl-route-back']);
    expect(across.classes).toEqual(['oyl-route']);
    expect(deeper.keyframes).toEqual(['oyl-route-in-from-end', 'oyl-route-out-to-start']);
    expect(back.keyframes).toEqual(['oyl-route-in-from-start', 'oyl-route-out-to-end']);
    // The cross-fade is the browser's own: none of the slide's keyframes.
    expect(across.keyframes.filter((name) => name.startsWith('oyl-route-'))).toEqual([]);
  });

  test('reduced motion collapses the slide too', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, '');
    await goTo(page, hrefFor(routeById('segments')), routeById('segments').title);
    const deeper = await applied(page, SEGMENT, routeById('segment-detail').title);
    expect(deeper.started).toBe(1);
    expect(deeper.classes).toEqual(['oyl-route-deeper']);
    expect(deeper.longest).toBeLessThanOrEqual(1);
  });

  test('where the engine has no View Transition API, the swap is instant and nothing breaks', async ({
    page,
  }) => {
    // An old, un-updated WebView on minSdk 24. Taken away before any page
    // script runs, as such a WebView would never have had it.
    await page.addInitScript(() => {
      Reflect.deleteProperty(Document.prototype, 'startViewTransition');
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    const response = await page.goto('/reflow.html?data=populated&motion=on#/');
    expect(response?.status()).toBe(200);
    await page.waitForFunction(() => window.__oylReflow !== undefined);
    expect(await page.evaluate(() => typeof document.startViewTransition)).toBe('undefined');
    for (const [hash, title] of [
      [hrefFor(routeById('segments')), routeById('segments').title],
      [SEGMENT, routeById('segment-detail').title],
      [hrefFor(routeById('segments')), routeById('segments').title],
      [hrefFor(routeById('routes')), routeById('routes').title],
    ] as const) {
      await page.evaluate((next) => {
        window.location.hash = next;
      }, hash);
      await expect(page.locator('h1')).toHaveText(title);
    }
    expect(await page.evaluate(() => window.__oylReflow?.errors)).toEqual([]);
  });
});
