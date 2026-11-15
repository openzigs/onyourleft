// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2600 — the ride controls hide until touched, and each panel collapses to a
 * tab: measured on the real ride (`ride-harness.tsx`, the real `GameView` and
 * `HudPanel` under the real `theme.css`) at the three tablet viewports, where
 * the tabs are drawn (`panel-tabs.ts` §`PANEL_TABS_MEDIA`).
 *
 * What only a browser can say, and so what is held here:
 *
 * - **Hidden, a finger lands on the road.** The actions panel is CLIPPED to
 *   the trainer's line (`theme.css` §"#2600"); the point where *Pause* was
 *   drawn hit-tests to something outside the actions panel, the trainer line
 *   still hit-tests to itself, and a real touch there shows the controls and
 *   does not pause. The second touch pauses.
 * - **Hidden, a keyboard still reaches them**: focus on *Pause* shows them.
 * - **Every tab is a 48 px target**, on the stage, on top where it is drawn,
 *   over no panel, no other tab and not the leaning rider — at the normal,
 *   large and extra-large text sizes (the reflow the issue asks for).
 * - **A collapsed panel is its tab**: its box no bigger than the tab's, the
 *   layout's own invariants (`ride-stage.ts` §`layoutFaults`) still holding,
 *   and in a lap race the standings still clear of the actions panel by
 *   #2599's 16 px with the trainer's line collapsed, or with the standings.
 *
 * Each case opens its own page: a tab pressed or a control hidden is state a
 * shared page would carry into the next case.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  TABLET_VIEWPORTS,
  inside,
  layoutFaults,
  measure,
  openRide,
  overlap,
  riderBox,
  type Viewport,
} from './ride-stage';
import type { Box } from './ride-harness';

/** `controls-reveal.ts` §`CONTROLS_HIDE_MILLISECONDS`, and a frame more. */
const HIDE_AFTER_MILLISECONDS = 5_000 + 100;

/** #669's ride-time target, which a tab is. */
const TARGET_PIXELS = 48;

/** `standings-room.ts` §`STANDINGS_CLEARANCE_PIXELS` (#2034). */
const STANDINGS_CLEARANCE_PIXELS = 16;

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
 * The hide's wipe run to its end. A CSS animation runs on the page's own
 * clock, which `page.clock` does not drive, so this waits for it as the page
 * reports it rather than for a guessed time.
 */
async function wiped(page: Page): Promise<void> {
  await page
    .locator('.oyl-hud__actions')
    .evaluate((panel) => Promise.all(panel.getAnimations().map((each) => each.finished)));
}

interface TabSeen {
  readonly name: string;
  readonly open: boolean;
  readonly box: Box;
  readonly onTop: boolean;
  /** The collapsed panel this tab stands for, where it is collapsed. */
  readonly panel: Box | undefined;
}

interface ChromeSeen {
  readonly tabs: readonly TabSeen[];
  readonly panels: readonly { readonly name: string; readonly box: Box }[];
}

async function chrome(page: Page): Promise<ChromeSeen> {
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
    const panels = [
      ...document.querySelectorAll('.oyl-hud > :not([data-oyl-announcer], .oyl-hud__tabs)'),
    ]
      .map((each) => ({ name: each.className, box: boxOf(each) }))
      .filter(({ box }) => box.width > 1 && box.height > 1);
    const tabs = [...document.querySelectorAll('button.oyl-hud__tab')].map((tab) => {
      const box = boxOf(tab);
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      const collapsed = tab.closest('.oyl-hud__panel--collapsed');
      return {
        name: (tab.textContent ?? '').trim(),
        open: tab.getAttribute('aria-expanded') === 'true',
        box,
        onTop: hit !== null && (hit === tab || tab.contains(hit)),
        panel: collapsed === null ? undefined : boxOf(collapsed),
      };
    });
    return { tabs, panels };
  });
}

/** What is wrong with the tabs on this stage, as lines. */
function tabFaults(seen: ChromeSeen, viewport: Viewport): string[] {
  const faults: string[] = [];
  const rider = riderBox(viewport);
  const at = (tab: TabSeen): string =>
    `${tab.name} [${tab.box.left.toFixed(0)},${tab.box.top.toFixed(0)} ${tab.box.width.toFixed(0)}×${tab.box.height.toFixed(0)}]`;
  seen.tabs.forEach((tab, index) => {
    if (tab.box.width < TARGET_PIXELS - 0.5 || tab.box.height < TARGET_PIXELS - 0.5) {
      faults.push(`under 48 px: ${at(tab)}`);
    }
    if (!inside(tab.box, viewport)) faults.push(`off the stage: ${at(tab)}`);
    if (!tab.onTop) faults.push(`covered: ${at(tab)}`);
    for (const other of seen.tabs.slice(index + 1)) {
      if (overlap(tab.box, other.box)) faults.push(`${at(tab)} × ${at(other)}`);
    }
    if (!tab.open) return;
    // An open panel's tab stands OUTSIDE every panel, over the road.
    for (const panel of seen.panels) {
      if (overlap(tab.box, panel.box)) faults.push(`${at(tab)} over ${panel.name}`);
    }
    if (overlap(tab.box, rider)) faults.push(`over the rider: ${at(tab)}`);
  });
  return faults;
}

for (const viewport of TABLET_VIEWPORTS) {
  test(`#2600 hidden, the first touch shows the controls and presses nothing — ${viewport.name}`, async ({
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
    await wiped(page);
    // The box is where it was — nothing moved — and a finger there lands
    // outside the actions panel: the clip took the control away.
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
        };
      },
      [x, y],
    );
    expect(landed.inActions, 'a finger on hidden Pause reached the actions panel').toBe(false);
    // The trainer's line is kept, on top, where it was.
    expect(landed.lineOnTop).toBe(true);

    await page.touchscreen.tap(x, y);
    await expect(page.locator('.oyl-hud')).toHaveAttribute('data-oyl-controls', 'shown');
    await expect(pause, 'the first touch paused the ride').toHaveText('Pause');
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

  for (const text of ['normal', 'large', 'extra-large'] as const) {
    test(`#2600 every open panel's tab is a 48 px target, over no panel and clear of the rider — ${viewport.name}, ${text} text`, async ({
      browser,
    }) => {
      const page = await ride(browser, viewport, text === 'normal' ? '' : `?text=${text}`);
      const seen = await chrome(page);
      expect(seen.tabs.map((tab) => tab.name.split(' panel')[0])).toEqual([
        'Power',
        'Readings',
        'Route',
        'Trainer',
      ]);
      expect(tabFaults(seen, viewport)).toEqual([]);
      expect(layoutFaults(await measure(page), viewport)).toEqual([]);
      await page.context().close();
    });
  }

  test(`#2600 a tab pressed collapses its panel to the tab, and the layout holds — ${viewport.name}`, async ({
    browser,
  }) => {
    const page = await ride(browser, viewport, '');
    for (const name of ['Power', 'Readings', 'Route', 'Trainer']) {
      await page.locator('button.oyl-hud__tab', { hasText: `${name} panel` }).click();
      await expect(
        page.locator('button.oyl-hud__tab', { hasText: `${name} panel` }),
      ).toHaveAttribute('aria-expanded', 'false');
    }
    const seen = await chrome(page);
    expect(tabFaults(seen, viewport)).toEqual([]);
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
    await page.context().close();
  });

  for (const collapsed of ['trainer', 'standings'] as const) {
    test(`#2600 a lap race's standings stay clear of the actions panel with the ${collapsed} collapsed — ${viewport.name}`, async ({
      browser,
    }) => {
      // The control: the same race with nothing collapsed. A lap race gives
      // readings way on a tablet (`ride-stage.ts` §`roomGivesWay`), which
      // `layoutFaults` reads as lost, so what is held is that collapsing a
      // panel adds no fault to the race's own.
      const open = await ride(browser, viewport, '?room=lap-race');
      const before = layoutFaults(await measure(open), viewport);
      await open.context().close();
      const page = await ride(browser, viewport, `?room=lap-race&collapsed=${collapsed}`);
      const seen = await chrome(page);
      expect(seen.tabs.find((tab) => !tab.open)?.name).toMatch(
        collapsed === 'trainer' ? /^Trainer/ : /^Race/,
      );
      expect(tabFaults(seen, viewport)).toEqual([]);
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
