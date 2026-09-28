// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every keyboard focus ring on the ride HUD can be seen — #748.
 *
 * The HUD is pinned to the light palette (`theme.css` §`.oyl-hud`, #672), so
 * `--oyl-color-focus` there is #141b1a, and a control that took the page's
 * `:focus-visible` drew that ring 2 px outside itself onto `hudSurface`,
 * #10161c: **1.04:1**. The mute toggle, the volume and the side camera's Stop
 * all did, in both page palettes, and nothing measured it: `contrast.a11y.test`
 * checks declared PAIRS, and no pair said which colour a HUD ring is.
 *
 * This Tabs through a real ride's HUD — `ride.html?sounds=on&side=lost`, which
 * carries all three — and for each control that takes focus inside `.oyl-hud`
 * reads the ring the engine computed and the surface it lands on (the nearest
 * ancestor that paints a background), and holds the ratio to 3:1 (SC 2.4.13's
 * non-text contrast), in the light page palette and the dark one. The three
 * controls #748 names must each be among those visited.
 *
 * **Control:** the rule #748 added is deleted through the CSSOM, and the same
 * three rings must read back at the 1.04:1 #748's review measured — so a
 * green run is a statement about that rule, not about a page whose rings
 * happened to be light.
 *
 * ⚠️ Not a screen reader and not a real phone: what it proves is the colour the
 * engine gives a keyboard focus ring, and where that ring lands.
 */

import { expect, test, type Page } from '@playwright/test';

import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../src/design/contrast';

const QUERY = '?sounds=on&side=lost';

/** The three controls #748 found at 1.04:1, as the HUD renders them. */
const NAMED = ['.oyl-sound__mute', '.oyl-sound__volume input', '.oyl-hud__side-camera-stop'];

/** The rule this file exists for, as the CSSOM reports its selector. */
const RULE = '.oyl-hud :focus-visible';

interface Ring {
  /** Which of {@link NAMED} this is, or the element's tag and class. */
  readonly name: string;
  readonly outline: string;
  readonly style: string;
  readonly surface: string;
}

/** `rgb(16, 22, 28)` → `#10161c`, for {@link contrastRatio}. */
function hex(rgb: string): string {
  const channels = /^rgba?\((\d+), (\d+), (\d+)/.exec(rgb);
  if (channels === null) throw new Error(`not an opaque rgb() colour: ${rgb}`);
  return `#${channels
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')}`;
}

async function openRide(page: Page): Promise<void> {
  await page.setViewportSize({ width: 844, height: 390 });
  const response = await page.goto(`/ride.html${QUERY}`);
  expect(response?.status()).toBe(200);
  await page.waitForFunction(
    () => (window as { __oylRide?: { readonly ready: boolean } }).__oylRide !== undefined,
  );
  const published = await page.evaluate(
    () =>
      (window as { __oylRide?: { readonly ready: boolean; readonly errors: string[] } }).__oylRide,
  );
  expect(published?.errors).toEqual([]);
  expect(published?.ready).toBe(true);
}

/**
 * Tab from the top of the page until focus comes back round, and read the ring
 * of every element that took focus inside the HUD — with the real keyboard, so
 * `:focus-visible` is the engine's own decision.
 */
async function tabThroughTheHud(page: Page): Promise<Ring[]> {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  const rings: Ring[] = [];
  const seen = new Set<string>();
  for (let press = 0; press < 60; press += 1) {
    await page.keyboard.press('Tab');
    const read = await page.evaluate((named) => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body) return undefined;
      const id = `${element.tagName}|${element.className}|${element.textContent ?? ''}`;
      if (element.closest('.oyl-hud') === null) return { id };
      if (!element.matches(':focus-visible')) return { id, invisible: true };
      let surface = 'rgba(0, 0, 0, 0)';
      for (let at = element.parentElement; at !== null; at = at.parentElement) {
        const background = getComputedStyle(at).backgroundColor;
        if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') {
          surface = background;
          break;
        }
      }
      const style = getComputedStyle(element);
      return {
        id,
        ring: {
          name:
            named.find((selector) => element.matches(selector)) ??
            `${element.tagName.toLowerCase()}.${element.className}`,
          outline: style.outlineColor,
          style: `${style.outlineStyle} ${style.outlineWidth}`,
          surface,
        },
      };
    }, NAMED);
    if (read === undefined) continue;
    if (seen.has(read.id)) break;
    seen.add(read.id);
    expect(
      read.invisible,
      `${read.id} took focus from the keyboard without :focus-visible`,
    ).not.toBe(true);
    if (read.ring !== undefined) rings.push(read.ring);
  }
  return rings;
}

function ratio(ring: Ring): number {
  return contrastRatio(hex(ring.outline), hex(ring.surface));
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`#748 — every HUD focus ring is 3:1 on its surface, in the ${colorScheme} page palette`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await openRide(page);
    const rings = await tabThroughTheHud(page);
    for (const ring of rings) {
      console.log(
        `#748 ${colorScheme}: ${ring.name} ring ${ring.outline} on ${ring.surface}, ${ratio(ring).toFixed(2)}:1`,
      );
    }
    // What the walk must find, so a HUD whose controls took no focus fails.
    expect(rings.map((ring) => ring.name)).toEqual(expect.arrayContaining(NAMED));
    for (const ring of rings) {
      expect(ring.style, `${ring.name} draws no ring`).toMatch(/^solid [1-9]/);
      expect(
        ratio(ring),
        `${ring.name}: ${ring.outline} on ${ring.surface}`,
      ).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_NON_TEXT);
    }
  });
}

test('#748 control — without the rule, the three rings are back at 1.04:1', async ({ page }) => {
  await openRide(page);
  const deleted = await page.evaluate((selector) => {
    let removed = 0;
    for (const sheet of document.styleSheets) {
      for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
        const rule = sheet.cssRules[index];
        if (rule instanceof CSSStyleRule && rule.selectorText === selector) {
          sheet.deleteRule(index);
          removed += 1;
        }
      }
    }
    return removed;
  }, RULE);
  expect(deleted, `${RULE} was not found to delete`).toBe(1);
  const named = (await tabThroughTheHud(page)).filter((ring) => NAMED.includes(ring.name));
  expect(named.map((ring) => ring.name).sort()).toEqual([...NAMED].sort());
  for (const ring of named) {
    expect(ratio(ring), `${ring.name} is still visible without the rule`).toBeLessThan(1.1);
  }
});
