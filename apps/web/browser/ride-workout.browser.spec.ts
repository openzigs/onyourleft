// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A workout and a loop on the ride's HUD, measured by a real engine — #1307,
 * #1244 and #1312.
 *
 * Sections of `ride.browser.spec.ts` until #1414, which divided that file so
 * the browser gate's shards could divide it too: its header is still this
 * file's — the viewports, the control and both ways (#1120) — and says which
 * section went where. What these cases share with the other four files is
 * `ride-stage.ts`.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  SUBPIXEL_TOLERANCE,
  HUD_SURFACE,
  type Viewport,
  OVERLAY_VIEWPORTS,
  openRide,
  measure,
  inside,
  overlap,
  describeItem,
  riderBox,
  bothWays,
  easedCollisions,
  EASED_RIDER_CLEARANCE_PIXELS,
  keepScreenOnNotice,
  keepScreenOnLaidOut,
  KEEP_SCREEN_ON_SEEN,
  TABLET_VIEWPORTS,
} from './ride-stage';

import type { Box, StageMeasurement } from './ride-harness';
import { longestReplanSentence } from './replan-longest';
import {
  RIDE_TIME_CONTROLS,
  RIDE_TIME_TARGET_PIXELS,
  namesControl,
} from '../src/design/ride-time-controls';

/**
 * #1307 — the running workout drawn on the HUD, `ride-harness.tsx` §`GRAPH`.
 *
 * The strip takes the route plan's place in the route panel, and the claim
 * that needs a browser is that it takes its SIZE too: a strip two pixels
 * taller is a panel two pixels further over the rider, which is #1169's
 * subject. So each viewport is loaded twice — a workout with the route plan,
 * and the same workout with the strip — and the route panel must measure the
 * same.
 *
 * The second claim is the second pass's: that what is in the strip can be
 * READ at that size. The first pass drew three lanes in 80 px, which left a
 * heart-rate band seven pixels tall on a near-white well. So: ONE lane, at
 * least 36 px of it; a bar; one line of text that fits; and no surface of its
 * own — the HUD panel's dark one, with the HUD's own inks.
 *
 * 802×600 is #1169's: the route and actions panels lay over the rider there on
 * `main`, and `theme.css` §"THE MIDDLE corners layout's bottom row" moved
 * them. The route panel is 271 px wide there, narrower than the strip's line
 * on DejaVu Sans, so the line is written as its two parts, one under the other
 * (`stacked`), as it is on a phone, in the strip's own height; the rider
 * clearance is asserted here too.
 */
interface GraphSight {
  readonly role: string | null;
  readonly name: string;
  readonly lane: string | null;
  readonly strip: Box;
  /** Whether the line's two parts are one under the other (`display: block`). */
  readonly stacked: boolean;
  readonly route: Box | undefined;
  readonly laneBox: Box | undefined;
  readonly progressBox: Box | undefined;
  readonly text: {
    readonly box: Box;
    readonly content: string;
    readonly colour: string;
    readonly fontSize: number;
    /** How much wider the line is than its box: over 0 is text cut off. */
    readonly overflow: number;
    /** How wide the text itself is, and the box it has to fit. */
    readonly inkWidth: number;
    readonly boxWidth: number;
  };
  readonly marks: readonly { readonly name: string; readonly box: Box; readonly paint: string }[];
  /** Every background painted by the strip or anything in it. */
  readonly backgrounds: readonly string[];
  readonly routeBackground: string;
  readonly theme: string | undefined;
}

async function graphOnTheHud(page: Page): Promise<GraphSight | undefined> {
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
    const strip = document.querySelector('.oyl-hud [data-oyl-workout-graph="hud"]');
    if (strip === null) return undefined;
    const route = document.querySelector('.oyl-hud__route');
    const text = strip.querySelector('p');
    const lane = strip.querySelector('.oyl-workout-strip__lane');
    const progress = strip.querySelector('.oyl-workout-strip__progress');
    if (text === null) throw new Error('the strip has no line of text');
    const textStyle = getComputedStyle(text);
    return {
      role: strip.getAttribute('role'),
      name: strip.getAttribute('aria-label') ?? '',
      lane: strip.getAttribute('data-oyl-lane'),
      strip: boxOf(strip),
      stacked: [...strip.querySelectorAll('.oyl-workout-strip__part')].some(
        (part) => getComputedStyle(part).display === 'block',
      ),
      route: route === null ? undefined : boxOf(route),
      laneBox: lane === null ? undefined : boxOf(lane),
      progressBox: progress === null ? undefined : boxOf(progress),
      text: {
        box: boxOf(text),
        content: text.textContent ?? '',
        colour: textStyle.color,
        fontSize: Number.parseFloat(textStyle.fontSize),
        overflow: text.scrollWidth - text.clientWidth,
        inkWidth: (() => {
          const range = document.createRange();
          range.selectNodeContents(text);
          return range.getBoundingClientRect().width;
        })(),
        boxWidth: text.clientWidth,
      },
      marks: [...strip.querySelectorAll('path')].map((path) => {
        const style = getComputedStyle(path);
        return {
          name: path.getAttribute('class') ?? '',
          box: boxOf(path),
          paint: style.stroke === 'none' ? style.fill : style.stroke,
        };
      }),
      backgrounds: [strip, ...strip.querySelectorAll('*')].map(
        (each) => getComputedStyle(each).backgroundColor,
      ),
      routeBackground: route === null ? '' : getComputedStyle(route).backgroundColor,
      theme: document.documentElement.dataset.theme,
    };
  });
}

/** The route plan's box, or the strip's in its place: whichever `.oyl-hud__plan-svg` is. */
async function planBox(page: Page): Promise<Box | undefined> {
  return page.evaluate(() => {
    const rect = document.querySelector('.oyl-hud__plan-svg')?.getBoundingClientRect();
    return rect === undefined
      ? undefined
      : {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
  });
}

/**
 * Wait until the ride's two gap readings, *Pacer* and *Your best*, each carry
 * their second line ("1 s / behind you") — #1313.
 *
 * The harness rides for real, and the secondary fields panel is a line taller
 * once they do: both read "—" at first, the pacer "Level" for a few seconds
 * after that, and then a gap with its line. The notices sit under that panel
 * and move down with it. A comparison of two loads measured on different sides
 * of that moment is a race (18 of 120 runs failed on exactly those two
 * numbers, `--repeat-each 30`, before this), so each load is measured once the
 * readings have settled. Measured locally: about 3 s into the ride.
 *
 * ⚠️ Those 3 s are not waited out: the case installs Playwright's clock before
 * its first load, and this moves the page's clock {@link GAPS_SETTLE_AFTER_MS}
 * on at once (`pauseAt` jumps as `fastForward` does: each timer that falls due
 * fires once, and the ride's tick reads the clock, so the ride is that far
 * on). Waiting them out cost about 20 s a viewport, six loads; `runFor` over
 * all of it, which fires every frame on the way, about 10 s; this, about 2 s,
 * the loads themselves.
 *
 * ⚠️ **And the jump STOPS the page's clock, which stays stopped — #2262.**
 * Until #2262 the jump was made on a running clock, which then ran on with the
 * runner's, and the case waited up to 5 s of wall clock for the readings to
 * settle on their own. That was a wait on live values twice over:
 *
 * - The jump could be spent on nothing. The simulation's first `advanceTo`
 *   only sets its origin (`simulation.ts`), and a load can be ready before
 *   the ride's loop has ticked once (both readings "—", the rider at rest), so
 *   a jump that fired that first tick rode no road at all. Measured here: 1
 *   load in 72 and 3 in 240, each of which then needed 3¼ s more riding.
 * - What came after was the runner's: on a busy CI runner the pacer still
 *   read "Level" when the 5 s ran out, at 1024×768 and 1280×800 (#2242, #2228
 *   and #2243 were each dropped from the merge queue on it).
 *
 * So the jump is a `pauseAt`, which stops the clock where it lands; and if the
 * readings have not settled there, the ride is run on in
 * {@link GAPS_SETTLE_STEP_MS} steps (`runFor`, every frame fired), with a look
 * after each. Nothing on the page moves unless this moves it, so the bound,
 * {@link GAPS_SETTLE_MOST_MS}, is of the page's clock and not of waiting, and
 * the failure says what the two fields read. Both of a load's measurements are
 * then taken on a stopped clock, so no reading moves between them either;
 * {@link openSettledRide} starts the clock again for the next load, whose
 * harness waits on animation frames.
 */
async function untilTheGapsSettle(page: Page): Promise<void> {
  const pageNow = await page.evaluate(() => Date.now());
  try {
    await page.clock.pauseAt(pageNow + GAPS_SETTLE_AFTER_MS);
  } catch (error) {
    // The page's clock ran past the mark between reading it and stopping it
    // (seen once in 240 loads with a mark 1 s on, 12 workers on 12 cores).
    // `pauseAt` stops the clock before it jumps, so it is stopped where it
    // was, which is further on than the mark, and the look below reads that.
    if (!String(error).includes('Cannot fast-forward to the past')) throw error;
  }
  const gapLines = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.oyl-hud__fields--secondary > .oyl-hud__field')]
        .filter((field) => /^(Pacer|Your best)$/.test(field.querySelector('dt')?.textContent ?? ''))
        .map((field) => ({
          reads: `${field.querySelector('dt')?.textContent ?? ''}: ${(field.querySelector('dd')?.textContent ?? '').trim()}`,
          second: field.querySelector('.oyl-hud__detail') !== null,
        })),
    );
  let ridden = GAPS_SETTLE_AFTER_MS;
  let gaps = await gapLines();
  while (!(gaps.length === 2 && gaps.every((gap) => gap.second))) {
    if (ridden >= GAPS_SETTLE_MOST_MS) {
      throw new Error(
        `the ride’s gap readings, Pacer and Your best, never both showed their second line in ${String(ridden / 1000)} s of the page’s clock — ${JSON.stringify(gaps.map((gap) => gap.reads))}`,
      );
    }
    await page.clock.runFor(GAPS_SETTLE_STEP_MS);
    ridden += GAPS_SETTLE_STEP_MS;
    gaps = await gapLines();
  }
}

/**
 * {@link openRide} on a running clock, then {@link untilTheGapsSettle}, which
 * stops it.
 */
async function openSettledRide(page: Page, viewport: Viewport, query: string): Promise<void> {
  await page.clock.resume();
  await openRide(page, viewport, query);
  await untilTheGapsSettle(page);
}

/** Past the "about 3 s" {@link untilTheGapsSettle} measured, with a second to spare. */
const GAPS_SETTLE_AFTER_MS = 4_000;

/** How far the ride is run on between two looks, when the jump was not enough. */
const GAPS_SETTLE_STEP_MS = 250;

/**
 * The most of the page's clock {@link untilTheGapsSettle} spends before it says
 * what it saw: the 9 s the jump and the old 5 s poll came to, so no bound is
 * wider than it was. A load whose jump fired the ride's first tick settles at
 * about 7¼ s.
 */
const GAPS_SETTLE_MOST_MS = 9_000;

const GRAPH_VIEWPORTS: readonly (Viewport & {
  readonly riderClear: boolean;
  readonly stacked: boolean;
})[] = [
  ...OVERLAY_VIEWPORTS.filter((each) => Math.min(each.width, each.height) > 480).map((each) => ({
    ...each,
    riderClear: true,
    stacked: false,
  })),
  {
    name: '#1169’s — 802×600',
    width: 802,
    height: 600,
    unstagedFails: true,
    riderClear: true,
    stacked: true,
  },
];

/** `tokens.ts`: `hudInk`, `hudInkMuted`, `hudBorder` — in BOTH page themes, like `HUD_SURFACE`. */
const HUD_INK = 'rgb(244, 247, 249)';

const HUD_INK_MUTED = 'rgb(157, 163, 168)';

const HUD_BORDER = 'rgb(120, 124, 130)';

const PAINTS_NOTHING = 'rgba(0, 0, 0, 0)';

const STRIP_FIXTURES = [
  {
    graph: 'hold',
    paused: false,
    lane: 'heart-rate',
    // The owner's ruling: in a hold the line gives the target the hold set too.
    text: '140 bpm, range 130–140 · Target 167 W',
    named: 'with a chosen range of 130–140 bpm',
    // Dashed: what is asked. Solid: what the rider is doing.
    asked: 'oyl-workout-strip__range',
    doing: 'oyl-workout-strip__heart-rate',
    absent: /target|power/,
  },
  {
    // A strap gone quiet: no line to draw. ⚠️ "— bpm", not "No heart rate":
    // that form measured 271.5 px in this 270 px strip, which is why it is
    // not what the strip writes.
    graph: 'hold-silent',
    paused: false,
    lane: 'heart-rate',
    text: '— bpm, range 130–140 · Target 167 W',
    named: 'No heart rate, with a chosen range of 130–140 bpm',
    asked: 'oyl-workout-strip__range',
    doing: undefined,
    absent: /target|power|strip__heart-rate/,
  },
  {
    graph: 'plain',
    paused: false,
    lane: 'power',
    text: 'Target 175 W · 15:00 left in block',
    named: 'Target the trainer last confirmed: 175 W.',
    asked: 'oyl-workout-strip__target',
    doing: 'oyl-workout-strip__power',
    absent: /range|heart-rate/,
  },
  {
    // Paused: the trainer was eased to its 50 W minimum. The line says THAT.
    // #1313 (the owner's ruling of 2026-11-05): through a pause the stale
    // dashed target is not drawn, and the power already ridden is.
    graph: 'paused',
    paused: true,
    lane: 'power',
    text: 'Paused · Target 50 W',
    named: 'Workout graph. Paused.',
    asked: undefined,
    doing: 'oyl-workout-strip__power',
    absent: /target|range|heart-rate/,
  },
  {
    // #1313: the same in a heart-rate hold. The lane is the heart-rate one
    // (the newest sample still carries the range and a heart rate): no
    // dashed range, and the heart rate ridden; the name gives no range.
    graph: 'paused-hold',
    paused: true,
    lane: 'heart-rate',
    text: 'Paused · Target 50 W',
    named: 'Workout graph. Paused.',
    asked: undefined,
    doing: 'oyl-workout-strip__heart-rate',
    absent: /target|power|range/,
  },
] as const;

/** What the strip must be for a rider to read it, whichever lane it drew. */
function expectStripReadable(graph: GraphSight, fixture: (typeof STRIP_FIXTURES)[number]): void {
  const { laneBox, progressBox } = graph;
  if (laneBox === undefined || progressBox === undefined) {
    throw new Error('the strip is missing its lane or its bar');
  }
  // An image with a name.
  expect(graph.role).toBe('img');
  expect(graph.name).toContain('Workout graph.');
  expect(graph.name).toContain(fixture.named);
  // ⚠️ No well of its own: nothing in the strip paints a background, so what
  // is behind it is the HUD panel's dark surface, and its inks are the HUD's.
  expect(new Set(graph.backgrounds)).toEqual(new Set([PAINTS_NOTHING]));
  expect(graph.routeBackground).toBe(HUD_SURFACE);
  expect(graph.text.colour).toBe(HUD_INK);
  const mark = (name: string) => {
    const found = graph.marks.find((each) => each.name === name);
    if (found === undefined) {
      throw new Error(`no ${name} — found: ${graph.marks.map((each) => each.name).join(', ')}`);
    }
    return found;
  };
  // ONE lane, chosen by what is running, and tall enough to read.
  expect(graph.lane).toBe(fixture.lane);
  expect(graph.marks.filter((each) => fixture.absent.test(each.name))).toEqual([]);
  expect(laneBox.height).toBeGreaterThanOrEqual(36);
  if (fixture.asked !== undefined) {
    expect(mark(fixture.asked).paint).toBe(HUD_INK_MUTED);
  }
  if (fixture.doing !== undefined) {
    expect(mark(fixture.doing).paint).toBe(HUD_INK);
  }
  // By what the fixture IS, not by its name (#1331's review). #1313: the
  // name says the lane's reading now, as it does running, and no range, as
  // the strip draws none. (The paused hold's strap has no reading now: "No
  // heart rate.", which the Ride screen's graph says of it too.)
  if (fixture.paused) {
    expect(graph.name).not.toContain('chosen range');
    expect(graph.name).toMatch(
      fixture.lane === 'power' ? /Your power: \d+ W\./ : /(Heart rate: \d+ bpm|No heart rate)\./,
    );
  }
  for (const name of [
    ...(fixture.asked === undefined ? [] : [fixture.asked]),
    ...(fixture.doing === undefined ? [] : [fixture.doing]),
  ]) {
    const { box } = mark(name);
    // Each uses a real share of the lane, across nearly all of its width.
    expect(box.height, name).toBeGreaterThanOrEqual(10);
    expect(box.width, name).toBeGreaterThan(laneBox.width * 0.9);
    expect(box.left, name).toBeGreaterThanOrEqual(laneBox.left - 2);
    expect(box.right, name).toBeLessThanOrEqual(laneBox.right + 2);
    expect(box.top, name).toBeGreaterThanOrEqual(laneBox.top - 2);
    expect(box.bottom, name).toBeLessThanOrEqual(laneBox.bottom + 2);
  }
  // The bar: as wide as the strip, thin, with now 900 s into a 2400 s plan.
  expect(mark('oyl-workout-strip__track').paint).toBe(HUD_BORDER);
  expect(mark('oyl-workout-strip__done').paint).toBe(HUD_INK_MUTED);
  expect(mark('oyl-workout-strip__now').paint).toBe(HUD_INK);
  expect(progressBox.height).toBeGreaterThanOrEqual(6);
  expect(progressBox.height).toBeLessThanOrEqual(10);
  expect(Math.abs(progressBox.width - graph.strip.width)).toBeLessThanOrEqual(1);
  const now = mark('oyl-workout-strip__now').box;
  const along = ((now.left + now.right) / 2 - progressBox.left) / progressBox.width;
  expect(along).toBeGreaterThan(0.36);
  expect(along).toBeLessThan(0.39);
  const done = mark('oyl-workout-strip__done').box;
  expect(Math.abs(done.right - (now.left + now.right) / 2)).toBeLessThanOrEqual(2);
  // The now mark stands out of the bar, and stays inside the strip.
  expect(now.height).toBeGreaterThan(progressBox.height + 2);
  expect(now.top).toBeGreaterThanOrEqual(laneBox.bottom - 1);
  expect(now.bottom).toBeLessThanOrEqual(graph.text.box.top + 1);
  // One line of text, whole, at a size the rest of the HUD's small text is.
  expect(graph.text.content).toBe(fixture.text);
  expect(graph.text.overflow).toBeLessThanOrEqual(0);
  // Measured, not assumed: the text itself against the box it is in.
  expect(graph.text.inkWidth).toBeLessThanOrEqual(graph.text.boxWidth);
  expect(graph.text.fontSize).toBeGreaterThanOrEqual(12);
  // One line of text, or two where the parts are stacked (a line is 16 px).
  expect(graph.text.box.height).toBeLessThanOrEqual(graph.stacked ? 36 : 20);
  // In order, and none over another: the lane, the bar, the line.
  expect(laneBox.top).toBeGreaterThanOrEqual(graph.strip.top - SUBPIXEL_TOLERANCE);
  expect(progressBox.top).toBeGreaterThanOrEqual(laneBox.bottom);
  expect(graph.text.box.top).toBeGreaterThanOrEqual(progressBox.bottom);
  expect(graph.text.box.bottom).toBeLessThanOrEqual(graph.strip.bottom + SUBPIXEL_TOLERANCE);
}

test.describe('a running workout drawn on the HUD — #1307', () => {
  for (const viewport of GRAPH_VIEWPORTS) {
    test(`takes the route plan’s place and its size, and can be read — ${viewport.name}`, async ({
      page,
    }) => {
      // The page's timers are Playwright's from here on, for every load in
      // this case, so `untilTheGapsSettle` can run them ahead and stop them.
      await page.clock.install();
      // The control: the same ride with the route plan, and no strip.
      await openSettledRide(page, viewport, '?trainer=workout');
      expect(await graphOnTheHud(page)).toBeUndefined();
      const plan = await planBox(page);
      const before = await bothWays(page);
      expect(plan?.height ?? 0).toBeGreaterThan(64);

      for (const fixture of STRIP_FIXTURES) {
        await openSettledRide(page, viewport, `?trainer=workout&graph=${fixture.graph}`);
        const graph = await graphOnTheHud(page);
        if (graph === undefined || plan === undefined) {
          throw new Error('no workout strip on the HUD');
        }
        const after = await bothWays(page);

        // The size the route plan had, to the pixel.
        expect(Math.abs(graph.strip.height - plan.height)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(graph.strip.width - plan.width)).toBeLessThanOrEqual(0.5);
        console.log(
          `#1307 the workout strip (${fixture.graph}) — ${viewport.name}: ${graph.strip.width.toFixed(1)} × ${graph.strip.height.toFixed(1)} px, the route plan’s ${plan.width.toFixed(1)} × ${plan.height.toFixed(1)}; its lane ${(graph.laneBox?.height ?? 0).toFixed(1)} px tall; its line “${graph.text.content}” is ${graph.text.inkWidth.toFixed(1)} px of ${graph.text.boxWidth.toFixed(1)}`,
        );

        // Every panel is where it was with the route plan, both ways.
        for (const [index, [how, seen]] of after.entries()) {
          await test.step(`${fixture.graph} — ${how}`, () => {
            const was = before[index]?.[1];
            // Every box, every number: both loads were measured once the
            // ride's gap readings had settled (#1313, `untilTheGapsSettle`).
            const boxes = (measurement: StageMeasurement | undefined) =>
              (measurement?.panels ?? [])
                .filter((each) => each.box.height > 0)
                .map(
                  (each) =>
                    `${each.name}: ${[each.box.left, each.box.top, each.box.width, each.box.height]
                      .map((n) => n.toFixed(1))
                      .join(' ')}`,
                );
            expect(boxes(seen).length).toBeGreaterThanOrEqual(4);
            expect(boxes(seen)).toEqual(boxes(was));
            if (viewport.riderClear) {
              expect(
                seen.panels
                  .filter((each) => each.box.height > 0)
                  .filter((each) => overlap(each.box, riderBox(viewport)))
                  .map(describeItem),
              ).toEqual([]);
            }
          });
        }

        expect(graph.stacked, `${fixture.graph} stacked`).toBe(viewport.stacked);
        expectStripReadable(graph, fixture);
        // The strip is inside the route panel.
        expect(graph.route).toBeDefined();
        expect(graph.strip.left).toBeGreaterThanOrEqual(
          (graph.route?.left ?? Infinity) - SUBPIXEL_TOLERANCE,
        );
        expect(graph.strip.right).toBeLessThanOrEqual(
          (graph.route?.right ?? 0) + SUBPIXEL_TOLERANCE,
        );
        expect(graph.strip.bottom).toBeLessThanOrEqual(
          (graph.route?.bottom ?? 0) + SUBPIXEL_TOLERANCE,
        );
      }
    });
  }

  test('is the same dark strip when the page is in the dark theme: the HUD keeps its own palette', async ({
    page,
  }) => {
    const viewport = GRAPH_VIEWPORTS[0];
    if (viewport === undefined) throw new Error('no viewport');
    await page.emulateMedia({ colorScheme: 'dark' });
    for (const fixture of STRIP_FIXTURES) {
      await openRide(page, viewport, `?trainer=workout&graph=${fixture.graph}`);
      const graph = await graphOnTheHud(page);
      if (graph === undefined) throw new Error('no workout strip on the HUD');
      expect(graph.theme).toBe('dark');
      expectStripReadable(graph, fixture);
    }
  });
});

/**
 * #1313 — the strip on a phone, which #1307 never measured.
 *
 * Measured before this: upright, the strip had the route panel's narrow
 * column, 127 px at 360 wide, and its line overflowed it by 74 px (120 px in a
 * hold); on its side a hold's line overflowed its 238 px by 9. And the
 * route's own "0% complete" stood directly beside or above the workout's bar,
 * where it read as the bar's caption. `theme.css` §"THE WORKOUT'S STRIP ON A
 * PHONE" is the fix: two lines, a strip one line taller, the wide column
 * upright, and a hairline between the route's lines and the strip.
 *
 * The standing trainer notice takes the route panel's cell on a phone for its
 * first 15 s; each load puts it away with its own control first, as a rider
 * would to see the strip sooner.
 */
const PHONE_VIEWPORTS = OVERLAY_VIEWPORTS.filter(
  (each) => Math.min(each.width, each.height) <= 480,
);

interface StripOnAPhone {
  readonly strip: Box;
  readonly lane: Box;
  readonly profileText: Box;
  readonly route: Box;
  /** Each part of the line: how wide its text is, and the box it has. */
  readonly parts: readonly { readonly ink: number; readonly room: number; readonly text: string }[];
  readonly text: string;
  readonly border: {
    readonly top: { readonly width: number; readonly colour: string };
    readonly left: { readonly width: number; readonly colour: string };
  };
}

async function stripOnAPhone(page: Page): Promise<StripOnAPhone> {
  const notice = page.getByRole('button', { name: 'Trainer notice', expanded: true });
  if ((await notice.count()) > 0) {
    await notice.click();
  }
  await page.locator('.oyl-hud__route .oyl-workout-strip').waitFor({ state: 'visible' });
  return page.evaluate(() => {
    const boxOf = (selector: string): Box => {
      const element = document.querySelector(selector);
      if (element === null) throw new Error(`no ${selector}`);
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
    const strip = document.querySelector('.oyl-hud__route .oyl-workout-strip');
    if (strip === null) throw new Error('no strip');
    const style = getComputedStyle(strip);
    return {
      strip: boxOf('.oyl-hud__route .oyl-workout-strip'),
      lane: boxOf('.oyl-workout-strip__lane'),
      profileText: boxOf('.oyl-hud__profile-text'),
      route: boxOf('.oyl-hud__route'),
      parts: [...strip.querySelectorAll('.oyl-workout-strip__part')].map((part) => {
        const range = document.createRange();
        range.selectNodeContents(part);
        // Only what is shown: a hidden separator has no box.
        const ink = [...range.getClientRects()].reduce(
          (widest, rect) => Math.max(widest, rect.right),
          0,
        );
        const room = part.parentElement?.getBoundingClientRect().right ?? 0;
        return { ink, room, text: part.textContent ?? '' };
      }),
      text: strip.querySelector('.oyl-workout-strip__text')?.textContent ?? '',
      border: {
        top: { width: Number.parseFloat(style.borderTopWidth), colour: style.borderTopColor },
        left: { width: Number.parseFloat(style.borderLeftWidth), colour: style.borderLeftColor },
      },
    };
  });
}

const PHONE_STRIPS = [
  { graph: 'plain', text: 'Target 175 W · 15:00 left in block' },
  { graph: 'hold', text: '140 bpm, range 130–140 · Target 167 W' },
  { graph: 'paused-hold', text: 'Paused · Target 50 W' },
] as const;

test.describe('the workout strip on a phone — #1313', () => {
  for (const viewport of PHONE_VIEWPORTS) {
    test(`writes its line whole, keeps its lane, is set apart from the route’s line and lies over no rider — ${viewport.name}`, async ({
      page,
    }) => {
      for (const fixture of PHONE_STRIPS) {
        await openRide(page, viewport, `?trainer=workout&graph=${fixture.graph}`);
        const seen = await stripOnAPhone(page);
        console.log(
          `#1313 the strip on a phone (${fixture.graph}) — ${viewport.name}: ${seen.strip.width.toFixed(1)} × ${seen.strip.height.toFixed(1)} px, its lane ${seen.lane.height.toFixed(1)} px tall; ${seen.parts.map((part) => `“${part.text}” ends at ${part.ink.toFixed(1)} of ${part.room.toFixed(1)}`).join(', ')}${viewport.height > viewport.width ? `; the route panel ends ${(riderBox(viewport).top - seen.route.bottom).toFixed(1)} px above the rider's box` : ''}`,
        );
        // The same words as on a tablet, every one on screen: the line is
        // two parts, and each ends inside the strip.
        expect(seen.text.replace(/\s+/g, ' ')).toBe(fixture.text);
        expect(seen.parts.length).toBe(2);
        for (const part of seen.parts) {
          expect(part.ink, part.text).toBeLessThanOrEqual(part.room + SUBPIXEL_TOLERANCE);
        }
        // The lane as tall as on a tablet, or near it.
        expect(seen.lane.height).toBeGreaterThanOrEqual(40);
        // A hairline in the HUD's border token between the route's own line
        // ("0% complete") and the strip, on the side the line is.
        const above = seen.profileText.bottom <= seen.strip.top + SUBPIXEL_TOLERANCE;
        const beside = seen.profileText.right <= seen.strip.left + SUBPIXEL_TOLERANCE;
        expect(above || beside).toBe(true);
        const edge = above ? seen.border.top : seen.border.left;
        expect(edge.width).toBeGreaterThanOrEqual(1);
        expect(edge.colour).toBe(HUD_BORDER);
        // And nothing it moved lies over the rider or leaves the screen.
        const measured = await measure(page);
        const laidOut = measured.panels.filter((each) => each.box.height > 0);
        expect(
          laidOut.filter((each) => overlap(each.box, riderBox(viewport))).map(describeItem),
        ).toEqual([]);
        expect(laidOut.filter((each) => !inside(each.box, viewport)).map(describeItem)).toEqual([]);
      }
    });
  }
});

/**
 * #1244 — *Keep the plan* on the game's HUD, `ride-harness.tsx` §`GRAPH_REPLAN`.
 *
 * While an accepted re-plan waits for the workout's next block, the HUD's
 * actions gain a third control after *Pause* and *End ride*, so a rider does
 * not leave the game to refuse a change. The actions panel is the corner
 * nearest the rider's back wheel, and a panel one control wider or taller is
 * a panel nearer the rider.
 *
 * ## What is held
 *
 * At the three tablet viewports, with anchor positioning and without: the
 * control is on the stage, inside the viewport, uncovered, at least #669's
 * 48 px in both axes (it is the HUD row's own 72), 8 px or more from *Pause*
 * and *End ride*, and **no panel of the HUD is over the leaning rider's
 * box** — the same box every other case here holds panels clear of.
 *
 * ⚠️ The HUD's strip does NOT draw the dotted outline of what the move
 * replaced: it is the last five minutes of power or heart rate and a progress
 * bar (#1307), with no plan ahead in it to outline. The outline is on the
 * Ride screen's graph (`rideview.browser.spec.ts`). #1324 decided to keep it
 * so: the HUD shows the move's sentence, which says what changes.
 *
 * ## #1324: the move's sentence above the control
 *
 * Since #1324 the actions show the waiting move's sentence on a line above
 * *Keep the plan* — the LONGEST sentence `workout/replan-text.ts` can produce
 * (`replan-longest.ts`), read back off the HUD word for word. At the tablet
 * viewports the line is on the stage, inside the viewport and uncovered, and
 * the no-panel-over-the-rider rule above holds with it showing. On the
 * phones it gives way and is held to be laid out at no height (`theme.css`
 * §"#1324" has the measurement that ruled it out there), and the actions
 * panel's clearance from the rider is printed as before. The same ride with
 * nothing waiting has no such line.
 *
 * ## What is only published
 *
 * The same reading at every other overlay viewport (the phones), where the
 * control is held to being on the stage and uncovered and the rider's
 * clearance is printed, not bounded: #1244's ruling is the tablet on the bars.
 *
 * ## The control
 *
 * The same ride with no re-plan waiting (`graph=plain`) has no such control,
 * so a case that found one everywhere would not be reading this state.
 */
const REPLAN_ON_THE_HUD = '?trainer=workout&graph=replan';

const KEEP_THE_PLAN = 'control: Keep the plan';

/** `ride-harness.tsx`'s item name for the sentence above it — #1324. */
const PLAN_CHANGE = 'the plan change';

test.describe('Keep the plan on the HUD while a re-plan waits — #1244', () => {
  test('the three tablet viewports are the ones this holds', () => {
    expect(TABLET_VIEWPORTS.map((each) => `${String(each.width)}×${String(each.height)}`)).toEqual([
      '1280×800',
      '1024×768',
      '800×1280',
    ]);
  });

  for (const viewport of OVERLAY_VIEWPORTS) {
    const tablet = TABLET_VIEWPORTS.includes(viewport);
    test(`is on the stage, a ride-time control${tablet ? ', and no panel covers the rider' : ''} — ${viewport.name}`, async ({
      page,
    }) => {
      // The control: no re-plan waiting, no such control.
      await openRide(page, viewport, '?trainer=workout&graph=plain');
      const without = await measure(page);
      expect(without.items.map((each) => each.name)).not.toContain(KEEP_THE_PLAN);
      expect(without.items.map((each) => each.name)).not.toContain(PLAN_CHANGE);

      await openRide(page, viewport, REPLAN_ON_THE_HUD);
      // #1324: the move's own sentence, the longest there is, and nothing else.
      const shown = await page.locator('.oyl-hud__actions .oyl-hud__plan-change').textContent();
      expect(shown).toBe(longestReplanSentence());
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          const line = seen.items.find((each) => each.name === PLAN_CHANGE);
          if (line === undefined) {
            throw new Error(`no ${PLAN_CHANGE} among the HUD's items`);
          }
          const keep = seen.items.find((each) => each.name === KEEP_THE_PLAN);
          const pause = seen.items.find((each) => each.name === 'control: Pause');
          const end = seen.items.find((each) => each.name === 'control: End ride');
          if (keep === undefined || pause === undefined || end === undefined) {
            throw new Error(`no ${KEEP_THE_PLAN}, Pause or End ride among the HUD's items`);
          }
          if (tablet) {
            // Above the control it explains, and on the stage, uncovered.
            expect(inside(line.box, viewport), describeItem(line)).toBe(true);
            expect(line.onTop, describeItem(line)).toBe(true);
            expect(line.box.bottom).toBeLessThanOrEqual(keep.box.top + SUBPIXEL_TOLERANCE);
          } else {
            // On a phone it gives way (`theme.css` §"#1324").
            expect(line.box.height, describeItem(line)).toBe(0);
          }
          const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
          const rider = riderBox(viewport);
          const over = seen.panels
            .filter((each) => each.box.height > 0)
            .filter((each) => overlap(each.box, rider));
          console.log(
            `#1244 Keep the plan on the HUD — ${viewport.name} — ${how}: ` +
              `${keep.box.width.toFixed(1)} × ${keep.box.height.toFixed(1)} px at ` +
              `[${keep.box.left.toFixed(0)},${keep.box.top.toFixed(0)}]; the sentence ` +
              `${line.box.width.toFixed(0)} × ${line.box.height.toFixed(0)} px; the actions panel ` +
              `${actions?.box.width.toFixed(0) ?? '?'} × ${actions?.box.height.toFixed(0) ?? '?'} px, ` +
              `its top ${((actions?.box.top ?? 0) - rider.bottom).toFixed(0)} px below the rider's box` +
              `, its left ${((actions?.box.left ?? 0) - rider.right).toFixed(0)} px right of it` +
              `; panels over the rider: ${over.length === 0 ? 'none' : over.map(describeItem).join(', ')}`,
          );

          // #1482: the touch lock is on the stage, uncovered, in the state
          // that fills the actions panel most; and on a phone on its side
          // *Trainer notice* gives way to it there (`theme.css` §"#1482"),
          // which the tablets have the room not to do.
          const lock = seen.items.find((each) => each.name === 'control: Lock');
          const notice = seen.items.find((each) => each.name === 'control: Trainer notice');
          if (lock === undefined || notice === undefined) {
            throw new Error("no Lock or Trainer notice among the HUD's items");
          }
          expect(inside(lock.box, viewport) && lock.onTop, describeItem(lock)).toBe(true);
          if (tablet) {
            expect(inside(notice.box, viewport) && notice.onTop, describeItem(notice)).toBe(true);
          } else if (viewport.width >= 736 && viewport.height <= 480) {
            expect(notice.box.height, describeItem(notice)).toBe(0);
          }

          expect(inside(keep.box, viewport), describeItem(keep)).toBe(true);
          expect(keep.onTop, describeItem(keep)).toBe(true);
          expect(keep.box.width).toBeGreaterThanOrEqual(48 - SUBPIXEL_TOLERANCE);
          expect(keep.box.height).toBeGreaterThanOrEqual(48 - SUBPIXEL_TOLERANCE);
          // Pause and End ride are still on the stage, uncovered.
          for (const other of [pause, end]) {
            expect(inside(other.box, viewport), describeItem(other)).toBe(true);
            expect(other.onTop, describeItem(other)).toBe(true);
            // Two controls a rider presses at the bars do not touch: 8 px.
            const apartX = Math.max(
              keep.box.left - other.box.right,
              other.box.left - keep.box.right,
            );
            const apartY = Math.max(
              keep.box.top - other.box.bottom,
              other.box.top - keep.box.bottom,
            );
            expect(
              Math.max(apartX, apartY),
              `${KEEP_THE_PLAN} and ${other.name} are closer than 8 px`,
            ).toBeGreaterThanOrEqual(8 - SUBPIXEL_TOLERANCE);
          }
          if (tablet) {
            expect(over.map(describeItem)).toEqual([]);
          }
        });
      }
    });
  }
});

/**
 * #1329 — *Switch re-plans off* on the game's HUD, `ride-harness.tsx`
 * §`GRAPH_REPLANS_ON`, so a rider in the game can stop what is being sent
 * without leaving it. A row of its own, last in the actions panel, for as
 * long as the workout has re-plans on: alone (`graph=replan-on`, most of
 * such a workout) and under *Keep the plan* and its sentence while a move
 * waits (`graph=replan`, the tallest the panel gets).
 *
 * Held at every overlay viewport, both ways: the control on the stage,
 * inside the viewport and uncovered, at least #669's 48 px, 8 px or more
 * from *Pause* and *End ride*, which stay on the stage. At the tablets no
 * panel is over the rider's box; at the phones the actions panel's
 * clearance is printed, for #1244's reason. The plain workout
 * (`graph=plain`, re-plans off) has no such control.
 */
const SWITCH_REPLANS_OFF = 'control: Switch re-plans off';

test.describe('Switch re-plans off on the HUD while re-plans are on — #1329', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    const tablet = TABLET_VIEWPORTS.includes(viewport);
    test(`is on the stage, a ride-time control${tablet ? ', and no panel covers the rider' : ''} — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?trainer=workout&graph=plain');
      expect((await measure(page)).items.map((each) => each.name)).not.toContain(
        SWITCH_REPLANS_OFF,
      );

      for (const query of ['?trainer=workout&graph=replan-on', REPLAN_ON_THE_HUD]) {
        await openRide(page, viewport, query);
        for (const [how, seen] of await bothWays(page)) {
          await test.step(`${query} — ${how}`, () => {
            const off = seen.items.find((each) => each.name === SWITCH_REPLANS_OFF);
            const pause = seen.items.find((each) => each.name === 'control: Pause');
            const end = seen.items.find((each) => each.name === 'control: End ride');
            if (off === undefined || pause === undefined || end === undefined) {
              throw new Error(`no ${SWITCH_REPLANS_OFF}, Pause or End ride among the HUD's items`);
            }
            const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
            const rider = riderBox(viewport);
            const over = seen.panels
              .filter((each) => each.box.height > 0)
              .filter((each) => overlap(each.box, rider));
            console.log(
              `#1329 Switch re-plans off — ${viewport.name} — ${query} — ${how}: ` +
                `${off.box.width.toFixed(1)} × ${off.box.height.toFixed(1)} px at ` +
                `[${off.box.left.toFixed(0)},${off.box.top.toFixed(0)}]; the actions panel ` +
                `${actions?.box.width.toFixed(0) ?? '?'} × ${actions?.box.height.toFixed(0) ?? '?'} px, ` +
                `its top ${((actions?.box.top ?? 0) - rider.bottom).toFixed(0)} px below the rider's box` +
                `; panels over the rider: ${over.length === 0 ? 'none' : over.map(describeItem).join(', ')}`,
            );
            expect(inside(off.box, viewport), describeItem(off)).toBe(true);
            expect(off.onTop, describeItem(off)).toBe(true);
            expect(off.box.width).toBeGreaterThanOrEqual(48 - SUBPIXEL_TOLERANCE);
            expect(off.box.height).toBeGreaterThanOrEqual(48 - SUBPIXEL_TOLERANCE);
            for (const other of [pause, end]) {
              expect(inside(other.box, viewport), describeItem(other)).toBe(true);
              expect(other.onTop, describeItem(other)).toBe(true);
              const apartX = Math.max(
                off.box.left - other.box.right,
                other.box.left - off.box.right,
              );
              const apartY = Math.max(
                off.box.top - other.box.bottom,
                other.box.top - off.box.bottom,
              );
              expect(
                Math.max(apartX, apartY),
                `${SWITCH_REPLANS_OFF} and ${other.name} are closer than 8 px`,
              ).toBeGreaterThanOrEqual(8 - SUBPIXEL_TOLERANCE);
            }
            if (tablet) {
              expect(over.map(describeItem)).toEqual([]);
            }
          });
        }
      }
    });
  }
});

/**
 * #1312 — a ride on a LOOP. `?lap=riding` has a lap open, so the elevation
 * strip's sentence carries the lap's time beside its number (`fields.ts`
 * §`profileReading`): `NN% of lap N · 59:59`. `?lap=ended` adds the finished
 * lap in the notice cell (`GameView` §`lapNotice`), with the widest notice a
 * ride short of an hour-long lap produces.
 *
 * ⚠️ **Why the lap's time is in the strip's sentence and not a field.** As an
 * eighth secondary field it was measured here first, and at 736×360 it put the
 * secondary panel over the rider (the panel grew a row, to 182 px); upright
 * at 360×752 it cost the notice cell its clearance. The sentence costs no
 * cell, and "riding" below holds the stage to exactly what it was: every
 * reading and control on it, every panel whole, none over another or over the
 * rider — and the sentence still on ONE line with the time in it.
 *
 * "Ended" measures the notice at every overlay viewport, both ways: whole,
 * over no panel and not over the rider, and upright clear of the rider's box
 * by the clearance #605 set for a notice there.
 *
 * ⚠️ **The lap's notice is alone in the cell by rule, and that rule is the
 * third thing measured** (`HudPanel.tsx` §`HudPanelProps.lapNotice`): beside
 * *Keep the screen on*, which is never put away, the lap is not on the HUD at
 * all — a pair of notices is what #585 and #647 each measured running over
 * the rider. There is no control that takes the rule away: it is a branch in
 * a component, not a stylesheet rule a page can restore, and the unit test
 * that holds it is `HudPanel.test.tsx` §"#1312". What stands in for one is
 * #647's own control above, where the same measurement is red for a pair.
 */
const LAP_NOTICE_SEEN =
  'Lap 3: 59:59 · 342 W · 36.0 km/h · 168 bpm. 124 s slower than lap 2. Best on this course: lap 2, 57:55.';

async function lapOnTheHud(page: Page): Promise<{
  readonly notice: string | undefined;
  /** The strip's sentence as the document holds it, laid out or not. */
  readonly sentence: string;
  /** The strip's sentence, and how many lines it is set on — or `undefined` where it is not laid out. */
  readonly strip: { readonly text: string; readonly lines: number } | undefined;
}> {
  return page.evaluate(() => {
    const label = [...document.querySelectorAll('.oyl-hud__notices .oyl-status__label')].find(
      (each) => each.textContent?.startsWith('Lap '),
    );
    const sentence = document.querySelector('.oyl-hud__profile-text');
    const words = sentence?.firstChild ?? null;
    let strip: { text: string; lines: number } | undefined;
    if (sentence !== null && words !== null && sentence.getClientRects().length > 0) {
      const range = document.createRange();
      range.selectNodeContents(words);
      // One rectangle per line box the words are set on.
      const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      strip = { text: sentence.textContent ?? '', lines: tops.size };
    }
    return {
      notice: label?.closest('.oyl-status')?.textContent?.replace(/\s+/g, ' '),
      sentence: sentence?.textContent ?? '',
      strip,
    };
  });
}

test.describe('a ride on a loop — #1312', () => {
  for (const viewport of OVERLAY_VIEWPORTS) {
    test(`the lap’s time is in the strip’s sentence, on one line, and the stage is as it was — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?lap=riding');
      const found = await lapOnTheHud(page);
      expect(found.strip?.text).toMatch(/^\d+% of lap \d+ · 59:59$/);
      expect(found.strip?.lines).toBe(1);
      expect(found.notice).toBeUndefined();

      const box = riderBox(viewport);
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          expect(seen.scrollY).toBe(0);
          expect(seen.pageOverflow).toBeLessThanOrEqual(0);
          const lost = seen.items.filter((each) => !inside(each.box, viewport) || !each.onTop);
          expect(lost.map(describeItem)).toEqual([]);
          expect(
            seen.panels.filter((each) => !inside(each.box, viewport)).map(describeItem),
          ).toEqual([]);
          const collisions: string[] = [];
          seen.panels.forEach((a, index) => {
            for (const b of seen.panels.slice(index + 1)) {
              if (overlap(a.box, b.box)) collisions.push(`${describeItem(a)} × ${describeItem(b)}`);
            }
          });
          expect(collisions).toEqual([]);
          expect(seen.panels.filter((each) => overlap(each.box, box)).map(describeItem)).toEqual(
            [],
          );
        });
      }
    });

    test(`as a lap ends: the finished lap’s notice, whole and over nothing — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?lap=ended');
      // The harness rides its four-metre loop for real, so the first crossing
      // of its line is a second or two of ride away.
      await expect
        .poll(async () => (await lapOnTheHud(page)).notice, { timeout: 30_000 })
        .toContain(LAP_NOTICE_SEEN);

      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          expect(seen.scrollY).toBe(0);
          expect(seen.pageOverflow).toBeLessThanOrEqual(0);
          // ⚠️ On a phone a notice takes the route panel's cell (#437), so for
          // these seconds the strip and the plan view are not laid out — and
          // on a tablet, where the notice has a cell of its own, they are.
          const onAPhone = Math.min(viewport.width, viewport.height) <= 480;
          const routePanel = ['the elevation strip', 'the road ahead', 'the plan view'];
          const lost = seen.items
            .filter((each) => !inside(each.box, viewport) || !each.onTop)
            .map((each) => each.name);
          expect(lost).toEqual(onAPhone ? routePanel : []);
          // The notice: whole, over no panel, not over the rider.
          expect(easedCollisions(seen, viewport)).toEqual([]);
          const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
          expect(notice?.box.height ?? 0).toBeGreaterThan(1);
          const clearance = riderBox(viewport).top - (notice?.box.bottom ?? Infinity);
          console.log(
            `a lap ended, ${how} — ${viewport.name} — notice cell ${(notice?.box.height ?? 0).toFixed(0)} px tall` +
              (viewport.height > viewport.width
                ? `; ${clearance.toFixed(0)} px above the rider's box`
                : ''),
          );
          if (viewport.height > viewport.width) {
            expect(clearance).toBeGreaterThanOrEqual(EASED_RIDER_CLEARANCE_PIXELS);
          }
        });
      }
    });
  }

  for (const viewport of OVERLAY_VIEWPORTS.filter((each) => each.width === 360)) {
    test(`a finished lap gives way to Keep the screen on: it is not in the notice cell — ${viewport.name}`, async ({
      page,
    }) => {
      // The apparatus is the case above at this viewport: without the refusal,
      // the lap IS in the cell. Here a lap HAS ended behind the refusal — the
      // strip's sentence is in the document though its panel is not laid out,
      // and it says the rider is past the first lap.
      await openRide(page, viewport, '?lap=ended&keepalive=failed');
      await expect
        .poll(async () => (await lapOnTheHud(page)).sentence, { timeout: 30_000 })
        .toMatch(/of lap ([3-9]|\d\d+) /);
      expect((await keepScreenOnNotice(page)).text).toBe(KEEP_SCREEN_ON_SEEN);
      expect((await lapOnTheHud(page)).notice).toBeUndefined();
      const { collisions, clearance } = keepScreenOnLaidOut(
        await measure(page),
        viewport,
        'a lap ended behind it',
      );
      expect(collisions).toEqual([]);
      expect(clearance).toBeGreaterThanOrEqual(EASED_RIDER_CLEARANCE_PIXELS);
    });
  }
});

/**
 * #1312 and #1244 together, which neither change measured alone: a lap ends
 * while an accepted re-plan waits. The lap's notice is in the notice cell and
 * *Keep the plan* is a row of the actions panel — a taller panel in one corner
 * and a notice in another, on the one stage.
 *
 * A waiting re-plan puts NO notice on the HUD (its sentence is a line of the
 * actions on a tablet and gives way on a phone, #1324), so there is nothing for the
 * lap's notice to give way to; what is held is that the two do not meet: the
 * notice whole, the control on the stage and on top, no panel over another,
 * and on the tablets no panel over the rider — each change's own bar, with
 * the other's furniture on the stage.
 */
test.describe('a lap ends while a re-plan waits — #1312 with #1244', () => {
  // ⚠️ ONE viewport, the tightest (the smallest column layout, 360×752), and
  // not the nine: on this fixture the lap's notice waits out the workout's
  // own notice first, so the case takes about sixteen seconds, and nine of
  // them is two and a half minutes of a gate whose `chromium` run has little
  // more than one to spare (docs/agents/ci.md §4c). All nine passed when this
  // was written, on a Mac; the one kept is where a notice has least room.
  for (const viewport of OVERLAY_VIEWPORTS.filter(
    (each) => each.width === 360 && each.height === 752,
  )) {
    const tablet = TABLET_VIEWPORTS.includes(viewport);
    test(`the lap’s notice and Keep the plan are both on the stage, over nothing — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, `${REPLAN_ON_THE_HUD}&lap=ended`);
      await expect
        .poll(async () => (await lapOnTheHud(page)).notice, { timeout: 30_000 })
        .toContain(LAP_NOTICE_SEEN);

      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          const keep = seen.items.find((each) => each.name === KEEP_THE_PLAN);
          if (keep === undefined) {
            throw new Error(`no ${KEEP_THE_PLAN} among the HUD's items`);
          }
          expect(inside(keep.box, viewport), describeItem(keep)).toBe(true);
          expect(keep.onTop, describeItem(keep)).toBe(true);
          for (const name of ['control: Pause', 'control: End ride', 'control: Lock']) {
            const control = seen.items.find((each) => each.name === name);
            expect(control?.onTop, name).toBe(true);
          }
          // The notice: whole, over no panel — the taller actions panel among them.
          const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
          expect(notice?.box.height ?? 0).toBeGreaterThan(1);
          expect(easedCollisions(seen, viewport)).toEqual([]);
          const rider = riderBox(viewport);
          const over = seen.panels
            .filter((each) => each.box.height > 0)
            .filter((each) => overlap(each.box, rider));
          console.log(
            `a lap ended while a re-plan waits, ${how} — ${viewport.name} — notice cell ` +
              `${(notice?.box.height ?? 0).toFixed(0)} px tall; panels over the rider: ` +
              (over.length === 0 ? 'none' : over.map(describeItem).join(', ')),
          );
          if (tablet) {
            expect(over.map(describeItem)).toEqual([]);
          }
        });
      }
    });
  }
});

/**
 * #2271 — the actions row at a short laptop window, in a workout with a
 * trainer (`?trainer=workout&graph=plain`): *Pause*, *End ride*, the lock and
 * *Trainer notice*, the row's four.
 *
 * At 1024×600 on `main` the four shared one line at 77 px each, because a
 * line is chosen by the controls' 72 px floors and not by their words: *End
 * ride*'s words ran out of its box under the lock, and *Trainer notice* ran
 * off the panel's edge. Every box was inside the viewport and over no other
 * box, so a check of boxes alone passed it. So what is held here is the WORDS
 * as well as the box, for each control in the row:
 *
 * - its box at least #669's 48 px (`RIDE_TIME_TARGET_PIXELS`) both ways;
 * - its visible words inside its own box (`theme.css` §"#2271");
 * - its box inside the actions panel and over no other control's box, and
 *   inside the viewport — every control on a corners layout, and the
 *   ride-time ones (`design/ride-time-controls.ts`) on the stacked layout,
 *   whose stage scrolls (#419): at 320×256 *Trainer notice* is partly under
 *   the fold there (its box ends at 271 px on a Mac) and reached by
 *   scrolling, as it was before #2271. The topmost-thing checks below still
 *   hold its centre, which is inside the viewport;
 * - the topmost thing at its centre and at the four corners of its words, so
 *   a control drawn over another's label is a red case;
 * - and Pause, End ride and the lock on one line in that order, which this
 *   change must not move (the issue's lane scope), with *Trainer notice* on a
 *   line below them on a landscape corners layout (736 px and wider).
 *
 * The viewports are the short laptop windows, down to the corners layout's
 * smallest and the stacked layout's two landscape ones under it: 1024×600 is
 * the issue's, 1280×720 and 1366×657 (a 1366×768 laptop under its browser's
 * chrome) are #875's, 960×540 a 16:9 window, 802×600 the middle corners
 * layout, 736×480 and 736×360 the short corners layout's edges, and 640×360
 * and 320×256 the stacked layout's (SC 1.4.10's viewport is the app's least).
 *
 * Not the upright tablet (800×1280) or an upright phone, which `theme.css`
 * §"#2271" leaves out and says why: §"#2281" below holds those.
 *
 * The control: `theme.css` §"#2271" deleted, which puts the four back on one
 * line in the 20 rem panel and turns 1024×600, 1280×720, 1366×657 and 960×540
 * red on *End ride*'s and *Trainer notice*'s words.
 */
const SHORT_LAPTOPS: readonly (Viewport & { readonly scrolls?: true })[] = [
  { name: 'the narrowest wide screen — 1024×600', width: 1024, height: 600, unstagedFails: true },
  { name: 'a laptop — 1280×720', width: 1280, height: 720, unstagedFails: true },
  {
    name: 'a 1366×768 laptop under its browser’s chrome — 1366×657',
    width: 1366,
    height: 657,
    unstagedFails: true,
  },
  { name: 'a 16:9 window — 960×540', width: 960, height: 540, unstagedFails: true },
  { name: 'the middle corners layout — 802×600', width: 802, height: 600, unstagedFails: true },
  {
    name: 'the tallest short corners layout — 736×480',
    width: 736,
    height: 480,
    unstagedFails: true,
  },
  { name: 'the smallest corners layout — 736×360', width: 736, height: 360, unstagedFails: true },
  {
    name: 'a small window on its side — 640×360',
    width: 640,
    height: 360,
    unstagedFails: true,
    scrolls: true,
  },
  { name: 'reflow — 320×256', width: 320, height: 256, unstagedFails: true, scrolls: true },
];

/** `theme.css` §"#2271"'s `min-width: 46rem`, in px: the corners layout begins here. */
const CORNERS_LAYOUT_MIN_WIDTH = 736;

/** The row's controls, in document order, as `HudCore.tsx` renders them. */
const ACTIONS_ROW = ['Pause', 'End ride', 'Lock', 'Trainer notice'] as const;

interface RowControl {
  /** The visible words, whitespace collapsed. */
  readonly words: string;
  readonly box: Box;
  /** The visible words' own box: every text node not visually hidden. */
  readonly ink: Box | undefined;
  /** Whether the control is the topmost thing at its centre. */
  readonly onTop: boolean;
  /** The corners of its words, 1 px in, that something else is drawn over. */
  readonly inkCovered: readonly string[];
}

async function actionsRow(
  page: Page,
): Promise<{ readonly panel: Box; readonly controls: readonly RowControl[] }> {
  return page.evaluate(() => {
    const boxOf = (rect: DOMRect): Box => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const panel = document.querySelector('.oyl-hud__actions');
    if (panel === null) throw new Error('no actions panel on the HUD');
    const owns = (control: Element, x: number, y: number): boolean => {
      const hit = document.elementFromPoint(x, y);
      return hit !== null && (hit === control || control.contains(hit));
    };
    const controls = [...panel.querySelectorAll('.oyl-hud__controls > button')].map((control) => {
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      const rects: DOMRect[] = [];
      const words: string[] = [];
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.parentElement?.closest('.oyl-visually-hidden') !== null) continue;
        if ((node.textContent ?? '').trim() === '') continue;
        words.push(node.textContent ?? '');
        const range = document.createRange();
        range.selectNodeContents(node);
        rects.push(...range.getClientRects());
      }
      const ink =
        rects.length === 0
          ? undefined
          : boxOf(
              new DOMRect(
                Math.min(...rects.map((each) => each.left)),
                Math.min(...rects.map((each) => each.top)),
                Math.max(...rects.map((each) => each.right)) -
                  Math.min(...rects.map((each) => each.left)),
                Math.max(...rects.map((each) => each.bottom)) -
                  Math.min(...rects.map((each) => each.top)),
              ),
            );
      const box = boxOf(control.getBoundingClientRect());
      const corners =
        ink === undefined
          ? []
          : ([
              ['top left', ink.left + 1, ink.top + 1],
              ['top right', ink.right - 1, ink.top + 1],
              ['bottom left', ink.left + 1, ink.bottom - 1],
              ['bottom right', ink.right - 1, ink.bottom - 1],
            ] as const);
      return {
        words: words.join(' ').replace(/\s+/g, ' ').trim(),
        box,
        ink,
        onTop: owns(control, (box.left + box.right) / 2, (box.top + box.bottom) / 2),
        inkCovered: corners.filter(([, x, y]) => !owns(control, x, y)).map(([where]) => where),
      };
    });
    return { panel: boxOf(panel.getBoundingClientRect()), controls };
  });
}

function within(inner: Box, outer: Box): boolean {
  return (
    inner.left >= outer.left - SUBPIXEL_TOLERANCE &&
    inner.top >= outer.top - SUBPIXEL_TOLERANCE &&
    inner.right <= outer.right + SUBPIXEL_TOLERANCE &&
    inner.bottom <= outer.bottom + SUBPIXEL_TOLERANCE
  );
}

/** Every way the row's controls fail #2271, as sentences; empty when none does. */
function actionsRowFailures(
  row: { readonly panel: Box; readonly controls: readonly RowControl[] },
  viewport: (typeof SHORT_LAPTOPS)[number],
): string[] {
  const found: string[] = [];
  const at = (box: Box) =>
    `[${box.left.toFixed(0)},${box.top.toFixed(0)} → ${box.right.toFixed(0)},${box.bottom.toFixed(0)}]`;
  const minimum = RIDE_TIME_TARGET_PIXELS - SUBPIXEL_TOLERANCE;
  for (const control of row.controls) {
    const { box, ink, words } = control;
    if (box.width < minimum || box.height < minimum) {
      found.push(`${words} ${at(box)} is under ${String(RIDE_TIME_TARGET_PIXELS)} px`);
    }
    if (ink === undefined) found.push(`${words} has no visible words`);
    else if (!within(ink, box))
      found.push(`${words}'s words ${at(ink)} run out of its box ${at(box)}`);
    if (!within(box, row.panel))
      found.push(`${words} ${at(box)} is outside its panel ${at(row.panel)}`);
    const rideTime = RIDE_TIME_CONTROLS.some(
      (entry) => entry.surface === 'game-hud' && namesControl(entry, words),
    );
    if ((rideTime || viewport.scrolls !== true) && !inside(box, viewport)) {
      found.push(`${words} ${at(box)} is off the stage`);
    }
    if (!control.onTop) found.push(`${words} is covered at its centre`);
    if (control.inkCovered.length > 0) {
      found.push(`${words}'s words are covered at ${control.inkCovered.join(', ')}`);
    }
  }
  for (const [index, a] of row.controls.entries()) {
    for (const b of row.controls.slice(index + 1)) {
      if (overlap(a.box, b.box))
        found.push(`${a.words} ${at(a.box)} is over ${b.words} ${at(b.box)}`);
    }
  }
  return found;
}

test.describe('the actions row at a short laptop window, in a workout with a trainer — #2271', () => {
  for (const viewport of SHORT_LAPTOPS) {
    test(`every control’s words in its box, on top, on the stage — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?trainer=workout&graph=plain');
      const row = await actionsRow(page);
      console.log(
        `#2271 the actions row — ${viewport.name}: panel ${row.panel.width.toFixed(0)} × ` +
          `${row.panel.height.toFixed(0)} px; ` +
          row.controls
            .map(
              (each) =>
                `${each.words} ${each.box.width.toFixed(0)} × ${each.box.height.toFixed(0)}` +
                ` (words ${(each.ink?.width ?? 0).toFixed(0)})`,
            )
            .join(', '),
      );

      // All four are in the row, in their order: the fixture is the one the
      // issue was found on, and a row missing *Trainer notice* proves nothing.
      expect(row.controls.map((each) => each.words)).toEqual([...ACTIONS_ROW]);
      expect(actionsRowFailures(row, viewport)).toEqual([]);

      // Pause, End ride and the lock keep their places: one line, in order.
      const [pause, end, lock] = row.controls;
      if (pause === undefined || end === undefined || lock === undefined) {
        throw new Error('the row lost a control');
      }
      expect(end.box.left).toBeGreaterThanOrEqual(pause.box.right);
      expect(lock.box.left).toBeGreaterThanOrEqual(end.box.right);
      expect(end.box.top).toBeLessThan(pause.box.bottom);
      expect(lock.box.top).toBeLessThan(pause.box.bottom);

      // The notice has the line of its own the rule gives it: below the three,
      // not before them, which `order: -1` would draw while the three stayed
      // in order one line lower.
      const notice = row.controls[3];
      if (notice === undefined) throw new Error('the row lost Trainer notice');
      if (viewport.width >= CORNERS_LAYOUT_MIN_WIDTH) {
        expect(notice.box.top).toBeGreaterThanOrEqual(pause.box.bottom - SUBPIXEL_TOLERANCE);
      }
    });
  }
});

/**
 * #2281 — the same row UPRIGHT, which #2271 left out: the upright tablet,
 * the column layout of an upright phone, and two upright phones on the
 * stacked layout (390×664 a phone in a browser with its bars showing, 320×704
 * a very narrow one). On a workout with a trainer (the row's four) and on a
 * ride with no notice (*Pause*, *End ride* and the lock, with the moving time
 * beside them on the column layout), each running and then paused, which puts
 * *Resume*, the row's longest word but one, where *Pause* was.
 *
 * On `main` (Mac fonts, whose widths for this row are the CI runner's too):
 * at 800×1280 the four were 77 px each, *End ride*'s words ran 6 px out of
 * its box and *Trainer notice*'s 53; upright at 360 wide *End ride* was 74 px
 * beside the moving time, 9 px out; in a workout *Trainer notice* ran 45 px
 * out at 360 wide and 35 at 390.
 *
 * Held here: `actionsRowFailures` above for every control, and
 *
 * - running, every control's words inside its border as well as its box;
 * - *Pause* (or *Resume*), *End ride* and the lock on one line, in order;
 * - on the two overlay layouts *Trainer notice* on that line too (its own
 *   line is the 80 px of panel `theme.css` §"#2281" exists not to spend),
 *   and every control the same width with anchor positioning and without
 *   (#1120), so the words measured are the words of both;
 * - and there no laid-out panel, and not the moving time, over the leaning
 *   rider, and the moving time over no control.
 *
 * The control: `theme.css` §"#2281" deleted, with §"THE MOVING TIME ON AN
 * UPRIGHT PHONE"'s gap back at 16 px, which is `main`: red at 800×1280,
 * 390×844 and 390×664 in a workout and at 360×800 and 360×752 on both rides.
 */
const UPRIGHT: readonly (Viewport & { readonly scrolls?: true })[] = [
  { name: 'a tablet upright — 800×1280', width: 800, height: 1280, unstagedFails: false },
  { name: 'a phone upright — 390×844', width: 390, height: 844, unstagedFails: false },
  {
    name: 'a narrow Android phone upright, in the app — 360×800',
    width: 360,
    height: 800,
    unstagedFails: false,
  },
  { name: 'the smallest column layout — 360×752', width: 360, height: 752, unstagedFails: false },
  {
    name: 'a phone upright in a browser — 390×664',
    width: 390,
    height: 664,
    unstagedFails: false,
    scrolls: true,
  },
  {
    name: 'a very narrow phone upright — 320×704',
    width: 320,
    height: 704,
    unstagedFails: true,
    scrolls: true,
  },
];

/** `theme.css` `.oyl-hud__control`'s border, each side. */
const CONTROL_BORDER_PIXELS = 2;

const UPRIGHT_RIDES = [
  { name: 'a workout with a trainer', query: '?trainer=workout&graph=plain', notice: true },
  { name: 'a ride with no notice', query: '', notice: false },
] as const;

test.describe('the actions row upright, running and paused — #2281', () => {
  for (const viewport of UPRIGHT) {
    for (const ride of UPRIGHT_RIDES) {
      test(`every control’s words in its box, one line, clear of the rider — ${ride.name} — ${viewport.name}`, async ({
        page,
      }) => {
        await openRide(page, viewport, ride.query);
        for (const paused of [false, true]) {
          if (paused) await page.getByRole('button', { name: 'Pause' }).click();
          await test.step(paused ? 'paused' : 'running', async () => {
            const row = await actionsRow(page);
            console.log(
              `#2281 the actions row — ${ride.name}${paused ? ', paused' : ''} — ${viewport.name}: ` +
                `panel ${row.panel.width.toFixed(0)} × ${row.panel.height.toFixed(0)} px; ` +
                row.controls
                  .map(
                    (each) =>
                      `${each.words} ${each.box.width.toFixed(0)} × ${each.box.height.toFixed(0)}` +
                      ` (words ${(each.ink?.width ?? 0).toFixed(0)})`,
                  )
                  .join(', '),
            );
            const first = paused ? 'Resume' : 'Pause';
            expect(row.controls.map((each) => each.words)).toEqual(
              ride.notice
                ? [first, 'End ride', 'Lock', 'Trainer notice']
                : [first, 'End ride', 'Lock'],
            );
            expect(actionsRowFailures(row, viewport)).toEqual([]);
            // Running, the state a rider reads at the bars, the words are
            // inside the border too and not drawn over it: shared out equally
            // (`flex: 1`) *End ride* is 77 px at 800×1280 and its words
            // cross both borders, inside its box by the measure above.
            if (!paused) {
              expect(
                row.controls
                  .filter(
                    ({ box, ink }) =>
                      ink !== undefined &&
                      (ink.left < box.left + CONTROL_BORDER_PIXELS - SUBPIXEL_TOLERANCE ||
                        ink.right > box.right - CONTROL_BORDER_PIXELS + SUBPIXEL_TOLERANCE),
                  )
                  .map(({ words }) => `${words}'s words cross its border`),
              ).toEqual([]);
            }

            const [pause, end, lock, notice] = row.controls;
            if (pause === undefined || end === undefined || lock === undefined) {
              throw new Error('the row lost a control');
            }
            expect(end.box.left).toBeGreaterThanOrEqual(pause.box.right);
            expect(lock.box.left).toBeGreaterThanOrEqual(end.box.right);
            expect(end.box.top).toBeLessThan(pause.box.bottom);
            expect(lock.box.top).toBeLessThan(pause.box.bottom);
            if (viewport.scrolls === true) return;

            if (notice !== undefined) {
              expect(notice.box.left).toBeGreaterThanOrEqual(lock.box.right);
              expect(notice.box.top, 'Trainer notice took a line of its own').toBeLessThan(
                pause.box.bottom,
              );
            }
            const rider = riderBox(viewport);
            for (const [how, seen] of await bothWays(page)) {
              const controls = seen.items.filter((each) => each.name.startsWith('control: '));
              for (const control of row.controls) {
                const same = controls.find((each) => each.name === `control: ${control.words}`);
                expect(same?.box.width, `${control.words} ${how}`).toBeCloseTo(
                  control.box.width,
                  0,
                );
              }
              const moving = seen.items.find((each) => each.name === 'reading: Moving');
              if (moving === undefined) throw new Error(`no moving time ${how}`);
              expect(
                [...seen.panels.filter((each) => each.box.height > 0), moving]
                  .filter((each) => overlap(each.box, rider))
                  .map(describeItem),
                `over the leaning rider ${how}`,
              ).toEqual([]);
              expect(
                controls.filter((each) => overlap(each.box, moving.box)).map(describeItem),
                `under the moving time ${how}`,
              ).toEqual([]);
            }
          });
        }
      });
    }
  }
});
