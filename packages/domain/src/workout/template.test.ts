// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { beatsPerMinute, seconds } from '../quantities';

import { WorkoutError, type WorkoutErrorCode } from './errors';
import { decodeWorkoutFile, encodeWorkoutFile } from './format';
import {
  MAXIMUM_INTENSITY_PERCENT,
  MINIMUM_INTENSITY_PERCENT,
  tailorWorkout,
  type TailorChoices,
  type WorkoutTemplate,
} from './template';
import { expandWorkout } from './timeline';
import { MAXIMUM_REPEATS, thresholdShare, type WorkoutBlock } from './workout';

const share = thresholdShare;

const warmUp: readonly WorkoutBlock[] = [
  { kind: 'ramp', seconds: seconds(600), from: share(0.5), to: share(0.75), label: 'Warm-up' },
];
const coolDown: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(600), target: share(0.5), label: 'Cool-down' },
];

/** Every block kind in a main set, a hold and a free ride among them. */
const mixedMain: readonly WorkoutBlock[] = [
  { kind: 'steady', seconds: seconds(300), target: share(0.9), label: 'Settle' },
  { kind: 'ramp', seconds: seconds(300), from: share(0.8), to: share(1) },
  {
    kind: 'intervals',
    repeats: 4,
    hardSeconds: seconds(60),
    hardTarget: share(1.2),
    easySeconds: seconds(60),
    easyTarget: share(0.5),
  },
  { kind: 'free-ride', seconds: seconds(15), label: 'Sprint' },
  {
    kind: 'heart-rate-hold',
    seconds: seconds(900),
    range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
    startShare: share(0.65),
    ceilingShare: share(0.8),
  },
];

/** A fixed main set of {@link mixedMain}. */
const mixed: WorkoutTemplate = {
  id: 'mixed-fixture',
  name: 'Mixed fixture',
  summary: 'Every kind of block in one main set.',
  category: 'race-simulation',
  warmUp,
  mainSet: {
    scaling: 'fixed',
    blocks: mixedMain,
  },
  coolDown,
  parameters: { intensityPercent: { minimum: -25, maximum: 10 } },
};

/** 2 × 20 min at 0.95 with 5 min easy: one steady rep and a recovery. */
const climb: WorkoutTemplate = {
  id: 'climb-fixture',
  name: 'Climb fixture',
  summary: 'Two long efforts just under threshold.',
  category: 'threshold',
  warmUp,
  mainSet: {
    scaling: 'repeat',
    rep: [{ kind: 'steady', seconds: seconds(1200), target: share(0.95), label: 'Climb' }],
    repeats: { minimum: 1, maximum: 4, default: 2 },
    recovery: {
      block: { kind: 'steady', seconds: seconds(300), target: share(0.55), label: 'Easy' },
      seconds: { minimum: 120, maximum: 600 },
    },
  },
  coolDown,
  parameters: { intensityPercent: { minimum: -10, maximum: 5 } },
};

/** A repetition of two blocks with no separate recovery, and a wide repeat range. */
const sprints: WorkoutTemplate = {
  id: 'sprints-fixture',
  name: 'Sprints fixture',
  summary: 'Short released sprints with easy spinning between.',
  category: 'sprint',
  warmUp,
  mainSet: {
    scaling: 'repeat',
    rep: [
      { kind: 'free-ride', seconds: seconds(15), label: 'Sprint' },
      { kind: 'steady', seconds: seconds(45), target: share(0.6) },
    ],
    // Wider than the global bound on purpose: the global one must still win.
    repeats: { minimum: 0, maximum: 200, default: 8 },
  },
  coolDown,
  // Wider than the global range on purpose, for the same reason.
  parameters: { intensityPercent: { minimum: -50, maximum: 50 } },
};

/** A repetition of two blocks and a recovery: written out, not compacted. */
const overUnders: WorkoutTemplate = {
  ...climb,
  id: 'over-unders-fixture',
  category: 'over-under',
  mainSet: {
    scaling: 'repeat',
    rep: [
      { kind: 'steady', seconds: seconds(120), target: share(1.05), label: 'Over' },
      { kind: 'steady', seconds: seconds(60), target: share(0.9), label: 'Under' },
    ],
    repeats: { minimum: 2, maximum: 6, default: 3 },
    recovery: { block: { kind: 'steady', seconds: seconds(300), target: share(0.5) } },
  },
};

/** A recovery whose length is part of the session. */
const lockedRecovery: WorkoutTemplate = {
  ...climb,
  id: 'locked-recovery-fixture',
  mainSet: {
    scaling: 'repeat',
    rep: [{ kind: 'steady', seconds: seconds(180), target: share(1.2) }],
    repeats: { minimum: 3, maximum: 8, default: 5 },
    recovery: { block: { kind: 'steady', seconds: seconds(180), target: share(0.5) } },
  },
};

/** One block near the top of what a target may be. */
const sprintNearLimit: WorkoutTemplate = {
  id: 'sprint-near-limit-fixture',
  name: 'Sprint near the limit',
  summary: 'One held effort at 2.8 of threshold.',
  category: 'anaerobic',
  warmUp,
  mainSet: {
    scaling: 'fixed',
    blocks: [{ kind: 'steady', seconds: seconds(30), target: share(2.8) }],
  },
  coolDown,
  parameters: { intensityPercent: { minimum: -25, maximum: 10 } },
};

/** A test: ridden as written. */
const fixedTest: WorkoutTemplate = {
  ...sprintNearLimit,
  id: 'fixed-test-fixture',
  name: 'Fixed test',
  category: 'test',
  parameters: { intensityPercent: { minimum: 0, maximum: 0 } },
};

/** The refusal, or a failure saying nothing was refused. */
function refusal(template: WorkoutTemplate, choices: TailorChoices): WorkoutError {
  let result: unknown;
  try {
    result = tailorWorkout(template, choices);
  } catch (error) {
    if (error instanceof WorkoutError) {
      return error;
    }
    throw error;
  }
  throw new Error(`expected a refusal, got a workout: ${JSON.stringify(result)}`);
}

function expectRefused(
  template: WorkoutTemplate,
  choices: TailorChoices,
  code: WorkoutErrorCode,
  message: RegExp,
): void {
  const error = refusal(template, choices);
  expect(error.code).toBe(code);
  expect(error.message).toMatch(message);
}

describe('tailorWorkout: the intensity offset, read through the expanded timeline', () => {
  it('scales every main-set target by 1.1 at +10 % and leaves everything else as it was', () => {
    const before = expandWorkout(tailorWorkout(mixed, {}));
    const after = expandWorkout(tailorWorkout(mixed, { intensityPercent: 10 }));

    expect(after.segments).toHaveLength(before.segments.length);
    const firstMain = warmUp.length;
    const lastMain = warmUp.length + mixedMain.length - 1;
    let scaled = 0;
    for (const [index, segment] of after.segments.entries()) {
      const original = before.segments[index];
      if (original === undefined) {
        throw new Error('segment counts differ');
      }
      expect(segment.startsAt).toBe(original.startsAt);
      expect(segment.endsAt).toBe(original.endsAt);
      expect(segment.hold).toEqual(original.hold);
      const inMain = segment.block >= firstMain && segment.block <= lastMain;
      if (inMain && original.hold === undefined && original.from !== undefined) {
        expect(segment.from).toBeCloseTo(original.from * 1.1, 12);
        expect(segment.to).toBeCloseTo((original.to ?? Number.NaN) * 1.1, 12);
        scaled += 1;
      } else {
        // Warm-up, cool-down, free ride and hold: exactly as written.
        expect(segment.from).toBe(original.from);
        expect(segment.to).toBe(original.to);
      }
    }
    // Steady, ramp and 4 × (hard, easy): ten segments scaled, none missed.
    expect(scaled).toBe(10);
    const hold = after.segments.find((segment) => segment.hold !== undefined);
    expect(hold?.hold?.ceilingShare).toBe(0.8);
    expect(hold?.hold?.startShare).toBe(0.65);
    expect(after.segments.find((segment) => segment.label === 'Sprint')?.from).toBeUndefined();
  });

  it('lowers every main-set target at a negative offset', () => {
    const [, intervals] = tailorWorkout(climb, { intensityPercent: -10 }).blocks;
    expect(intervals).toMatchObject({ kind: 'intervals' });
    if (intervals?.kind !== 'intervals') {
      throw new Error('expected the intervals block');
    }
    expect(intervals.hardTarget).toBeCloseTo(0.855, 12);
    expect(intervals.easyTarget).toBeCloseTo(0.495, 12);
  });

  it('refuses an offset that takes a target over 3.0 of threshold, and returns no workout', () => {
    // 2.8 × 1.1 = 3.08: refused by validateWorkout's own check, never clamped to 3.
    expectRefused(
      sprintNearLimit,
      { intensityPercent: 10 },
      'target-out-of-range',
      /between 0\.2 and 3/,
    );
    // Just inside: 2.8 × 1.07 = 2.996 is a workout.
    const inside = tailorWorkout(sprintNearLimit, { intensityPercent: 7 });
    expect(inside.blocks[1]).toMatchObject({ kind: 'steady' });
  });

  it('refuses an offset outside the template’s bounds, naming the bound', () => {
    expectRefused(
      climb,
      { intensityPercent: 6 },
      'invalid-choice',
      /from −10% to \+5%; you asked for \+6%/,
    );
    expectRefused(
      climb,
      { intensityPercent: -11 },
      'invalid-choice',
      /from −10% to \+5%; you asked for −11%/,
    );
    expect(() => tailorWorkout(climb, { intensityPercent: 5 })).not.toThrow();
    expect(() => tailorWorkout(climb, { intensityPercent: -10 })).not.toThrow();
  });

  it('narrows a template’s wider bounds to the global −25 % to +10 %', () => {
    expect(MINIMUM_INTENSITY_PERCENT).toBe(-25);
    expect(MAXIMUM_INTENSITY_PERCENT).toBe(10);
    expectRefused(sprints, { intensityPercent: 11 }, 'invalid-choice', /from −25% to \+10%/);
    expectRefused(sprints, { intensityPercent: -26 }, 'invalid-choice', /from −25% to \+10%/);
    expect(() => tailorWorkout(sprints, { intensityPercent: 10 })).not.toThrow();
    expect(() => tailorWorkout(sprints, { intensityPercent: -25 })).not.toThrow();
  });

  it('refuses any offset on a template ridden at its written intensity', () => {
    expectRefused(
      fixedTest,
      { intensityPercent: 1 },
      'invalid-choice',
      /cannot be set; you asked for \+1%/,
    );
    expect(tailorWorkout(fixedTest, { intensityPercent: 0 })).toEqual(tailorWorkout(fixedTest, {}));
  });

  it('refuses an offset that is not a number', () => {
    expectRefused(climb, { intensityPercent: Number.NaN }, 'invalid-choice', /you asked for NaN/);
    expectRefused(
      climb,
      { intensityPercent: Number.POSITIVE_INFINITY },
      'invalid-choice',
      /from −10%/,
    );
  });
});

describe('tailorWorkout: the defaults are the template as written', () => {
  it('gives exactly a fixed template’s own blocks, named and described by the template', () => {
    const workout = tailorWorkout(mixed, {});
    expect(workout).toEqual({
      name: 'Mixed fixture',
      description: 'Every kind of block in one main set.',
      blocks: [...warmUp, ...mixedMain, ...coolDown],
    });
  });

  it('writes a steady rep with a recovery as one intervals block at the default count', () => {
    expect(tailorWorkout(climb, {}).blocks).toEqual([
      ...warmUp,
      {
        kind: 'intervals',
        repeats: 2,
        hardSeconds: 1200,
        hardTarget: 0.95,
        easySeconds: 300,
        easyTarget: 0.55,
        label: 'Climb',
      },
      ...coolDown,
    ]);
  });

  it('writes out a repetition of several blocks, once per repeat', () => {
    const { blocks } = tailorWorkout(sprints, {});
    const rep = sprints.mainSet.scaling === 'repeat' ? sprints.mainSet.rep : [];
    expect(blocks).toEqual([
      ...warmUp,
      ...Array.from({ length: 8 }, () => rep).flat(),
      ...coolDown,
    ]);
  });

  it('follows every repetition with the recovery, the last one included', () => {
    // Compacted: warm-up 600, 2 × (1200 + 300), cool-down 600.
    const climbed = expandWorkout(tailorWorkout(climb, {}));
    expect(climbed.totalSeconds).toBe(600 + 2 * 1500 + 600);
    expect(climbed.segments.map((segment) => segment.from)).toEqual([
      0.5, 0.95, 0.55, 0.95, 0.55, 0.5,
    ]);
    // Written out: three of (over, under, recovery).
    const written = expandWorkout(tailorWorkout(overUnders, {}));
    expect(written.totalSeconds).toBe(600 + 3 * (120 + 60 + 300) + 600);
    expect(written.segments.map((segment) => segment.from)).toEqual([
      0.5, 1.05, 0.9, 0.5, 1.05, 0.9, 0.5, 1.05, 0.9, 0.5, 0.5,
    ]);
  });

  it('gives a share back exactly, even one that arithmetic would nudge', () => {
    // (0.2013 × 100) / 100 is not 0.2013 in floating point: no choice of
    // intensity must mean no arithmetic on a target at all.
    const oddBlock: WorkoutBlock = { kind: 'steady', seconds: seconds(600), target: share(0.2013) };
    const odd: WorkoutTemplate = { ...mixed, mainSet: { scaling: 'fixed', blocks: [oddBlock] } };
    expect(tailorWorkout(odd, {}).blocks[1]).toEqual(oddBlock);
    expect(tailorWorkout(odd, { intensityPercent: 0 })).toEqual(tailorWorkout(odd, {}));
  });
});

describe('tailorWorkout: repeats and recovery', () => {
  it('rides the number of repeats chosen', () => {
    const [, intervals] = tailorWorkout(climb, { repeats: 3 }).blocks;
    expect(intervals).toMatchObject({ kind: 'intervals', repeats: 3, hardSeconds: 1200 });
    expect(tailorWorkout(sprints, { repeats: 10 }).blocks).toHaveLength(
      warmUp.length + 20 + coolDown.length,
    );
  });

  it('refuses a repeat count past MAXIMUM_REPEATS even when the template allows more', () => {
    expectRefused(sprints, { repeats: MAXIMUM_REPEATS + 1 }, 'invalid-choice', /1 to 100 repeats/);
    expect(() => tailorWorkout(sprints, { repeats: MAXIMUM_REPEATS })).not.toThrow();
    // A template floor under one is raised to one.
    expectRefused(sprints, { repeats: 0 }, 'invalid-choice', /1 to 100 repeats/);
  });

  it('refuses a repeat count outside the template’s own bounds, or not a whole number', () => {
    expectRefused(climb, { repeats: 5 }, 'invalid-choice', /1 to 4 repeats/);
    expectRefused(lockedRecovery, { repeats: 2 }, 'invalid-choice', /3 to 8 repeats/);
    expectRefused(climb, { repeats: 2.5 }, 'invalid-choice', /you asked for 2\.5/);
    expect(() => tailorWorkout(climb, { repeats: 4 })).not.toThrow();
    expect(() => tailorWorkout(lockedRecovery, { repeats: 3 })).not.toThrow();
  });

  it('refuses repeats on a template that has none, rather than ignoring them', () => {
    expectRefused(mixed, { repeats: 3 }, 'invalid-choice', /no repeat count/);
  });

  it('rides the recovery length chosen, inside the template’s bounds', () => {
    const [, intervals] = tailorWorkout(climb, { recoverySeconds: 400 }).blocks;
    expect(intervals).toMatchObject({ kind: 'intervals', easySeconds: 400, easyTarget: 0.55 });
    expect(() => tailorWorkout(climb, { recoverySeconds: 120 })).not.toThrow();
    expect(() => tailorWorkout(climb, { recoverySeconds: 600 })).not.toThrow();
    expectRefused(
      climb,
      { recoverySeconds: 601 },
      'invalid-choice',
      /120 to 600 seconds; you asked for 601/,
    );
    expectRefused(climb, { recoverySeconds: 119 }, 'invalid-choice', /120 to 600 seconds/);
    expectRefused(climb, { recoverySeconds: Number.NaN }, 'invalid-choice', /120 to 600 seconds/);
  });

  it('refuses a recovery choice where the template has none to change', () => {
    expectRefused(mixed, { recoverySeconds: 300 }, 'invalid-choice', /no recovery between repeats/);
    expectRefused(sprints, { recoverySeconds: 300 }, 'invalid-choice', /does not let its recovery/);
    expectRefused(
      lockedRecovery,
      { recoverySeconds: 120 },
      'invalid-choice',
      /does not let its recovery/,
    );
  });
});

describe('a tailored workout is an ordinary workout file', () => {
  it.each([
    ['a workout with no hold', climb, { intensityPercent: 5, repeats: 3, recoverySeconds: 240 }, 1],
    ['a workout with a hold', mixed, { intensityPercent: -25 }, 2],
  ] as const)(
    'round-trips %s through format.ts at the lowest version',
    (_, template, choices, version) => {
      const tailored = tailorWorkout(template, choices);
      const text = encodeWorkoutFile(tailored);
      expect((JSON.parse(text) as { onYourLeftWorkout: number }).onYourLeftWorkout).toBe(version);
      expect(decodeWorkoutFile(text)).toEqual(tailored);
    },
  );
});
