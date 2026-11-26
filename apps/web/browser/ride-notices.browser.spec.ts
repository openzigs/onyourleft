// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's standing notices that stay, measured by a real engine — #647,
 * #785 and #693's review.
 *
 * A section of `ride.browser.spec.ts` until #1414, which divided that file so
 * the browser gate's shards could divide it too: its header is still this
 * file's — the viewports, the control and both ways (#1120) — and says which
 * section went where. What these cases share with the other four files is
 * `ride-stage.ts`; `keepScreenOnNotice` there carries #647's account.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  type Viewport,
  OVERLAY_VIEWPORTS,
  LAPTOP_VIEWPORTS,
  openRide,
  measure,
  inside,
  overlap,
  describeItem,
  riderBox,
  named,
  withoutAnchors,
  ANCHORED,
  UNANCHORED,
  bothWays,
  easedCollisions,
  EASED_RIDER_CLEARANCE_PIXELS,
  noticeText,
  keepScreenOnNotice,
  keepScreenOnLaidOut,
  KEEP_SCREEN_ON_SEEN,
  TABLET_VIEWPORTS,
} from './ride-stage';

import { AI_BOTS_RACE_TEXT } from '../src/game/lap-race/choice';
import { pacerSayProblem } from '@onyourleft/domain';

import { AI_PACER_LINE } from './ai-pacer-line';
import { applyInsets, NO_INSETS, PIXEL_TABLET_LANDSCAPE_INSETS, type Insets } from './insets';

import type { StageMeasurement } from './ride-harness';

/** `GameView` §`ONE_NOTICE_ONLY_QUERY`'s phones: the column layout under 25 rem wide. */
const oneNoticeOnly = (viewport: Viewport): boolean =>
  viewport.width >= 360 && viewport.width < 400 && viewport.height >= 752;

test.describe('a ride that may stop with the screen off — #647', () => {
  for (const [query, what] of [
    ['?keepalive=failed', 'alone'],
    ['?keepalive=failed&trainer=workout', 'with the road notice'],
  ] as const) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`the notice, ${what}, whole and over nothing — ${viewport.name}`, async ({ page }) => {
        await openRide(page, viewport, query);
        const found = await keepScreenOnNotice(page);
        expect(found.text).toBe(KEEP_SCREEN_ON_SEEN);
        expect(found.inDisclosure).toBe(false);
        const withRoad = query.includes('trainer=workout');
        if (withRoad && !oneNoticeOnly(viewport)) {
          // As without the refusal: open for the ride's first seconds, beside
          // it, with its control on the HUD.
          expect(found.roadNoticeShown).toBe(true);
          const toggle = named((await measure(page)).items, 'control: Trainer notice');
          expect(inside(toggle.box, viewport) && toggle.onTop, describeItem(toggle)).toBe(true);
        } else {
          // Alone — and at the two narrowest upright phones, the road notice
          // and its control are not on the HUD while the refusal stands.
          expect(found.roadNoticeOnHud).toBe(false);
          expect(
            (await measure(page)).items.some((each) => each.name === 'control: Trainer notice'),
          ).toBe(false);
        }
        const described = withRoad && oneNoticeOnly(viewport) ? 'road notice off the HUD' : what;
        // #1120: and as an engine without anchor positioning lays it out.
        for (const [how, seen] of await bothWays(page)) {
          await test.step(how, () => {
            const { collisions, clearance } = keepScreenOnLaidOut(
              seen,
              viewport,
              `${described}, ${how}`,
            );
            expect(collisions).toEqual([]);
            if (viewport.height > viewport.width) {
              expect(clearance).toBeGreaterThanOrEqual(EASED_RIDER_CLEARANCE_PIXELS);
            }
          });
        }
      });
    }
  }

  // #2078, the owner's ruling of 2026-11-06: on the 4:3 tablet the recent
  // graph gives way while two notices are DRAWN in their cell — and the road
  // notice folded away, its wrapper still in the cell and visually hidden, is
  // not one of them.
  test('#2078 the graph gives way to two drawn notices, and comes back when the road notice folds — 1024×768', async ({
    page,
  }) => {
    const viewport = OVERLAY_VIEWPORTS.find((each) => each.width === 1024) as Viewport;
    await openRide(page, viewport, '?keepalive=failed&trainer=workout');
    await expect.poll(async () => (await keepScreenOnNotice(page)).roadNoticeShown).toBe(true);
    const graphDrawn = async (): Promise<boolean> =>
      page.evaluate(() => {
        const box = document.querySelector('.oyl-hud__recent')?.getBoundingClientRect();
        return box !== undefined && box.width * box.height > 1;
      });
    expect(await graphDrawn()).toBe(false);
    await page.getByRole('button', { name: 'Trainer notice' }).click();
    await expect.poll(async () => (await keepScreenOnNotice(page)).roadNoticeShown).toBe(false);
    expect(await graphDrawn()).toBe(true);
    for (const [how, seen] of await bothWays(page)) {
      const { collisions } = keepScreenOnLaidOut(seen, viewport, `road notice folded, ${how}`);
      expect(collisions, how).toEqual([]);
    }
  });

  // The control: the rule taken away. `matchMedia` answers "no" to
  // ONE_NOTICE_ONLY_QUERY before the page loads, so at the two 360 px
  // upright phones the road notice opens beside it as it does elsewhere — and
  // must come within the clearance of the rider, or the rule is being held
  // over a pair that always fitted.
  for (const viewport of OVERLAY_VIEWPORTS.filter((each) => each.width === 360)) {
    test(`the control — without the rule, the road notice open beside it comes within the clearance of the rider — ${viewport.name}`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        // `not all` matches nothing, in the browser's own MediaQueryList.
        window.matchMedia = (query: string): MediaQueryList =>
          real(query.includes('width < 25rem') ? 'not all' : query);
      });
      await openRide(page, viewport, '?keepalive=failed&trainer=workout');
      await expect.poll(async () => (await keepScreenOnNotice(page)).roadNoticeShown).toBe(true);
      // ⚠️ Clearance only, since #693's re-review shortened the sentence (to
      // one line on a Mac; the CI runner still wraps it): the pair open now
      // ends 26 px (360×800) and 1 px (360×752) ABOVE the rider's box on a
      // Mac, where the longer one ran 27 px into it — under the clearance
      // still, and so still the rule's reason.
      const { clearance } = keepScreenOnLaidOut(
        await measure(page),
        viewport,
        'without the rule, the road notice open',
      );
      expect(clearance).toBeLessThan(EASED_RIDER_CLEARANCE_PIXELS);
    });
  }
});

/**
 * #785, #1360's re-review (R3) — the room's notice slot, laid out with its
 * longest sentences at every overlay viewport, phones and tablets, both ways
 * (#1120). `?room=lost` is `ROOM_LOST_TEXT`, the longest sentence the slot
 * carries; `?room=paused` is the paused-recording sentence the re-review
 * asked to have measured. The rule is the Eased notice's: whole on the
 * screen, over no panel, clear of the rider, *Pause* and *End ride* on top.
 *
 * Upright, the notice is also held to `EASED_RIDER_CLEARANCE_PIXELS` above
 * the leaning rider's box. Until #1356 it could not be: a room ride's HUD came
 * within 5 px of the rider at 360×752 (on a Mac) whatever the notice said.
 * Until #1358 the bottom row below a phone-in-landscape stage was excused
 * here too; it is held with everything else now.
 */
test.describe('the room’s notice, with its longest sentences — #785', () => {
  for (const [query, words] of [
    ['?room=lost', 'connection was lost'],
    ['?room=paused', 'Recording paused'],
  ] as const) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`${query}: whole and over nothing — ${viewport.name}`, async ({ page }) => {
        await openRide(page, viewport, query);
        const text = await page.evaluate(() =>
          [...document.querySelectorAll('.oyl-hud__notices .oyl-status')]
            .map((each) => (each.textContent ?? '').replace(/\s+/g, ' '))
            .join(' | '),
        );
        expect(text).toContain(words);
        for (const [how, seen] of await bothWays(page)) {
          await test.step(how, () => {
            const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
            const rider = riderBox(viewport);
            console.log(
              `room notice ${query} — ${viewport.name}, ${how} — cell ${(notice?.box.height ?? 0).toFixed(0)} px tall` +
                (viewport.height > viewport.width
                  ? `; ${(rider.top - (notice?.box.bottom ?? Infinity)).toFixed(0)} px above the rider's box`
                  : ''),
            );
            // Nothing excused. Until #1356 and #1358 a room ride's reading
            // fields over the rider on a phone, and its bottom row below a
            // phone-in-landscape stage, were — both there with or without
            // any notice. §"#1358" says what the cause was.
            expect(easedCollisions(seen, viewport)).toEqual([]);
            // And the notice itself, held everywhere: over no panel and not
            // over the rider, and whole across the stage.
            expect(notice, 'the room notice was laid out').toBeDefined();
            if (notice === undefined) return;
            const others = seen.panels.filter(
              (each) => each !== notice && each.box.height > 1 && overlap(each.box, notice.box),
            );
            expect(others.map(describeItem)).toEqual([]);
            expect(overlap(notice.box, rider), describeItem(notice)).toBe(false);
            if (viewport.height > viewport.width) {
              expect(rider.top - notice.box.bottom, describeItem(notice)).toBeGreaterThanOrEqual(
                EASED_RIDER_CLEARANCE_PIXELS,
              );
            }
            expect(notice.box.left).toBeGreaterThanOrEqual(0);
            expect(notice.box.right).toBeLessThanOrEqual(viewport.width);
            expect(inside(notice.box, viewport), describeItem(notice)).toBe(true);
          });
        }
      });
    }
  }
});

/*
 * #2381 — the press of *Ride* could not start the ride's recording
 * (`?record=refused`), so the notice cell says this ride is not being
 * recorded, and why. Held as the room's notice is above: whole, over no panel,
 * not over the rider (clear of it upright), and over no ride control —
 * `easedCollisions` requires *Pause* and *End ride* on the stage and uncovered.
 */
test.describe('a ride whose recording could not start says so — #2381', () => {
  // Round 3 (the review of 4f726fde): and in its tallest stack — the longest
  // cause's sentence, with the road notice that would open beside it for the
  // same first seconds, and #647's *Keep the screen on*, which never goes
  // away. Measured, that stack ran off a phone in landscape and came to 34 px
  // of the rider at 360×752, so (`GameView` §`notRecordedShown`) the road
  // notice gives way to this one while it stands — on a PHONE only, the
  // owner's ruling on round 3 (`SHORT_OF_SPACE_QUERY`; here `onAPhone`): on a
  // tablet both show, held over nothing — and on the narrowest upright phones
  // (`oneNoticeOnly`) this one gives way to #647's, and is still SAID.
  for (const [query, words, what] of [
    [
      '?record=refused',
      'This ride is not being recorded, because the ride before it is not finished saving.',
      'alone',
    ],
    [
      '?record=not-saved&trainer=workout&keepalive=failed',
      'because the ride before it could not be added to your activities.',
      'with the road notice and #647',
    ],
  ] as const) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`${what}: whole and over nothing — ${viewport.name}`, async ({ page }) => {
        await openRide(page, viewport, query);
        const text = await noticeText(page);
        const stacked = query.includes('keepalive=failed');
        if (stacked && oneNoticeOnly(viewport)) {
          expect(text).not.toContain(words);
          // Off the HUD, and still said once by its one region (#445): the
          // review of round 3, finding 6.
          await expect.poll(async () => hudRegion(page), { timeout: 20_000 }).toContain(words);
        } else {
          expect(text).toContain(words);
        }
        if (stacked) {
          expect(text).toContain('Keep the screen on');
          const roadOnHud = (await keepScreenOnNotice(page)).roadNoticeOnHud;
          const toggle = (await measure(page)).items.find(
            (each) => each.name === 'control: Trainer notice',
          );
          if (onAPhone(viewport)) {
            // Where space is short, the road notice and its control give way.
            expect(roadOnHud).toBe(false);
            expect(toggle).toBeUndefined();
          } else {
            // On a tablet both show, the road notice's control on the stage.
            expect(roadOnHud).toBe(true);
            expect(toggle, 'the road notice’s control').toBeDefined();
            if (toggle !== undefined) {
              expect(inside(toggle.box, viewport) && toggle.onTop, describeItem(toggle)).toBe(true);
            }
            // Under 50 rem tall (the 4:3 tablet), three drawn notices: the ride
            // so far gives way (`theme.css` §"#2381"), or on the CI runner's
            // fonts the cell ran 19 px into the route panel.
            if (viewport.height < 800) {
              const totals = await page.evaluate(() =>
                [...document.querySelectorAll('.oyl-hud__field--total')].map((each) => {
                  const box = each.getBoundingClientRect();
                  return box.width * box.height;
                }),
              );
              expect(totals.length).toBeGreaterThan(0);
              expect(totals.every((area) => area <= 1)).toBe(true);
            }
          }
        }
        for (const [how, seen] of await bothWays(page)) {
          await test.step(how, () => {
            expect(easedCollisions(seen, viewport)).toEqual([]);
            const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
            expect(notice, 'the notice was laid out').toBeDefined();
            if (notice === undefined) return;
            const rider = riderBox(viewport);
            console.log(
              `#2381 not recording — ${viewport.name}, ${how} — cell ${notice.box.height.toFixed(0)} px tall` +
                (viewport.height > viewport.width
                  ? `; ${(rider.top - notice.box.bottom).toFixed(0)} px above the rider's box`
                  : ''),
            );
            const others = seen.panels.filter(
              (each) => each !== notice && each.box.height > 1 && overlap(each.box, notice.box),
            );
            expect(others.map(describeItem)).toEqual([]);
            expect(overlap(notice.box, rider), describeItem(notice)).toBe(false);
            if (viewport.height > viewport.width) {
              expect(rider.top - notice.box.bottom, describeItem(notice)).toBeGreaterThanOrEqual(
                EASED_RIDER_CLEARANCE_PIXELS,
              );
            }
            expect(inside(notice.box, viewport), describeItem(notice)).toBe(true);
          });
        }
      });
    }
  }

  // The control: the give-way taken away. `matchMedia` answers "no" to
  // `SHORT_OF_SPACE_QUERY` before the page loads, so on the two short phones
  // in landscape the road notice stands beside the stack — and the stack must
  // then collide, or the rule is held over a stack that always fitted.
  for (const viewport of OVERLAY_VIEWPORTS.filter(
    (each) => each.name.includes('844×390') || each.name.includes('736×360'),
  )) {
    test(`the control — without the give-way, the stack collides — ${viewport.name}`, async ({
      page,
    }) => {
      await page.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (query: string): MediaQueryList =>
          real(query.includes('max-height: 30rem') ? 'not all' : query);
      });
      await openRide(page, viewport, '?record=not-saved&trainer=workout&keepalive=failed');
      expect((await keepScreenOnNotice(page)).roadNoticeOnHud).toBe(true);
      const collisions = easedCollisions(await measure(page), viewport);
      console.log(`#2381 control — ${viewport.name}: ${collisions.join('; ')}`);
      expect(collisions).not.toEqual([]);
    });
  }
});

/** The HUD's one live region, as a screen reader would hear it. */
async function hudRegion(page: Page): Promise<string> {
  return page.evaluate(
    () => document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '',
  );
}

/** `ride-stage.ts` §`TABLET_VIEWPORTS`' line: a phone's shorter side is 480 px or less. */
const onAPhone = (viewport: Viewport): boolean => Math.min(viewport.width, viewport.height) <= 480;

/**
 * #647 — #693's re-review, B2: *"Keep the screen on"* beside EACH other
 * notice the HUD never puts away. The notice cell stacks every one of them —
 * the *Trainer* fault, *Eased* (#585), the side camera's lost link (#551) and
 * this — so a pair is a taller cell over the same rider, and none of the
 * sentences may be put away to make room.
 *
 * Every pair is held over nothing at every overlay viewport and, upright, to
 * `EASED_RIDER_CLEARANCE_PIXELS` above the leaning rider's box — #605's floor
 * for the Eased notice, which the other two pairs meet by the same geometry
 * (a two-line notice and a one-line one), so they are held to it too rather
 * than only to "no collision". Each prints its clearance.
 *
 * What gets it there: *"Keep the screen on: your ride may stop without it."*
 * is shorter — one line at 360 px on a Mac, though still two on the CI runner,
 * whose fonts are wider — and two notices sharing the cell give up half their
 * vertical padding (`theme.css` §"Two notices in the one cell"), which on the
 * runner is what clears the floor. As round one
 * of #693 shipped it — the longer sentence, full padding — the pair beside
 * Eased ended 38 px above the rider at 360×752; the control below puts both
 * back and requires the same measurement to fall under the floor.
 */
const NEVER_PUT_AWAY: readonly (readonly [query: string, beside: string, words: string])[] = [
  ['&rescue=floor', 'Eased', 'Eased'],
  ['&side=lost', 'the side camera lost', 'Side camera'],
  ['&gradient=refused', 'a trainer fault', 'stopped accepting the road'],
];

/**
 * The stage measured on a SETTLED frame that has both notices in the cell. The
 * refusing trainer's fault can be absent for a frame (`ride-harness.tsx`
 * §`REFUSED`), so the check and the measurement are one evaluation.
 *
 * ⚠️ **The first frame with both is not always the settled one** (#871): on
 * `main` the pair beside Eased at 360×752 measured 55 px above the rider on 2
 * of 8 local runs and 69 px on the other six, and 41 px once on CI (#868's
 * first run). So a measurement counts only when the next poll, both notices
 * still present, reads the same notice cell — two equal consecutive readings
 * of its box. The cell and not the whole stage: the ride is running, and a
 * reading's box may change width with its value between any two polls.
 */
async function measureWithBoth(page: Page, words: string): Promise<StageMeasurement> {
  let found: StageMeasurement | undefined;
  let previous: string | undefined;
  await expect
    .poll(async () => {
      const reading = await page.evaluate((beside) => {
        const text = document.querySelector('.oyl-hud__notices')?.textContent ?? '';
        return text.includes(beside) && text.includes('Keep the screen on')
          ? window.__oylRide?.measure()
          : undefined;
      }, words);
      const key =
        reading === undefined
          ? undefined
          : JSON.stringify(
              reading.panels.find((each) => each.name.includes('oyl-hud__notices'))?.box,
            );
      const settled = key !== undefined && key === previous;
      previous = key;
      found = settled ? reading : undefined;
      return settled;
    })
    .toBe(true);
  if (found === undefined) throw new Error('unreachable');
  return found;
}

test.describe('keep the screen on, beside every notice that stays — #647', () => {
  for (const [query, beside, words] of NEVER_PUT_AWAY) {
    for (const viewport of OVERLAY_VIEWPORTS) {
      test(`beside ${beside}, over nothing — ${viewport.name}`, async ({ page }) => {
        await openRide(page, viewport, `?keepalive=failed${query}`);
        const settled = await measureWithBoth(page, words);
        // #1120: and the same settled frame as an engine without anchor
        // positioning lays it out — read straight after, with both notices
        // still in the cell (asserted).
        const bare = await withoutAnchors(page);
        expect(bare.panels.find((each) => each.name.includes('oyl-hud__notices'))?.box).toEqual(
          settled.panels.find((each) => each.name.includes('oyl-hud__notices'))?.box,
        );
        for (const [how, seen] of [
          [ANCHORED, settled],
          [UNANCHORED, bare],
        ] as const) {
          const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
          const rider = riderBox(viewport);
          const clearance = rider.top - (notice?.box.bottom ?? Infinity);
          console.log(
            `keep the screen on beside ${beside} — ${viewport.name} — ${how} — notice cell ` +
              `${(notice?.box.height ?? 0).toFixed(0)} px tall` +
              (viewport.height > viewport.width
                ? `; ${clearance.toFixed(0)} px above the rider's box`
                : `; ends at x = ${(notice?.box.right ?? 0).toFixed(0)}, rider from x = ${rider.left.toFixed(0)}`),
          );
          expect(easedCollisions(seen, viewport), how).toEqual([]);
          if (viewport.height > viewport.width) {
            expect(clearance, how).toBeGreaterThanOrEqual(EASED_RIDER_CLEARANCE_PIXELS);
          }
        }
      });
    }
  }

  // The control: the cell as round one of #693 shipped it — the old, longer
  // sentence in the same notice, and both notices at the padding a notice has
  // alone. Same elements, same cell, same viewport; only the words and the
  // padding change. It must fall under the floor, or the floor above is being
  // held over a cell that could never have reached the rider.
  for (const viewport of OVERLAY_VIEWPORTS.filter((each) => each.height === 752)) {
    test(`the control — as round one shipped it, the pair beside Eased comes within ${String(EASED_RIDER_CLEARANCE_PIXELS)} px of the rider — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?keepalive=failed&rescue=floor');
      await measureWithBoth(page, 'Eased');
      await page.evaluate(() => {
        const statuses = [
          ...document.querySelectorAll<HTMLElement>('.oyl-hud__notices > .oyl-status'),
        ];
        const label = statuses
          .map((each) => each.querySelector('.oyl-status__label'))
          .find((each) => each?.textContent?.startsWith('Keep the screen on'));
        const body = label?.parentElement;
        if (label === null || label === undefined || body === null || body === undefined) {
          throw new Error('no keep-the-screen-on notice to restore');
        }
        body.replaceChildren(label, 'your ride may stop if the screen goes off.');
        for (const each of statuses) each.style.padding = 'var(--oyl-space-sm)';
      });
      const text = await noticeText(page);
      expect(text).toContain('Eased');
      expect(text).toContain('Keep the screen on: your ride may stop if the screen goes off.');
      const seen = await measure(page);
      const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
      const clearance = riderBox(viewport).top - (notice?.box.bottom ?? Infinity);
      console.log(
        `keep the screen on beside Eased, as round one shipped it — ${viewport.name} — ${clearance.toFixed(0)} px above the rider's box`,
      );
      expect(clearance).toBeLessThan(EASED_RIDER_CLEARANCE_PIXELS);
    });
  }
});

/*
 * #2710 — A LAP RACE'S AI BOTS LINE IS SEEN AT 1024×600.
 *
 * `?lap=riding&ai=racing`: a solo lap race with AI bots, the consent given
 * (`ride-harness.tsx` §`AI_BOTS`). The standings are drawn on a tablet only
 * (ADR 0051 D-7; `theme.css` §"A RACE'S STANDINGS"), and since #2868 they do
 * not carry this line: it is said on the pre-race screen. So the notice cell
 * carries it from the press, for `GameView` §`STANDING_NOTICE_SECONDS` of
 * ride (`GameView` §`aiBotsNotice`).
 *
 * Held at the narrowest wide screen, beside the race's own countdown notice:
 * every copy of the line on the page is found, and one of them must be laid
 * out, whole on the stage, the topmost thing at each of its corners, over no
 * other panel, no control and not the leaning rider. The control takes the
 * notice away and requires no copy of the line left visible.
 */
const AI_BOTS_RACING_LINE = AI_BOTS_RACE_TEXT.racing;

const SMALL_LAPTOP = LAPTOP_VIEWPORTS.find((each) => each.width === 1024 && each.height === 600);

interface LineSeen {
  readonly box: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  readonly onTop: boolean;
  readonly inNotices: boolean;
}

/** Every element whose own text is the line, with its box and whether it is what a press lands on. */
async function aiBotsLines(page: Page): Promise<readonly LineSeen[]> {
  return page.evaluate((line) => {
    return [...document.querySelectorAll('.oyl-hud *')]
      .filter(
        (each) =>
          (each.textContent ?? '').includes(line) &&
          ![...each.children].some((child) => (child.textContent ?? '').includes(line)),
      )
      .map((each) => {
        const rect = each.getBoundingClientRect();
        const corners = [
          [rect.left + 2, rect.top + 2],
          [rect.right - 2, rect.top + 2],
          [rect.left + 2, rect.bottom - 2],
          [rect.right - 2, rect.bottom - 2],
        ];
        return {
          box: {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          },
          onTop:
            rect.width > 4 &&
            rect.height > 4 &&
            corners.every(([x, y]) => {
              const hit = document.elementFromPoint(x ?? 0, y ?? 0);
              return hit !== null && each.contains(hit);
            }),
          inNotices: each.closest('.oyl-hud__notices') !== null,
        };
      });
  }, AI_BOTS_RACING_LINE);
}

const seenLine = (each: LineSeen): boolean =>
  each.box.width > 1 && each.box.height > 1 && each.onTop;

test.describe('a lap race’s AI bots line is seen on the HUD at 1024×600 — #2710', () => {
  if (SMALL_LAPTOP === undefined) throw new Error('no 1024×600 viewport to measure at');
  const viewport = SMALL_LAPTOP;

  test(`laid out, on top, over no panel, control or the rider — ${viewport.name}`, async ({
    page,
  }) => {
    await openRide(page, viewport, '?lap=riding&ai=racing');
    const lines = await aiBotsLines(page);
    // No copy outside the notice is visible: since #2868 the standings carry none.
    expect(lines.filter((each) => !each.inNotices).every((each) => !seenLine(each))).toBe(true);
    const shown = lines.find((each) => each.inNotices && seenLine(each));
    expect(shown, `no visible copy of the line: ${JSON.stringify(lines)}`).toBeDefined();
    if (shown === undefined) return;
    expect(inside(shown.box, viewport), 'the line is off the stage').toBe(true);
    expect(overlap(shown.box, riderBox(viewport)), 'the line is over the rider').toBe(false);
    for (const [how, seen] of await bothWays(page)) {
      await test.step(how, () => {
        expect(easedCollisions(seen, viewport)).toEqual([]);
        const notice = seen.panels.find((each) => each.name.includes('oyl-hud__notices'));
        expect(notice, 'the notice was laid out').toBeDefined();
        if (notice === undefined) return;
        console.log(
          `#2710 AI bots line — ${viewport.name}, ${how} — at ${shown.box.top.toFixed(0)}–${shown.box.bottom.toFixed(0)} px; cell ${notice.box.height.toFixed(0)} px tall`,
        );
        const panels = seen.panels.filter(
          (each) => each !== notice && each.box.height > 1 && overlap(each.box, notice.box),
        );
        expect(panels.map(describeItem)).toEqual([]);
        const controls = seen.items.filter(
          (each) => each.name.startsWith('control:') && overlap(each.box, shown.box),
        );
        expect(controls.map(describeItem)).toEqual([]);
      });
    }
  });

  test(`the control — without the notice, no copy of the line is seen — ${viewport.name}`, async ({
    page,
  }) => {
    await openRide(page, viewport, '?lap=riding&ai=racing');
    await page.evaluate((line) => {
      for (const each of document.querySelectorAll<HTMLElement>('.oyl-hud__notices .oyl-status')) {
        if ((each.textContent ?? '').includes(line)) each.style.display = 'none';
      }
    }, AI_BOTS_RACING_LINE);
    const lines = await aiBotsLines(page);
    expect(lines.length, 'the standings carry the line').toBeGreaterThan(0);
    expect(lines.filter(seenLine)).toEqual([]);
  });
});

/**
 * THE AI PACER'S LINE, LARGE ENOUGH TO READ WHILE RIDING — #2760's review, on
 * the owner's word of 2026-11-17: "Might need to make the feedback a bit
 * larger. I noticed it can be hard to see."
 *
 * `ride.html?aipacer=saying` rides with the AI pacer on and a stand-in
 * instance answering every ask with {@link AI_PACER_LINE}, the longest line a
 * pacer may say. At 1024×600 and the owner's 1280×800, the line is read back
 * off the engine: its type at least 1.5 times a notice's (`theme.css`
 * §`.oyl-hud__pacer-say`) and in Barlow at 700, at most three lines, nothing clipped or
 * scrolled, its ink at least 4.5:1 on its surface, on top, and over no other
 * panel and no control, with the anchors on and off. At the old size (the
 * class's rule deleted) the size assertion goes red.
 *
 * ⚠️ **Three lines, not two, at the longest.** The cell is held to 22 rem and
 * short of the rider's box (`theme.css` §"A notice goes under the primary
 * panel"), so at 1.2 rem two lines hold about 45 characters with the label;
 * the 80-character line takes three, measured at both sizes, and is held to
 * three, whole and clear of every panel and control.
 */
interface PacerLineSeen {
  readonly box: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  readonly face: string;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly noticeSize: number;
  readonly lines: number;
  readonly overflows: readonly string[];
  readonly contrast: number;
  readonly onTop: boolean;
}

async function pacerLine(page: Page): Promise<PacerLineSeen | undefined> {
  return page.evaluate(async () => {
    const notice = [
      ...document.querySelectorAll<HTMLElement>('.oyl-hud__notices .oyl-status'),
    ].find((each) => each.querySelector('.oyl-status__label')?.textContent === 'Your pacer: ');
    if (notice === undefined) return undefined;
    const style = getComputedStyle(notice);
    // Measured in the face it is drawn in, Barlow, not the fallback it swaps from.
    await document.fonts.load(`${style.fontWeight} ${style.fontSize} Barlow`).catch(() => []);
    await document.fonts.ready;
    const barlow =
      [...document.fonts].find(
        (face) =>
          face.family.replaceAll(/['"]/g, '') === 'Barlow' && face.weight === style.fontWeight,
      )?.status ?? 'absent';
    const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const token = getComputedStyle(document.documentElement).getPropertyValue('--oyl-font-size-sm');
    const noticeSize = parseFloat(token) * (token.trim().endsWith('rem') ? root : 1);
    // Its lines: the sentence's text, read a line box at a time. The flex
    // item round it is one box, so its own rects would say one line.
    const sentence = notice.querySelector<HTMLElement>(':scope > span:not(.oyl-status__glyph)');
    const range = document.createRange();
    if (sentence !== null) range.selectNodeContents(sentence);
    const lineHeight = parseFloat(style.lineHeight);
    const tops: number[] = [];
    for (const rect of range.getClientRects()) {
      if (rect.width < 1) continue;
      if (!tops.some((top) => Math.abs(top - rect.top) < lineHeight / 2)) tops.push(rect.top);
    }
    const overflows: string[] = [];
    for (const each of [notice, notice.closest<HTMLElement>('.oyl-hud__notices')]) {
      if (each === null) continue;
      if (each.scrollHeight > each.clientHeight + 1 || each.scrollWidth > each.clientWidth + 1) {
        overflows.push(
          `${each.className.split(' ')[0] ?? ''} ${String(each.scrollWidth)}×${String(each.scrollHeight)} in ${String(each.clientWidth)}×${String(each.clientHeight)}`,
        );
      }
    }
    const rgb = (value: string): number[] =>
      (value.match(/[\d.]+/g) ?? []).slice(0, 3).map((channel) => {
        const c = Number(channel) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    const luminance = (value: string): number => {
      const [r = 0, g = 0, b = 0] = rgb(value);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ink = luminance(style.color);
    const surface = luminance(style.backgroundColor);
    const rect = notice.getBoundingClientRect();
    const corners = [
      [rect.left + 4, rect.top + 4],
      [rect.right - 4, rect.top + 4],
      [rect.left + 4, rect.bottom - 4],
      [rect.right - 4, rect.bottom - 4],
    ];
    return {
      box: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      },
      face: `${style.fontFamily.split(',')[0]?.replaceAll(/['"]/g, '') ?? ''} ${barlow}`,
      fontSize: parseFloat(style.fontSize),
      fontWeight: Number(style.fontWeight),
      noticeSize,
      lines: tops.length,
      overflows,
      contrast: (Math.max(ink, surface) + 0.05) / (Math.min(ink, surface) + 0.05),
      onTop: corners.every(([x, y]) => {
        const hit = document.elementFromPoint(x ?? 0, y ?? 0);
        return hit !== null && notice.contains(hit);
      }),
    };
  });
}

test.describe('the AI pacer’s line, large enough to read while riding — #2760', () => {
  const sizes = [
    LAPTOP_VIEWPORTS.find((each) => each.width === 1024 && each.height === 600),
    OVERLAY_VIEWPORTS.find((each) => each.width === 1280 && each.height === 800),
  ];

  test('the line measured is one the pacer may say, at the longest', () => {
    expect(pacerSayProblem(AI_PACER_LINE)).toBeUndefined();
    expect(AI_PACER_LINE).toHaveLength(80);
  });

  for (const viewport of sizes) {
    if (viewport === undefined) throw new Error('no 1024×600 or 1280×800 viewport to measure at');
    test(`1.5× a notice, at most three lines, on top, over no panel or control — ${viewport.name}`, async ({
      page,
    }) => {
      await openRide(page, viewport, '?aipacer=saying');
      await page.waitForFunction(
        (line) =>
          [...document.querySelectorAll('.oyl-hud__notices .oyl-status')].some((each) =>
            (each.textContent ?? '').includes(line),
          ),
        AI_PACER_LINE,
      );
      const seen = await pacerLine(page);
      expect(seen, 'the pacer’s line is on the HUD').toBeDefined();
      if (seen === undefined) return;
      console.log(
        `#2760 the AI pacer's line — ${viewport.name}: ${seen.fontSize.toFixed(1)} px at ${String(seen.fontWeight)} in ${seen.face} (a notice ${seen.noticeSize.toFixed(1)} px), ${String(seen.lines)} lines, ${seen.box.width.toFixed(0)}×${seen.box.height.toFixed(0)} px, ${seen.contrast.toFixed(2)}:1`,
      );
      expect(seen.fontSize, 'the line is 1.5 times a notice’s size').toBeGreaterThanOrEqual(
        seen.noticeSize * 1.5 - 0.05,
      );
      expect(seen.fontWeight, 'the line is at the HUD numerals’ weight').toBeGreaterThanOrEqual(
        700,
      );
      expect(seen.face, 'the line is in the HUD numerals’ face, loaded').toBe('Barlow loaded');
      expect(seen.lines, 'the longest line takes at most three lines').toBeLessThanOrEqual(3);
      expect(seen.overflows, 'nothing is clipped or scrolled').toEqual([]);
      expect(seen.contrast, 'its ink on its surface').toBeGreaterThanOrEqual(4.5);
      expect(seen.onTop, 'the line is what a press lands on').toBe(true);
      expect(inside(seen.box, viewport), 'the line is off the stage').toBe(true);
      expect(overlap(seen.box, riderBox(viewport)), 'the line is over the rider').toBe(false);
      for (const [how, measured] of await bothWays(page)) {
        await test.step(how, () => {
          const notices = measured.panels.find((each) => each.name.includes('oyl-hud__notices'));
          const panels = measured.panels.filter(
            (each) => each !== notices && each.box.height > 1 && overlap(each.box, seen.box),
          );
          expect(panels.map(describeItem)).toEqual([]);
          const controls = measured.items.filter(
            (each) => each.name.startsWith('control:') && overlap(each.box, seen.box),
          );
          expect(controls.map(describeItem)).toEqual([]);
        });
      }
    });
  }
});

/**
 * THE AI PACER'S POWER, ON THE TABLET'S HUD — #2864, the owner's ruling of
 * 2026-11-20: *"Show the pacer's power on the ride screen: its current watts
 * and what it is doing"*.
 *
 * `ride.html?aipacer=saying` rides with the AI pacer on. On each tablet — the
 * owner's 1280×800 with its insets read off the device (top 36, bottom 32),
 * 800×1280 upright with the same assumed, and 1024×768 with none — the
 * *Pacer power* reading is read back off the engine: drawn, whole and
 * unclipped, its watts and what the pacer is doing in it, inside the safe
 * area, the topmost thing where it is, and over no other reading, panel or
 * control, with the anchors on and off. Away from a tablet it gives way
 * (`theme.css` §"THE AI PACER'S POWER, ON A TABLET ONLY"), which the line's
 * own case above holds at 1024×600 by the notices clearing the route panel.
 */
test.describe('the AI pacer’s power on the tablet’s HUD — #2864', () => {
  const insetsOf = (viewport: Viewport): Insets =>
    viewport.width === 1024 ? NO_INSETS : PIXEL_TABLET_LANDSCAPE_INSETS;

  for (const viewport of TABLET_VIEWPORTS) {
    test(`drawn whole, with its watts and what it is doing, in the safe area and over nothing — ${viewport.name}`, async ({
      page,
    }) => {
      const insets = insetsOf(viewport);
      await applyInsets(page, insets);
      await openRide(page, viewport, '?aipacer=saying');
      await page.waitForFunction(() =>
        [...document.querySelectorAll('.oyl-hud__field')].some(
          (each) => each.querySelector('dt')?.textContent === 'Pacer power',
        ),
      );
      const read = await page.evaluate(() => {
        const field = [...document.querySelectorAll<HTMLElement>('.oyl-hud__field')].find(
          (each) => each.querySelector('dt')?.textContent === 'Pacer power',
        );
        if (field === undefined) return undefined;
        const clipped: string[] = [];
        for (const each of [field, ...field.querySelectorAll<HTMLElement>('*')]) {
          if (
            each.scrollWidth > each.clientWidth + 1 ||
            each.scrollHeight > each.clientHeight + 1
          ) {
            if (each.clientWidth > 0) clipped.push(each.className || each.tagName);
          }
        }
        const detail = field.querySelector('.oyl-hud__detail')?.getBoundingClientRect();
        return {
          text: (field.querySelector('dd')?.textContent ?? '').trim(),
          clipped,
          detailDrawn: detail !== undefined && detail.width * detail.height > 1,
        };
      });
      expect(read, 'the Pacer power reading is on the HUD').toBeDefined();
      console.log(`#2864 the AI pacer's power — ${viewport.name}: “${read?.text ?? ''}”`);
      expect(read?.text, 'its watts, then what it is doing').toMatch(/^\d+ W [a-z]/u);
      expect(read?.detailDrawn, 'what it is doing is drawn').toBe(true);
      expect(read?.clipped, 'nothing in it is clipped or scrolled').toEqual([]);
      for (const [how, measured] of await bothWays(page)) {
        await test.step(how, () => {
          const field = named(measured.items, 'reading: Pacer power');
          expect(field.onTop, 'the reading is the topmost thing where it is').toBe(true);
          const safe = {
            left: field.box.left - insets.left,
            top: field.box.top - insets.top,
            right: field.box.right - insets.left,
            bottom: field.box.bottom - insets.top,
            width: field.box.width,
            height: field.box.height,
          };
          expect(
            inside(safe, {
              ...viewport,
              width: viewport.width - insets.left - insets.right,
              height: viewport.height - insets.top - insets.bottom,
            }),
            `the reading is inside the safe area: ${describeItem(field)}`,
          ).toBe(true);
          expect(overlap(field.box, riderBox(viewport)), 'the reading is over the rider').toBe(
            false,
          );
          const others = measured.items.filter(
            (each) => each !== field && each.box.height > 1 && overlap(each.box, field.box),
          );
          expect(others.map(describeItem)).toEqual([]);
          // Over no panel but the tier it is drawn in, and that tier, one
          // reading longer, still clear of the leaning rider.
          const tier = measured.panels.find((each) =>
            each.name.includes('oyl-hud__fields--secondary'),
          );
          const panels = measured.panels.filter(
            (each) => each !== tier && each.box.height > 1 && overlap(each.box, field.box),
          );
          expect(panels.map(describeItem)).toEqual([]);
          expect(tier, 'the secondary tier is on the stage').toBeDefined();
          if (tier !== undefined) {
            expect(
              overlap(tier.box, riderBox(viewport)),
              `the tier is over the rider: ${describeItem(tier)}`,
            ).toBe(false);
          }
        });
      }
    });
  }
});
