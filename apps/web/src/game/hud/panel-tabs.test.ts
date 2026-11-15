// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2600: where an open panel's tab is drawn — `panel-tabs.ts` §`placeTab`.
 * Boxes as a 1024×768 stage lays them out, in CSS pixels; the browser gate
 * measures the real ones (`ride-chrome.browser.spec.ts`).
 */

import { describe, expect, it } from 'vitest';

import { TAB_GAP_PIXELS, placeTab, type TabBox } from './panel-tabs';

const stage: TabBox = { left: 0, top: 0, right: 1024, bottom: 768 };
const box = (left: number, top: number, right: number, bottom: number): TabBox => ({
  left,
  top,
  right,
  bottom,
});
const size = { width: 80, height: 48 };

describe('an open panel’s tab — #2600', () => {
  it('stands beside a top-start panel, toward the road, level with its top', () => {
    const panel = box(8, 8, 392, 200);
    expect(placeTab({ panel, edge: panel, stage, ...size, others: [] })).toEqual({
      left: 392 + TAB_GAP_PIXELS,
      top: 8,
    });
  });

  it('stands beside a bottom-end panel, toward the road, level with its bottom', () => {
    const panel = box(700, 560, 1016, 760);
    expect(placeTab({ panel, edge: panel, stage, ...size, others: [] })).toEqual({
      left: 700 - TAB_GAP_PIXELS - 80,
      top: 760 - 48,
    });
  });

  it('lines up with the edge it is handed — the trainer’s line, inside its panel', () => {
    const panel = box(700, 560, 1016, 760);
    const line = box(708, 568, 1008, 600);
    // Level with the line's own bottom, not the panel's, so it stands beside the line.
    expect(placeTab({ panel, edge: line, stage, ...size, others: [] })?.top).toBe(600 - 48);
    // The line is in the bottom half; one in the top half lines up with its top.
    const high = box(700, 100, 1016, 400);
    const highLine = box(708, 108, 1008, 140);
    expect(placeTab({ panel: high, edge: highLine, stage, ...size, others: [] })?.top).toBe(108);
  });

  it('goes under the panel, at its inner end, where beside it is another panel', () => {
    const panel = box(8, 8, 392, 200);
    const neighbour = box(400, 8, 1016, 200);
    expect(placeTab({ panel, edge: panel, stage, ...size, others: [neighbour] })).toEqual({
      left: 392 - 80,
      top: 200 + TAB_GAP_PIXELS,
    });
  });

  it('goes under at its outer end where the inner end is taken too', () => {
    const panel = box(8, 8, 392, 200);
    const neighbour = box(400, 8, 1016, 200);
    const below = box(300, 210, 392, 300);
    expect(placeTab({ panel, edge: panel, stage, ...size, others: [neighbour, below] })).toEqual({
      left: 8,
      top: 200 + TAB_GAP_PIXELS,
    });
  });

  it('takes the nearest clear place beside or past it where the named ones are taken', () => {
    // A room's layout at 1024×768: the secondary panel beside, a notice under.
    const panel = box(8, 8, 392, 172);
    const secondary = box(400, 8, 1016, 179);
    const notice = box(8, 187, 360, 255);
    const place = placeTab({ panel, edge: panel, stage, ...size, others: [secondary, notice] });
    expect(place).toBeDefined();
    const at = { left: place?.left ?? 0, top: place?.top ?? 0 };
    const drawn = box(at.left, at.top, at.left + 80, at.top + 48);
    for (const other of [panel, secondary, notice]) {
      const clear =
        drawn.right <= other.left ||
        other.right <= drawn.left ||
        drawn.bottom <= other.top ||
        other.bottom <= drawn.top;
      expect(clear).toBe(true);
    }
    // Off the panel's inner corner, as near it as is clear: in the column
    // beside it, just below the secondary panel.
    expect(at).toEqual({ left: 392 + TAB_GAP_PIXELS, top: 184 });
  });

  it('draws no tab where nowhere is clear, rather than one over a reading', () => {
    const panel = box(8, 8, 1016, 200);
    const under = box(0, 200, 1024, 400);
    expect(placeTab({ panel, edge: panel, stage, ...size, others: [under] })).toBeUndefined();
  });

  it('answers against the stage’s own corner', () => {
    const offset: TabBox = { left: 100, top: 50, right: 1124, bottom: 818 };
    const panel = box(108, 58, 492, 250);
    expect(placeTab({ panel, edge: panel, stage: offset, ...size, others: [] })).toEqual({
      left: 492 + TAB_GAP_PIXELS - 100,
      top: 8,
    });
  });
});
