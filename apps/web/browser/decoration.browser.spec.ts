// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The holiday decorations' belt in the pinned Chromium — #1624.
 * `decoration-harness.ts` says what each page function draws.
 *
 * 1. **One call**: two villages' items, every anchor carrying a probe, draw
 *    in exactly ONE call more than the same scene with the belt hidden, read
 *    off three's own `renderer.info.render.calls`; the control is that the
 *    belt holds triangles at all, so the difference is not a hidden belt's.
 * 2. **The glow in the same call**: a box marked glowing reads back as its own
 *    colour with the light at its face AND turned away, in both worlds'
 *    materials, while the same box unmarked — the control — is lit with the
 *    light at it and dark with the light away.
 * 3. **Steady, under reduced motion too** (WCAG 2.3.1): two frames a second
 *    apart, with and without `prefers-reduced-motion`, read the same colours —
 *    since #1625 the product's own jack-o'-lantern face and since #1626 its
 *    winter bulbs — and since #1627 the village-square tree's baubles among
 *    them — as well as the box.
 */

import { expect, test, type Page } from '@playwright/test';

import { HOLIDAY_DECORATIONS, VILLAGE_TREE } from '../src/game/decorations';
import type { DecorationPixel } from '../src/game/three-renderer';

/** #1627: every colour the village-square tree's baubles glow, as 0–255 sRGB. */
const TREE_GLOWS: readonly (readonly number[])[] = [
  ...new Set(
    (HOLIDAY_DECORATIONS['winter-lights'] ?? [])
      .filter((kind) => kind.item === VILLAGE_TREE)
      .flatMap((kind) => kind.parts)
      .filter((part) => part.glows)
      .map((part) => part.colour),
  ),
].map((colour) => [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff]);

/**
 * `decoration-harness.ts` §`GLOW_PROBE_COLOUR`, 0xc06030, as 0–255 sRGB.
 * Restated rather than imported: the harness's module is the page's.
 */
const PROBE: readonly [number, number, number] = [0xc0, 0x60, 0x30];

/** How far a channel read back may stand from the colour encoded: rounding, twice. */
const CHANNEL_TOLERANCE = 2;

async function open(page: Page): Promise<void> {
  const response = await page.goto('/decoration.html');
  expect(
    response?.status(),
    'decoration.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylDecoration?.ready === true);
}

function glowOf(
  page: Page,
  world: 'stylised' | 'realistic',
  light: 'toward' | 'away',
  glows: boolean,
): Promise<DecorationPixel> {
  return page.evaluate(
    ([w, l, g]) => {
      const harness = window.__oylDecoration;
      if (harness === undefined) throw new Error('no harness');
      return harness.glow(w, l, g);
    },
    [world, light, glows] as const,
  );
}

const brightness = (rgb: readonly number[]): number => rgb.reduce((sum, each) => sum + each, 0);

test.describe('the holiday decorations’ belt — #1624', () => {
  test('draws two villages’ items in ONE call', async ({ page }) => {
    await open(page);
    const counted = await page.evaluate(() => window.__oylDecoration?.calls());
    console.log(`#1624 belt calls: ${JSON.stringify(counted)}`);
    // The control: the belt holds two villages' probes, so a hidden belt is
    // not what the difference measures.
    expect(counted?.triangles ?? 0).toBeGreaterThan(0);
    expect((counted?.shown ?? 0) - (counted?.hidden ?? 0)).toBe(1);
  });

  for (const world of ['stylised', 'realistic'] as const) {
    test(`glows its own colour whatever the light, where the same box unmarked is lit, in the ${world} world’s material`, async ({
      page,
    }) => {
      await open(page);
      const glowing = {
        toward: await glowOf(page, world, 'toward', true),
        away: await glowOf(page, world, 'away', true),
      };
      const lit = {
        toward: await glowOf(page, world, 'toward', false),
        away: await glowOf(page, world, 'away', false),
      };
      console.log(`#1624 ${world}: glowing ${JSON.stringify(glowing)}, lit ${JSON.stringify(lit)}`);
      for (const reading of [glowing.toward, glowing.away]) {
        reading.forEach((channel, at) => {
          expect(Math.abs(channel - (PROBE[at] as number))).toBeLessThanOrEqual(CHANNEL_TOLERANCE);
        });
      }
      // The control: the unmarked box IS lit — bright with the light at it,
      // dark with it turned away — so the glowing one is not merely a box the
      // light happened to reach.
      expect(brightness(lit.toward)).toBeGreaterThan(100);
      expect(brightness(lit.away)).toBeLessThan(10);
    });
  }

  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`is steady: two frames a second apart read the same, ${reducedMotion}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await open(page);
      for (const world of ['stylised', 'realistic'] as const) {
        const first = await glowOf(page, world, 'away', true);
        await page.waitForTimeout(1_000);
        const second = await glowOf(page, world, 'away', true);
        expect(second, world).toEqual(first);
        expect(brightness(first), world).toBeGreaterThan(150);
      }
    });

    test(`keeps the holidays’ own glowing parts steady — Halloween’s faces (#1625), the winter lights’ bulbs (#1626) and the village tree’s baubles (#1627): two frames a second apart read the same, ${reducedMotion}`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion });
      await open(page);
      const glowsOf = (world: 'stylised' | 'realistic', holiday: 'halloween' | 'winter-lights') =>
        page.evaluate(
          ([w, h]) => {
            const harness = window.__oylDecoration;
            if (harness === undefined) throw new Error('no harness');
            return harness.holidayGlows(w, h);
          },
          [world, holiday] as const,
        );
      for (const holiday of ['halloween', 'winter-lights'] as const) {
        for (const world of ['stylised', 'realistic'] as const) {
          const first = await glowsOf(world, holiday);
          await page.waitForTimeout(1_000);
          const second = await glowsOf(world, holiday);
          expect(first.length, `${holiday} ${world}`).toBeGreaterThan(0);
          // #1627: the tree's every bauble colour is among those read.
          if (holiday === 'winter-lights') {
            expect(TREE_GLOWS.length).toBeGreaterThan(0);
            for (const colour of TREE_GLOWS) {
              expect(first.map((each) => [...each.colour])).toContainEqual(colour);
            }
          }
          expect(second.map((each) => each.pixel)).toEqual(first.map((each) => each.pixel));
          // And each glows its own colour with the light turned away from it.
          for (const { pixel, colour } of first) {
            pixel.forEach((channel, at) => {
              expect(
                Math.abs(channel - (colour[at] as number)),
                `${holiday} ${world}`,
              ).toBeLessThanOrEqual(CHANNEL_TOLERANCE);
            });
          }
        }
      }
    });
  }
});
