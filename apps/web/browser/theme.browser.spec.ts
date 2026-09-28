// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The dark palette, as the pinned Chromium paints it — #672.
 *
 * `contrast.a11y.test.ts` measures the tokens and `theme.a11y.test.ts` holds
 * `theme.css`'s two blocks to them, and neither can say whether a page is
 * PAINTED in the dark palette, or when. This does, in four parts:
 *
 * 1. **No wrong-palette first frame**, on the PRODUCT build (`dist`, served on
 *    its own port). An init script — which runs before any script of the
 *    page's own — registers a `requestAnimationFrame`, and the callback reads
 *    the body's computed background: that is the colour of the first frame.
 *    Under a dark device with nothing chosen it must be the dark canvas; with
 *    *Light* chosen under a dark device, the light one; with *Dark* chosen
 *    under a light device, the dark one. **Control:** the same page with the
 *    inline theme script cut out of the HTML must paint its first frame LIGHT
 *    under a dark device — which is the flash this issue exists to remove, and
 *    what makes the positive reads a statement about the script rather than
 *    about a page that happened to be dark.
 * 2. **The choice survives a reload**: Settings' *Dark*, pressed on the
 *    product, then the page reloaded and a second page opened, each reading
 *    `data-theme` and its first frame.
 * 3. **Every route is painted from the dark palette** under a dark device —
 *    `shell.html` with the real `AppShell` and route table: the body, the
 *    header's surface (#671's alias), every link in running text and every
 *    primary button. **Control:** the dark block deleted through the CSSOM,
 *    after which the same reads must fail on every route.
 * 4. **The HUD is untouched**: `hud.html`, and a ride carrying every control
 *    and notice the HUD can (`ride.html?trainer=workout&sounds=on&side=lost`),
 *    each read under a light device and then a dark one — every computed
 *    colour of `.oyl-hud` and of EVERY descendant and pseudo-element
 *    (buttons, the range, status messages, SVG fill and stroke) identical,
 *    each panel the HUD's own surface, and on the ride the mute toggle, the
 *    volume, the side camera's Stop and the warning notice the same PIXELS —
 *    with the page around it shown to have changed, so "identical" is not two
 *    light reads. **Control:** the pin (`theme.css` §`.oyl-hud`) deleted
 *    through the CSSOM, after which the mute toggle and the warning notice
 *    must follow the page, which is what #744's review measured.
 *
 * ## What this does NOT prove
 *
 * - The Android WebView. The owner's tablet check (a cold start in a dark room,
 *   in each palette and with the override opposite the device) is the proof
 *   there, and it is a device criterion no gate here can meet.
 * - The launch screen before the WebView paints: that is native, and #672's
 *   second half (`res/values-night`).
 * - The basemap, which is literal colours in `map/basemap.ts` — also #672's
 *   second half.
 */

import { expect, test, type Page } from '@playwright/test';

import { PRODUCT_ORIGIN } from '../playwright.config';
import { THEME_STORAGE_KEY } from '../src/design/theme-selection';
import { paletteColours, type ColourToken, type Theme } from '../src/design/tokens';
import { THEME_SELECTION_MARKER } from '../tools/theme/theme-selection-plugin';
import { ALL_ROUTES, hrefFor } from '../src/shell/routes';

/** `#0b5c55` → `rgb(11, 92, 85)`, as Chromium reports a computed colour. */
function rgb(theme: Theme, token: ColourToken): string {
  const hex = paletteColours(theme)[token];
  const channel = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
  return `rgb(${String(channel(1))}, ${String(channel(3))}, ${String(channel(5))})`;
}

interface FirstFrame {
  readonly theme: string | null;
  readonly background: string;
  readonly stylesheets: number;
}

declare global {
  interface Window {
    __oylFirstFrame?: FirstFrame;
  }
}

/**
 * Register the first-frame read before anything of the page's runs. An init
 * script is evaluated in every new document before its own scripts, so the
 * callback is the FIRST animation frame's — which is the frame before the
 * first paint.
 */
async function probeFirstFrame(page: Page): Promise<void> {
  await page.addInitScript(() => {
    requestAnimationFrame(() => {
      const surface = document.body ?? document.documentElement;
      window.__oylFirstFrame = {
        theme: document.documentElement.getAttribute('data-theme'),
        background: getComputedStyle(surface).backgroundColor,
        stylesheets: document.styleSheets.length,
      };
    });
  });
}

/** Choose a palette on this device before the page runs, as Settings would have. */
async function chooseBeforeLoad(page: Page, choice: 'light' | 'dark'): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, value);
    },
    [THEME_STORAGE_KEY, choice] as const,
  );
}

async function firstFrame(page: Page): Promise<FirstFrame> {
  await page.waitForFunction(() => window.__oylFirstFrame !== undefined);
  const frame = await page.evaluate(() => window.__oylFirstFrame);
  if (frame === undefined) throw new Error('no first frame was read');
  return frame;
}

/** The product's page with the inline theme script cut out — the control. */
async function withoutTheScript(page: Page): Promise<{ cut: () => number }> {
  let cut = 0;
  await page.route(`${PRODUCT_ORIGIN}/`, async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    const stripped = html.replace(
      new RegExp(`<script id="${THEME_SELECTION_MARKER}">[\\s\\S]*?</script>`),
      '',
    );
    if (stripped !== html) cut += 1;
    await route.fulfill({ response, body: stripped });
  });
  return { cut: () => cut };
}

test.describe('#672 — no frame is painted in the wrong palette', () => {
  const cases: readonly {
    readonly device: 'light' | 'dark';
    readonly chosen?: 'light' | 'dark';
    readonly expected: Theme;
  }[] = [
    { device: 'dark', expected: 'dark' },
    { device: 'light', expected: 'light' },
    { device: 'dark', chosen: 'light', expected: 'light' },
    { device: 'light', chosen: 'dark', expected: 'dark' },
  ];

  for (const { device, chosen, expected } of cases) {
    test(`a ${device} device${chosen === undefined ? '' : `, ${chosen} chosen`}: the first frame is ${expected}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: device });
      await probeFirstFrame(page);
      if (chosen !== undefined) await chooseBeforeLoad(page, chosen);
      await page.goto(`${PRODUCT_ORIGIN}/`);
      const frame = await firstFrame(page);
      // The stylesheet is in force at the first frame, so the colour read is
      // the palette's and not the browser's default canvas.
      expect(frame.stylesheets, 'no stylesheet at the first frame').toBeGreaterThan(0);
      expect(frame.theme).toBe(expected);
      expect(frame.background).toBe(rgb(expected, 'canvas'));
    });
  }

  test('the control — without the inline script, a dark device gets a LIGHT first frame', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await probeFirstFrame(page);
    const control = await withoutTheScript(page);
    await page.goto(`${PRODUCT_ORIGIN}/`);
    const frame = await firstFrame(page);
    expect(control.cut(), 'the theme script was not found in dist/index.html to cut').toBe(1);
    expect(frame.stylesheets).toBeGreaterThan(0);
    expect(frame.theme).toBeNull();
    expect(frame.background).toBe(rgb('light', 'canvas'));
  });
});

test.describe('#672 — a choice made in Settings survives a reload', () => {
  test('Dark, pressed on the product under a light device, is dark from the first frame after', async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto(`${PRODUCT_ORIGIN}/#/settings`);
    const group = page.getByRole('group', { name: 'Light or dark?' });
    await expect(group).toBeVisible();
    const radios = group.getByRole('radio');
    await expect(radios).toHaveCount(3);
    await expect(group.getByRole('radio', { name: 'Match this device' })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('light');

    await group.getByText('Dark', { exact: true }).click();
    await expect(group.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      rgb('dark', 'canvas'),
    );

    await probeFirstFrame(page);
    await page.reload();
    const reloaded = await firstFrame(page);
    expect(reloaded.theme).toBe('dark');
    expect(reloaded.background).toBe(rgb('dark', 'canvas'));

    // A fresh page in the same browser — the next launch, as near as a gate gets.
    const next = await context.newPage();
    await next.emulateMedia({ colorScheme: 'light' });
    await probeFirstFrame(next);
    await next.goto(`${PRODUCT_ORIGIN}/#/settings`);
    expect((await firstFrame(next)).theme).toBe('dark');
    await expect(
      next.getByRole('group', { name: 'Light or dark?' }).getByRole('radio', { name: 'Dark' }),
    ).toBeChecked();

    // And back to the device, which is followed again with no reload.
    await next
      .getByRole('group', { name: 'Light or dark?' })
      .getByText('Match this device', { exact: true })
      .click();
    expect(await next.evaluate(() => document.documentElement.dataset['theme'])).toBe('light');
    await next.emulateMedia({ colorScheme: 'dark' });
    await expect
      .poll(() => next.evaluate(() => document.documentElement.dataset['theme']))
      .toBe('dark');
  });
});

/** What one route paints, read back from the engine. */
interface RoutePaint {
  readonly theme: string | null;
  readonly body: string;
  readonly header: string | null;
  readonly links: readonly string[];
  readonly primaries: readonly { readonly background: string; readonly color: string }[];
}

async function readRoute(page: Page): Promise<RoutePaint> {
  return page.evaluate(() => {
    const header = document.querySelector('.oyl-header');
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      body: getComputedStyle(document.body).backgroundColor,
      header: header === null ? null : getComputedStyle(header).backgroundColor,
      links: [...document.querySelectorAll('main a:not([class])')].map(
        (link) => getComputedStyle(link).color,
      ),
      primaries: [
        ...document.querySelectorAll<HTMLButtonElement>(
          'button.oyl-button:not(.oyl-button--secondary):not(.oyl-button--toggle):not(:disabled)',
        ),
      ].map((button) => {
        const style = getComputedStyle(button);
        return { background: style.backgroundColor, color: style.color };
      }),
    };
  });
}

/** Every read on a route that is not the dark palette's. Empty is a pass. */
function darkFaults(route: string, seen: RoutePaint): string[] {
  const faults: string[] = [];
  if (seen.theme !== 'dark') faults.push(`${route}: data-theme is ${String(seen.theme)}`);
  if (seen.body !== rgb('dark', 'canvas')) faults.push(`${route}: the page is ${seen.body}`);
  if (seen.header === null) faults.push(`${route}: no header to read a surface from`);
  else if (seen.header !== rgb('dark', 'surfaceOverlay')) {
    faults.push(`${route}: the header's surface is ${seen.header}`);
  }
  for (const colour of seen.links) {
    if (colour !== rgb('dark', 'link')) faults.push(`${route}: a link is ${colour}`);
  }
  for (const primary of seen.primaries) {
    if (primary.background !== rgb('dark', 'accent')) {
      faults.push(`${route}: a primary button's fill is ${primary.background}`);
    }
    if (primary.color !== rgb('dark', 'accentInk')) {
      faults.push(`${route}: a primary button's label is ${primary.color}`);
    }
  }
  return faults;
}

async function openShellRoute(page: Page, route: (typeof ALL_ROUTES)[number]): Promise<void> {
  await page.goto(`/shell.html?links=specimens&route=${route.id}${hrefFor(route)}`);
  await page.waitForSelector('html[data-oyl-shell-ready]');
}

test.describe('#672 — every route is painted from the dark palette under a dark device', () => {
  // Wide enough for the header, whose surface is #671's alias.
  test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 800 } });

  test('the page, its header, every link and every primary button', async ({ page }) => {
    test.setTimeout(120_000);
    const faults: string[] = [];
    let links = 0;
    let primaries = 0;
    for (const route of ALL_ROUTES) {
      await openShellRoute(page, route);
      const seen = await readRoute(page);
      links += seen.links.length;
      primaries += seen.primaries.length;
      faults.push(...darkFaults(route.id, seen));
    }
    console.log(
      `#672: ${String(ALL_ROUTES.length)} routes dark, ${String(links)} links, ${String(primaries)} primary buttons`,
    );
    expect(ALL_ROUTES.length).toBeGreaterThan(0);
    // Counted, so a walk that found nothing to read cannot pass over it.
    expect(links, 'no route rendered a link in running text').toBeGreaterThan(0);
    expect(primaries, 'no route rendered a primary button').toBeGreaterThan(0);
    expect(faults).toEqual([]);
  });

  test('the control — with the dark block deleted, every route fails the same reads', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    let deleted = 0;
    let failing = 0;
    for (const route of ALL_ROUTES) {
      await openShellRoute(page, route);
      deleted += await page.evaluate(() => {
        let removed = 0;
        for (const sheet of document.styleSheets) {
          for (let index = sheet.cssRules.length - 1; index >= 0; index -= 1) {
            const rule = sheet.cssRules[index];
            if (
              rule instanceof CSSStyleRule &&
              rule.selectorText.replaceAll('"', "'") === ":root[data-theme='dark']"
            ) {
              sheet.deleteRule(index);
              removed += 1;
            }
          }
        }
        return removed;
      });
      if (darkFaults(route.id, await readRoute(page)).length > 0) failing += 1;
    }
    expect(deleted, 'the dark block was not found to delete').toBe(ALL_ROUTES.length);
    expect(failing).toBe(ALL_ROUTES.length);
  });
});

/** Every computed colour property the HUD walk reads, on an element and its pseudo-elements. */
const HUD_COLOUR_PROPERTIES = [
  'color',
  'background-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'caret-color',
  'accent-color',
  'fill',
  'stroke',
  'box-shadow',
  'color-scheme',
] as const;

/** One element's (or pseudo-element's) paint inside the HUD. */
interface HudEntry {
  /** Where it is: its index in the walk, its tag and its classes, and a pseudo-element. */
  readonly at: string;
  readonly paint: string;
}

/** What the HUD paints, and the page behind it. */
interface HudPaint {
  readonly theme: string | null;
  readonly page: string;
  readonly entries: readonly HudEntry[];
  readonly panels: readonly string[];
}

/**
 * Every computed colour of `.oyl-hud` and EVERY descendant — buttons, inputs,
 * status messages, SVG fill and stroke — and of each one's `::before`,
 * `::after` and `::marker`. #744's review measured the mute toggle and a
 * warning notice following the page while the panels did not; a read of the
 * panels alone could not see that half.
 */
async function readHudPaint(page: Page): Promise<HudPaint> {
  return page.evaluate((properties) => {
    const hud = document.querySelector('.oyl-hud');
    if (hud === null) throw new Error('no .oyl-hud on the page');
    const entries: { at: string; paint: string }[] = [];
    [hud, ...hud.querySelectorAll('*')].forEach((element, index) => {
      const name = `${String(index)} ${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`;
      for (const pseudo of [null, '::before', '::after', '::marker']) {
        const style = getComputedStyle(element, pseudo);
        entries.push({
          at: pseudo === null ? name : `${name}${pseudo}`,
          paint: properties
            .map((property) => `${property}=${style.getPropertyValue(property)}`)
            .join('; '),
        });
      }
    });
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      page: getComputedStyle(document.body).backgroundColor,
      entries,
      panels: [...document.querySelectorAll('.oyl-hud__panel')].map(
        (panel) => getComputedStyle(panel).backgroundColor,
      ),
    };
  }, HUD_COLOUR_PROPERTIES);
}

/** Switch the device's palette under a loaded page, which the inline script follows. */
async function deviceBecomes(page: Page, scheme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(scheme);
}

/** The entries whose paint differs between two reads of the same page. */
function moved(light: HudPaint, dark: HudPaint): string[] {
  expect(dark.entries.map((entry) => entry.at)).toEqual(light.entries.map((entry) => entry.at));
  return light.entries.flatMap((entry, index) =>
    entry.paint === dark.entries[index]?.paint
      ? []
      : [`${entry.at}\n  light: ${entry.paint}\n  dark:  ${String(dark.entries[index]?.paint)}`],
  );
}

/** The page behind the HUD did change, so an equal HUD is not two reads of an unswitched page. */
function expectThePageSwitched(light: HudPaint, dark: HudPaint): void {
  expect(light.theme).toBe('light');
  expect(dark.theme).toBe('dark');
  expect(light.page).toBe(rgb('light', 'canvas'));
  expect(dark.page).toBe(rgb('dark', 'canvas'));
}

/**
 * The pin (`theme.css` §`.oyl-hud`) deleted through the CSSOM — the control.
 * Returns how many declarations were removed.
 */
async function unpinTheHud(page: Page): Promise<number> {
  return page.evaluate(() => {
    let removed = 0;
    for (const sheet of document.styleSheets) {
      for (const rule of sheet.cssRules) {
        if (!(rule instanceof CSSStyleRule) || rule.selectorText !== '.oyl-hud') continue;
        for (const property of [...rule.style]) {
          if (property.startsWith('--oyl-color-') || property === 'color-scheme') {
            rule.style.removeProperty(property);
            removed += 1;
          }
        }
      }
    }
    return removed;
  });
}

test.describe('#672 — the HUD is the same in both palettes', () => {
  test('hud.html: every descendant of the HUD paints the same in light and dark', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    const response = await page.goto('/hud.html');
    expect(response?.status()).toBe(200);
    await page.waitForFunction(
      () =>
        (window as { __oylHudHarness?: { readonly ready: boolean } }).__oylHudHarness?.ready ===
        true,
    );
    const light = await readHudPaint(page);
    await deviceBecomes(page, 'dark');
    const dark = await readHudPaint(page);
    expectThePageSwitched(light, dark);
    expect(light.panels.length).toBeGreaterThan(0);
    // Absolute as well as relative: a panel painted with a PAGE token would
    // read the same in both palettes now that the pin holds page tokens light.
    for (const panel of light.panels) expect(panel).toBe(rgb('light', 'hudSurface'));
    expect(moved(light, dark)).toEqual([]);
  });

  test.describe('a ride with every control and notice the HUD can carry', () => {
    // The mute toggle and the volume (`sounds=on`), the side camera's Stop and
    // its lost-link notice (`side=lost`), the workout's warning notice
    // (`trainer=workout`), paused so nothing on the HUD ticks between reads.
    test.use({ viewport: { width: 844, height: 390 } });

    const QUERY = '?trainer=workout&sounds=on&side=lost&paused=yes';

    const PIXEL_TARGETS = [
      '.oyl-sound__mute',
      '.oyl-sound__volume input',
      '.oyl-hud__side-camera-stop',
      '.oyl-hud__notices .oyl-status--warning',
    ] as const;

    async function pixels(page: Page): Promise<Buffer[]> {
      const shots: Buffer[] = [];
      for (const selector of PIXEL_TARGETS) {
        shots.push(await page.locator(selector).first().screenshot({ animations: 'disabled' }));
      }
      return shots;
    }

    test('every computed colour and every control’s pixels are identical; unpinned, they move', async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      const response = await page.goto(`/ride.html${QUERY}`);
      expect(response?.status()).toBe(200);
      await page.waitForFunction(
        () => (window as { __oylRide?: { readonly ready: boolean } }).__oylRide !== undefined,
      );
      const published = await page.evaluate(
        () =>
          (window as { __oylRide?: { readonly ready: boolean; readonly errors: string[] } })
            .__oylRide,
      );
      expect(published?.errors).toEqual([]);
      expect(published?.ready).toBe(true);

      // What the walk must find, so a HUD that rendered none of them fails.
      for (const selector of PIXEL_TARGETS) {
        await expect(page.locator(selector).first(), `no ${selector} on the HUD`).toBeVisible();
      }
      // An SVG is in the walk too, though at this size the profile is not shown.
      expect(await page.locator('.oyl-hud svg').count(), 'no SVG in the HUD').toBeGreaterThan(0);

      const light = await readHudPaint(page);
      const lightPixels = await pixels(page);
      await deviceBecomes(page, 'dark');
      const dark = await readHudPaint(page);
      const darkPixels = await pixels(page);

      expectThePageSwitched(light, dark);
      for (const panel of light.panels) expect(panel).toBe(rgb('light', 'hudSurface'));
      expect(moved(light, dark)).toEqual([]);
      PIXEL_TARGETS.forEach((selector, index) => {
        expect(
          darkPixels[index]?.equals(lightPixels[index] ?? Buffer.alloc(0)),
          `${selector} is not the same pixels in light and dark`,
        ).toBe(true);
      });

      // The control: the pin deleted, the SAME reads must see the mute toggle
      // and the warning notice follow the page — what #744's review measured.
      expect(await unpinTheHud(page), 'the pin was not found to delete').toBe(29);
      const unpinned = await readHudPaint(page);
      const unpinnedPixels = await pixels(page);
      const movedWithoutThePin = moved(light, unpinned).join('\n');
      expect(movedWithoutThePin).toContain('oyl-sound__mute');
      expect(movedWithoutThePin).toContain('oyl-status--warning');
      expect(unpinnedPixels[0]?.equals(lightPixels[0] ?? Buffer.alloc(0))).toBe(false);
    });
  });
});
