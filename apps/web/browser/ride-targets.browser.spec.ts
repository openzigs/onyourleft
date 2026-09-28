// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride-time touch target — #669, measured by a real engine.
 *
 * The owner's ruling of 2026-09-27: the controls a rider presses DURING a
 * ride — *Start*, *Pause*, *End* and *Set target* — get **48 px** targets, and
 * everything else stays at `.oyl-button`'s 44 (#316). 44 is WCAG 2.2 **SC 2.5.5
 * (Target Size (Enhanced), AAA)**; ⚠️ not SC 2.5.8, which is the AA criterion
 * and is 24. 48 is Android's own guidance — 48 dp, one CSS px each in a
 * WebView — with 8 dp between targets.
 *
 * Which controls those are is ONE list, `src/design/ride-time-controls.ts`
 * §`RIDE_TIME_CONTROLS`, and this spec walks it: every entry must be found on
 * one of the {@link SCENES} at every viewport, so an entry that no scene
 * renders is a red build rather than a loop over nothing.
 *
 * ## Three measurements, and they fail for three different reasons (#316)
 *
 * - **the shipped box** — at least 48 × 48, at a phone either way up and the
 *   owner's tablet, because a wrapped label and a narrow column are layout.
 * - **the declaration** — the control wears `oyl-button--ride` and its computed
 *   `min-height` and `min-width` are at least 48. ⚠️ Weak on its own, as #316
 *   found of its own: it says the rule is there, not that it does anything.
 * - **the box with the floor stripped** — every ride-time control on the page
 *   at `min-height: 0; min-width: 0` at once (at once, because the HUD's two are
 *   flex items that stretch to the taller of the pair), which must fall UNDER
 *   48. That is what proves the floor is doing the work: a control that is 48
 *   because of its padding would stay 48 and go red here, with the floor then
 *   decorative.
 *
 * And the two halves the issue adds: an ORDINARY button beside them — *End
 * ERG*, in the same form as *Set target* — still declares exactly 44 and is
 * under 48, so the size did not leak through a container; and no two ride-time
 * controls on a screen are closer than 8 px, box to box.
 *
 * ## The control
 *
 * The modifier taken off *Set target* on the live element: its shipped box and
 * its declaration must both fall under 48. Without it every case above is just
 * as true of a stylesheet that made EVERY button 48 — which the ordinary
 * button's case also catches, from the other side.
 *
 * ## What this does not prove
 *
 * Anything on a device. The tablet check — Start, Pause, Resume, Stop and the
 * game's Pause / End ride on the Pixel Tablet in the shell, both ways up — is
 * the owner's, which is why #669's pull request says `Refs`.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  RIDE_TIME_CONTROLS,
  RIDE_TIME_SPACING_PIXELS,
  RIDE_TIME_TARGET_PIXELS,
  namesControl,
  type RideTimeControl,
  type RideTimeSurface,
} from '../src/design/ride-time-controls';

/** `.oyl-button`'s floor, which every other button keeps. @see shell.browser.spec.ts */
const ORDINARY_TARGET_PIXELS = 44;

/** Sub-pixel layout, not slack. @see ride.browser.spec.ts */
const SUBPIXEL_TOLERANCE = 0.5;

const RIDE_CLASS = 'oyl-button--ride';

const VIEWPORTS = [
  { name: 'a phone upright — 390×844', width: 390, height: 844 },
  { name: 'a phone in landscape — 844×390', width: 844, height: 390 },
  { name: 'the owner’s tablet — 1280×800', width: 1280, height: 800 },
] as const;

interface Scene {
  readonly name: string;
  readonly page: 'rideview' | 'ride';
  readonly query: string;
  /** Which surfaces of the list this page renders. */
  readonly surfaces: readonly RideTimeSurface[];
  /** An ordinary button this scene must also hold at 44, if it has one. */
  readonly ordinary?: string;
}

const RIDE_SCREEN: readonly RideTimeSurface[] = ['ride-screen', 'trainer-panel', 'workout-panel'];

/**
 * Every state that puts a ride-time control on the screen. The Ride screen
 * through `rideview-harness.tsx` (`?ride=` is #669's), the game through
 * `ride-harness.tsx`, which RIDES — its HUD is the one a rider gets.
 */
const SCENES: readonly Scene[] = [
  {
    name: 'the Ride screen before a ride',
    page: 'rideview',
    query: '?ride=idle',
    surfaces: RIDE_SCREEN,
  },
  {
    name: 'the Ride screen mid-ride',
    page: 'rideview',
    query: '',
    surfaces: RIDE_SCREEN,
    ordinary: 'End ERG',
  },
  {
    name: 'the Ride screen, paused, stop armed',
    page: 'rideview',
    query: '?ride=armed',
    surfaces: RIDE_SCREEN,
  },
  {
    name: 'the Ride screen, a workout running',
    page: 'rideview',
    query: '?workout=running',
    surfaces: RIDE_SCREEN,
  },
  { name: 'the game, sounds on', page: 'ride', query: '?sounds=on', surfaces: ['game-hud'] },
];

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface ButtonReading {
  readonly name: string;
  readonly ride: boolean;
  readonly box: Box;
  readonly minHeight: number;
  readonly minWidth: number;
  /** The box with `min-height`/`min-width` stripped, taken with every ride control stripped. */
  readonly stripped: Box;
  readonly strippedMin: string;
}

async function open(page: Page, scene: Scene): Promise<void> {
  const response = await page.goto(`/${scene.page}.html${scene.query}`);
  expect(
    response?.status(),
    `${scene.page}.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?`,
  ).toBe(200);
  // Both harnesses publish `{ ready, errors }` on a global of their own.
  const global = scene.page === 'rideview' ? '__oylRideView' : '__oylRide';
  await page.waitForFunction((name) => name in window, global);
  const published = await page.evaluate(
    (name) =>
      (window as unknown as Record<string, { ready: boolean; errors: readonly string[] }>)[name],
    global,
  );
  expect(published?.errors, `the ${scene.page} harness reported an error`).toEqual([]);
  expect(published?.ready).toBe(true);
}

/**
 * Every button on the page, as laid out and with the floors of `strip` taken
 * away. `strip` is the ride-time controls this page carries, found by name.
 */
async function readButtons(
  page: Page,
  isRideTime: (name: string) => boolean,
): Promise<readonly ButtonReading[]> {
  const names = await page.evaluate(() =>
    [...document.querySelectorAll('button')].map((each) =>
      (each.textContent ?? '').replace(/\s+/g, ' ').trim(),
    ),
  );
  const strip = names.map(isRideTime);
  return page.evaluate(
    ({ strip, rideClass }) => {
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
      const buttons = [...document.querySelectorAll<HTMLElement>('button')];
      const shipped = buttons.map((each) => {
        const style = getComputedStyle(each);
        return {
          name: (each.textContent ?? '').replace(/\s+/g, ' ').trim(),
          ride: each.classList.contains(rideClass),
          box: boxOf(each),
          minHeight: Number.parseFloat(style.minHeight),
          minWidth: Number.parseFloat(style.minWidth),
        };
      });
      const before = buttons.map((each) => each.style.cssText);
      buttons.forEach((each, index) => {
        if (strip[index] === true) {
          each.style.minHeight = '0px';
          each.style.minWidth = '0px';
        }
      });
      const stripped = buttons.map((each) => ({
        box: boxOf(each),
        min: getComputedStyle(each).minHeight,
      }));
      buttons.forEach((each, index) => {
        each.style.cssText = before[index] ?? '';
      });
      return shipped.map((each, index) => ({
        ...each,
        stripped: stripped[index]?.box ?? each.box,
        strippedMin: stripped[index]?.min ?? '',
      }));
    },
    { strip, rideClass: RIDE_CLASS },
  );
}

function entriesOf(scene: Scene): readonly RideTimeControl[] {
  return RIDE_TIME_CONTROLS.filter((entry) => scene.surfaces.includes(entry.surface));
}

function rideTimeIn(scene: Scene): (name: string) => boolean {
  return (name) => entriesOf(scene).some((entry) => namesControl(entry, name));
}

/** Box to box: the larger of the horizontal and vertical gaps, a lower bound on the distance. */
function separation(a: Box, b: Box): number {
  const across = Math.max(b.left - a.right, a.left - b.right);
  const down = Math.max(b.top - a.bottom, a.top - b.bottom);
  return Math.max(across, down);
}

const describe = (reading: ButtonReading): string =>
  `“${reading.name}” ${reading.box.width.toFixed(1)}×${reading.box.height.toFixed(1)} at y ${reading.box.top.toFixed(0)}`;

for (const viewport of VIEWPORTS) {
  test.describe(`#669 — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    /**
     * ⚠️ The apparatus. Every entry of the list is found on some scene; a
     * list entry nothing renders would otherwise be skipped by every loop
     * below.
     */
    test('every control on the list is found on a scene', async ({ page }) => {
      const found = new Set<RideTimeControl>();
      for (const scene of SCENES) {
        await open(page, scene);
        const names = (await readButtons(page, () => false)).map((each) => each.name);
        for (const entry of entriesOf(scene)) {
          if (names.some((name) => namesControl(entry, name))) found.add(entry);
        }
      }
      const missing = RIDE_TIME_CONTROLS.filter((entry) => !found.has(entry)).map(
        (entry) => `${entry.surface}: ${entry.name}`,
      );
      expect(missing, 'on the list and on no scene').toEqual([]);
    });

    for (const scene of SCENES) {
      test.describe(scene.name, () => {
        test('each ride-time control is a 48×48 box, declares it, and falls short without it', async ({
          page,
        }, testInfo) => {
          await open(page, scene);
          const readings = await readButtons(page, rideTimeIn(scene));
          const ride = readings.filter((each) => rideTimeIn(scene)(each.name));
          expect(ride.length, 'no ride-time control on this scene').toBeGreaterThan(0);

          const note = ride
            .map(
              (each) =>
                `${describe(each)}; stripped ${each.stripped.width.toFixed(1)}×${each.stripped.height.toFixed(1)}`,
            )
            .join(' · ');
          testInfo.annotations.push({ type: 'ride-time targets', description: note });
          console.log(`#669 ride-time targets — ${viewport.name} — ${scene.name} — ${note}`);

          for (const each of ride) {
            // 1. The shipped box.
            expect(
              each.box.height,
              `${describe(each)}: under the 48 px ride-time target`,
            ).toBeGreaterThanOrEqual(RIDE_TIME_TARGET_PIXELS - SUBPIXEL_TOLERANCE);
            expect(
              each.box.width,
              `${describe(each)}: a target is two-dimensional`,
            ).toBeGreaterThanOrEqual(RIDE_TIME_TARGET_PIXELS - SUBPIXEL_TOLERANCE);
            // 2. The declaration.
            expect(each.ride, `“${each.name}” does not wear ${RIDE_CLASS}`).toBe(true);
            expect(
              each.minHeight,
              `“${each.name}” declares min-height ${String(each.minHeight)}px`,
            ).toBeGreaterThanOrEqual(RIDE_TIME_TARGET_PIXELS);
            expect(
              each.minWidth,
              `“${each.name}” declares min-width ${String(each.minWidth)}px`,
            ).toBeGreaterThanOrEqual(RIDE_TIME_TARGET_PIXELS);
            // 3. The floor stripped: it must fall short, or the floor is decorative.
            expect(each.strippedMin, `“${each.name}”'s floor was not taken off`).toBe('0px');
            expect(
              each.stripped.height,
              `“${each.name}” is ${each.stripped.height.toFixed(1)}px tall with its floor stripped, ` +
                'so something other than the declared 48 px is holding it there',
            ).toBeLessThan(RIDE_TIME_TARGET_PIXELS);
          }
        });

        test('no two ride-time controls are closer than 8 px', async ({ page }, testInfo) => {
          await open(page, scene);
          const ride = (await readButtons(page, () => false)).filter(
            (each) => rideTimeIn(scene)(each.name) && each.box.width > 0,
          );
          const tooClose: string[] = [];
          let closest = Infinity;
          for (const [index, a] of ride.entries()) {
            for (const b of ride.slice(index + 1)) {
              const gap = separation(a.box, b.box);
              closest = Math.min(closest, gap);
              if (gap < RIDE_TIME_SPACING_PIXELS - SUBPIXEL_TOLERANCE) {
                tooClose.push(`“${a.name}” and “${b.name}”: ${gap.toFixed(1)} px`);
              }
            }
          }
          const note = `closest pair ${Number.isFinite(closest) ? `${closest.toFixed(1)} px` : 'none'}`;
          testInfo.annotations.push({ type: 'ride-time spacing', description: note });
          console.log(`#669 ride-time spacing — ${viewport.name} — ${scene.name} — ${note}`);
          expect(tooClose).toEqual([]);
        });

        if (scene.ordinary !== undefined) {
          const ordinary = scene.ordinary;
          test(`an ordinary button — “${ordinary}” — is still the 44 px floor`, async ({
            page,
          }) => {
            await open(page, scene);
            const reading = (await readButtons(page, () => false)).find(
              (each) => each.name === ordinary,
            );
            expect(reading, `no “${ordinary}” on this scene`).toBeDefined();
            expect(reading?.ride).toBe(false);
            expect(reading?.minHeight).toBe(ORDINARY_TARGET_PIXELS);
            expect(reading?.minWidth).toBe(ORDINARY_TARGET_PIXELS);
            expect(reading?.box.height ?? 0).toBeGreaterThanOrEqual(ORDINARY_TARGET_PIXELS);
            expect(reading?.box.height ?? Infinity).toBeLessThan(RIDE_TIME_TARGET_PIXELS);
          });
        }
      });
    }

    test('the control — without the modifier, Set target falls under 48', async ({ page }) => {
      const scene = SCENES[1];
      if (scene === undefined) throw new Error('no mid-ride scene');
      await open(page, scene);
      await page.evaluate((rideClass) => {
        const target = [...document.querySelectorAll('button')].find(
          (each) => (each.textContent ?? '').trim() === 'Set target',
        );
        if (target === undefined) throw new Error('no Set target');
        target.classList.remove(rideClass);
      }, RIDE_CLASS);
      const reading = (await readButtons(page, () => false)).find(
        (each) => each.name === 'Set target',
      );
      expect(reading?.ride).toBe(false);
      expect(reading?.minHeight ?? Infinity).toBeLessThan(RIDE_TIME_TARGET_PIXELS);
      expect(reading?.box.height ?? Infinity).toBeLessThan(RIDE_TIME_TARGET_PIXELS);
    });
  });
}
