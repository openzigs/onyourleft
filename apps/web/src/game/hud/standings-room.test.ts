// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2599: which of a race's standings lines give way when the room above the
 * actions panel is short, and how many lines a room holds. Where the room is
 * on the stage is the browser gate's (`lap-race-hud.browser.spec.ts` §"#2599").
 */

import { describe, expect, it } from 'vitest';

import { STANDINGS_CLEARANCE_PIXELS, giveWayRanks, givesWay, linesThatFit } from './standings-room';

/** Eight lines with the rider's own at `own`. */
function field(own: number, length = 8): { you: boolean }[] {
  return Array.from({ length }, (_, index) => ({ you: index === own }));
}

/** The lines kept when `fit` lines fit, by index. */
function kept(own: number, fit: number, length = 8): number[] {
  const ranks = giveWayRanks(field(own, length));
  return ranks.flatMap((rank, index) => (givesWay(rank, fit) ? [] : [index]));
}

describe('giveWayRanks — #2599', () => {
  it('keeps the rider’s own line longest, then the leader, then outward, the line ahead first', () => {
    // The rider 4th of 8: you, the leader, 3rd, 5th, 2nd, 6th, 7th, 8th.
    expect(giveWayRanks(field(3))).toEqual([1, 4, 2, 0, 3, 5, 6, 7]);
  });

  it('keeps the rider last of eight and the racers just ahead, the leader before them', () => {
    expect(giveWayRanks(field(7))).toEqual([1, 7, 6, 5, 4, 3, 2, 0]);
    expect(kept(7, 4)).toEqual([0, 5, 6, 7]);
  });

  it('keeps the rider leading and the racers just behind', () => {
    expect(giveWayRanks(field(0))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(kept(0, 3)).toEqual([0, 1, 2]);
  });

  it('follows the list’s order where the rider has no line', () => {
    expect(giveWayRanks(field(-1, 4))).toEqual([0, 1, 2, 3]);
  });

  it('gives every line a rank of its own', () => {
    for (let own = 0; own < 8; own += 1) {
      expect([...giveWayRanks(field(own))].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    }
  });
});

describe('givesWay — #2599', () => {
  it('gives no line way where the room holds them all', () => {
    expect(givesWay(7, undefined)).toBe(false);
  });

  it('gives way the lines ranked at or past the number that fit', () => {
    expect(givesWay(5, 6)).toBe(false);
    expect(givesWay(6, 6)).toBe(true);
    expect(givesWay(0, 0)).toBe(true);
  });
});

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
});
