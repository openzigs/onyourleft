// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { FLAG_COASTING, FLAG_PLAUSIBILITY } from '@onyourleft/protocol';

import type { RoomStanding } from '../../net/room-session';
import {
  gapSpokenText,
  gapText,
  NO_POWER_TEXT,
  OWN_GAP_TEXT,
  standingLines,
  STANDINGS_DRAWN,
  wattsPerKilogramText,
} from './standings';

function standing(riderId: number, overrides: Partial<RoomStanding> = {}): RoomStanding {
  return {
    riderId,
    name: `R${String(riderId)}`,
    distanceMetres: 1_000 - riderId,
    gapSeconds: 0,
    wattsPerKilogram: 3.25,
    flags: 0,
    own: false,
    ...overrides,
  };
}

describe('the gap, in time — #1347', () => {
  it('says behind you with a plus and ahead with a minus, in seconds and then minutes', () => {
    expect(gapText(12.4)).toBe('+12 s');
    expect(gapText(-5)).toBe('−5 s');
    expect(gapText(65)).toBe('+1:05');
    expect(gapText(-600)).toBe('−10:00');
    expect(gapText(0.3)).toBe('0 s');
    expect(gapText(3_600)).toBe('+1 h or more');
  });

  it('says the same in words for a screen reader', () => {
    expect(gapSpokenText(12.4)).toBe('12 seconds behind you');
    expect(gapSpokenText(-1)).toBe('1 second ahead of you');
    expect(gapSpokenText(65)).toBe('1 minute 5 seconds behind you');
    expect(gapSpokenText(-120)).toBe('2 minutes ahead of you');
    expect(gapSpokenText(0)).toBe('level with you');
    expect(gapSpokenText(-3_600)).toBe('an hour or more ahead of you');
  });
});

describe('W/kg — never watts', () => {
  it('is one decimal, and No power for a rider the room is coasting, never 0.0', () => {
    expect(wattsPerKilogramText(standing(1, { wattsPerKilogram: 3.2 }))).toBe('3.2 W/kg');
    expect(wattsPerKilogramText(standing(1, { wattsPerKilogram: 0 }))).toBe('0.0 W/kg');
    expect(wattsPerKilogramText(standing(1, { wattsPerKilogram: 0, flags: FLAG_COASTING }))).toBe(
      NO_POWER_TEXT,
    );
  });
});

describe('the rows — #1347', () => {
  it('keeps the room’s order, numbers every place, marks your row and flags a flagged rider', () => {
    const lines = standingLines([
      standing(4, { gapSeconds: -20 }),
      standing(2, { own: true }),
      standing(9, { gapSeconds: 7, flags: FLAG_PLAUSIBILITY }),
    ]);
    expect(lines.map((line) => [line.place, line.name, line.gap, line.own, line.flagged])).toEqual([
      [1, 'R4', '−20 s', false, false],
      [2, 'R2', OWN_GAP_TEXT, true, false],
      [3, 'R9', '+7 s', false, true],
    ]);
    expect(lines[1]?.gapSpoken).toBe('you');
  });

  it('draws a window of rows centred on yours, slid to stay inside the list, and keeps everybody', () => {
    const field = (own: number) =>
      Array.from({ length: 12 }, (_, index) => standing(index, { own: index === own }));
    const drawn = (own: number) =>
      standingLines(field(own))
        .filter((line) => line.drawn)
        .map((line) => line.place);
    expect(STANDINGS_DRAWN).toBe(5);
    expect(drawn(6)).toEqual([5, 6, 7, 8, 9]);
    expect(drawn(0)).toEqual([1, 2, 3, 4, 5]);
    expect(drawn(11)).toEqual([8, 9, 10, 11, 12]);
    // Everybody is still a row: the rest are hidden by clip, for a screen reader.
    expect(standingLines(field(6))).toHaveLength(12);
    // Fewer riders than the window: all of them.
    expect(standingLines(field(1).slice(0, 3)).every((line) => line.drawn)).toBe(true);
    // No own row in the frame: the top of the list.
    expect(
      standingLines(field(-1))
        .filter((line) => line.drawn)
        .map((line) => line.place),
    ).toEqual([1, 2, 3, 4, 5]);
  });
});
