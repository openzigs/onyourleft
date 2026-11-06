// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD's street map, laid out and ridden in a real engine — #2290.
 *
 * `street-map.html` renders the real HUD over a dense synthetic corridor, and
 * with `?map=outline` over none — the plan view as it was. jsdom performs no
 * layout, so three of #2290's criteria can only be read here:
 *
 * 1. **The panel keeps its size and position, and moves no ride-time control.**
 *    At each viewport the route panel, the plan view's box and *Pause* and
 *    *End ride* are measured on both pages and must be the same boxes. Holding
 *    them to the control page rather than to numbers is what makes this hold
 *    through every phone give-way rule `theme.css` applies to the plan view:
 *    whatever the rule, the map is under it too.
 * 2. **It follows the rider**, and the mark is drawn in the middle of the box
 *    at the plan view's size.
 * 3. **Its cost**, as counts a slow runner cannot change: over a minute at
 *    40 km/h in 60 frames a second, the plan view's DOM changes only when the
 *    view moves on its 5 m grid — where the outline it replaces moves its mark
 *    every frame. A paced second of each, map and outline, publishes the
 *    engine's own main-thread times and frame intervals, and asserts none of
 *    them: they are the runner's, a timing gate needs three CI readings before
 *    it may assert anything, and the owner's tablet is what they are for.
 *
 * The screenshots of the route panel at each viewport are attached to the
 * test, for the owner.
 */

import { expect, test, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';

/** What `street-map-harness.tsx` publishes. Mirrored, as `hud.browser.spec.ts` mirrors its own. */
interface StreetMapRide {
  readonly frames: number;
  readonly mutations: number;
  readonly views: number;
  readonly medianRenderMs: number;
  readonly worstRenderMs: number;
  readonly medianFrameMs: number;
  readonly worstFrameMs: number;
}

declare global {
  interface Window {
    __oylStreetMap?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly ride?: (
        frames: number,
        metresPerFrame: number,
        paced: boolean,
      ) => Promise<StreetMapRide>;
    };
  }
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'a phone on its side, short', width: 736, height: 360 },
  { name: 'a narrow phone upright', width: 360, height: 800 },
  { name: 'the middle band', width: 802, height: 600 },
  { name: 'a landscape tablet', width: 1280, height: 800 },
] as const;

/** 40 km/h, one frame of sixty. */
const METRES_PER_FRAME = 40 / 3.6 / 60;

async function open(page: Page, map: 'street' | 'outline'): Promise<void> {
  const response = await page.goto(
    `${HARNESS_ORIGIN}/street-map.html${map === 'outline' ? '?map=outline' : ''}`,
  );
  if (response === null || !response.ok()) {
    throw new Error(
      `street-map.html did not load (${String(response?.status())}). Is it named in ` +
        `vite.browser.config.ts's build.rollupOptions.input?`,
    );
  }
  await page.waitForFunction(() => window.__oylStreetMap !== undefined);
  const published = await page.evaluate(() => window.__oylStreetMap);
  if (published === undefined || !published.ready) {
    throw new Error(`the harness did not become ready: ${published?.errors.join('; ') ?? ''}`);
  }
}

/** The boxes the map may not move: the route panel, the plan view's box, and the two controls. */
async function boxes(page: Page): Promise<Record<string, Box | undefined>> {
  return page.evaluate(() => {
    const box = (element: Element | null | undefined) => {
      if (element === null || element === undefined) return undefined;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    };
    const button = (name: string) =>
      [...document.querySelectorAll('button')].find(
        (each) => (each.textContent ?? '').trim() === name,
      );
    return {
      route: box(document.querySelector('.oyl-hud__route')),
      plan: box(document.querySelector('.oyl-hud__plan-svg')),
      pause: box(button('Pause')),
      end: box(button('End ride')),
    };
  });
}

for (const viewport of VIEWPORTS) {
  test(`#2290 the street map is the plan view's box, and moves nothing — ${viewport.name}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await open(page, 'outline');
    // The control page draws the outline and no map: what is compared against.
    expect(await page.locator('.oyl-hud__street-map').count()).toBe(0);
    const before = await boxes(page);

    await open(page, 'street');
    const map = page.locator('.oyl-hud__street-map');
    await expect(map).toHaveCount(1);
    const after = await boxes(page);

    for (const name of ['route', 'plan', 'pause', 'end'] as const) {
      const was = before[name];
      const is = after[name];
      expect(was, `${name} on the control page`).toBeDefined();
      expect(is, `${name} with the street map`).toBeDefined();
      for (const side of ['left', 'top', 'width', 'height'] as const) {
        expect(
          Math.abs((is?.[side] ?? 0) - (was?.[side] ?? 0)),
          `${name}.${side}: ${String(was?.[side])} without the map, ${String(is?.[side])} with it`,
        ).toBeLessThanOrEqual(0.5);
      }
    }

    // The rider's mark, drawn in the middle of the box at the plan view's size.
    const mark = await page.locator('.oyl-hud__street-map circle').boundingBox();
    const plan = after.plan;
    expect(mark).not.toBeNull();
    expect(mark?.width ?? 0).toBeGreaterThanOrEqual(11);
    const middle = {
      x: (plan?.left ?? 0) + (plan?.width ?? 0) / 2,
      y: (plan?.top ?? 0) + (plan?.height ?? 0) / 2,
    };
    expect(Math.abs((mark?.x ?? 0) + (mark?.width ?? 0) / 2 - middle.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((mark?.y ?? 0) + (mark?.height ?? 0) / 2 - middle.y)).toBeLessThanOrEqual(1);
    // And streets drawn across the box: the map is there, not a blank square.
    const streets = await page
      .locator('.oyl-hud__street-map [data-oyl-street-map="streets"]')
      .boundingBox();
    expect(streets?.width ?? 0).toBeGreaterThanOrEqual((plan?.width ?? 0) - 1);
    expect(streets?.height ?? 0).toBeGreaterThanOrEqual((plan?.height ?? 0) - 1);

    console.log(
      `#2290 the street map at ${viewport.name} (${String(viewport.width)}×${String(viewport.height)}): ` +
        `${(plan?.width ?? 0).toFixed(1)} × ${(plan?.height ?? 0).toFixed(1)} px, the mark ` +
        `${(mark?.width ?? 0).toFixed(1)} px across`,
    );
    const panel = page.locator('.oyl-hud__route');
    await testInfo.attach(`route panel, ${viewport.name}`, {
      body: await panel.screenshot(),
      contentType: 'image/png',
    });
  });
}

/** Ride `frames` frames on a freshly opened page, and read the engine's main-thread times around it. */
async function rideOn(page: Page, map: 'street' | 'outline', frames: number, paced: boolean) {
  await open(page, map);
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const metric = async (): Promise<Record<string, number>> =>
    Object.fromEntries(
      (await session.send('Performance.getMetrics')).metrics.map((each) => [each.name, each.value]),
    );
  const start = await metric();
  const ridden = await page.evaluate(
    async ([count, step, steady]) => window.__oylStreetMap?.ride?.(count, step, steady),
    [frames, METRES_PER_FRAME, paced] as const,
  );
  const end = await metric();
  await session.detach();
  if (ridden === undefined) throw new Error('the harness published no ride');
  const perFrame = (name: string): number =>
    (((end[name] ?? 0) - (start[name] ?? 0)) * 1000) / frames;
  return {
    ridden,
    script: perFrame('ScriptDuration'),
    style: perFrame('RecalcStyleDuration'),
    layout: perFrame('LayoutDuration'),
    task: perFrame('TaskDuration'),
  };
}

test('#2290 the street map follows the rider, and writes to the DOM only when the view moves', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // One minute at 40 km/h, sixty frames a second: 667 m.
  const frames = 3600;
  const street = (await rideOn(page, 'street', frames, false)).ridden;
  const outline = (await rideOn(page, 'outline', frames, false)).ridden;
  expect(street.frames).toBe(frames);

  // It follows: the view moves once per 5 m step ridden, and no oftener.
  const metres = frames * METRES_PER_FRAME;
  expect(street.views).toBeGreaterThan(metres / 5 - 2);
  expect(street.views).toBeLessThanOrEqual(Math.ceil(metres / 5) + 1);
  // And it writes only then: each move rewrites the viewBox and the mark's
  // two coordinates, and once per 500 m cell the five layers. Eight records
  // a move is that with room; a map redrawn every frame would be thousands.
  expect(street.mutations).toBeLessThanOrEqual(8 * street.views);
  // The control: the outline it replaces moves its mark on every frame.
  expect(outline.mutations).toBeGreaterThanOrEqual(frames);
  expect(street.mutations).toBeLessThan(outline.mutations / 10);
  console.log(
    `#2290 a minute at 40 km/h, ${String(frames)} frames: the street map made ` +
      `${String(street.mutations)} DOM records in ${String(street.views)} views; the outline ` +
      `${String(outline.mutations)} in ${String(outline.views)}`,
  );
});

test('#2290 what a paced ride costs the engine, map and outline — published, not asserted', async ({
  page,
}) => {
  // A second of riding each, one step per animation frame. The numbers are
  // the runner's and are for reading against the owner's tablet; only that
  // the ride completed is asserted (see the header).
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const frames = 60;
  const outline = await rideOn(page, 'outline', frames, true);
  const street = await rideOn(page, 'street', frames, true);
  expect(street.ridden.frames).toBe(frames);
  expect(outline.ridden.frames).toBe(frames);
  const line = (what: string, reading: typeof street): string =>
    `${what}: per frame, script ${reading.script.toFixed(2)} ms, style ` +
    `${reading.style.toFixed(2)} ms, layout ${reading.layout.toFixed(2)} ms, every ` +
    `main-thread task ${reading.task.toFixed(2)} ms; the HUD's render median ` +
    `${reading.ridden.medianRenderMs.toFixed(2)} ms, worst ${reading.ridden.worstRenderMs.toFixed(2)} ms; ` +
    `frames median ${reading.ridden.medianFrameMs.toFixed(1)} ms, worst ` +
    `${reading.ridden.worstFrameMs.toFixed(1)} ms`;
  console.log('#2290 a paced second at 40 km/h, 1280×800, over the dense synthetic town');
  console.log(`  ${line('outline (control)', outline)}`);
  console.log(`  ${line('street map', street)}`);
});
