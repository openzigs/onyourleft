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
} from './ride-stage';

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
