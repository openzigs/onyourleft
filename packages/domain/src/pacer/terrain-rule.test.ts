// SPDX-License-Identifier: Apache-2.0

/** The pacer paces the terrain with the rider on its wheel — ADR 0082, #2794. */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradePercent,
  metres,
} from '../quantities';
import type { RouteProfile } from '../route/profile';
import {
  directedPacingFactor,
  PACER_AHEAD_FLOOR_S,
  PACER_INTENTS,
  PACER_PLANS,
  RIDER_PLACES,
  type PacerDirection,
} from './model-pacer';
import { PACING_FACTOR_CEILING, PACING_FACTOR_FLOOR } from './pacing';
import {
  PACER_BEFORE_CLIMB_M,
  PACER_OVER_THE_TOP_M,
  PACER_TERRAINS,
  pacerSayAgainstRidden,
  pacerTerrainApplies,
  pacerTerrainAt,
  riddenDirection,
  type PacerRuleGround,
} from './terrain-rule';

const STEP = 10;

/** A profile on a 10 m grid whose grade at each sample is the slope to the next one, unsmoothed. */
function profileOf(height: (along: number) => number, length: number, loop = false): RouteProfile {
  const count = Math.round(length / STEP) + 1;
  const heights = Array.from({ length: count }, (_, at) => height(at * STEP));
  const grades = heights.map((value, at) => {
    const next = heights[at + 1];
    const prior = heights[at - 1] ?? value;
    return ((next === undefined ? value - prior : next - value) / STEP) * 100;
  });
  return {
    loop,
    resolution: metres(STEP),
    totalDistance: metres(length),
    totalAscent: metres(0),
    totalDescent: metres(0),
    elevations: heights.map((value) => altitudeMetres(value)),
    grades: grades.map((value) => gradePercent(value)),
    positions: heights.map(() => geographicPosition(degreesLatitude(0), degreesLongitude(0))),
  };
}

/** Heights along a road of straight pieces: each `[metres, grade %]`, from 100 m up. */
function pieces(...stretches: readonly (readonly [number, number])[]): (along: number) => number {
  return (along) => {
    let height = 100;
    let start = 0;
    for (const [length, grade] of stretches) {
      const on = Math.min(Math.max(0, along - start), length);
      height += (on * grade) / 100;
      start += length;
    }
    return height;
  };
}

/** Flat to 1 km, 500 m at 6 % to 1.5 km, flat to 2.5 km, 400 m at −5 % to 2.9 km, flat to 4 km. */
const ROAD = profileOf(pieces([1_000, 0], [500, 6], [1_000, 0], [400, -5], [1_100, 0]), 4_000);

const LEVEL: PacerRuleGround = {
  terrain: 'none',
  riderPlace: 'level',
  riderInDraft: false,
  aheadForS: undefined,
};
const HOLD: PacerDirection = { plan: 'climber', intent: 'hold' };

describe('where the pacer is on the road, for the rule — ADR 0082 D-1', () => {
  it('states its figures', () => {
    expect(PACER_BEFORE_CLIMB_M).toBe(300);
    expect(PACER_OVER_THE_TOP_M).toBe(200);
  });

  it.each([
    [600, 'none'], // 400 m before the climb: too early
    [690, 'none'],
    [710, 'before-climb'], // 290 m before it
    [990, 'before-climb'],
    [1_010, 'none'], // on the climb, the model's intent
    [1_480, 'none'], // its last 20 m are still the climb
    [1_510, 'over-the-top'],
    [1_690, 'over-the-top'],
    [1_720, 'none'], // 220 m past the top
    [2_510, 'descent'],
    [2_880, 'descent'], // the last 20 m of a descent are still the descent
    [2_920, 'none'], // past the foot: no top to lift over
    [3_900, 'none'],
  ] as const)('at %i m is %s', (at, terrain) => {
    expect(pacerTerrainAt(ROAD, at)).toBe(terrain);
  });

  it('is no climb, no descent and no top for a ramp shorter than a climb', () => {
    const ramps = profileOf(pieces([1_000, 0], [150, 8], [500, 0], [150, -8], [1_200, 0]), 3_000);
    for (const at of [900, 1_100, 1_200, 1_700, 1_800])
      expect(pacerTerrainAt(ramps, at)).toBe('none');
  });

  it('eases where a descent runs into a climb inside the 300 m, rather than lifting', () => {
    const dip = profileOf(pieces([1_000, 0], [400, -5], [600, 6], [1_000, 0]), 3_000);
    expect(pacerTerrainAt(dip, 1_050)).toBe('descent'); // 350 m before the climb
    expect(pacerTerrainAt(dip, 1_150)).toBe('before-climb'); // still descending, 250 m before it
  });

  it('reads a loop across its line: the top of a climb that ends at the line is behind the pacer', () => {
    const loop = profileOf(pieces([1_500, 0], [500, 6]), 2_000, true);
    expect(pacerTerrainAt(loop, 50)).toBe('over-the-top');
    expect(pacerTerrainAt(loop, 1_300)).toBe('before-climb');
  });
});

describe('who the rule is for — ADR 0082 D-1', () => {
  it('applies with the rider level, or in the draft, and never ahead', () => {
    expect(pacerTerrainApplies('level', false)).toBe(true);
    expect(pacerTerrainApplies('level', true)).toBe(true);
    expect(pacerTerrainApplies('behind', true)).toBe(true);
    expect(pacerTerrainApplies(undefined, true)).toBe(true);
    expect(pacerTerrainApplies('ahead', false)).toBe(false);
    expect(pacerTerrainApplies('ahead', true)).toBe(false);
    expect(pacerTerrainApplies('behind', false)).toBe(false);
    expect(pacerTerrainApplies(undefined, false)).toBe(false);
  });
});

describe('the direction ridden — ADR 0082 D-1, D-2', () => {
  it('eases before a climb and lifts on a descent and over the top, keeping the model’s plan', () => {
    expect(riddenDirection(HOLD, { ...LEVEL, terrain: 'before-climb' })).toEqual({
      plan: 'climber',
      intent: 'ease',
    });
    expect(riddenDirection(HOLD, { ...LEVEL, terrain: 'descent' })).toEqual({
      plan: 'climber',
      intent: 'lift',
    });
    const ease = { plan: 'even', intent: 'ease' } as const;
    expect(
      riddenDirection(ease, {
        ...LEVEL,
        riderPlace: 'behind',
        riderInDraft: true,
        terrain: 'over-the-top',
      }),
    ).toEqual({ plan: 'even', intent: 'lift' });
  });

  it('rides the model’s direction itself where the rule does not act', () => {
    const lift = { plan: 'rolling', intent: 'lift' } as const;
    expect(riddenDirection(lift, LEVEL)).toBe(lift);
    for (const terrain of PACER_TERRAINS) {
      for (const riderPlace of ['ahead', 'behind'] as const) {
        expect(riddenDirection(lift, { ...LEVEL, terrain, riderPlace })).toBe(lift);
      }
    }
    expect(
      riddenDirection(HOLD, {
        ...LEVEL,
        terrain: 'before-climb',
        riderPlace: 'ahead',
        riderInDraft: true,
      }),
    ).toBe(HOLD);
  });

  it('puts ADR 0078’s floor last, so the floor wins if the two ever meet', () => {
    // Not reachable from a ride today (the rule refuses `ahead`, which the floor needs):
    // the ground is built by hand to show the order.
    expect(
      riddenDirection(HOLD, {
        terrain: 'before-climb',
        riderPlace: 'level',
        riderInDraft: true,
        aheadForS: PACER_AHEAD_FLOOR_S,
      }),
    ).toEqual({ plan: 'climber', intent: 'hold' });
  });

  it('never takes the pacer outside #92’s envelope, on any grade, for any answer and ground', () => {
    const grades = Array.from({ length: 101 }, (_, index) => -25 + index * 0.5);
    for (const plan of PACER_PLANS) {
      for (const intent of PACER_INTENTS) {
        for (const terrain of PACER_TERRAINS) {
          for (const riderPlace of [...RIDER_PLACES, undefined]) {
            for (const riderInDraft of [true, false]) {
              const ridden = riddenDirection(
                { plan, intent },
                { terrain, riderPlace, riderInDraft, aheadForS: undefined },
              );
              for (const grade of grades) {
                const factor = directedPacingFactor(ridden, grade);
                expect(factor).toBeGreaterThanOrEqual(PACING_FACTOR_FLOOR);
                expect(factor).toBeLessThanOrEqual(PACING_FACTOR_CEILING);
              }
            }
          }
        }
      }
    }
  });
});

describe('the line beside the intent ridden — ADR 0082 D-3', () => {
  it.each([
    ['I am going to push on now.', 'ease', true],
    ['I will ease off for the climb.', 'ease', false],
    ['I will ease off for the climb.', 'lift', true],
    ['Let me push down this descent.', 'lift', false],
    ['I will ease off for the climb.', 'hold', true],
    ['I am going to push on now.', 'hold', true],
    ['Stay smooth on my wheel.', 'hold', false],
    ['Stay smooth on my wheel.', 'ease', false],
    ['Stay smooth on my wheel.', 'lift', false],
  ] as const)('%j under a ridden %s is refused: %s', (say, ridden, refused) => {
    expect(pacerSayAgainstRidden(say, ridden)).toBe(refused);
  });
});
