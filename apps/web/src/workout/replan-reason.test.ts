// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A re-plan's reason is said only when this device can see its premise in
 * what it sent — #1244's review. Every reason code, both ways.
 */

import { REASON_CODES, type ReasonCode } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { BlockSummary, ReplanInput } from './replan-job';
import { CADENCE_FALL_RPM, REASONS_NEVER_SHOWN, reasonPremiseHolds } from './replan-reason';

const HOLD = {
  kind: 'heart-rate-hold',
  seconds: 600,
  startShare: 0.5,
  ceilingShare: 0.8,
  range: { low: 130, high: 140 },
};
const STEADY = { kind: 'steady', seconds: 300, target: 0.6 };

const summary = (overrides: Partial<BlockSummary> = {}): BlockSummary => ({
  block: 0,
  seconds: 300,
  rescues: 0,
  ...overrides,
});

const sent = (overrides: Partial<ReplanInput> = {}): ReplanInput => ({
  revision: 0,
  summarySeq: 1,
  currentBlock: 1,
  goals: {},
  blocks: [STEADY, STEADY, STEADY],
  summaries: [summary()],
  ...overrides,
});

/** A hold block ridden at this mean heart rate, with the hold's own range of 130 to 140. */
const afterHold = (meanHeartRate: number | undefined): ReplanInput =>
  sent({
    blocks: [HOLD, STEADY, STEADY],
    summaries: [summary(meanHeartRate === undefined ? {} : { meanHeartRate })],
  });

describe('a reason is said only when the device holds its premise', () => {
  it('heart-rate-high: the block just ridden had a range the rider chose, and its mean was above the top', () => {
    expect(reasonPremiseHolds('heart-rate-high', afterHold(141))).toBe(true);
    // At the top of the range is inside it.
    expect(reasonPremiseHolds('heart-rate-high', afterHold(140))).toBe(false);
    expect(reasonPremiseHolds('heart-rate-high', afterHold(120))).toBe(false);
    // No strap reading in that block: nothing to say it about.
    expect(reasonPremiseHolds('heart-rate-high', afterHold(undefined))).toBe(false);
    // ⚠️ The review's case: steady blocks, no goals, a high heart rate. The
    // rider chose no range, so there is none to have stayed above.
    expect(
      reasonPremiseHolds('heart-rate-high', sent({ summaries: [summary({ meanHeartRate: 185 })] })),
    ).toBe(false);
  });

  it('heart-rate-low: … and its mean was below the bottom', () => {
    expect(reasonPremiseHolds('heart-rate-low', afterHold(129))).toBe(true);
    expect(reasonPremiseHolds('heart-rate-low', afterHold(130))).toBe(false);
    expect(reasonPremiseHolds('heart-rate-low', afterHold(150))).toBe(false);
    expect(
      reasonPremiseHolds('heart-rate-low', sent({ summaries: [summary({ meanHeartRate: 90 })] })),
    ).toBe(false);
  });

  it('takes the goals’ range for a block that is not a hold, and the hold’s own for one that is', () => {
    const goals = { holdRange: { low: 100, high: 110 } } as ReplanInput['goals'];
    // A steady block, a goals range of 100 to 110, a mean of 120: above it.
    expect(
      reasonPremiseHolds(
        'heart-rate-high',
        sent({ goals, summaries: [summary({ meanHeartRate: 120 })] }),
      ),
    ).toBe(true);
    // The same mean in a HOLD block of 130 to 140 is below the hold's range, not above the goals'.
    const inHold = sent({
      goals,
      blocks: [HOLD, STEADY, STEADY],
      summaries: [summary({ meanHeartRate: 120 })],
    });
    expect(reasonPremiseHolds('heart-rate-high', inHold)).toBe(false);
    expect(reasonPremiseHolds('heart-rate-low', inHold)).toBe(true);
  });

  it('reads the LATEST summary sent, not an earlier one', () => {
    const earlierHigh = sent({
      blocks: [HOLD, HOLD, STEADY],
      currentBlock: 2,
      summaries: [summary({ meanHeartRate: 150 }), summary({ block: 1, meanHeartRate: 135 })],
    });
    expect(reasonPremiseHolds('heart-rate-high', earlierHigh)).toBe(false);
  });

  it('cadence-falling: the last two blocks with a cadence differ by the margin or more, the later the lower', () => {
    const cadences = (...values: (number | undefined)[]): ReplanInput =>
      sent({
        summaries: values.map((meanCadence, block) =>
          summary(meanCadence === undefined ? { block } : { block, meanCadence }),
        ),
      });
    expect(CADENCE_FALL_RPM).toBe(5);
    expect(reasonPremiseHolds('cadence-falling', cadences(90, 85))).toBe(true);
    expect(reasonPremiseHolds('cadence-falling', cadences(90, 86))).toBe(false);
    expect(reasonPremiseHolds('cadence-falling', cadences(85, 90))).toBe(false);
    // One block ridden: nothing to have fallen from.
    expect(reasonPremiseHolds('cadence-falling', cadences(60))).toBe(false);
    // A block with no cadence reading is skipped, not read as a zero.
    expect(reasonPremiseHolds('cadence-falling', cadences(90, undefined, 84))).toBe(true);
    expect(reasonPremiseHolds('cadence-falling', cadences(90, undefined))).toBe(false);
  });

  it('goal-duration: the goals sent hold a duration', () => {
    expect(reasonPremiseHolds('goal-duration', sent({ goals: { durationMinutes: 60 } }))).toBe(
      true,
    );
    expect(reasonPremiseHolds('goal-duration', sent())).toBe(false);
  });

  it('on-plan is never said, however well the block went: seeing it means setting power against the target — R1', () => {
    // The cases the first definition said yes to, and the two the review measured.
    expect(reasonPremiseHolds('on-plan', sent())).toBe(false);
    expect(reasonPremiseHolds('on-plan', afterHold(135))).toBe(false);
    // A block ridden at a third of what it asked for.
    expect(
      reasonPremiseHolds('on-plan', sent({ summaries: [summary({ meanPowerShare: 0.3 })] })),
    ).toBe(false);
    // And one ridden exactly as asked: the device still may not work that out.
    expect(
      reasonPremiseHolds(
        'on-plan',
        sent({
          summaries: [summary({ meanPowerShare: 0.6, meanHeartRate: 135, meanCadence: 90 })],
        }),
      ),
    ).toBe(false);
    expect(REASONS_NEVER_SHOWN).toContain('on-plan');
  });

  it.each(['goal-time-in-range', 'effort-check-in'] as const)(
    '%s is never said: this device sends nothing a model could have taken it from',
    (reason) => {
      // With everything a request can hold that might seem to support it.
      const full = sent({
        goals: { durationMinutes: 60, holdRange: { low: 130, high: 140 } } as ReplanInput['goals'],
        blocks: [HOLD, STEADY, STEADY],
        summaries: [summary({ meanHeartRate: 135, secondsInRange: 300, meanCadence: 90 })],
      });
      expect(reasonPremiseHolds(reason, full)).toBe(false);
      expect(REASONS_NEVER_SHOWN).toContain(reason);
    },
  );

  it('says no reason at all of a request with no summary in it', () => {
    for (const reason of REASON_CODES) {
      expect(reasonPremiseHolds(reason, sent({ summaries: [] }))).toBe(false);
    }
  });

  it('has an answer for every reason code: three it never says, and four it says when it holds them', () => {
    expect(REASONS_NEVER_SHOWN).toStrictEqual(['goal-time-in-range', 'effort-check-in', 'on-plan']);
    // A request that holds every premise this device can see.
    const everything = sent({
      goals: { durationMinutes: 60 },
      blocks: [STEADY, HOLD, STEADY],
      currentBlock: 2,
      summaries: [
        summary({ meanCadence: 95 }),
        summary({ block: 1, meanHeartRate: 141, meanCadence: 85 }),
      ],
    });
    const said = REASON_CODES.filter((reason: ReasonCode) =>
      reasonPremiseHolds(reason, everything),
    );
    expect([...said].sort()).toStrictEqual(['cadence-falling', 'goal-duration', 'heart-rate-high']);
    // heart-rate-low is the fourth: the same block ridden under its range.
    expect(
      reasonPremiseHolds(
        'heart-rate-low',
        sent({ blocks: [HOLD, STEADY, STEADY], summaries: [summary({ meanHeartRate: 120 })] }),
      ),
    ).toBe(true);
    for (const never of REASONS_NEVER_SHOWN) {
      expect(said).not.toContain(never);
    }
  });
});
