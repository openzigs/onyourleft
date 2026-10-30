// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ride's specs share — #1414.
 *
 * `ride.browser.spec.ts` was one file until #1414 divided it into five, so
 * that `--shard` and the workers could divide it too; its header says which
 * section went where and why. This is the part more than one of the five
 * reads: the viewports, `openRide` and `sharedRide`, the measuring helpers,
 * `withoutAnchors` and `bothWays` (#1120), and the few helpers a later
 * section borrowed from an earlier one. Each is exactly as it was in the one
 * file, with `export` added, so its doc comment is still the authority — and
 * "below" in one of them means the specs that import it.
 *
 * ⚠️ **A spec that calls `sharedRide` registers `releaseSharedPage` as its
 * `afterAll`** and `attachSharedPageOnFailure` as its `afterEach`
 * (`shared-load.ts`); a hook registered here would be no file's hook.
 */

import { expect, test, type Browser, type Page } from '@playwright/test';

import { sharedPage } from './shared-load';

import { riderFrameBox } from '../src/game/camera';
import { MAXIMUM_LEAN_RADIANS } from '../src/game/racing-line';

import type { AnchorFallback, Box, StageItem, StageMeasurement } from './ride-harness';

/**
 * How far past an edge a box may measure and still count as inside it.
 *
 * ⚠️ One pixel, and it is sub-pixel layout rather than slack: a panel whose
 * height comes from `1.05` line-heights and `0.8rem` labels has a fractional
 * box, and a strict comparison fails this gate on arithmetic rather than on
 * layout. Widening it further would let a whole line of text hide.
 */
export const SUBPIXEL_TOLERANCE = 1;

/**
 * `hud-value-size.test.ts` §`MINIMUM_TIER_RATIO`, as the engine resolves it.
 *
 * Restated rather than imported: that file reads the stylesheet as text, and
 * this reads what Chromium made of it — a rule overridden by a later one, or
 * by a media query, satisfies the first and not the second.
 */
export const MINIMUM_TIER_RATIO = 1.5;

/** `theme.css` §`--oyl-color-hud-surface`, as `getComputedStyle` spells it. */
export const HUD_SURFACE = 'rgb(16, 22, 28)';

export interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /**
   * Whether the same DOM **without the stage** puts *End ride* below the fold
   * here — i.e. whether this viewport can carry the control.
   *
   * ⚠️ Not every viewport can, and pretending otherwise would be asserting the
   * opposite of the bug: upright on a tall screen the unstaged page FITS,
   * exactly as #373's old placement was visible in portrait. So the control
   * runs at every LANDSCAPE overlay viewport and at all four stacked ones, and
   * at no upright overlay viewport.
   *
   * ⚠️ **Which leaves the column layout with no control of this kind, and that
   * is stated rather than papered over.** What stands in for it there is the
   * apparatus case — fourteen items, four panels, the surface token resolved —
   * and the mutation record: a 7 rem track floor, a 14 rem plan view and a
   * route panel moved back to the bottom each turned column-layout cases red
   * when they were tried (B6, B8 and B11 in the pull request). A control that
   * cannot honestly fail is worse than none.
   */
  readonly unstagedFails: boolean;
}

/**
 * Where the HUD is an OVERLAY — `theme.css` §`.oyl-game--riding`.
 *
 * ⚠️ Both layouts and both of their edges: the smallest viewport each admits as
 * well as the ordinary ones, because a layout is most likely to overflow at
 * the bottom of the range it claims.
 */
export const OVERLAY_VIEWPORTS: readonly Viewport[] = [
  {
    name: 'a landscape tablet — 1280×800, the owner’s',
    width: 1280,
    height: 800,
    unstagedFails: true,
  },
  { name: 'a 4:3 tablet in landscape — 1024×768', width: 1024, height: 768, unstagedFails: true },
  { name: 'a tablet upright — 800×1280', width: 800, height: 1280, unstagedFails: false },
  { name: 'a phone in landscape — 844×390', width: 844, height: 390, unstagedFails: true },
  { name: 'the smallest corners layout — 736×360', width: 736, height: 360, unstagedFails: true },
  /**
   * #512: the TALLEST of the short corners layout (`theme.css` §"A SHORT
   * corners layout", `max-height: 30rem`). A leaning rider's box grows with
   * the viewport's height while the panels, in rem, do not, so this is where
   * the bottom row is nearest a rider leaning at the cap — 12 px, measured.
   * Until #512 it was measured nowhere, and a 20 rem actions panel here was
   * over the rider by about 50 px.
   */
  {
    name: 'the tallest short corners layout — 736×480',
    width: 736,
    height: 480,
    unstagedFails: true,
  },
  { name: 'a phone upright — 390×844', width: 390, height: 844, unstagedFails: false },
  {
    name: 'a narrow Android phone upright, in the app — 360×800',
    width: 360,
    height: 800,
    unstagedFails: false,
  },
  { name: 'the smallest column layout — 360×752', width: 360, height: 752, unstagedFails: false },
];

/**
 * Where it is not — `theme.css` §`.oyl-game--riding` says why each is here.
 *
 * 320×256 is SC 1.4.10's viewport, which is a 1280×1024 window at 400 %.
 * 390×664 is a phone upright in a browser with the browser's own bars showing:
 * too short for three panels to clear the rider's helmet, by measurement.
 */
export const STACKED_VIEWPORTS: readonly Viewport[] = [
  { name: 'reflow — 320×256', width: 320, height: 256, unstagedFails: true },
  { name: 'a small phone on its side — 640×360', width: 640, height: 360, unstagedFails: true },
  { name: 'a phone upright in a browser — 390×664', width: 390, height: 664, unstagedFails: false },
  // ⚠️ Was "the smallest column layout" until the pull request's first CI run:
  // on the runner's fonts the three top panels are 373 px here, 8 px over the
  // rider's helmet, while the same case was green on a Mac. `theme.css`
  // §"COLUMN" records what that changed.
  { name: 'a very narrow phone upright — 320×704', width: 320, height: 704, unstagedFails: true },
];

export async function openRide(page: Page, viewport: Viewport, query = ''): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  const response = await page.goto(`/ride.html${query}`);
  // ⚠️ A page missing from `vite.browser.config.ts`'s `build.rollupOptions.input`
  // is simply not built, and the failure is a 404 sixty seconds later inside
  // `waitForFunction` with no mention of the config — the trap #266 confirmed
  // by deleting its own line.
  expect(
    response?.status(),
    'ride.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylRide !== undefined);
  const published = await page.evaluate(() => ({
    ready: window.__oylRide?.ready,
    errors: window.__oylRide?.errors,
  }));
  // The harness rides for real, so "ready" means the picker offered a route,
  // the ride started, the stage appeared and the trainer line was written.
  expect(published.errors, 'the ride harness reported an error').toEqual([]);
  expect(published.ready).toBe(true);
}

/**
 * {@link openRide}, loaded once for every case in a row that only MEASURES the
 * page at this viewport and query — #1051, `shared-load.ts`. A case that
 * changes the page (a control taking the stage's class off, an inset, a click)
 * takes its own `page` and calls `openRide`.
 */
export async function sharedRide(browser: Browser, viewport: Viewport, query = ''): Promise<Page> {
  return sharedPage(
    browser,
    `ride.html${query} at ${String(viewport.width)}×${String(viewport.height)}`,
    (page) => openRide(page, viewport, query),
    test.info(),
  );
}

export async function measure(page: Page): Promise<StageMeasurement> {
  const measured = await page.evaluate(() => window.__oylRide?.measure());
  if (measured === undefined) {
    throw new Error('the ride harness published no measurement');
  }
  return measured;
}

export function inside(box: Box, viewport: Viewport): boolean {
  return (
    box.left >= -SUBPIXEL_TOLERANCE &&
    box.top >= -SUBPIXEL_TOLERANCE &&
    box.right <= viewport.width + SUBPIXEL_TOLERANCE &&
    box.bottom <= viewport.height + SUBPIXEL_TOLERANCE &&
    box.width > 0 &&
    box.height > 0
  );
}

export function overlap(a: Box, b: Box): boolean {
  return (
    a.left < b.right - SUBPIXEL_TOLERANCE &&
    b.left < a.right - SUBPIXEL_TOLERANCE &&
    a.top < b.bottom - SUBPIXEL_TOLERANCE &&
    b.top < a.bottom - SUBPIXEL_TOLERANCE
  );
}

export function describeItem(item: StageItem): string {
  const { box } = item;
  return (
    `${item.name} [${box.left.toFixed(0)},${box.top.toFixed(0)} → ` +
    `${box.right.toFixed(0)},${box.bottom.toFixed(0)}]${item.onTop ? '' : ' COVERED'}`
  );
}

/**
 * `game/camera.ts` §`riderFrameBox`, in this viewport's pixels, for a rider
 * leaning as far as one is ever drawn (#499).
 *
 * ⚠️ Non-vacuous by construction rather than by luck: it throws on a box too
 * small to overlap anything, because "no panel overlaps a rectangle of no
 * size" is true of every layout there is.
 */
export function riderBox(viewport: Viewport, lean: number = MAXIMUM_LEAN_RADIANS): Box {
  // At the lean cap (#499): the bicycle stays mid-frame on the racing line
  // because the camera follows it across, but the rider's top rolls up to
  // 0.95 m to one side. A panel over a leaning rider is over the rider, at
  // EVERY overlay viewport — #512 closed the one (736×360) that used to be
  // held to the upright box, by narrowing the short corners layout's bottom
  // row rather than by moving the camera.
  const rider = riderFrameBox(viewport.width / viewport.height, lean);
  const box: Box = {
    left: rider.left * viewport.width,
    right: rider.right * viewport.width,
    top: rider.top * viewport.height,
    bottom: rider.bottom * viewport.height,
    width: (rider.right - rider.left) * viewport.width,
    height: (rider.bottom - rider.top) * viewport.height,
  };
  if (box.width < 10 || box.height < 40 || !inside(box, viewport)) {
    throw new Error(`the rider's frame box is not a usable rectangle: ${JSON.stringify(box)}`);
  }
  return box;
}

export function named(items: readonly StageItem[], name: string): StageItem {
  const found = items.find((each) => each.name === name);
  if (found === undefined) {
    throw new Error(`the stage has no "${name}" — found: ${items.map((i) => i.name).join(', ')}`);
  }
  return found;
}

/**
 * #1120 — how many `@supports (anchor-name: …)` blocks `theme.css` has, and
 * how many `@supports not (anchor-name: …)` fallbacks. One each for #576's
 * side-camera row on a phone on its side, #1111's moving time below 802 px on
 * its side, and #1111's moving time upright. A block added or taken away
 * changes these, and the case that reads them says which.
 */
export const ANCHOR_BLOCKS = 3;

export const ANCHOR_FALLBACK_BLOCKS = 3;

/**
 * #1120 — the stage measured as an engine with NO anchor positioning lays it
 * out: Android System WebView older than Chrome 125. `ride-harness.tsx`
 * §`withoutAnchors` takes every `@supports (anchor-name: …)` block out of the
 * live stylesheet, puts every `@supports not (anchor-name: …)` block in force
 * (or, for the control, takes those out too — `main` before #1120), measures,
 * and puts the stylesheet back, in one synchronous call on the page as it is:
 * no load of its own, and a shared page is left as it was.
 *
 * ⚠️ **It cannot pass over a page where nothing was taken out.** Every call is
 * required to have taken out every anchor block, put every fallback in force
 * (or taken them out), left NOTHING on the stage with an `anchor-name` or a
 * `position-anchor` as the engine computes them, and put every rule back
 * exactly. §"the instrument" also holds that the same count was MORE than
 * zero, before, wherever the layout uses anchors at all.
 */
export async function withoutAnchors(
  page: Page,
  fallback: AnchorFallback = 'shipped',
): Promise<StageMeasurement & { readonly anchoredBefore: number }> {
  const found = await page.evaluate((which) => window.__oylRide?.withoutAnchors(which), fallback);
  if (found === undefined) {
    throw new Error('the ride harness published no withoutAnchors');
  }
  expect(found.removed, 'every @supports (anchor-name: …) block taken out').toBe(ANCHOR_BLOCKS);
  expect(found.forced, 'every @supports not (anchor-name: …) block put in force').toBe(
    fallback === 'shipped' ? ANCHOR_FALLBACK_BLOCKS : 0,
  );
  expect(found.dropped, 'the fallbacks taken out too, for the control').toBe(
    fallback === 'shipped' ? 0 : ANCHOR_FALLBACK_BLOCKS,
  );
  expect(found.anchoredAfter, 'nothing on the stage laid out by anchor positioning').toBe(0);
  expect(found.restored, 'the stylesheet put back exactly').toBe(true);
  return { ...found.measurement, anchoredBefore: found.anchoredBefore };
}

/**
 * Whether the layout at this viewport uses anchor positioning at all
 * (`theme.css`): the short corners layout — 46 rem wide or more, 22.5 to 30 rem
 * tall — and the column layout, under 46 rem wide and 47 rem tall or more.
 */
export function usesAnchorPositioning(viewport: Viewport): boolean {
  const short = viewport.width >= 736 && viewport.height >= 360 && viewport.height <= 480;
  const column = viewport.width >= 360 && viewport.width < 736 && viewport.height >= 752;
  return short || column;
}

/**
 * #1120 — where the layout `main` gave an engine without anchor positioning
 * put a panel over the leaning rider on the widest ride: the moving time a
 * third secondary row (`theme.css` §"THE MOVING TIME ON A NARROW PHONE ON ITS
 * SIDE" and §"THE MOVING TIME ON AN UPRIGHT PHONE"). Measured on this
 * repository's CI fonts. At 360×800, 736×480 and 844×390 the widest ride had
 * the room, so this cannot fail there and is not run there; what failed at
 * 360×800 was a standing notice beside it, which §"a ride with a standing
 * notice" holds both ways.
 */
export const MAIN_FALLBACK_OVER_THE_RIDER = new Set(['736×360', '390×844', '360×752']);

/** The two ways a stage is laid out (#1120), each with the words a failure carries. */
export const ANCHORED = 'with anchor positioning';

export const UNANCHORED = 'without anchor positioning (#1120)';

/** One measurement of the page as it is, and one as an engine without anchors lays it out. */
export async function bothWays(page: Page): Promise<(readonly [string, StageMeasurement])[]> {
  return [
    [ANCHORED, await measure(page)],
    [UNANCHORED, await withoutAnchors(page)],
  ];
}

/**
 * #1124: the least room `9:59:59` may have in its field, in CSS pixels — at
 * every overlay viewport, both ways (with anchor positioning and without).
 * Until #1124 the field was a fixed track or a fixed 6 rem and the time was
 * measured into what was left: 1.0 px at 844×390 and both landscape tablets
 * on the CI runner's DejaVu Sans, which a font change would have turned red
 * with nothing wrong in the product. The field is sized from its value's
 * own digits now (`theme.css` §"THE MOVING TIME'S OWN WIDTH — #1124"), and
 * the spare width is published at every viewport and held to this, as the
 * fold checks hold 50 px. Since #1158 it holds where the HUD stacks, too
 * (`ride.browser.spec.ts` §"#1158").
 */
export const MOVING_TIME_SPARE_PIXELS = 4;

/**
 * #585 — a running workout's stall rescue, on the game's HUD (PR #599's
 * review, finding B1). `?rescue=floor` is the workout fixture above with the
 * rescue in force, and the floor is the longest sentence
 * `workout/rescue-text.ts` builds.
 *
 * ⚠️ **Why this exists**: the harness's trainer double returned `undefined`
 * from `workoutRescue`, so no case here had ever laid the "Eased" notice out
 * — and beside the road notice a workout always has, it was 309 px tall on a
 * phone on its side and put *Pause* and *End ride* below the stage, with every
 * case in this file green. `GameView` §`roadNotice` now gives the Eased notice
 * the one notice cell while the rescue holds, and this measures that at every
 * overlay viewport; the control below puts the road notice back beside it and
 * requires the same measurement to fail.
 */
export function easedCollisions(seen: StageMeasurement, viewport: Viewport): string[] {
  const laidOut = seen.panels.filter((each) => each.box.height > 1);
  const found = laidOut.filter((each) => !inside(each.box, viewport)).map(describeItem);
  laidOut.forEach((a, index) => {
    for (const b of laidOut.slice(index + 1)) {
      if (overlap(a.box, b.box)) found.push(`${describeItem(a)} × ${describeItem(b)}`);
    }
  });
  found.push(...laidOut.filter((each) => overlap(each.box, riderBox(viewport))).map(describeItem));
  found.push(
    ...['control: Pause', 'control: End ride']
      .map((name) => named(seen.items, name))
      .filter((each) => !inside(each.box, viewport) || !each.onTop)
      .map(describeItem),
  );
  return found;
}

/**
 * #605 — how far the Eased notice must end above the leaning rider's box on an
 * UPRIGHT screen, where the notice is stacked over the sky and the rider is
 * under it. The number §4f treats as proven on a device: #585 shipped this at
 * 2 px on the CI runner (20 on a Mac), which was inside the gate and proved
 * nothing about a Pixel 8's fonts. The one-sentence notice clears it by the
 * figure each run prints.
 */
export const EASED_RIDER_CLEARANCE_PIXELS = 50;

/** The HUD's notice cell as a rider reads it. */
export async function noticeText(page: Page): Promise<string> {
  return page.evaluate(() => document.querySelector('.oyl-hud__notices')?.textContent ?? '');
}

/**
 * #647 — the ride being recorded may stop if the screen goes off, because the
 * platform refused the recording service. `?keepalive=failed` puts
 * *"Keep the screen on: your ride may stop without it."* in the
 * HUD's notice cell, where it stays for as long as the refusal does: it is a
 * safety sentence, so there is no toggle and no disclosure (the owner's ruling
 * on #654's re-review).
 *
 * `&trainer=workout` adds the longest road notice, which stands open for a
 * ride's first seconds and has a *Trainer notice* control. ⚠️ **Since #693's
 * review (N2) the refusal changes that on upright phones under 25 rem wide
 * and nowhere else**: there (`GameView` §`ONE_NOTICE_ONLY_QUERY` — 360×800,
 * 360×752 and 390×844 here) the road notice and its control are off the HUD
 * while the refusal stands, because the two together ran over the rider, or
 * up to it, however the road notice got open; everywhere else it opens, and
 * is put away, exactly as it does without the refusal — and the pair is held
 * over nothing, clear of the rider's box by `EASED_RIDER_CLEARANCE_PIXELS`
 * upright.
 *
 * The control takes the rule away — `matchMedia` answering "no" to that one
 * query before the page loads — and requires the pair, open, to come within
 * the clearance of the rider at the two 360 px phones. Not at 390×844, where
 * the pair ended 51 px above the rider on a Mac: inside the rule for the CI
 * runner's tighter fonts, not because it collides there.
 */
export async function keepScreenOnNotice(page: Page): Promise<{
  text: string;
  inDisclosure: boolean;
  roadNoticeShown: boolean;
  roadNoticeOnHud: boolean;
}> {
  return page.evaluate(() => {
    const label = [...document.querySelectorAll('.oyl-hud__notices .oyl-status__label')].find(
      (each) => each.textContent?.startsWith('Keep the screen on'),
    );
    const notice = label?.closest('.oyl-status');
    const road = document.querySelector('#oyl-hud-standing-notice');
    return {
      text: (notice?.textContent ?? '').replace(/\s+/g, ' '),
      inDisclosure: (notice?.closest('details') ?? null) !== null,
      roadNoticeShown: road !== null && !road.classList.contains('oyl-visually-hidden'),
      roadNoticeOnHud: road !== null,
    };
  });
}

/** The keep-the-screen-on notice laid out on the stage, over nothing. */
export function keepScreenOnLaidOut(
  seen: StageMeasurement,
  viewport: Viewport,
  what: string,
): { readonly collisions: string[]; readonly clearance: number } {
  const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
  const onAPhone = Math.min(viewport.width, viewport.height) <= 480;
  const laidOut = seen.panels.filter((each) => each.box.height > 1);
  expect(laidOut).toHaveLength(onAPhone ? 4 : 5);
  const rider = riderBox(viewport);
  const clearance = rider.top - (notice?.box.bottom ?? Infinity);
  console.log(
    `keep the screen on, ${what} — ${viewport.name} — notice cell ${(notice?.box.height ?? 0).toFixed(0)} px tall` +
      (viewport.height > viewport.width
        ? `; ${clearance.toFixed(0)} px above the rider's box`
        : `; ends at x = ${(notice?.box.right ?? 0).toFixed(0)}, rider from x = ${rider.left.toFixed(0)}`),
  );
  return { collisions: easedCollisions(seen, viewport), clearance };
}

export const KEEP_SCREEN_ON_SEEN = '!Keep the screen on: your ride may stop without it.';

export const TABLET_VIEWPORTS: readonly Viewport[] = OVERLAY_VIEWPORTS.filter(
  (each) => Math.min(each.width, each.height) > 480,
);
