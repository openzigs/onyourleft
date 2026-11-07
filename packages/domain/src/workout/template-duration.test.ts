// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import { seconds } from '../quantities';

import { WorkoutError } from './errors';
import { BUILT_IN_WORKOUTS } from './library';
import {
  LENGTH_TOLERANCE_SECONDS,
  LENGTH_TOLERANCE_SHARE,
  MINIMUM_COOL_DOWN_SECONDS,
  MINIMUM_WARM_UP_SECONDS,
  tailorWorkout,
  TEMPLATE_LENGTHS_MINUTES,
  type TailorChoices,
  type TemplateBlock,
  type WorkoutTemplate,
} from './template';
import { expandWorkout, type WorkoutTimeline } from './timeline';
import { thresholdShare, type ThresholdShare, type Workout } from './workout';

const share = thresholdShare;

const intensity = { intensityPercent: { minimum: -25, maximum: 10 } };

/** 5 × 3 min hard, 3 min easy: 50 minutes as written. */
const vo2: WorkoutTemplate = {
  id: 'vo2-fixture',
  name: 'VO2 fixture',
  summary: 'Three-minute efforts above threshold.',
  category: 'vo2',
  warmUp: [{ kind: 'ramp', seconds: seconds(600), from: share(0.5), to: share(0.75) }],
  mainSet: {
    scaling: 'repeat',
    rep: [{ kind: 'steady', seconds: seconds(180), target: share(1.2), label: 'Hard' }],
    repeats: { minimum: 3, maximum: 12, default: 5 },
    recovery: {
      block: { kind: 'steady', seconds: seconds(180), target: share(0.5) },
      seconds: { minimum: 120, maximum: 300 },
    },
  },
  coolDown: [{ kind: 'steady', seconds: seconds(600), target: share(0.5) }],
  parameters: intensity,
};

/** 2 × 20 min with 5 min easy, and a 15-minute warm-up: 75 minutes as written. */
const threshold: WorkoutTemplate = {
  id: 'threshold-fixture',
  name: 'Threshold fixture',
  summary: 'Two long efforts just under threshold.',
  category: 'threshold',
  warmUp: [
    { kind: 'ramp', seconds: seconds(600), from: share(0.5), to: share(0.75) },
    { kind: 'steady', seconds: seconds(300), target: share(0.75) },
  ],
  mainSet: {
    scaling: 'repeat',
    rep: [{ kind: 'steady', seconds: seconds(1200), target: share(0.95) }],
    repeats: { minimum: 1, maximum: 3, default: 2 },
    recovery: { block: { kind: 'steady', seconds: seconds(300), target: share(0.55) } },
  },
  coolDown: [{ kind: 'steady', seconds: seconds(600), target: share(0.5) }],
  parameters: intensity,
};

/** One or two 30-minute efforts and nothing between: 50 or 80 minutes, little else. */
const longEfforts: WorkoutTemplate = {
  id: 'long-efforts-fixture',
  name: 'Long efforts fixture',
  summary: 'Half-hour efforts at tempo.',
  category: 'tempo',
  warmUp: [{ kind: 'steady', seconds: seconds(600), target: share(0.6) }],
  mainSet: {
    scaling: 'repeat',
    rep: [{ kind: 'steady', seconds: seconds(1800), target: share(0.85) }],
    repeats: { minimum: 1, maximum: 2, default: 1 },
  },
  coolDown: [{ kind: 'steady', seconds: seconds(600), target: share(0.5) }],
  parameters: intensity,
};

/** Released sprints with easy spinning: a repetition of two blocks, no recovery. */
const sprints: WorkoutTemplate = {
  id: 'sprints-fixture',
  name: 'Sprints fixture',
  summary: 'Short released sprints.',
  category: 'sprint',
  warmUp: [{ kind: 'ramp', seconds: seconds(600), from: share(0.5), to: share(0.75) }],
  mainSet: {
    scaling: 'repeat',
    rep: [
      { kind: 'free-ride', seconds: seconds(15), label: 'Sprint' },
      { kind: 'steady', seconds: seconds(285), target: share(0.55) },
    ],
    repeats: { minimum: 4, maximum: 20, default: 8 },
  },
  coolDown: [{ kind: 'steady', seconds: seconds(600), target: share(0.5) }],
  parameters: intensity,
};

/** Endurance with a tempo lift in the middle: 65 minutes as written. */
const endurance: WorkoutTemplate = {
  id: 'endurance-fixture',
  name: 'Endurance fixture',
  summary: 'Long and steady, with a lift in the middle.',
  category: 'endurance',
  warmUp: [{ kind: 'ramp', seconds: seconds(600), from: share(0.45), to: share(0.65) }],
  mainSet: {
    scaling: 'stretch',
    blocks: [
      { kind: 'steady', seconds: seconds(1200), target: share(0.65) },
      { kind: 'steady', seconds: seconds(600), target: share(0.75), label: 'Lift' },
      { kind: 'steady', seconds: seconds(1200), target: share(0.65) },
    ],
    stretch: { minimum: 0.4, maximum: 2 },
  },
  coolDown: [{ kind: 'steady', seconds: seconds(300), target: share(0.5) }],
  parameters: intensity,
};

/** Tempo that may stretch only a little: 36 to 57 minutes, and nothing outside. */
const tempo: WorkoutTemplate = {
  id: 'tempo-fixture',
  name: 'Tempo fixture',
  summary: 'Two tempo blocks with an easy spell.',
  category: 'tempo',
  warmUp: [{ kind: 'steady', seconds: seconds(600), target: share(0.6) }],
  mainSet: {
    scaling: 'stretch',
    blocks: [
      { kind: 'steady', seconds: seconds(900), target: share(0.85) },
      { kind: 'steady', seconds: seconds(300), target: share(0.55) },
      { kind: 'steady', seconds: seconds(900), target: share(0.85) },
    ],
    stretch: { minimum: 0.8, maximum: 1.2 },
  },
  coolDown: [{ kind: 'steady', seconds: seconds(300), target: share(0.5) }],
  parameters: intensity,
};

/** A test: its length is part of what it measures. */
const rampTest: WorkoutTemplate = {
  id: 'ramp-test-fixture',
  name: 'Ramp test fixture',
  summary: 'One-minute steps until you stop.',
  category: 'test',
  warmUp: [{ kind: 'steady', seconds: seconds(300), target: share(0.5) }],
  mainSet: {
    scaling: 'fixed',
    blocks: [{ kind: 'ramp', seconds: seconds(1200), from: share(0.5), to: share(1.7) }],
  },
  coolDown: [{ kind: 'steady', seconds: seconds(300), target: share(0.4) }],
  parameters: { intensityPercent: { minimum: 0, maximum: 0 } },
};

/**
 * The templates the duration rule is proven on: the shipped library
 * (`BUILT_IN_WORKOUTS`, #2300), so that a template added to it is enumerated
 * here and cannot be added untested, and these fixtures, which cover each
 * strategy at its edges — a test ridden as written among them.
 */
const LIBRARY: readonly WorkoutTemplate[] = [
  vo2,
  threshold,
  longEfforts,
  sprints,
  endurance,
  tempo,
  rampTest,
  ...BUILT_IN_WORKOUTS,
];

function tolerance(minutes: number): number {
  return Math.max(minutes * 60 * LENGTH_TOLERANCE_SHARE, LENGTH_TOLERANCE_SECONDS);
}

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

/** The segments of the main set, by block index. */
function mainSegments(template: WorkoutTemplate, timeline: WorkoutTimeline) {
  const first = template.warmUp.length;
  const last = timeline.workout.blocks.length - template.coolDown.length;
  return timeline.segments.filter((segment) => segment.block >= first && segment.block < last);
}

function partSeconds(timeline: WorkoutTimeline, blocks: readonly number[]): number {
  return timeline.segments
    .filter((segment) => blocks.includes(segment.block))
    .reduce((total, segment) => total + segment.endsAt - segment.startsAt, 0);
}

/** How much of the main set is easy riding (a target under 0.6), as a share of it. */
function recoveryShare(template: WorkoutTemplate, timeline: WorkoutTimeline): number {
  let easy = 0;
  let all = 0;
  for (const segment of mainSegments(template, timeline)) {
    const length = segment.endsAt - segment.startsAt;
    all += length;
    if (segment.from !== undefined && segment.from < 0.6) {
      easy += length;
    }
  }
  return easy / all;
}

const indexes = (from: number, count: number): number[] =>
  Array.from({ length: count }, (_, offset) => from + offset);

describe('tailorWorkout to a length: every template, every length', () => {
  for (const template of LIBRARY) {
    it(`${template.id}: inside tolerance, or refused with lengths it can make`, () => {
      const written = expandWorkout(tailorWorkout(template, {}));
      let made = 0;
      for (const minutes of TEMPLATE_LENGTHS_MINUTES) {
        let workout: Workout;
        try {
          workout = tailorWorkout(template, { targetMinutes: minutes });
        } catch (error) {
          expect(error).toBeInstanceOf(WorkoutError);
          const { code, message } = error as WorkoutError;
          expect(code).toBe('invalid-choice');
          if (template.mainSet.scaling === 'fixed') {
            expect(message).toMatch(/its length cannot be chosen/);
            continue;
          }
          // Every length the refusal names is one the template can make.
          const named = [...message.matchAll(/(\d+)(?= (?:or|to) |\s+minutes)/g)]
            .map((match) => Number(match[1]))
            .filter((value) => value !== minutes);
          expect(named.length).toBeGreaterThan(0);
          for (const length of named) {
            expect(() => tailorWorkout(template, { targetMinutes: length })).not.toThrow();
          }
          continue;
        }
        made += 1;
        const timeline = expandWorkout(workout);
        expect(Math.abs(timeline.totalSeconds - minutes * 60)).toBeLessThanOrEqual(
          tolerance(minutes),
        );
        // The shape: same block kinds in the frame, and the same balance of
        // work and recovery in the main set, within ±10 %.
        expect(workout.blocks.slice(0, template.warmUp.length).map((b) => b.kind)).toEqual(
          template.warmUp.map((b) => b.kind),
        );
        expect(workout.blocks.slice(-template.coolDown.length).map((b) => b.kind)).toEqual(
          template.coolDown.map((b) => b.kind),
        );
        const before = recoveryShare(template, written);
        const after = recoveryShare(template, timeline);
        expect(Math.abs(after - before)).toBeLessThanOrEqual(before * 0.1);
      }
      if (template.mainSet.scaling === 'fixed') {
        expect(made).toBe(0);
      } else {
        expect(made).toBeGreaterThan(0);
      }
    });
  }
});

describe('a repeat main set changes only its repeat count', () => {
  it('rides 7 of the same rep at 60 minutes, every target and rep length as written', () => {
    const timeline = expandWorkout(tailorWorkout(vo2, { targetMinutes: 60 }));
    expect(timeline.totalSeconds).toBe(600 + 7 * 360 + 600);
    const main = mainSegments(vo2, timeline);
    expect(main).toHaveLength(14);
    for (const [index, segment] of main.entries()) {
      expect(segment.endsAt - segment.startsAt).toBe(180);
      expect(segment.from).toBe(index % 2 === 0 ? 1.2 : 0.5);
    }
    // The frame is as written: the length was met without touching it.
    expect(tailorWorkout(vo2, { targetMinutes: 60 }).blocks[0]).toEqual(vo2.warmUp[0]);
  });

  it('chooses the count with the recovery the rider chose', () => {
    // 600 + n × (180 + 120) + 600 nearest 60 minutes: n = 8.
    const [, intervals] = tailorWorkout(vo2, { targetMinutes: 60, recoverySeconds: 120 }).blocks;
    expect(intervals).toMatchObject({ kind: 'intervals', repeats: 8, easySeconds: 120 });
  });

  it('refuses a length and a repeat count together', () => {
    const error = refusal(vo2, { targetMinutes: 60, repeats: 5 });
    expect(error.code).toBe('invalid-choice');
    expect(error.message).toMatch(/a length or a number of repeats/);
  });

  it('names the nearest lengths on either side when neither is close enough', () => {
    expect(refusal(longEfforts, { targetMinutes: 60 }).message).toBe(
      '"Long efforts fixture" can be 50 or 68 minutes long; you asked for 60 minutes.',
    );
    expect(refusal(longEfforts, { targetMinutes: 30 }).message).toBe(
      '"Long efforts fixture" can be no shorter than 38 minutes; you asked for 30 minutes.',
    );
    expect(refusal(vo2, { targetMinutes: 200 }).message).toBe(
      '"VO2 fixture" can be no longer than 92 minutes; you asked for 200 minutes.',
    );
  });
});

describe('a stretch main set changes only the length of its blocks', () => {
  it('stretches every block by one factor, keeping the targets and the number of blocks', () => {
    const workout = tailorWorkout(endurance, { targetMinutes: 90 });
    // (5400 − 900) / 3000 = 1.5.
    expect(workout.blocks).toEqual([
      ...endurance.warmUp,
      { kind: 'steady', seconds: 1800, target: 0.65 },
      { kind: 'steady', seconds: 900, target: 0.75, label: 'Lift' },
      { kind: 'steady', seconds: 1800, target: 0.65 },
      ...endurance.coolDown,
    ]);
  });

  it('stretches an intervals block’s hard and easy lengths alike', () => {
    const set: WorkoutTemplate = {
      ...endurance,
      mainSet: {
        scaling: 'stretch',
        blocks: [
          {
            kind: 'intervals',
            repeats: 3,
            hardSeconds: seconds(600),
            hardTarget: share(0.8),
            easySeconds: seconds(400),
            easyTarget: share(0.6),
          },
        ],
        stretch: { minimum: 0.5, maximum: 2 },
      },
    };
    // (3900 − 900) / 3000 = 1.
    expect(tailorWorkout(set, { targetMinutes: 65 }).blocks[1]).toMatchObject({
      hardSeconds: 600,
      easySeconds: 400,
    });
    // (5400 − 900) / 3000 = 1.5.
    expect(tailorWorkout(set, { targetMinutes: 90 }).blocks[1]).toMatchObject({
      repeats: 3,
      hardSeconds: 900,
      easySeconds: 600,
    });
  });

  it('never stretches past the template’s maximum, and says how long it can be', () => {
    expect(refusal(tempo, { targetMinutes: 90 }).message).toBe(
      '"Tempo fixture" can be 36 to 57 minutes long; you asked for 90 minutes.',
    );
    expect(refusal(tempo, { targetMinutes: 30 }).message).toMatch(/can be 36 to 57 minutes long/);
    const longest = tailorWorkout(tempo, { targetMinutes: 57 });
    expect(longest.blocks[1]).toMatchObject({ seconds: 1080 });
  });

  it('refuses repeat and recovery choices, which it has none of', () => {
    expect(refusal(endurance, { repeats: 3 }).message).toMatch(/no repeat count/);
    expect(refusal(endurance, { recoverySeconds: 60 }).message).toMatch(/no recovery/);
    expect(tailorWorkout(endurance, {}).blocks).toEqual([
      ...endurance.warmUp,
      ...(endurance.mainSet.scaling === 'stretch' ? endurance.mainSet.blocks : []),
      ...endurance.coolDown,
    ]);
  });
});

describe('a fixed main set refuses a length', () => {
  it.each([...TEMPLATE_LENGTHS_MINUTES, 25])('refuses %d minutes', (minutes) => {
    const error = refusal(rampTest, { targetMinutes: minutes });
    expect(error.code).toBe('invalid-choice');
    expect(error.message).toBe(
      '"Ramp test fixture" is ridden as written, so its length cannot be chosen.',
    );
  });
});

describe('a length that is not a length', () => {
  it.each([0, -30, Number.NaN, Number.POSITIVE_INFINITY])('refuses %d minutes', (minutes) => {
    const error = refusal(endurance, { targetMinutes: minutes });
    expect(error.code).toBe('invalid-choice');
    expect(error.message).toMatch(/a number of minutes above zero/);
  });
});

describe('the warm-up and cool-down at a short length', () => {
  it.each([vo2, threshold, endurance])(
    '$id at 30 minutes keeps both, each no shorter than its floor',
    (template) => {
      const workout = tailorWorkout(template, { targetMinutes: 30 });
      const timeline = expandWorkout(workout);
      const warmUp = partSeconds(timeline, indexes(0, template.warmUp.length));
      const coolDown = partSeconds(
        timeline,
        indexes(workout.blocks.length - template.coolDown.length, template.coolDown.length),
      );
      expect(warmUp).toBeGreaterThanOrEqual(MINIMUM_WARM_UP_SECONDS);
      expect(coolDown).toBeGreaterThanOrEqual(MINIMUM_COOL_DOWN_SECONDS);
      expect(workout.blocks).toHaveLength(
        template.warmUp.length + mainSegmentsBlocks(template, workout) + template.coolDown.length,
      );
      // It was shortened: as written it would not fit.
      expect(warmUp + coolDown).toBeLessThan(
        expandWorkout({ name: 'frame', blocks: [...template.warmUp, ...template.coolDown] })
          .totalSeconds,
      );
    },
  );

  it('shares the shortening between the two, in proportion to what each may lose', () => {
    // VO2 at 30: 3 repeats (1080 s) with the 1200 s frame is 2280 s, 480 s
    // over. The warm-up may lose 300 s and the cool-down 420 s, so they lose
    // 200 s and 280 s of it.
    const timeline = expandWorkout(tailorWorkout(vo2, { targetMinutes: 30 }));
    expect(timeline.totalSeconds).toBe(1800);
    expect(timeline.segments[0]?.endsAt).toBe(400);
    const last = timeline.segments.at(-1);
    expect((last?.endsAt ?? 0) - (last?.startsAt ?? 0)).toBe(320);
  });

  it('keeps its own length when the main set alone can meet the length', () => {
    const workout = tailorWorkout(vo2, { targetMinutes: 90 });
    expect(workout.blocks[0]).toEqual(vo2.warmUp[0]);
    expect(workout.blocks.at(-1)).toEqual(vo2.coolDown[0]);
  });

  it('honours a floor the template declares', () => {
    const template: WorkoutTemplate = {
      ...vo2,
      warmUpFloorSeconds: 480,
      coolDownFloorSeconds: 400,
    };
    const timeline = expandWorkout(tailorWorkout(template, { targetMinutes: 30 }));
    expect(timeline.segments[0]?.endsAt).toBeGreaterThanOrEqual(480);
    const last = timeline.segments.at(-1);
    expect((last?.endsAt ?? 0) - (last?.startsAt ?? 0)).toBeGreaterThanOrEqual(400);
  });

  it('refuses by length, not by a broken block, when the frame is already at its floors', () => {
    const tight: WorkoutTemplate = {
      ...longEfforts,
      warmUp: [{ kind: 'steady', seconds: seconds(MINIMUM_WARM_UP_SECONDS), target: share(0.6) }],
      coolDown: [
        { kind: 'steady', seconds: seconds(MINIMUM_COOL_DOWN_SECONDS), target: share(0.5) },
      ],
    };
    const error = refusal(tight, { targetMinutes: 30 });
    expect(error.code).toBe('invalid-choice');
    expect(error.message).toMatch(/can be no shorter than 38 minutes/);
  });

  it('never lengthens a warm-up already shorter than its floor', () => {
    // 25 minutes: 3 repeats run 300 s over, and only the cool-down may lose any.
    const short: WorkoutTemplate = {
      ...vo2,
      warmUp: [{ kind: 'steady', seconds: seconds(120), target: share(0.6) }],
    };
    const workout = tailorWorkout(short, { targetMinutes: 25 });
    expect(workout.blocks[0]).toEqual(short.warmUp[0]);
    expect(expandWorkout(workout).totalSeconds).toBe(1500);
  });

  it('keeps the frame as written when the overshoot is inside tolerance', () => {
    // Tempo at 40: the shortest stretch gives 43 minutes, 3 over, which is
    // inside tolerance, so nothing is shortened to make it exact.
    const workout = tailorWorkout(tempo, { targetMinutes: 40 });
    expect(expandWorkout(workout).totalSeconds).toBe(2580);
    expect(workout.blocks[0]).toEqual(tempo.warmUp[0]);
    expect(workout.blocks.at(-1)).toEqual(tempo.coolDown[0]);
  });
});

/** How many blocks the main set wrote, read from the workout itself. */
function mainSegmentsBlocks(template: WorkoutTemplate, workout: Workout): number {
  return workout.blocks.length - template.warmUp.length - template.coolDown.length;
}

describe('length and intensity compose', () => {
  /** A share offset the way a rider's intensity is: (share × (100 + p)) / 100. */
  const offset = (value: ThresholdShare, percent: number): ThresholdShare =>
    ((value * (100 + percent)) / 100) as ThresholdShare;

  function offsetBlock(block: TemplateBlock, percent: number): TemplateBlock {
    switch (block.kind) {
      case 'steady':
        return { ...block, target: offset(block.target, percent) };
      case 'ramp':
        return { ...block, from: offset(block.from, percent), to: offset(block.to, percent) };
      case 'intervals':
        return {
          ...block,
          hardTarget: offset(block.hardTarget, percent),
          easyTarget: offset(block.easyTarget, percent),
        };
      default:
        return block;
    }
  }

  /** The template with its main set's targets already offset. */
  function offsetTemplate(template: WorkoutTemplate, percent: number): WorkoutTemplate {
    const set = template.mainSet;
    if (set.scaling !== 'repeat') {
      return {
        ...template,
        mainSet: { ...set, blocks: set.blocks.map((b) => offsetBlock(b, percent)) },
      };
    }
    return {
      ...template,
      mainSet: {
        ...set,
        rep: set.rep.map((b) => offsetBlock(b, percent)),
        ...(set.recovery === undefined
          ? {}
          : {
              recovery: {
                ...set.recovery,
                block: offsetBlock(set.recovery.block, percent) as typeof set.recovery.block,
              },
            }),
      },
    };
  }

  it.each([endurance, vo2, sprints])(
    '$id at 45 minutes and −5 %: scaling then offsetting, in either order',
    (template) => {
      const both = tailorWorkout(template, { targetMinutes: 45, intensityPercent: -5 });
      // Offset first, then scale.
      expect(tailorWorkout(offsetTemplate(template, -5), { targetMinutes: 45 })).toEqual(both);
      // Scale first, then offset the main set.
      const scaled = tailorWorkout(template, { targetMinutes: 45 });
      const first = template.warmUp.length;
      const last = scaled.blocks.length - template.coolDown.length;
      expect({
        ...scaled,
        blocks: scaled.blocks.map((block, index) =>
          index >= first && index < last ? offsetBlock(block, -5) : block,
        ),
      }).toEqual(both);
      expect(both).not.toEqual(scaled);
    },
  );
});
