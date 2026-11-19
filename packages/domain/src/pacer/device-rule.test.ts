// SPDX-License-Identifier: Apache-2.0

/** The device decides what the AI pacer does — #2835, ADR 0083 D-1. */

import { describe, expect, it } from 'vitest';

import {
  PACER_GAP_FULL_S,
  pacerGapResponse,
  pacerRuleDecision,
  type PacerRuleGround,
} from './device-rule';
import {
  directedPacingFactor,
  PACER_CHASE_MOST,
  PACER_EASE,
  PACER_LEVEL_S,
  PACER_LIFT,
  PACER_REASONS,
  PACER_WAIT_MOST,
  readPacerDecisionRecord,
} from './model-pacer';
import { PACING_FACTOR_CEILING, PACING_FACTOR_FLOOR } from './pacing';
import { PACER_TERRAINS } from './terrain-rule';

/** 10 m/s, so a gap in metres is ten times its seconds. */
const SPEED = 10;

const ground = (fields: Partial<PacerRuleGround>): PacerRuleGround => ({
  riderGapM: 0,
  riderSpeed: SPEED,
  riderInDraft: false,
  terrain: 'none',
  ...fields,
});

describe('the gap curve — ADR 0083 D-1.3', () => {
  it('states its figures: level inside 2 s, whole at 10 s', () => {
    expect(PACER_LEVEL_S).toBe(2);
    expect(PACER_GAP_FULL_S).toBe(10);
  });

  it('holds inside the level band, either way', () => {
    for (const gapS of [0, 1, -1, 2, -2, 1.99, -1.99]) {
      expect(pacerGapResponse(gapS)).toEqual({ intent: 'hold' });
    }
  });

  it.each([
    [-3, 0.03], // 1 s past level of 8: an eighth of 20 %, 2.5 %, to a whole percent
    [-4, 0.05],
    [-6, 0.1],
    [-8, 0.15],
    [-10, 0.2],
    [-25, 0.2],
    [-600, 0.2],
  ])('waits for a rider %d s behind by easing %d of its power', (gapS, by) => {
    expect(pacerGapResponse(gapS)).toEqual({ intent: 'ease', by });
  });

  it.each([
    [3, 0.01],
    [4, 0.03], // a quarter of 10 %, 2.5 %, to a whole percent
    [6, 0.05],
    [8, 0.08], // three quarters of 10 %, 7.5 %
    [10, 0.1],
    [40, 0.1],
  ])('chases a rider %d s ahead by lifting %d of its power', (gapS, by) => {
    expect(pacerGapResponse(gapS)).toEqual({ intent: 'lift', by });
  });

  it('grows with the gap and never shrinks, each way, up to the whole envelope', () => {
    let waited = 0;
    let chased = 0;
    for (let gapS = 0; gapS <= 30; gapS += 0.1) {
      const wait = pacerGapResponse(-gapS).by ?? 0;
      const chase = pacerGapResponse(gapS).by ?? 0;
      expect(wait).toBeGreaterThanOrEqual(waited);
      expect(chase).toBeGreaterThanOrEqual(chased);
      expect(wait).toBeLessThanOrEqual(PACER_WAIT_MOST);
      expect(chase).toBeLessThanOrEqual(PACER_CHASE_MOST);
      waited = wait;
      chased = chase;
    }
    expect(waited).toBe(PACER_WAIT_MOST);
    expect(chased).toBe(PACER_CHASE_MOST);
  });

  it('can bring back a rider well under the pacer’s setting: more than the old fixed 7 %', () => {
    // #2835: with `ease` fixed at 7 %, a rider more than about 7 % under the pacer never came back.
    expect(pacerGapResponse(-8).by).toBeGreaterThan(PACER_EASE);
    expect(pacerGapResponse(-10).by).toBeCloseTo(1 - PACING_FACTOR_FLOOR, 12);
  });

  it('holds for a gap that is not a number', () => {
    expect(pacerGapResponse(Number.NaN)).toEqual({ intent: 'hold' });
    expect(pacerGapResponse(Number.POSITIVE_INFINITY)).toEqual({ intent: 'hold' });
  });
});

describe('the device’s decision — ADR 0083 D-1', () => {
  it('holds with the rider level, and says so', () => {
    expect(pacerRuleDecision(ground({ riderGapM: -8 }))).toEqual({
      direction: { plan: 'rolling', intent: 'hold' },
      reason: 'rider-level',
      place: 'level',
      gapS: -0.8,
    });
  });

  it('waits for a rider who has dropped back, more the further back they are', () => {
    expect(pacerRuleDecision(ground({ riderGapM: -60 }))).toEqual({
      direction: { plan: 'rolling', intent: 'ease', by: 0.1 },
      reason: 'rider-behind',
      place: 'behind',
      gapS: -6,
    });
    expect(pacerRuleDecision(ground({ riderGapM: -150 })).direction).toEqual({
      plan: 'rolling',
      intent: 'ease',
      by: PACER_WAIT_MOST,
    });
  });

  it('chases a rider who has pulled away, more the further ahead they are', () => {
    expect(pacerRuleDecision(ground({ riderGapM: 60 }))).toEqual({
      direction: { plan: 'rolling', intent: 'lift', by: 0.05 },
      reason: 'rider-ahead',
      place: 'ahead',
      gapS: 6,
    });
    expect(pacerRuleDecision(ground({ riderGapM: 400 })).direction).toEqual({
      plan: 'rolling',
      intent: 'lift',
      by: PACER_CHASE_MOST,
    });
  });

  it('never eases with the rider ahead, from the first ask, on any terrain, in or out of the draft', () => {
    // ADR 0078's floor, at once (#2835): the owner's "slowing down when behind me".
    for (const terrain of PACER_TERRAINS) {
      for (const riderInDraft of [true, false]) {
        for (let gapM = 20.5; gapM <= 600; gapM += 7.5) {
          for (const riderSpeed of [2, 6, 10, 15]) {
            const decided = pacerRuleDecision(
              ground({ riderGapM: gapM, riderSpeed, riderInDraft, terrain }),
            );
            if (decided.place !== 'ahead') continue;
            expect(decided.direction.intent).not.toBe('ease');
          }
        }
      }
    }
    expect(pacerRuleDecision(ground({ riderGapM: 30, terrain: 'before-climb' })).direction).toEqual(
      {
        plan: 'rolling',
        intent: 'lift',
        by: 0.01,
      },
    );
  });

  it('paces the terrain with the rider on its wheel: ADR 0082, at ADR 0072’s fixed shares', () => {
    expect(pacerRuleDecision(ground({ terrain: 'before-climb' }))).toEqual({
      direction: { plan: 'rolling', intent: 'ease' },
      reason: 'before-climb',
      place: 'level',
      gapS: 0,
    });
    expect(pacerRuleDecision(ground({ terrain: 'descent' })).direction).toEqual({
      plan: 'rolling',
      intent: 'lift',
    });
    expect(pacerRuleDecision(ground({ terrain: 'over-the-top' })).reason).toBe('over-the-top');
    // A terrain decision carries no share, so it is ridden at the fixed ones.
    const eased = pacerRuleDecision(ground({ terrain: 'before-climb' })).direction;
    expect(directedPacingFactor({ ...eased, plan: 'even' }, 0)).toBeCloseTo(1 - PACER_EASE, 12);
    const lifted = pacerRuleDecision(ground({ terrain: 'descent' })).direction;
    expect(directedPacingFactor({ ...lifted, plan: 'even' }, 0)).toBeCloseTo(1 + PACER_LIFT, 12);
  });

  it('paces the terrain for a rider behind but in the draft, and the gap for one behind and out of it', () => {
    expect(
      pacerRuleDecision(ground({ riderGapM: -30, riderInDraft: true, terrain: 'descent' })),
    ).toMatchObject({ direction: { intent: 'lift' }, reason: 'descent', place: 'behind' });
    expect(
      pacerRuleDecision(ground({ riderGapM: -30, riderInDraft: false, terrain: 'descent' })),
    ).toMatchObject({ direction: { intent: 'ease', by: 0.03 }, reason: 'rider-behind' });
  });

  it('eases right off for a rider stopped behind it, and holds for one stopped level or ahead', () => {
    expect(pacerRuleDecision(ground({ riderGapM: -40, riderSpeed: 0 }))).toEqual({
      direction: { plan: 'rolling', intent: 'ease', by: PACER_WAIT_MOST },
      reason: 'rider-stopped',
      place: undefined,
      gapS: undefined,
    });
    for (const riderGapM of [0, 25]) {
      expect(pacerRuleDecision(ground({ riderGapM, riderSpeed: 0 }))).toEqual({
        direction: { plan: 'rolling', intent: 'hold' },
        reason: 'rider-level',
        place: undefined,
        gapS: undefined,
      });
    }
  });

  it('never picks a plan: it rides #92’s own rule', () => {
    for (const terrain of PACER_TERRAINS) {
      for (const riderGapM of [-300, -30, 0, 30, 300]) {
        expect(pacerRuleDecision(ground({ riderGapM, terrain })).direction.plan).toBe('rolling');
      }
    }
  });

  it('never takes the pacer outside #92’s envelope, on any grade, for any ground', () => {
    const grades = Array.from({ length: 101 }, (_, index) => -25 + index * 0.5);
    for (const terrain of PACER_TERRAINS) {
      for (const riderInDraft of [true, false]) {
        for (const riderSpeed of [0, 0.01, 3, 10]) {
          for (const riderGapM of [-5_000, -120, -30, -1, 0, 1, 30, 120, 5_000]) {
            const { direction } = pacerRuleDecision({
              riderGapM,
              riderSpeed,
              riderInDraft,
              terrain,
            });
            for (const grade of grades) {
              const factor = directedPacingFactor(direction, grade);
              expect(factor).toBeGreaterThanOrEqual(PACING_FACTOR_FLOOR);
              expect(factor).toBeLessThanOrEqual(PACING_FACTOR_CEILING);
            }
          }
        }
      }
    }
  });

  it('answers a reason from the closed list, and a decision the log can keep, for a rider barely moving too', () => {
    for (const riderSpeed of [0, 0.001, 4, 12]) {
      for (const riderGapM of [-90_000, -400, -25, 0, 25, 400, 90_000]) {
        for (const terrain of PACER_TERRAINS) {
          const decided = pacerRuleDecision({
            riderGapM,
            riderSpeed,
            riderInDraft: false,
            terrain,
          });
          expect(PACER_REASONS).toContain(decided.reason);
          const { direction, reason, place, gapS } = decided;
          const record = {
            askedAtS: 5,
            arrivedAtS: null,
            outcome: 'failed',
            plan: direction.plan,
            intent: direction.intent,
            ...(direction.by === undefined ? {} : { by: direction.by }),
            reason,
            ...(place === undefined ? {} : { place }),
            ...(gapS === undefined ? {} : { gapS }),
            line: 'none',
          };
          expect(readPacerDecisionRecord(record)).toEqual(record);
        }
      }
    }
  });
});
