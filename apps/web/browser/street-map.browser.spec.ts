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
 *    ⚠️ **Except on a tall upright phone** (412×915), where by the owner's
 *    ruling of 2026-11-06 the map is given more room (`theme.css` §"THE STREET
 *    MAP ON A TALL UPRIGHT PHONE"). There it must be a BIGGER square than the
 *    outline's box, the route panel may only grow downwards, and the controls
 *    are still where they were. At every viewport the plan view keeps 16 px
 *    to the screen's edges, the route panel and the map credit are clear of
 *    the leaning rider (`ride-stage.ts` §`riderBox`), and nothing measured is
 *    off the screen.
 * 2. **It follows the rider**, and the mark is drawn in the middle of the box
 *    at the plan view's size.
 * 3. **Its cost**, as counts a slow runner cannot change: over a minute at
 *    40 km/h in 60 frames a second, the plan view's DOM changes only when the
 *    view moves on its 5 m grid — where the outline it replaces moves its mark
 *    every frame — and then only the sheet's `transform`: what is drawn
 *    changes once per 250 m (#2380). Paced, the map is painted once per new
 *    sheet and not once per move, counted from the engine's own trace
 *    `Paint` events. A paced second of each, map and outline, publishes the
 *    engine's own main-thread times and frame intervals, and asserts none of
 *    them: they are the runner's, a timing gate needs three CI readings before
 *    it may assert anything, and the owner's tablet is what they are for.
 *
 * The screenshots of the route panel at each viewport are attached to the
 * test, for the owner.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import { HARNESS_ORIGIN } from '../playwright.config';
import { inside, overlap, riderBox } from './ride-stage';

/** What `street-map-harness.tsx` publishes. Mirrored, as `hud.browser.spec.ts` mirrors its own. */
interface StreetMapRide {
  readonly frames: number;
  readonly mutations: number;
  readonly drawn: number;
  readonly drawnWithin: number;
  readonly views: number;
  readonly regions: number;
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

/** `grows`: the map is given more room than the outline's box there (see the header). */
const VIEWPORTS = [
  { name: 'portrait', width: 390, height: 844, grows: false },
  { name: 'landscape', width: 844, height: 390, grows: false },
  { name: 'a phone on its side, short', width: 736, height: 360, grows: false },
  { name: 'a narrow phone upright', width: 360, height: 800, grows: false },
  { name: 'a tall phone upright', width: 412, height: 915, grows: true },
  { name: 'the middle band', width: 802, height: 600, grows: false },
  { name: 'a landscape tablet', width: 1280, height: 800, grows: false },
] as const;

/** The least clear space between the plan view and each edge of the screen. */
const SCREEN_MARGIN_PIXELS = 16;

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
      credit: box(document.querySelector('.oyl-hud__attribution')),
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

    const same = (name: string, side: keyof Box): void => {
      const was = before[name];
      const is = after[name];
      expect(was, `${name} on the control page`).toBeDefined();
      expect(is, `${name} with the street map`).toBeDefined();
      expect(
        Math.abs((is?.[side] ?? 0) - (was?.[side] ?? 0)),
        `${name}.${side}: ${String(was?.[side])} without the map, ${String(is?.[side])} with it`,
      ).toBeLessThanOrEqual(0.5);
    };
    const sides = ['left', 'top', 'width', 'height'] as const;
    // No ride-time control moves, anywhere.
    for (const name of ['pause', 'end'] as const) for (const side of sides) same(name, side);
    if (viewport.grows) {
      // More room for the map, as a bigger square, and the panel grows downwards only.
      const was = before.plan;
      const is = after.plan;
      expect(is?.width ?? 0, 'the map is wider than the outline').toBeGreaterThan(
        (was?.width ?? 0) + 24,
      );
      expect(is?.height ?? 0, 'the map is taller than the outline').toBeGreaterThan(
        (was?.height ?? 0) + 24,
      );
      expect(Math.abs((is?.width ?? 0) - (is?.height ?? 0)), 'a square').toBeLessThanOrEqual(0.5);
      for (const side of ['left', 'top', 'width'] as const) same('route', side);
    } else {
      for (const name of ['route', 'plan'] as const) for (const side of sides) same(name, side);
    }

    // Nothing measured is off the screen, the plan view keeps its margins,
    // and neither the route panel nor the credit is over the leaning rider.
    const stage = { name: viewport.name, width: viewport.width, height: viewport.height };
    const rider = riderBox({ ...stage, unstagedFails: false });
    const edges = (found: Box | undefined) => ({
      left: found?.left ?? 0,
      top: found?.top ?? 0,
      width: found?.width ?? 0,
      height: found?.height ?? 0,
      right: (found?.left ?? 0) + (found?.width ?? 0),
      bottom: (found?.top ?? 0) + (found?.height ?? 0),
    });
    for (const name of ['route', 'plan', 'credit', 'pause', 'end'] as const) {
      expect(after[name], `${name} with the street map`).toBeDefined();
      expect(
        inside(edges(after[name]), { ...stage, unstagedFails: false }),
        `${name} on screen`,
      ).toBe(true);
    }
    for (const name of ['route', 'credit'] as const) {
      expect(
        overlap(edges(after[name]), rider),
        `${name} [${JSON.stringify(after[name])}] over the leaning rider [${JSON.stringify(rider)}]`,
      ).toBe(false);
    }
    const plan = edges(after.plan);
    for (const [side, room] of [
      ['left', plan.left],
      ['top', plan.top],
      ['right', viewport.width - plan.right],
      ['bottom', viewport.height - plan.bottom],
    ] as const) {
      expect(room, `the plan view's ${side} margin`).toBeGreaterThanOrEqual(
        SCREEN_MARGIN_PIXELS - 0.5,
      );
    }

    // The rider's mark, drawn in the middle of the box at the plan view's size.
    const mark = await page.locator('.oyl-hud__street-map circle').boundingBox();
    expect(mark).not.toBeNull();
    expect(mark?.width ?? 0).toBeGreaterThanOrEqual(11);
    const middle = {
      x: plan.left + plan.width / 2,
      y: plan.top + plan.height / 2,
    };
    expect(Math.abs((mark?.x ?? 0) + (mark?.width ?? 0) / 2 - middle.x)).toBeLessThanOrEqual(1);
    expect(Math.abs((mark?.y ?? 0) + (mark?.height ?? 0) / 2 - middle.y)).toBeLessThanOrEqual(1);
    // #2380: the sheet is drawn at #2290's scale, the box's SHORTER side a
    // kilometre — on an upright phone the box is taller than it is wide —
    // and so is the mark over it.
    const scale = await page.evaluate(() => {
      const sheet = document.querySelector('.oyl-hud__street-map-sheet');
      const [, , , tall] = (sheet?.getAttribute('viewBox') ?? '').split(' ').map(Number);
      return { metres: tall ?? 0, pixels: sheet?.getBoundingClientRect().height ?? 0 };
    });
    const pixelsPerMetre = Math.min(plan.width, plan.height) / 1000;
    expect(
      Math.abs(scale.pixels - scale.metres * pixelsPerMetre),
      `the sheet is ${scale.pixels.toFixed(1)} px for ${String(scale.metres)} m in a box ` +
        `${plan.width.toFixed(1)} × ${plan.height.toFixed(1)} px`,
    ).toBeLessThanOrEqual(1);
    // And streets drawn across the box: the map is there, not a blank square.
    const streets = await page
      .locator('.oyl-hud__street-map [data-oyl-street-map="streets"]')
      .boundingBox();
    expect(streets?.width ?? 0).toBeGreaterThanOrEqual(plan.width - 1);
    expect(streets?.height ?? 0).toBeGreaterThanOrEqual(plan.height - 1);

    console.log(
      `#2290 the street map at ${viewport.name} (${String(viewport.width)}×${String(viewport.height)}): ` +
        `${plan.width.toFixed(1)} × ${plan.height.toFixed(1)} px (the outline's ` +
        `${(before.plan?.width ?? 0).toFixed(1)} × ${(before.plan?.height ?? 0).toFixed(1)}), the mark ` +
        `${(mark?.width ?? 0).toFixed(1)} px across` +
        (viewport.height > viewport.width
          ? `; the credit ends ${(rider.top - edges(after.credit).bottom).toFixed(0)} px above ` +
            `the leaning rider's top`
          : ''),
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

test('#2290 #2380 the street map follows the rider, and changes its drawing only once per 250 m', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // One minute at 40 km/h, sixty frames a second: 667 m.
  const frames = 3600;
  const street = (await rideOn(page, 'street', frames, false)).ridden;
  const outline = (await rideOn(page, 'outline', frames, false)).ridden;
  expect(street.frames).toBe(frames);

  // It follows: the sheet moves once per 5 m step ridden, and no oftener.
  const metres = frames * METRES_PER_FRAME;
  expect(street.views).toBeGreaterThan(metres / 5 - 2);
  expect(street.views).toBeLessThanOrEqual(Math.ceil(metres / 5) + 1);
  // #2380: while the rider is within the margin, nothing drawn changes —
  // no `d`, no `viewBox`, no element — only the sheet's `transform`…
  expect(street.drawnWithin).toBe(0);
  expect(street.mutations - street.drawn).toBeLessThanOrEqual(street.views);
  // …and the sheet is drawn again once per 250 m: 667 m from a grid point
  // is three new sheets, each six paths' `d` and the `viewBox`.
  expect(street.regions).toBeLessThanOrEqual(Math.ceil(metres / 250) + 1);
  expect(street.drawn).toBeLessThanOrEqual(7 * street.regions);
  // The control: crossing the margin does draw it again, so the count above
  // is of a sheet that changes, not of one stuck where the ride began.
  expect(street.regions).toBeGreaterThan(1);
  expect(street.drawn).toBeGreaterThan(0);
  // And the outline it replaces moves its mark on every frame.
  expect(outline.mutations).toBeGreaterThanOrEqual(frames);
  expect(street.mutations).toBeLessThan(outline.mutations / 10);
  console.log(
    `#2290 #2380 a minute at 40 km/h, ${String(frames)} frames: the street map made ` +
      `${String(street.mutations)} DOM records in ${String(street.views)} places, ` +
      `${String(street.drawn)} of them to the drawing, in ${String(street.regions)} sheets; ` +
      `the outline ${String(outline.mutations)} in ${String(outline.views)}`,
  );
});

/** What `devtools.timeline` records for a paint: the node whose layer was painted. */
interface PaintEvent {
  readonly name: string;
  readonly args?: { readonly data?: { readonly nodeName?: string } };
}

/**
 * Ride `frames` paced frames of `metresPerFrame` on a freshly opened page, and
 * count the engine's paints of the street map — #2380. The trace's `Paint`
 * events are the engine's own record of a layer's content being painted
 * again, each naming the node the layer is for: any node of the street map's
 * (`oyl-hud__street-map…`), which is the sheet now and was the whole SVG as
 * #2290 drew it.
 */
async function paintsOn(page: Page, browser: Browser, frames: number, metresPerFrame: number) {
  await open(page, 'street');
  await browser.startTracing(page, { categories: ['devtools.timeline'] });
  const ridden = await page.evaluate(
    async ([count, step]) => window.__oylStreetMap?.ride?.(count, step, true),
    [frames, metresPerFrame] as const,
  );
  const trace = JSON.parse((await browser.stopTracing()).toString()) as {
    readonly traceEvents: readonly PaintEvent[];
  };
  if (ridden === undefined) throw new Error('the harness published no ride');
  const paints = trace.traceEvents.filter((event) => event.name === 'Paint');
  const map = paints.filter((event) =>
    (event.args?.data?.nodeName ?? '').includes('oyl-hud__street-map'),
  ).length;
  return { ridden, map, all: paints.length };
}

test('#2380 moving the street map does not paint it again: once per 250 m, not once per 5 m', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  // 600 m in 120 paced frames of 5 m: a move on every frame, and two or
  // three new sheets. A count of paints, which a slow runner cannot raise.
  const frames = 120;
  const { ridden, map, all } = await paintsOn(page, browser, frames, 5);
  expect(ridden.frames).toBe(frames);
  expect(ridden.views).toBeGreaterThan(frames - 2);
  // The control: the trace does see paints, and the HUD's own on every frame.
  expect(all).toBeGreaterThan(frames);
  // A paint per new sheet, and two to spare; #2290's map was painted on
  // every move, 30 in 30 frames when this was measured against it.
  expect(map).toBeLessThanOrEqual(ridden.regions + 2);
  expect(map).toBeLessThan(ridden.views / 10);
  console.log(
    `#2380 ${String(frames)} paced frames of 5 m, 1280×800: ${String(ridden.views)} moves, ` +
      `${String(ridden.regions)} sheets, ${String(map)} paints of the street map ` +
      `(${String(all)} paints in all)`,
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
