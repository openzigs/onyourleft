// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2599: how many whole lines of a race's standings the room above the
 * actions panel holds — the list's height where it scrolls. Where the room is
 * on the stage is the browser gate's (`lap-race-hud.browser.spec.ts` §"#2599").
 */

import { describe, expect, it } from 'vitest';

import {
  STANDINGS_CLEARANCE_PIXELS,
  STANDINGS_HYSTERESIS_PIXELS,
  linesThatFit,
} from './standings-room';

describe('linesThatFit — #2599', () => {
  const room = {
    listTop: 300,
    listBottom: 500,
    panelBottom: 509,
    lineHeight: 25,
  };

  it('holds the whole lines between the list’s top and the actions panel, less the clearance and the panel’s padding', () => {
    // 300 + 9 below the list + 16 clear: 175 px of room, seven lines.
    expect(linesThatFit({ ...room, actionsTop: 300 + 9 + STANDINGS_CLEARANCE_PIXELS + 175 })).toBe(
      7,
    );
    expect(linesThatFit({ ...room, actionsTop: 300 + 9 + STANDINGS_CLEARANCE_PIXELS + 174 })).toBe(
      6,
    );
  });

  it('reads a room of exactly n lines in sub-pixel layout as n', () => {
    expect(
      linesThatFit({
        ...room,
        lineHeight: 24.8,
        actionsTop: 300 + 9 + STANDINGS_CLEARANCE_PIXELS + 24.8 * 3 - 0.0001,
      }),
    ).toBe(3);
  });

  it('holds no line where there is no room, and never fewer than none', () => {
    expect(linesThatFit({ ...room, actionsTop: 310 })).toBe(0);
    expect(linesThatFit({ ...room, actionsTop: 0 })).toBe(0);
  });

  it('holds no line when no line height is known', () => {
    expect(linesThatFit({ ...room, lineHeight: 0, actionsTop: 900 })).toBe(0);
  });

  describe('with the lines drawn now — the hysteresis (PR #2621)', () => {
    /** The actions panel's top for a room `extra` px over `lines` whole lines. */
    const actionsTop = (lines: number, extra: number): number =>
      300 + 9 + STANDINGS_CLEARANCE_PIXELS + 25 * lines + extra;

    it('does not grow the list by a line until the room holds it and a few pixels more', () => {
      expect(linesThatFit({ ...room, actionsTop: actionsTop(6, 2) }, 5)).toBe(5);
      expect(
        linesThatFit({ ...room, actionsTop: actionsTop(6, STANDINGS_HYSTERESIS_PIXELS) }, 5),
      ).toBe(6);
    });

    it('shrinks the list as soon as the room no longer holds a line', () => {
      expect(linesThatFit({ ...room, actionsTop: actionsTop(5, 24) }, 6)).toBe(5);
    });

    it('keeps the list’s height when the room is unchanged near the wrap point', () => {
      expect(linesThatFit({ ...room, actionsTop: actionsTop(6, 1) }, 6)).toBe(6);
      expect(linesThatFit({ ...room, actionsTop: actionsTop(6, 1) }, 5)).toBe(5);
    });
  });
});
