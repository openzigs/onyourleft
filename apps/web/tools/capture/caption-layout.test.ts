// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3156: where a caption of the demo video goes. The rule under test is the
 * epic's: no caption box crosses the HUD panel it explains or the map credit,
 * and every caption but the closing card is inside the title-safe area.
 *
 * The render holds every drawn caption to the same rules again, against the
 * page's own boxes (`render-script.ts` §`drawnProblems`), and stops on a
 * frame that breaks them.
 */

import { describe, expect, it } from 'vitest';

import {
  balancedWidth,
  CALLOUT_GAP_SHARE,
  inside,
  intersects,
  placeCaption,
  titleSafe,
  type Box,
  type CaptionRequest,
} from './caption-layout';

const box = (x: number, y: number, width: number, height: number): Box => ({
  x,
  y,
  width,
  height,
});

/**
 * The HUD at 1920 × 1080 as the capture build draws it, measured in the page
 * by `getBoundingClientRect` on the lap race's 30th second (the scene with
 * the most panels and a credit): the panels, the credit, and the readings a
 * callout points at.
 */
const HUD_1080 = {
  primary: box(8, 8, 520, 164),
  gradient: box(380, 17, 139, 101),
  secondary: box(1144, 8, 768, 175),
  calories: box(1395, 86, 153, 88),
  item: box(1796, 86, 107, 88),
  route: box(8, 734, 288, 338),
  strips: box(17, 743, 270, 100),
  plan: box(17, 867, 270, 128),
  actions: box(1592, 894, 320, 178),
  throws: box(1601, 991, 302, 72),
  standings: box(1624, 191, 288, 219),
  credit: box(8, 706, 194, 20),
};
const PANELS_1080 = [
  HUD_1080.primary,
  HUD_1080.secondary,
  HUD_1080.route,
  HUD_1080.actions,
  HUD_1080.standings,
];

/** Whether `placed` keeps the rules for `request`. */
function keepsTheRules(request: CaptionRequest, placed: Box): boolean {
  const { width, height } = request.frame;
  return (
    (request.target === undefined || !intersects(placed, request.target)) &&
    request.hard.every((each) => !intersects(placed, each)) &&
    inside(placed, titleSafe(width, height))
  );
}

describe('where a caption goes on the frame — #3156', () => {
  it('holds a box that only touches another as clear of it', () => {
    expect(intersects(box(0, 0, 10, 10), box(10, 0, 10, 10))).toBe(false);
    expect(intersects(box(0, 0, 10, 10), box(9, 9, 10, 10))).toBe(true);
    expect(titleSafe(1920, 1080)).toEqual(box(96, 54, 1728, 972));
  });

  it.each(Object.entries(HUD_1080).filter(([name]) => name !== 'credit'))(
    'calls out the %s at 1080p clear of it, of the credit and of every other panel',
    (_name, target) => {
      const request: CaptionRequest = {
        frame: { width: 1920, height: 1080 },
        size: { width: 520, height: 110 },
        placement: 'callout',
        target,
        hard: [HUD_1080.credit],
        soft: PANELS_1080,
      };
      const placed = placeCaption(request);
      expect(placed).toBeDefined();
      if (placed === undefined) return;
      expect(keepsTheRules(request, placed.box)).toBe(true);
      expect(PANELS_1080.some((panel) => intersects(placed.box, panel))).toBe(false);
    },
  );

  it('draws the leader from the caption’s edge to the panel’s', () => {
    const placed = placeCaption({
      frame: { width: 1920, height: 1080 },
      size: { width: 400, height: 80 },
      placement: 'callout',
      target: HUD_1080.gradient,
      hard: [],
      soft: PANELS_1080,
    });
    expect(placed?.leader).toBeDefined();
    const { from, to } = placed?.leader ?? { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };
    const on = (point: { x: number; y: number }, b: Box): boolean =>
      point.x >= b.x && point.x <= b.x + b.width && point.y >= b.y && point.y <= b.y + b.height;
    expect(on(from, placed?.box ?? box(0, 0, 0, 0))).toBe(true);
    expect(on(to, HUD_1080.gradient)).toBe(true);
    // A reading inside a panel is called out from below the panel, a gap clear of it.
    expect(placed?.box.y).toBeGreaterThanOrEqual(
      HUD_1080.primary.y + HUD_1080.primary.height + 1080 * CALLOUT_GAP_SHARE,
    );
  });

  // The sweep: every frame size a render might be asked for, a panel in
  // each of nine places and three sizes, the credit in each corner, and each
  // kind of caption. Where a place is found, it keeps the rules.
  const SIZES = [
    [1024, 768],
    [1280, 720],
    [1920, 1080],
    [2560, 1440],
    [3840, 2160],
  ] as const;
  it.each(SIZES)(
    'never puts a caption over its panel or the credit, or outside title-safe, at %i×%i',
    (width, height) => {
      let placed = 0;
      let refused = 0;
      for (const share of [0.08, 0.15, 0.3]) {
        for (const fx of [0, 0.5, 1]) {
          for (const fy of [0, 0.5, 1]) {
            const w = width * share;
            const h = height * share * 0.6;
            const target = box((width - w) * fx, (height - h) * fy, w, h);
            for (const corner of [
              [0, 0],
              [1, 0],
              [0, 1],
              [1, 1],
            ] as const) {
              const credit = box((width - 200) * corner[0], (height - 24) * corner[1], 200, 24);
              for (const placement of ['callout', 'lower-third', 'title'] as const) {
                const request: CaptionRequest = {
                  frame: { width, height },
                  size: { width: width * 0.3, height: height * 0.08 },
                  placement,
                  target: placement === 'callout' ? target : undefined,
                  hard: [credit, ...(placement === 'callout' ? [] : [target])],
                  // No soft boxes: nothing but the geometry keeps a callout off its panel.
                  soft: [],
                };
                const result = placeCaption(request);
                if (result === undefined) {
                  refused += 1;
                  continue;
                }
                placed += 1;
                expect(keepsTheRules(request, result.box)).toBe(true);
              }
            }
          }
        }
      }
      // The sweep found places, so it is a test of them, not of refusals.
      expect(placed).toBeGreaterThan(refused * 10);
    },
  );

  it('crosses another panel only when the frame has no room clear of it, and never the credit', () => {
    const frame = { width: 1000, height: 600 };
    const safe = titleSafe(frame.width, frame.height);
    // A soft panel over the whole safe area but a strip: the caption goes in the strip.
    const wide = box(0, 0, 1000, 400);
    const placed = placeCaption({
      frame,
      size: { width: 300, height: 60 },
      placement: 'lower-third',
      hard: [],
      soft: [wide],
    });
    expect(placed !== undefined && intersects(placed.box, wide)).toBe(false);
    // Soft over everything: it is crossed.
    const all = box(0, 0, 1000, 600);
    expect(
      placeCaption({
        frame,
        size: { width: 300, height: 60 },
        placement: 'lower-third',
        hard: [],
        soft: [all],
      }),
    ).toBeDefined();
    // Hard over everything: no place.
    expect(
      placeCaption({
        frame,
        size: { width: 300, height: 60 },
        placement: 'lower-third',
        hard: [safe],
        soft: [],
      }),
    ).toBeUndefined();
  });

  it('refuses a callout with no panel, and a caption too big for the title-safe area', () => {
    const frame = { width: 1280, height: 720 };
    expect(
      placeCaption({
        frame,
        size: { width: 300, height: 60 },
        placement: 'callout',
        hard: [],
        soft: [],
      }),
    ).toBeUndefined();
    expect(
      placeCaption({
        frame,
        size: { width: 1200, height: 60 },
        placement: 'lower-third',
        hard: [],
        soft: [],
      }),
    ).toBeUndefined();
  });

  it('draws a card over the whole frame, and refuses one over the credit', () => {
    const frame = { width: 1920, height: 1080 };
    expect(
      placeCaption({ frame, size: frame, placement: 'card', hard: [], soft: PANELS_1080 })?.box,
    ).toEqual(box(0, 0, 1920, 1080));
    expect(
      placeCaption({ frame, size: frame, placement: 'card', hard: [HUD_1080.credit], soft: [] }),
    ).toBeUndefined();
  });

  it('draws a wrapped caption at the least width that keeps its lines, and a one-line caption at its own — #3175', async () => {
    // 600 px of words in a 400 px box: two lines of 40 px, and a third under 300 px.
    const tried: number[] = [];
    const wrapped = await balancedWidth({ width: 400, height: 80 }, (width) => {
      tried.push(width);
      return Promise.resolve(Math.ceil(600 / width) * 40);
    });
    expect(wrapped).toBe(300);
    expect(tried.every((width) => width > 0 && width < 400)).toBe(true);
    // One line: any narrower is taller, so it keeps its width, rounded up to a pixel.
    expect(
      await balancedWidth({ width: 399.4, height: 40 }, (width) =>
        Promise.resolve(width >= 399.4 ? 40 : 80),
      ),
    ).toBe(400);
    // The browser's half pixel of rounding is not a new line.
    expect(
      await balancedWidth({ width: 400, height: 80 }, (width) =>
        Promise.resolve(width >= 300 ? 80.4 : 120),
      ),
    ).toBe(300);
  });
});
