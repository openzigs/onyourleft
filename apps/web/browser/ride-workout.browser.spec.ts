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
 * ⚠️ **802×600 is here for the size comparison ONLY.** #1169 records that the
 * route and actions panels lie over the rider there on `main`; this change
 * does not fix that and must not be read as measuring it. What it shows is
 * that the strip makes it no worse.
 */
interface GraphSight {
  readonly role: string | null;
  readonly name: string;
  readonly lane: string | null;
  readonly strip: Box;
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

const GRAPH_VIEWPORTS: readonly (Viewport & { readonly riderClear: boolean })[] = [
  ...OVERLAY_VIEWPORTS.filter((each) => Math.min(each.width, each.height) > 480).map((each) => ({
    ...each,
    riderClear: true,
  })),
  { name: '#1169’s — 802×600', width: 802, height: 600, unstagedFails: true, riderClear: false },
];

/** `tokens.ts`: `hudInk`, `hudInkMuted`, `hudBorder` — in BOTH page themes, like `HUD_SURFACE`. */
const HUD_INK = 'rgb(245, 248, 250)';

const HUD_INK_MUTED = 'rgb(168, 182, 194)';

const HUD_BORDER = 'rgb(123, 139, 153)';

const PAINTS_NOTHING = 'rgba(0, 0, 0, 0)';

const STRIP_FIXTURES = [
  {
    graph: 'hold',
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
    lane: 'heart-rate',
    text: '— bpm, range 130–140 · Target 167 W',
    named: 'No heart rate, with a chosen range of 130–140 bpm',
    asked: 'oyl-workout-strip__range',
    doing: undefined,
    absent: /target|power|strip__heart-rate/,
  },
  {
    graph: 'plain',
    lane: 'power',
    text: 'Target 175 W · 15:00 left in block',
    named: 'Target the trainer last confirmed: 175 W.',
    asked: 'oyl-workout-strip__target',
    doing: 'oyl-workout-strip__power',
    absent: /range|heart-rate/,
  },
  {
    // Paused: the trainer was eased to its 50 W minimum. The line says THAT.
    // #1313 (the owner's ruling): no target or trace line is drawn through a
    // pause, so the lane is empty, and the name says nothing a line would.
    graph: 'paused',
    lane: 'power',
    text: 'Paused · Target 50 W',
    named: 'Workout graph. Paused.',
    asked: undefined,
    doing: undefined,
    absent: /target|power|range|heart-rate/,
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
  if (fixture.graph === 'paused') {
    expect(graph.name).not.toMatch(/Your power|Heart rate|chosen range/);
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
  expect(graph.text.box.height).toBeLessThanOrEqual(20);
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
      // The control: the same ride with the route plan, and no strip.
      await openRide(page, viewport, '?trainer=workout');
      expect(await graphOnTheHud(page)).toBeUndefined();
      const plan = await planBox(page);
      const before = await bothWays(page);
      expect(plan?.height ?? 0).toBeGreaterThan(64);

      for (const fixture of STRIP_FIXTURES) {
        await openRide(page, viewport, `?trainer=workout&graph=${fixture.graph}`);
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
            // ⚠️ Two boxes are compared WITHOUT the one number the ride itself
            // moves. The harness rides for real, and the secondary fields
            // panel is a line taller (182.5 px against 195.9) at some moments
            // of the ride than at others — its pacer and best-effort readings
            // are "—" at first and gain a second line ("3 s / ahead of you")
            // once they have something to report; the notices sit under that
            // panel and move down with it. The two
            // loads compared here are seconds apart, so which side of that
            // moment each was measured on is a race: 18 of 120 runs of this
            // case failed on exactly those two numbers and on nothing else
            // (`--repeat-each 30`). Neither holds the strip: the route panel,
            // the actions and the primary fields are compared in full.
            const RIDE_MOVES: readonly { readonly panel: string; readonly skip: number }[] = [
              { panel: 'oyl-hud__fields--secondary', skip: 3 }, // its height
              { panel: 'oyl-hud__notices', skip: 1 }, // its top
            ];
            const boxes = (measurement: StageMeasurement | undefined) =>
              (measurement?.panels ?? [])
                .filter((each) => each.box.height > 0)
                .map((each) => {
                  const skip = RIDE_MOVES.find((moved) => each.name.includes(moved.panel))?.skip;
                  return `${each.name}: ${[
                    each.box.left,
                    each.box.top,
                    each.box.width,
                    each.box.height,
                  ]
                    .map((n, index) => (index === skip ? '(the ride’s)' : n.toFixed(1)))
                    .join(' ')}`;
                });
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
 * Ride screen's graph (`rideview.browser.spec.ts`).
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

      await openRide(page, viewport, REPLAN_ON_THE_HUD);
      for (const [how, seen] of await bothWays(page)) {
        await test.step(how, () => {
          const keep = seen.items.find((each) => each.name === KEEP_THE_PLAN);
          const pause = seen.items.find((each) => each.name === 'control: Pause');
          const end = seen.items.find((each) => each.name === 'control: End ride');
          if (keep === undefined || pause === undefined || end === undefined) {
            throw new Error(`no ${KEEP_THE_PLAN}, Pause or End ride among the HUD's items`);
          }
          const actions = seen.panels.find((each) => each.name.includes('oyl-hud__actions'));
          const rider = riderBox(viewport);
          const over = seen.panels
            .filter((each) => each.box.height > 0)
            .filter((each) => overlap(each.box, rider));
          console.log(
            `#1244 Keep the plan on the HUD — ${viewport.name} — ${how}: ` +
              `${keep.box.width.toFixed(1)} × ${keep.box.height.toFixed(1)} px at ` +
              `[${keep.box.left.toFixed(0)},${keep.box.top.toFixed(0)}]; the actions panel ` +
              `${actions?.box.width.toFixed(0) ?? '?'} × ${actions?.box.height.toFixed(0) ?? '?'} px, ` +
              `its top ${((actions?.box.top ?? 0) - rider.bottom).toFixed(0)} px below the rider's box` +
              `, its left ${((actions?.box.left ?? 0) - rider.right).toFixed(0)} px right of it` +
              `; panels over the rider: ${over.length === 0 ? 'none' : over.map(describeItem).join(', ')}`,
          );

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
          const routePanel = ['the elevation strip', 'the plan view'];
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
 * A waiting re-plan puts NO notice on the HUD (#1324: its sentence is the
 * region's, and its control is the row), so there is nothing here for the
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
          for (const name of ['control: Pause', 'control: End ride']) {
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
