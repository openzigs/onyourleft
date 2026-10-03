// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Analysis' ride chooser — #1028, measured in the pinned Chromium.
 *
 * Seen on the owner's Pixel Tablet in landscape (build 900d6ebd): the *Ride*
 * `<select>` under *Time in zone* was a narrow box, and the ride's name wrapped
 * over four lines inside it. Two things did it together: the select wore
 * `.oyl-input`, whose 8rem is a number box's width, and under
 * `appearance: base-select` (#667) the closed control is a box like any other,
 * whose text wraps where a platform-drawn select's never did.
 *
 * Opened in `reflow.html` over the populated fixtures, whose rides have names
 * longer than any column (`testing/populated-shell.tsx` §`rideName`), on the
 * owner's tablet in the shell both ways up with the #439 insets, and on a
 * phone. What is held at each:
 *
 * - **One line.** The chooser's content box holds one line of its own
 *   line-height, and no more.
 * - **The section's width.** The chooser spans its section's content box,
 *   to a pixel — so a long name gets every pixel the column has before it is
 *   cut.
 * - **Cut short of the chevron.** A name longer than the box is clipped at
 *   the content box, and the chevron has a right padding of its own to be
 *   drawn in. Both were missing: `.oyl-input`'s `background` shorthand reset
 *   `select`'s chevron to no image, and its padding took back the room.
 *   ⚠️ **No ellipsis is drawn**, though `theme.css` declares one: under
 *   `base-select` the closed control's text is in an engine-internal box no
 *   author style reaches (Chromium 153), so the name is clipped, not elided.
 * - **Its 44 px target** (SC 2.5.5, `theme.css` §`select`).
 *
 * ## The control
 *
 * `?chooser=as-shipped` lays the chooser as it shipped over the shipping
 * stylesheet — 8rem wide, its text allowed to wrap — and the one-line and the
 * width checks must then FAIL at every viewport, or they measure nothing.
 */

import { expect, test, type Page } from '@playwright/test';

import {
  applyInsets,
  NO_INSETS,
  PIXEL_TABLET_LANDSCAPE_INSETS,
  PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  resolvedInsets,
  type Insets,
} from './insets';

interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly insets: Insets;
}

const VIEWPORTS: readonly Viewport[] = [
  {
    name: 'tablet in the shell 1280×800, insets 36/32',
    width: 1280,
    height: 800,
    insets: PIXEL_TABLET_LANDSCAPE_INSETS,
  },
  {
    name: 'tablet upright 800×1280, insets 36/32 (assumed)',
    width: 800,
    height: 1280,
    insets: PIXEL_TABLET_PORTRAIT_INSETS_ASSUMED,
  },
  { name: 'phone 390×844', width: 390, height: 844, insets: NO_INSETS },
];

/** SC 2.5.5's 44 × 44, which `theme.css` §`select` declares. */
const TOUCH_TARGET_PIXELS = 44;

/** What the chooser lays out, read back from the engine. */
interface Chooser {
  /** The name the closed control shows. */
  readonly shown: string;
  /** Lines of the chooser's own line-height its content box holds. */
  readonly lines: number;
  readonly width: number;
  readonly height: number;
  /** The content box's width of the section the chooser is in. */
  readonly sectionWidth: number;
  readonly whiteSpace: string;
  /** Where a name too long for the box is cut: `content-box` keeps it off the chevron. */
  readonly overflowClipMargin: string;
  /** The right padding the chevron is drawn in, and the chevron itself. */
  readonly paddingRight: number;
  readonly backgroundImage: string;
  /** Whether the name is wider than the box, so it is cut. */
  readonly cut: boolean;
}

async function chooserAt(page: Page, viewport: Viewport, control = ''): Promise<Chooser> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await applyInsets(page, viewport.insets);
  const response = await page.goto(`/reflow.html?data=populated${control}`);
  expect(
    response?.status(),
    'reflow.html did not load — is it named in vite.browser.config.ts build.rollupOptions.input?',
  ).toBe(200);
  await page.waitForFunction(() => window.__oylReflow !== undefined);
  expect(await page.evaluate(() => window.__oylReflow?.errors)).toEqual([]);
  expect(await resolvedInsets(page)).toEqual(viewport.insets);
  const seen = await page.evaluate(async () => window.__oylReflow?.visit('#/analysis'));
  expect(seen?.settledWithinPatience, '#/analysis did not settle').toBe(true);
  expect(seen?.errors, '#/analysis raised an error').toEqual([]);
  // The rides are read after the page settles its first frame.
  await page.waitForFunction(() => {
    const first = document.querySelector<HTMLSelectElement>('#oyl-zone-ride')?.options[0];
    return first !== undefined && first.value !== '';
  });
  return page.evaluate((): Chooser => {
    const select = document.querySelector<HTMLSelectElement>('#oyl-zone-ride');
    const section = select?.closest('section');
    if (select === null || section === null || section === undefined) {
      throw new Error('#/analysis rendered no ride chooser inside a section');
    }
    const style = getComputedStyle(select);
    const content =
      select.clientHeight -
      Number.parseFloat(style.paddingTop) -
      Number.parseFloat(style.paddingBottom);
    const sectionStyle = getComputedStyle(section);
    const box = select.getBoundingClientRect();
    // How wide the shown name would lay out on one line, in the chooser's font.
    const probe = document.createElement('span');
    probe.style.font = style.font;
    probe.style.whiteSpace = 'pre';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    const shown = select.selectedOptions[0]?.text ?? '';
    probe.textContent = shown;
    document.body.append(probe);
    const nameWidth = probe.getBoundingClientRect().width;
    probe.remove();
    return {
      shown,
      lines: Math.round(content / Number.parseFloat(style.lineHeight)),
      width: box.width,
      height: box.height,
      sectionWidth:
        section.clientWidth -
        Number.parseFloat(sectionStyle.paddingLeft) -
        Number.parseFloat(sectionStyle.paddingRight),
      whiteSpace: style.whiteSpace,
      overflowClipMargin: style.overflowClipMargin,
      paddingRight: Number.parseFloat(style.paddingRight),
      backgroundImage: style.backgroundImage,
      cut:
        nameWidth >
        select.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight),
    };
  });
}

test.describe('#1028 — the ride chooser shows a ride’s name on one line', () => {
  for (const viewport of VIEWPORTS) {
    test(`at ${viewport.name}, and fails as it shipped`, async ({ page, context }) => {
      const now = await chooserAt(page, viewport);
      const shipped = await chooserAt(await context.newPage(), viewport, '&chooser=as-shipped');
      console.log(
        `[#1028] ${viewport.name}: ${now.shown === '' ? 'nothing shown' : `"${now.shown}"`} — ` +
          `${String(now.lines)} line(s), ${String(Math.round(now.width))} of ` +
          `${String(Math.round(now.sectionWidth))} px, ${String(Math.round(now.height))} px tall` +
          `${now.cut ? ', cut before the chevron' : ''}; as shipped ${String(shipped.lines)} line(s), ` +
          `${String(Math.round(shipped.width))} px`,
      );

      expect(now.shown, 'the chooser shows no ride, so there is no name to measure').toMatch(/\S/u);
      expect(now.lines, 'the ride’s name wraps inside the chooser').toBe(1);
      expect(now.width, 'the chooser does not take its section’s width').toBeGreaterThanOrEqual(
        now.sectionWidth - 1,
      );
      expect(now.width, 'the chooser is wider than its section').toBeLessThanOrEqual(
        now.sectionWidth + 1,
      );
      expect(now.height).toBeGreaterThanOrEqual(TOUCH_TARGET_PIXELS);
      expect(now.whiteSpace).toBe('nowrap');
      // A name too long for the box is cut at the content box, short of the
      // chevron, which is drawn in a right padding of its own.
      expect(now.cut, 'the fixture’s name fits, so nothing here is cut').toBe(true);
      expect(now.overflowClipMargin).toBe('content-box');
      expect(now.paddingRight, 'no room for the chevron').toBeGreaterThanOrEqual(32);
      expect(now.backgroundImage, 'the chevron is not drawn').toContain('linear-gradient');

      // The control: as it shipped, both checks must fail.
      expect(
        shipped.lines,
        'as shipped, the name fit on one line — this measures nothing',
      ).toBeGreaterThanOrEqual(2);
      expect(
        shipped.width,
        'as shipped, the chooser took its section’s width — this measures nothing',
      ).toBeLessThan(shipped.sectionWidth - 1);
    });
  }
});
