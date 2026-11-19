// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2600 — the ride controls fade until touched, and a tap on a panel tucks it
 * away to a tab that a tap brings back: measured on the real ride
 * (`ride-harness.tsx`, the real `GameView` and `HudPanel` under the real
 * `theme.css`) at the three tablet viewports, where panels tuck
 * (`panel-tabs.ts` §`PANEL_TABS_MEDIA`).
 *
 * What only a browser can say, and so what is held here:
 *
 * - **Hidden, the controls are faded and a finger lands on the road.** They
 *   fade to nothing (the owner's ruling of 2026-11-16, *"Fade out is
 *   better"*), and then the actions panel is clipped to the trainer's line
 *   (`theme.css` §"#2600"): the point where *Pause* was drawn hit-tests to
 *   something outside the actions panel, the trainer line still hit-tests to
 *   itself, and a real touch there shows the controls and does not pause. The
 *   second touch pauses.
 * - **Hidden, a keyboard still reaches them**: focus on *Pause* shows them.
 * - **Tap out, tap in** (the owner's ruling of 2026-11-16): a real touch on
 *   each panel tucks it away; each tab is a 48 px target, on the stage, on
 *   top, over no other tab, and no bigger than the tucked panel; the layout's
 *   own invariants (`ride-stage.ts` §`layoutFaults`) still hold; and a touch
 *   on each tab brings its panel back — with no box left drawn on it.
 * - **A keyboard reaches each open panel's one control**, which is drawn only
 *   while it has focus: then a 48 px target, on top, on the stage and on its
 *   own panel — at the normal, large and extra-large text sizes (the reflow
 *   the issue asks for).
 * - In a lap race the standings still clear the actions panel by #2599's
 *   16 px with the trainer's line tucked away, or with the standings.
 * - **A fade, not a pop** (the owner's report of 2026-11-17 from the tablet,
 *   *"Not a fade just a pop"*): sampled mid-fade off the page's own
 *   animations, the controls in the lined actions panel go out over
 *   `HUD_CONTROLS_FADE_MS.out` with no step, the panel is not clipped until
 *   they have, its clip then closes over `--oyl-motion-medium` with no step,
 *   and they come back over `HUD_CONTROLS_FADE_MS.in` — at the owner's tablet
 *   and a 1024×600 window. Under reduced motion none of it animates.
 *
 * Each case opens its own page: a panel tucked or a control hidden is state a
 * shared page would carry into the next case.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import { HUD_CONTROLS_FADE_MS, MOTION_DURATION_MS } from '../src/design/tokens';
import {
  LAPTOP_VIEWPORTS,
  TABLET_VIEWPORTS,
  inside,
  layoutFaults,
  measure,
  openRide,
  overlap,
  type Viewport,
} from './ride-stage';
import type { Box } from './ride-harness';

/** `controls-reveal.ts` §`CONTROLS_HIDE_MILLISECONDS`, and a frame more. */
const HIDE_AFTER_MILLISECONDS = 5_000 + 100;

/** #669's ride-time target, which a tab is. */
const TARGET_PIXELS = 48;

/** `standings-room.ts` §`STANDINGS_CLEARANCE_PIXELS` (#2034). */
const STANDINGS_CLEARANCE_PIXELS = 16;

/** The panels a plain ride draws, by the word on each one's tab. */
const PLAIN_RIDE = [
  { word: 'Power', at: '.oyl-hud__fields--primary dd' },
  { word: 'Readings', at: '.oyl-hud__fields--secondary dd' },
  { word: 'Route', at: '.oyl-hud__route' },
  { word: 'Trainer', at: '.oyl-hud__actions > .oyl-hud__trainer' },
] as const;

const sized = (viewport: Viewport): string =>
  `${String(viewport.width)}×${String(viewport.height)}`;

async function ride(
  browser: Browser,
  viewport: Viewport,
  query: string,
  touch = false,
): Promise<Page> {
  const context = await browser.newContext({ hasTouch: touch });
  const page = await context.newPage();
  await page.clock.install();
  await openRide(page, viewport, query);
  return page;
}

/**
 * The fade, the hold before the clip and its closing, run to their end. A CSS animation
 * runs on the page's own clock, which `page.clock` does not drive, so this
 * waits for them as the page reports them rather than for a guessed time.
 */
async function settled(page: Page): Promise<void> {
  await page
    .locator('.oyl-hud__actions')
    .evaluate((panel) =>
      Promise.all(panel.getAnimations({ subtree: true }).map((each) => each.finished)),
    );
}

/** A real touch on the middle of the first element `selector` names. */
async function touch(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`${selector} has no box`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

interface TabSeen {
  readonly name: string;
  readonly box: Box;
  readonly onTop: boolean;
  /** The tucked panel this tab stands for. */
  readonly panel: Box | undefined;
}

/** Every drawn tucked panel's tab, and how each open panel's control is drawn. */
async function tabs(page: Page): Promise<{
  readonly tabs: readonly TabSeen[];
  readonly drawnControls: readonly string[];
}> {
  return page.evaluate(() => {
    const boxOf = (element: Element): Box => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const onTop = (element: Element): boolean => {
      const box = boxOf(element);
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && (hit === element || element.contains(hit));
    };
    return {
      tabs: [...document.querySelectorAll('button.oyl-hud__tab')].map((tab) => {
        const tucked = tab.closest('.oyl-hud__panel--collapsed');
        return {
          name: tab.getAttribute('aria-label') ?? '',
          box: boxOf(tab),
          onTop: onTop(tab),
          panel: tucked === null ? undefined : boxOf(tucked),
        };
      }),
      // Drawn: unclipped, or where a finger finds it. Clipped, it is neither.
      drawnControls: [...document.querySelectorAll('button.oyl-hud__tuck')]
        .filter((each) => onTop(each) || getComputedStyle(each).clipPath === 'none')
        .map((each) => each.textContent ?? ''),
    };
  });
}

/** What is wrong with the tabs on this stage, as lines. */
function tabFaults(seen: readonly TabSeen[], viewport: Viewport): string[] {
  const faults: string[] = [];
  const at = (tab: TabSeen): string =>
    `${tab.name} [${tab.box.left.toFixed(0)},${tab.box.top.toFixed(0)} ${tab.box.width.toFixed(0)}×${tab.box.height.toFixed(0)}]`;
  seen.forEach((tab, index) => {
    if (tab.box.width < TARGET_PIXELS - 0.5 || tab.box.height < TARGET_PIXELS - 0.5) {
      faults.push(`under 48 px: ${at(tab)}`);
    }
    if (!inside(tab.box, viewport)) faults.push(`off the stage: ${at(tab)}`);
    if (!tab.onTop) faults.push(`covered: ${at(tab)}`);
    for (const other of seen.slice(index + 1)) {
      if (overlap(tab.box, other.box)) faults.push(`${at(tab)} × ${at(other)}`);
    }
  });
  return faults;
}

/** One moment of the fade, read off the page with its animations held there. */
interface FadeSample {
  readonly atMs: number;
  /** *Pause*'s opacity as drawn: its own times every ancestor's. */
  readonly opacity: number;
  /** Whether *Pause*'s middle still hit-tests inside the actions panel (not clipped). */
  readonly pauseInPanel: boolean;
  /** How far down from its top the actions panel is drawn, by hit-testing its middle column. */
  readonly drawnHeight: number;
  /** The panel's own height, and the trainer's line's bottom below its top. */
  readonly panelHeight: number;
  readonly lineBottom: number;
}

/**
 * Hold every animation in the actions panel at each of `atMs` in turn and read
 * what a rider would see then. A CSS animation runs on the page's own clock,
 * not `page.clock`'s, so they are paused and seeked rather than waited for.
 */
async function sampleFade(page: Page, atMs: readonly number[]): Promise<FadeSample[]> {
  return page.evaluate((times) => {
    const panel = document.querySelector('.oyl-hud__actions');
    const pause = document.querySelector('.oyl-hud__controls button');
    const line = document.querySelector('.oyl-hud__actions > .oyl-hud__trainer');
    if (panel === null || pause === null) throw new Error('no actions panel or no Pause');
    const animations = panel.getAnimations({ subtree: true });
    for (const each of animations) each.pause();
    const drawnOpacity = (element: Element): number => {
      let opacity = 1;
      for (let at: Element | null = element; at !== null; at = at.parentElement) {
        opacity *= Number(getComputedStyle(at).opacity);
      }
      return opacity;
    };
    const inPanel = (x: number, y: number): boolean => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && panel.contains(hit);
    };
    const samples = times.map((atMs) => {
      for (const each of animations) each.currentTime = atMs;
      const box = panel.getBoundingClientRect();
      const pauseBox = pause.getBoundingClientRect();
      const x = box.left + box.width / 2;
      let drawnHeight = 0;
      for (let y = box.top + 1; y < box.bottom; y += 1) {
        if (inPanel(x, y)) drawnHeight = y - box.top + 1;
      }
      return {
        atMs,
        opacity: drawnOpacity(pause),
        pauseInPanel: inPanel(
          pauseBox.left + pauseBox.width / 2,
          pauseBox.top + pauseBox.height / 2,
        ),
        drawnHeight,
        panelHeight: box.height,
        lineBottom: line === null ? 0 : line.getBoundingClientRect().bottom - box.top,
      };
    });
    for (const each of animations) each.finish();
    return samples;
  }, atMs);
}

/** `0, step, 2 × step, …, end`. */
function steps(start: number, end: number, step: number): number[] {
  const out: number[] = [];
  for (let at = start; at < end; at += step) out.push(at);
  out.push(end);
  return out;
}

/** Every place one sample to the next does not move the way `by` says, as lines. */
function stepFaults(
  samples: readonly FadeSample[],
  read: (sample: FadeSample) => number,
  direction: 'falls' | 'rises',
  largestStep: number,
): string[] {
  const faults: string[] = [];
  samples.slice(1).forEach((sample, index) => {
    const before = samples[index];
    if (before === undefined) return;
    const change = read(sample) - read(before);
    const moved = direction === 'falls' ? -change : change;
    const where = `${String(before.atMs)}→${String(sample.atMs)} ms`;
    if (moved <= 0) faults.push(`${where}: held at ${read(sample).toFixed(3)}`);
    if (moved > largestStep) faults.push(`${where}: a step of ${moved.toFixed(3)}`);
  });
  return faults;
}

/** The owner's tablet, and the 1024×600 window the owner's report names beside it. */
const FADE_VIEWPORTS: readonly Viewport[] = [
  ...TABLET_VIEWPORTS.filter((each) => each.width === 1280 && each.height === 800),
  ...LAPTOP_VIEWPORTS.filter((each) => each.width === 1024 && each.height === 600),
];

for (const viewport of FADE_VIEWPORTS) {
  test(`#2600 the controls fade out and back in, and the lined actions panel closes only after, with no step — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await ride(browser, viewport, '?controls=hide', true);
    const out = HUD_CONTROLS_FADE_MS.out;
    const close = MOTION_DURATION_MS.medium;
    await page.clock.fastForward(HIDE_AFTER_MILLISECONDS);
    await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'hidden');
    // One reading of the page, held at each moment in turn: the fade, and the
    // clip's closing after it.
    const samples = await sampleFade(page, [
      ...steps(0, out, 100),
      ...steps(out, out + close, close / 4).slice(1),
    ]);
    const fading = samples.filter((each) => each.atMs <= out);
    const where = sized(viewport);
    expect(fading[0]?.opacity, `drawn at the start, ${where}`).toBeGreaterThan(0.99);
    expect(fading.at(-1)?.opacity, `gone at the end, ${where}`).toBeLessThan(0.01);
    // A fade: every 100 ms lower than the last, and none of them most of it.
    expect(
      stepFaults(fading, (each) => each.opacity, 'falls', 0.5),
      where,
    ).toEqual([]);
    // Halfway through it is still there to see.
    const half = fading.find((each) => each.atMs === out / 2);
    expect(half?.opacity, `halfway, ${where}`).toBeGreaterThan(0.02);
    expect(half?.opacity, `halfway, ${where}`).toBeLessThan(0.9);
    // Nothing is clipped while anything can be seen: the panel is whole.
    expect(
      fading.filter((each) => !each.pauseInPanel).map((each) => each.atMs),
      `clipped mid-fade, ${where}`,
    ).toEqual([]);
    for (const each of fading) {
      expect(each.drawnHeight, `${String(each.atMs)} ms, ${where}`).toBeGreaterThan(
        each.panelHeight - 2,
      );
    }

    // Then the clip closes up to the trainer's line, a little at a time.
    const closing = samples.filter((each) => each.atMs >= out);
    const first = closing[0];
    const last = closing.at(-1);
    if (first === undefined || last === undefined) throw new Error('no samples');
    expect(first.drawnHeight, where).toBeGreaterThan(first.panelHeight - 2);
    expect(last.lineBottom, `the trainer's line, ${where}`).toBeGreaterThan(0);
    expect(last.drawnHeight, where).toBeGreaterThanOrEqual(last.lineBottom - 1);
    expect(last.drawnHeight, where).toBeLessThan(last.panelHeight * 0.75);
    expect(last.pauseInPanel, `Pause still under a finger, ${where}`).toBe(false);
    expect(
      stepFaults(
        closing,
        (each) => each.drawnHeight,
        'falls',
        0.75 * (first.drawnHeight - last.drawnHeight),
      ),
      where,
    ).toEqual([]);

    // A touch brings them back, and they fade in rather than appear.
    await page.touchscreen.tap(viewport.width / 2, viewport.height / 2);
    await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'shown');
    const back = HUD_CONTROLS_FADE_MS.in;
    const returning = await sampleFade(page, steps(0, back, back / 5));
    expect(returning[0]?.opacity, where).toBeLessThan(0.01);
    expect(returning.at(-1)?.opacity, where).toBeGreaterThan(0.99);
    expect(
      stepFaults(returning, (each) => each.opacity, 'rises', 0.75),
      where,
    ).toEqual([]);
    expect(returning.every((each) => each.pauseInPanel)).toBe(true);
    await page.context().close();
  });
}

test('#2600 under reduced motion the controls go at once, with no fade and no closing', async ({
  browser,
}) => {
  const [viewport] = FADE_VIEWPORTS;
  if (viewport === undefined) throw new Error('no viewport');
  const context = await browser.newContext({ hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.clock.install();
  await openRide(page, viewport, '?controls=hide');
  await page.clock.fastForward(HIDE_AFTER_MILLISECONDS);
  await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'hidden');
  // No fade and no closing: none of `theme.css` §"#2600"'s animations runs.
  // (The stylesheet-wide collapse still gives every change a 0.01 ms
  // transition, which is a switch rather than motion.)
  const running = await page.locator('.oyl-hud__actions').evaluate((panel) =>
    panel
      .getAnimations({ subtree: true })
      .filter((each) => each instanceof CSSAnimation)
      .map((each) => each.animationName),
  );
  expect(running).toEqual([]);
  await expect
    .poll(async () => (await sampleFade(page, [0]))[0])
    .toMatchObject({ opacity: 0, pauseInPanel: false });
  await context.close();
});

for (const viewport of TABLET_VIEWPORTS) {
  test(`#2600 hidden, the controls are faded, and the first touch shows them and presses nothing — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await ride(browser, viewport, '?controls=hide', true);
    const pause = page.locator('.oyl-hud__controls button').first();
    await expect(pause).toHaveText('Pause');
    const drawn = await pause.boundingBox();
    if (drawn === null) throw new Error('Pause has no box');
    const x = drawn.x + drawn.width / 2;
    const y = drawn.y + drawn.height / 2;

    await page.clock.fastForward(HIDE_AFTER_MILLISECONDS);
    await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'hidden');
    await settled(page);
    // Faded to nothing, and the box is where it was — nothing moved.
    expect(
      await page.locator('.oyl-hud__controls').evaluate((row) => getComputedStyle(row).opacity),
    ).toBe('0');
    expect(await pause.boundingBox()).toEqual(drawn);
    const landed = await page.evaluate(
      ([px, py]) => {
        const hit = document.elementFromPoint(px ?? 0, py ?? 0);
        const line = document.querySelector('.oyl-hud__trainer');
        const lineBox = line?.getBoundingClientRect();
        const lineHit =
          lineBox === undefined
            ? null
            : document.elementFromPoint(
                lineBox.left + lineBox.width / 2,
                lineBox.top + lineBox.height / 2,
              );
        return {
          inActions: hit?.closest('.oyl-hud__actions') !== null && hit !== null,
          lineOnTop: line !== null && lineHit !== null && line.contains(lineHit),
          lineOpacity: line === null ? '' : getComputedStyle(line).opacity,
        };
      },
      [x, y],
    );
    expect(landed.inActions, 'a finger on hidden Pause reached the actions panel').toBe(false);
    // The trainer's line is kept, drawn whole and on top, where it was.
    expect(landed.lineOnTop).toBe(true);
    expect(landed.lineOpacity).toBe('1');

    await page.touchscreen.tap(x, y);
    await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'shown');
    await expect(pause, 'the first touch paused the ride').toHaveText('Pause');
    // And faded back in.
    await settled(page);
    expect(
      await page.locator('.oyl-hud__controls').evaluate((row) => getComputedStyle(row).opacity),
    ).toBe('1');
    await page.touchscreen.tap(x, y);
    await expect(pause).toHaveText('Resume');
    await page.context().close();
  });

  test(`#2600 hidden, focus on Pause shows the controls — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await ride(browser, viewport, '?controls=hide');
    await page.clock.fastForward(HIDE_AFTER_MILLISECONDS);
    await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'hidden');
    const pause = page.locator('.oyl-hud__controls button').first();
    await pause.focus();
    await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'shown');
    const box = await pause.boundingBox();
    if (box === null) throw new Error('Pause has no box');
    const onTop = await page.evaluate(
      ([px, py]) =>
        document.elementFromPoint(px ?? 0, py ?? 0)?.closest('.oyl-hud__controls') !== null,
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(onTop).toBe(true);
    await page.context().close();
  });

  test(`#2600 a touch on each panel tucks it away to a 48 px tab, and a touch on the tab brings it back — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await ride(browser, viewport, '', true);
    // Open, no panel has a box drawn on it to press.
    expect(await tabs(page)).toEqual({ tabs: [], drawnControls: [] });
    for (const { word, at } of PLAIN_RIDE) {
      await touch(page, at);
      await expect(
        page.locator(`button.oyl-hud__tab[aria-label="${word} panel, hidden"]`),
      ).toHaveCount(1);
    }
    const seen = await tabs(page);
    expect(seen.tabs.map((tab) => tab.name)).toEqual(
      PLAIN_RIDE.map(({ word }) => `${word} panel, hidden`),
    );
    expect(tabFaults(seen.tabs, viewport)).toEqual([]);
    for (const tab of seen.tabs) {
      // The trainer's tab stands in the actions panel, in the line's place.
      if (tab.panel === undefined) continue;
      expect(tab.panel.width, `${tab.name} at ${sized(viewport)}`).toBeLessThanOrEqual(
        tab.box.width + 1,
      );
      expect(tab.panel.height, `${tab.name} at ${sized(viewport)}`).toBeLessThanOrEqual(
        tab.box.height + 1,
      );
    }
    expect(layoutFaults(await measure(page), viewport)).toEqual([]);
    // Kept on the device, where the next ride reads it (the harness writes
    // its own choice on a reload, so the store is read here; `HudPanel
    // .panel-tabs.test.tsx` mounts the next ride on it).
    const kept = await page.evaluate(() => localStorage.getItem('oyl.rideChrome.v1'));
    expect(JSON.parse(kept ?? '{}')).toEqual({
      autoHide: false,
      collapsed: ['primary', 'secondary', 'route', 'trainer'],
    });

    // Tap in: each tab brings its panel back, and leaves no box drawn on it.
    for (const { word } of PLAIN_RIDE) {
      await touch(page, `button.oyl-hud__tab[aria-label="${word} panel, hidden"]`);
      await expect(
        page.locator(`button.oyl-hud__tuck`, { hasText: `${word} panel, shown` }),
      ).toHaveCount(1);
    }
    expect(await tabs(page)).toEqual({ tabs: [], drawnControls: [] });
    expect(layoutFaults(await measure(page), viewport)).toEqual([]);
    await page.context().close();
  });

  test(`#2600 with any one panel tucked away, its tab is on top and every reading still drawn — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await ride(browser, viewport, '');
    for (const panel of ['primary', 'secondary', 'route', 'trainer'] as const) {
      await openRide(page, viewport, `?collapsed=${panel}`);
      const seen = await tabs(page);
      expect(seen.tabs, panel).toHaveLength(1);
      expect(tabFaults(seen.tabs, viewport), `${panel} at ${sized(viewport)}`).toEqual([]);
      // The tiers' size ratio reads a tucked Power panel's 0 px numerals; that
      // the tiers keep their ratio is a drawn panel's invariant, not a tab's.
      const faults = layoutFaults(await measure(page), viewport).filter(
        (fault) => panel !== 'primary' || !fault.startsWith('primary 0 px over secondary'),
      );
      expect(faults, panel).toEqual([]);
      // The 4:3 tablet draws the Power panel's Gradient in the Readings panel:
      // with that panel tucked away, the Gradient is still on the stage, on top.
      if (panel !== 'primary') {
        const gradient = await page.evaluate(() => {
          const field = document.querySelector('.oyl-hud__field--gradient');
          const box = field?.getBoundingClientRect();
          if (field === null || box === undefined) return false;
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return box.width > 1 && hit !== null && field.contains(hit);
        });
        expect(gradient, `the Gradient with the ${panel} tucked away`).toBe(true);
      }
    }
    await page.context().close();
  });

  for (const text of ['normal', 'large', 'extra-large'] as const) {
    test(`#2600 a keyboard reaches each open panel's control, drawn on its panel as a 48 px target only while focused — ${viewport.name}, ${text} text`, async ({
      browser,
    }) => {
      const page = await ride(browser, viewport, text === 'normal' ? '' : `?text=${text}`);
      await page.locator('.oyl-hud__controls button').first().focus();
      const reached: string[] = [];
      for (let press = 0; press < 40 && reached.length < PLAIN_RIDE.length; press += 1) {
        await page.keyboard.press('Tab');
        const seen = await page.evaluate(() => {
          const focused = document.activeElement;
          if (!(focused instanceof HTMLElement) || !focused.classList.contains('oyl-hud__tuck')) {
            return undefined;
          }
          const box = focused.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          const selectors: Record<string, string> = {
            primary: '.oyl-hud__fields--primary',
            secondary: '.oyl-hud__fields--secondary',
            route: '.oyl-hud__route',
            trainer: '.oyl-hud__trainer',
          };
          const own = document.querySelector(selectors[focused.dataset['oylTab'] ?? ''] ?? '');
          const panel = own?.getBoundingClientRect();
          return {
            name: focused.textContent ?? '',
            box: {
              left: box.left,
              top: box.top,
              right: box.right,
              bottom: box.bottom,
              width: box.width,
              height: box.height,
            },
            onTop: hit !== null && (hit === focused || focused.contains(hit)),
            onPanel:
              panel !== undefined &&
              box.left < panel.right &&
              panel.left < box.right &&
              box.top < panel.bottom &&
              panel.top < box.bottom,
          };
        });
        if (seen === undefined) continue;
        reached.push(seen.name);
        const where = `${seen.name} at ${sized(viewport)}`;
        expect(seen.box.width, where).toBeGreaterThanOrEqual(TARGET_PIXELS - 0.5);
        expect(seen.box.height, where).toBeGreaterThanOrEqual(TARGET_PIXELS - 0.5);
        expect(inside(seen.box, viewport), where).toBe(true);
        expect(seen.onTop, where).toBe(true);
        expect(seen.onPanel, where).toBe(true);
      }
      expect(reached).toEqual(PLAIN_RIDE.map(({ word }) => `${word} panel, shown`));
      // Focus gone from them, none is drawn, and the layout is the ride's own.
      await page.locator('.oyl-hud__controls button').first().focus();
      expect((await tabs(page)).drawnControls).toEqual([]);
      expect(layoutFaults(await measure(page), viewport)).toEqual([]);
      await page.context().close();
    });
  }

  for (const collapsed of ['trainer', 'standings'] as const) {
    test(`#2600 a lap race's standings stay clear of the actions panel with the ${collapsed} tucked away — ${viewport.name}`, async ({
      browser,
    }) => {
      // The control: the same race with nothing tucked. A lap race gives
      // readings way on a tablet (`ride-stage.ts` §`roomGivesWay`), which
      // `layoutFaults` reads as lost, so what is held is that tucking a panel
      // away adds no fault to the race's own.
      const open = await ride(browser, viewport, '?room=lap-race');
      const before = layoutFaults(await measure(open), viewport);
      await open.context().close();
      const page = await ride(browser, viewport, `?room=lap-race&collapsed=${collapsed}`);
      const seen = await tabs(page);
      expect(seen.tabs.map((tab) => tab.name)).toEqual([
        collapsed === 'trainer' ? 'Trainer panel, hidden' : 'Race panel, hidden',
      ]);
      expect(tabFaults(seen.tabs, viewport)).toEqual([]);
      expect(layoutFaults(await measure(page), viewport)).toEqual(before);
      const gap = await page.evaluate(() => {
        const standings = document.querySelector('.oyl-hud__standings');
        const actions = document.querySelector('.oyl-hud__actions');
        if (standings === null || actions === null) return undefined;
        return actions.getBoundingClientRect().top - standings.getBoundingClientRect().bottom;
      });
      expect(gap).toBeDefined();
      expect(gap ?? 0).toBeGreaterThanOrEqual(STANDINGS_CLEARANCE_PIXELS - 0.5);
      await page.context().close();
    });
  }
}

/*
 * #2837 — the standings' room is measured on an event of the layout's, never
 * on a frame. The room hook reads boxes off the page (`standings-room.ts`
 * §`useStandingsRoom`), which makes the engine lay the page out: on a frame
 * that would be a forced layout sixty times a second on the tablet. So a
 * lap race in a room is ridden for two seconds of frames with the auto-hide
 * on, the HUD rewriting its readings as it goes, and every read of the
 * standings panel's box is counted — the hook reads it once each time it
 * measures, and nothing else on the page reads it.
 *
 * The control is the mutation recorded in the pull request: with the hook
 * measuring on every frame, this counts one read a frame and fails.
 */
const COUNTED_FRAMES = 120;

/** The most measurements a ride that changes no layout may make in {@link COUNTED_FRAMES} frames. */
const MOST_MEASUREMENTS = 6;

test('#2837 a moving lap race measures the standings’ room on no frame', async ({ page }) => {
  const viewport = TABLET_VIEWPORTS.find((each) => each.width === 1280 && each.height === 800);
  if (viewport === undefined) throw new Error('no 1280×800 tablet');
  await openRide(page, viewport, '?room=lap-race&controls=hide');
  const counted = await page.evaluate(async (frames) => {
    const standings = document.querySelector('.oyl-hud__standings');
    const hud = document.querySelector('.oyl-hud');
    if (standings === null || hud === null) throw new Error('no standings on the HUD');
    // Counted on the panel itself: an own method in front of the prototype's.
    let measurements = 0;
    Object.defineProperty(standings, 'getBoundingClientRect', {
      configurable: true,
      value: (): DOMRect => {
        measurements += 1;
        return Element.prototype.getBoundingClientRect.call(standings);
      },
    });
    let rewrites = 0;
    const rewritten = new MutationObserver((records) => {
      rewrites += records.length;
    });
    rewritten.observe(hud, { subtree: true, childList: true, characterData: true });
    let drawn = 0;
    await new Promise<void>((resolve) => {
      const frame = (): void => {
        drawn += 1;
        if (drawn >= frames) resolve();
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    rewritten.disconnect();
    // The same panel to the end: a panel drawn anew would have been counted on nothing.
    const kept = document.querySelector('.oyl-hud__standings') === standings;
    return { measurements, rewrites, drawn, kept };
  }, COUNTED_FRAMES);
  console.log(
    `#2837 a moving lap race: ${String(counted.measurements)} measurements of the standings' ` +
      `room and ${String(counted.rewrites)} HUD rewrites in ${String(counted.drawn)} frames`,
  );
  expect(counted.drawn).toBe(COUNTED_FRAMES);
  expect(counted.kept, 'the standings panel was replaced while it was counted').toBe(true);
  // The ride moved: the HUD rewrote readings while it was counted.
  expect(counted.rewrites, 'the HUD rewrote nothing: no ride to count').toBeGreaterThan(10);
  expect(counted.measurements).toBeLessThanOrEqual(MOST_MEASUREMENTS);
});

/*
 * #2837 — and a ride with no race moves nothing: hidden, its actions panel is
 * clipped to the trainer's line where the panel begins, as #2600 left it. The
 * move to the stage's bottom edge is a race's alone (`theme.css` §"#2837"),
 * where the standings have a use for the room.
 */
test('#2837 with no race, the hidden actions panel stays where it was drawn', async ({
  browser,
}) => {
  const viewport = TABLET_VIEWPORTS.find((each) => each.width === 1280 && each.height === 800);
  if (viewport === undefined) throw new Error('no 1280×800 tablet');
  const page = await ride(browser, viewport, '?controls=hide');
  const top = (): Promise<number> =>
    page.locator('.oyl-hud__actions').evaluate((panel) => panel.getBoundingClientRect().top);
  const drawn = await top();
  await page.clock.fastForward(HIDE_AFTER_MILLISECONDS);
  await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'hidden');
  await settled(page);
  expect(await top()).toBeCloseTo(drawn, 0);
  await page.context().close();
});
