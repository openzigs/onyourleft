// SPDX-License-Identifier: Apache-2.0

/**
 * The catalogue gates — #2300. Every built-in workout passes every one of
 * them, and each runs over `BUILT_IN_WORKOUTS` by enumeration rather than by
 * name, so a template added to the library cannot be added unchecked.
 */

import { describe, expect, it } from 'vitest';

import {
  HEART_RATE_ZONE_LOWER_FRACTIONS,
  POWER_ZONE_LOWER_FRACTIONS,
  SWEET_SPOT_FRACTIONS,
} from '../../analysis/zones';
import { workoutBlockText, workoutShapeText } from '../describe';
import { WorkoutError } from '../errors';
import {
  LENGTH_TOLERANCE_SECONDS,
  LENGTH_TOLERANCE_SHARE,
  MAXIMUM_INTENSITY_PERCENT,
  MINIMUM_INTENSITY_PERCENT,
  tailorWorkout,
  TEMPLATE_LENGTHS_MINUTES,
  type HeartRateZoneHoldBlock,
  type TailorChoices,
  type TemplateBlock,
  type WorkoutCategory,
  type WorkoutTemplate,
} from '../template';
import { expandWorkout } from '../timeline';
import { MAXIMUM_HOLD_CEILING_SHARE, validateWorkout, type Workout } from '../workout';

import { BUILT_IN_WORKOUTS } from '.';

/** How many templates each category must hold, at least: #2300's and #2301's tables. */
const MINIMUM_COUNTS: Partial<Record<WorkoutCategory, number>> = {
  recovery: 3,
  endurance: 6,
  tempo: 5,
  'sweet-spot': 6,
  threshold: 6,
  'over-under': 4,
  vo2: 6,
  anaerobic: 4,
  sprint: 4,
  pyramid: 3,
  'race-simulation': 3,
};

/**
 * Every id the library has shipped. An id is how a link, a browse history or
 * a later screen finds a template, so one renamed or removed turns this red,
 * and the change has to be made here, on purpose.
 */
const KNOWN_IDS: readonly string[] = [
  'recovery-easy-spin',
  'recovery-spin-ups',
  'recovery-free-finish',
  'endurance-steady-hour',
  'endurance-long',
  'endurance-ninety',
  'endurance-gentle-surges',
  'endurance-heart-rate',
  'endurance-heart-rate-low',
  'tempo-2x20',
  'tempo-3x15',
  'tempo-2x25',
  'tempo-long-steady',
  'tempo-rising-steps',
  'sweet-spot-3x12',
  'sweet-spot-2x20',
  'sweet-spot-4x10',
  'sweet-spot-3x15',
  'sweet-spot-rising',
  'sweet-spot-long-block',
  'threshold-2x20',
  'threshold-3x12',
  'threshold-4x8',
  'threshold-5x6',
  'threshold-3x15',
  'threshold-1x30',
  'over-under-3x3',
  'over-under-3x4',
  'over-under-two-minute-overs',
  'over-under-three-minute-overs',
  'vo2-5x3',
  'vo2-5x4',
  'vo2-4x5',
  'vo2-30-30',
  'vo2-30-15',
  'vo2-40-20',
  'anaerobic-8x1',
  'anaerobic-6x1-hard',
  'anaerobic-10x1',
  'anaerobic-8x30',
  'sprint-6x15',
  'sprint-8x10',
  'sprint-10x20',
  'sprint-endurance-base',
  'pyramid-1-to-4',
  'pyramid-ascending',
  'pyramid-1-to-3',
  'race-simulation-tempo-surges',
  'race-simulation-time-trial',
  'race-simulation-criterium',
];

/** A threshold heart rate to resolve zone holds with: a typical one. */
const THRESHOLD_HEART_RATE = 170;

// --- The banned names: spike 0038 §3 -----------------------------------------

/**
 * The load-metric marks and two wording rules, matched as **upper-case whole
 * words**: a case-insensitive `IF` would match the English "if" (§3.1). `FTP`
 * is the project's wording rule (it says *threshold power*), and `MPA` is ADR
 * 0048 D-12's.
 */
const UPPER_CASE_WORDS: readonly string[] = ['NP', 'TSS', 'IF', 'CTL', 'ATL', 'TSB', 'FTP', 'MPA'];

/**
 * Coinages, matched by **containment**, ignoring case: §3.1's long forms, §3.2's
 * products, programmes and features, and ADR 0048 D-12's banned wording (ADR
 * 0030's 2026-10-09 amendment), which applies to every workout string.
 */
const CONTAINED: readonly string[] = [
  // §3.1, the long forms of the marks.
  'Normalized Power',
  'Normalised Power',
  'Training Stress Score',
  'Intensity Factor',
  // §3.2, products.
  'Zwift',
  'TrainerRoad',
  'Wahoo',
  'SYSTM',
  'Sufferfest',
  'TrainerDay',
  'ErgDB',
  'TrainingPeaks',
  'intervals.icu',
  'GoldenCheetah',
  // §3.2, programmes, features and titles distinctive enough to contain.
  '4DP',
  'Four-Dimensional Power',
  'Half Monty',
  'ISLAGIATT',
  'Collywobbles',
  'Coach Jack',
  'Pettit',
  'Lamarck',
  'Spanish Needle',
  'Mount Field',
  'Sweet Spot Base',
  'The Mayfield',
  "Jon's Mix",
  'The Gorby',
  'Devedeset',
  'ODZwifters',
  'Adaptive Training',
  'TrainNow',
  'Progression Levels',
  'Workout Levels',
  'SMART workouts',
  'Maximum Power Available',
  'ActivePulse',
  'HR+',
  '80/20',
  // ADR 0048 D-12: never in a workout string.
  'cardiac',
  'heart condition',
  'rehabilitation',
  'patient',
  'therapy',
  'safe heart rate',
  'protects your heart',
  'medical',
  'clinical',
];

/**
 * Descriptive titles, matched against the **whole name**, without case, spaces
 * or punctuation (§3.3): banning them by containment would ban the training
 * vocabulary the library is written in.
 */
const WHOLE_NAMES: readonly string[] = [
  'Downward Spiral',
  'Fight Club',
  'Revolver',
  'Angels',
  'The Hunted',
  'Local Hero',
  'A Very Dark Place',
  'Hell Hath No Fury',
  'Extra Shot',
  'The Long Scream',
  'There Is No Try',
  'The Wretched',
  'Blender',
  'Rubber Glove',
  'Violator',
  'SST (Short)',
  'SST (Med)',
  '6x2 VO2 Max',
  'Over - Unders',
  "The Famous 40/20's",
  'Get It Done',
  'Aerobic Builds',
  'Less Than 60 Minutes to Burn',
  'The Long Haul',
  'Ride On for World Bicycle Relief',
  'Classic Training Zones',
  '4DP-Style Workouts',
  'SYSTM Style',
  '80/20 Polarized',
  'Pyramidal',
  'Hour of Power',
];

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Every banned term in a template's name or summary; empty when it is clear. */
function bannedTermsIn(template: Pick<WorkoutTemplate, 'name' | 'summary'>): string[] {
  const found: string[] = [];
  for (const text of [template.name, template.summary]) {
    for (const word of UPPER_CASE_WORDS) {
      if (new RegExp(`(?<![A-Za-z0-9])${escaped(word)}(?![A-Za-z0-9])`).test(text)) {
        found.push(word);
      }
    }
    for (const term of CONTAINED) {
      if (text.toLowerCase().includes(term.toLowerCase())) {
        found.push(term);
      }
    }
  }
  for (const title of WHOLE_NAMES) {
    if (bare(template.name) === bare(title)) {
      found.push(title);
    }
  }
  return found;
}

// --- The category bands ------------------------------------------------------

/** A range of shares of threshold power, lower bound inclusive. */
interface Band {
  readonly lower: number;
  /** Exclusive, like a zone's, unless {@link upperInclusive}. */
  readonly upper: number;
  readonly upperInclusive?: boolean;
}

/** Zone `n`'s lower bound (1-based), read from the zone table. */
function zone(n: number): number {
  const lower = POWER_ZONE_LOWER_FRACTIONS[n - 1];
  if (lower === undefined) {
    throw new Error(`there is no power zone ${String(n)}`);
  }
  return lower;
}

/**
 * Where each category's working targets lie, from `POWER_ZONE_LOWER_FRACTIONS`
 * and the one named band beside it, `SWEET_SPOT_FRACTIONS` (spike 0038 §5.2):
 * no literal here is a new boundary.
 */
const BANDS: Partial<Record<WorkoutCategory, Band>> = {
  recovery: { lower: zone(1), upper: zone(2) },
  endurance: { lower: zone(2), upper: zone(3) },
  tempo: { lower: zone(3), upper: zone(4) },
  'sweet-spot': { ...SWEET_SPOT_FRACTIONS, upperInclusive: true },
  threshold: { lower: zone(4), upper: zone(5) },
  'over-under': { lower: zone(4), upper: zone(6) },
  // #2301 asks for 1.06–1.30. 1.30 is not a boundary in the table, and a
  // short-short set at 1.20–1.30 crosses into Anaerobic at 1.21, so the band
  // is VO₂ and Anaerobic together: the nearest the table comes.
  vo2: { lower: zone(5), upper: zone(7) },
  anaerobic: { lower: zone(6), upper: zone(7) },
  // Every sprint is a free ride (ruling 6), so a sprint's held targets are
  // only the easy spinning between, which `workTargets` leaves out; this band
  // is what an ERG-held sprint would have to be in.
  sprint: { lower: zone(7), upper: Infinity },
  pyramid: { lower: zone(4), upper: zone(7) },
  'race-simulation': { lower: zone(3), upper: zone(7) },
};

function inBand(value: number, band: Band): boolean {
  return (
    value >= band.lower &&
    (value < band.upper || (band.upperInclusive === true && value === band.upper))
  );
}

/** Every power target a block may ask for. A free ride asks for none. */
function targetsOf(block: TemplateBlock): number[] {
  switch (block.kind) {
    case 'steady':
      return [block.target];
    case 'ramp':
      return [block.from, block.to];
    case 'intervals':
      return [block.hardTarget, block.easyTarget];
    case 'free-ride':
      return [];
    case 'heart-rate-hold':
    case 'heart-rate-zone-hold':
      // The hold may move the target anywhere up to its ceiling.
      return [block.startShare, block.ceilingShare];
    default: {
      const unhandled: never = block;
      throw new Error(`unreachable: ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The main set's blocks: a repeating set's repetition, without the recovery
 * after it, or every block of a set ridden through.
 */
function workBlocks(template: WorkoutTemplate): readonly TemplateBlock[] {
  const set = template.mainSet;
  return set.scaling === 'repeat' ? set.rep : set.blocks;
}

/**
 * The main set's working targets.
 *
 * For a category whose band starts at Tempo or above, a target below Tempo's
 * lower bound is **easy riding between the work** — the easy half of a
 * 30/30, the spinning between sprints — and not work, so it is left out; a
 * Tempo-or-harder target is work and must be in the band, so a threshold set
 * with a block at 0.85 still fails. For recovery and endurance, every target
 * is work. The line is the zone table's, not a new number.
 */
function workTargets(template: WorkoutTemplate, band: Band): number[] {
  const all = workBlocks(template).flatMap(targetsOf);
  return band.lower >= zone(3) ? all.filter((target) => target >= zone(3)) : all;
}

/** The zone holds a template's main set carries. */
function zoneHolds(template: WorkoutTemplate): HeartRateZoneHoldBlock[] {
  return workBlocks(template).filter(
    (block): block is HeartRateZoneHoldBlock => block.kind === 'heart-rate-zone-hold',
  );
}

// --- Helpers -----------------------------------------------------------------

function tolerance(minutes: number): number {
  return Math.max(minutes * 60 * LENGTH_TOLERANCE_SHARE, LENGTH_TOLERANCE_SECONDS);
}

/** The tailored workout, or the refusal it was given. */
function attempt(template: WorkoutTemplate, choices: TailorChoices): Workout | WorkoutError {
  try {
    return tailorWorkout(template, choices);
  } catch (error) {
    if (error instanceof WorkoutError) {
      return error;
    }
    throw error;
  }
}

/** The browse lengths a template can be tailored to. */
function offeredLengths(template: WorkoutTemplate): number[] {
  return TEMPLATE_LENGTHS_MINUTES.filter(
    (minutes) => !(attempt(template, { targetMinutes: minutes }) instanceof WorkoutError),
  );
}

// --- The gates ---------------------------------------------------------------

describe('the catalogue: what it holds', () => {
  it('has at least 50 templates, and at least the count in each category', () => {
    expect(BUILT_IN_WORKOUTS.length).toBeGreaterThanOrEqual(50);
    for (const [category, minimum] of Object.entries(MINIMUM_COUNTS)) {
      const count = BUILT_IN_WORKOUTS.filter((t) => t.category === category).length;
      expect(count, category).toBeGreaterThanOrEqual(minimum);
    }
  });

  it('has at least two endurance rides written as heart-rate holds (R-4)', () => {
    const held = BUILT_IN_WORKOUTS.filter(
      (t) => t.category === 'endurance' && zoneHolds(t).length > 0,
    );
    expect(held.length).toBeGreaterThanOrEqual(2);
  });
});

describe('the catalogue: ids and names', () => {
  it('gives every template a unique id that is a lower-case slug led by its category', () => {
    const ids = BUILT_IN_WORKOUTS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const template of BUILT_IN_WORKOUTS) {
      expect(template.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(template.id.startsWith(`${template.category}-`), template.id).toBe(true);
    }
  });

  it('keeps every id it has shipped, and ships no id it has not listed', () => {
    expect([...BUILT_IN_WORKOUTS.map((t) => t.id)].sort()).toEqual([...KNOWN_IDS].sort());
  });

  it('gives every template a unique name and a one-sentence summary', () => {
    const names = BUILT_IN_WORKOUTS.map((t) => bare(t.name));
    expect(new Set(names).size).toBe(names.length);
    for (const template of BUILT_IN_WORKOUTS) {
      expect(template.name.trim(), template.id).not.toBe('');
      expect(template.summary, template.id).toMatch(/^[A-Z][^.]*\.$/);
    }
  });
});

describe('the catalogue: the banned names (spike 0038 §3)', () => {
  it.each(BUILT_IN_WORKOUTS.map((t) => [t.id, t] as const))(
    '%s names no other product, title or mark',
    (_, template) => {
      expect(bannedTermsIn(template)).toEqual([]);
    },
  );

  /** A fixture with a clean name and summary, for the checker to be tried on. */
  const clean = { name: 'Tempo, two by twenty', summary: 'Twenty-minute tempo blocks.' };

  it('finds a mark as an upper-case word, and leaves the English word alone', () => {
    expect(bannedTermsIn(clean)).toEqual([]);
    expect(bannedTermsIn({ ...clean, summary: 'Ride as if it were a race.' })).toEqual([]);
    expect(bannedTermsIn({ ...clean, summary: 'Worth 60 TSS.' })).toEqual(['TSS']);
    expect(bannedTermsIn({ ...clean, name: 'IF builder' })).toEqual(['IF']);
    expect(bannedTermsIn({ ...clean, summary: 'At 95% of FTP.' })).toEqual(['FTP']);
  });

  it.each(CONTAINED.map((term) => [term]))('finds %s anywhere in a name or summary', (term) => {
    expect(bannedTermsIn({ ...clean, name: `Tempo after ${term} style` })).toContain(term);
    expect(bannedTermsIn({ ...clean, summary: `Like ${term.toUpperCase()}.` })).toContain(term);
  });

  it.each(WHOLE_NAMES.map((title) => [title]))('finds the title %s as a whole name', (title) => {
    expect(bannedTermsIn({ ...clean, name: title })).toContain(title);
    expect(bannedTermsIn({ ...clean, name: title.toUpperCase().replace(/ /g, '-') })).toContain(
      title,
    );
  });

  it('leaves the training vocabulary a title is built from', () => {
    expect(bannedTermsIn({ ...clean, name: 'Over-unders, three sets of three' })).toEqual([]);
    expect(bannedTermsIn({ ...clean, name: 'Sweet spot, two by twenty' })).toEqual([]);
  });
});

describe('the catalogue: every template tailors', () => {
  it.each(BUILT_IN_WORKOUTS.map((t) => [t.id, t] as const))(
    '%s tailors with its defaults, at both ends of its intensity, and at every length it offers',
    (_, template) => {
      const defaults = tailorWorkout(template, {});
      expect(validateWorkout(defaults)).toBe(defaults);
      expect(defaults.name).toBe(template.name);
      expect(defaults.description).toBe(template.summary);

      const offered = offeredLengths(template);
      if (template.mainSet.scaling === 'fixed') {
        expect(offered).toEqual([]);
      } else {
        expect(offered.length, 'browse lengths it can make').toBeGreaterThan(0);
      }

      for (const minutes of TEMPLATE_LENGTHS_MINUTES) {
        const made = attempt(template, { targetMinutes: minutes });
        if (made instanceof WorkoutError) {
          // A length it cannot make is refused as a choice, never as a broken workout.
          expect(made.code, `${String(minutes)} minutes`).toBe('invalid-choice');
        }
      }

      for (const minutes of offered) {
        for (const intensityPercent of [MINIMUM_INTENSITY_PERCENT, 0, MAXIMUM_INTENSITY_PERCENT]) {
          for (const thresholdHeartRate of [undefined, THRESHOLD_HEART_RATE]) {
            const workout = tailorWorkout(template, {
              targetMinutes: minutes,
              intensityPercent,
              thresholdHeartRate,
            });
            expect(validateWorkout(workout)).toBe(workout);
            const total = expandWorkout(workout).totalSeconds;
            expect(Math.abs(total - minutes * 60)).toBeLessThanOrEqual(tolerance(minutes));
          }
        }
      }
    },
  );
});

describe('the catalogue: every category matches its main set', () => {
  it.each(BUILT_IN_WORKOUTS.map((t) => [t.id, t] as const))(
    '%s works inside its category’s band, and recovers below it',
    (_, template) => {
      const band = BANDS[template.category];
      expect(band, `a band for ${template.category}`).toBeDefined();
      if (band === undefined) {
        return;
      }
      const targets = workTargets(template, band);
      // Work to do: a working target, or an effort with the trainer released.
      const released = workBlocks(template).some((block) => block.kind === 'free-ride');
      expect(targets.length > 0 || released, 'a main set with work in it').toBe(true);
      for (const target of targets) {
        expect(inBand(target, band), `${String(target)} in ${JSON.stringify(band)}`).toBe(true);
      }
      const set = template.mainSet;
      if (set.scaling === 'repeat' && set.recovery !== undefined) {
        expect(set.recovery.block.target).toBeLessThan(band.lower);
      }
    },
  );

  it.each(
    BUILT_IN_WORKOUTS.filter((t) => t.category === 'over-under').map((t) => [t.id, t] as const),
  )('%s goes both over and under threshold', (_, template) => {
    const band = BANDS['over-under'];
    const targets = band === undefined ? [] : workTargets(template, band);
    expect(targets.some((target) => target > 1)).toBe(true);
    expect(targets.some((target) => target < 1)).toBe(true);
  });
});

describe('the catalogue: every template can be read without seeing it', () => {
  it.each(BUILT_IN_WORKOUTS.map((t) => [t.id, t] as const))(
    '%s says its shape in words, block by block (#48)',
    (_, template) => {
      for (const thresholdHeartRate of [undefined, THRESHOLD_HEART_RATE]) {
        const workout = tailorWorkout(template, { thresholdHeartRate });
        expect(workoutShapeText(workout).trim()).not.toBe('');
        for (const block of workout.blocks) {
          expect(workoutBlockText(block).trim()).not.toBe('');
        }
      }
    },
  );
});

/** #2301: the longest a sprint effort may be, in seconds. */
const SPRINT_LONGEST_SECONDS = 30;
/** #2301: the shortest easy riding after a sprint, in seconds. */
const SPRINT_SHORTEST_RECOVERY_SECONDS = 120;
/** The owner's ruling 6 on #2295: a sprint this short, or shorter, is a free ride. */
const FREE_RIDE_SPRINT_SECONDS = 20;

/** The segments of a tailored workout's main set, as the player reads them. */
function mainSegments(template: WorkoutTemplate, workout: Workout) {
  const timeline = expandWorkout(workout);
  const first = template.warmUp.length;
  const last = workout.blocks.length - template.coolDown.length;
  return {
    timeline,
    main: timeline.segments.filter((segment) => segment.block >= first && segment.block < last),
  };
}

/** A sprint: an effort with the trainer released, or one held in the Sprint zone. */
function isSprint(segment: { readonly from: number | undefined }): boolean {
  return segment.from === undefined || segment.from >= zone(7);
}

describe('the catalogue: sprints', () => {
  const sprints = BUILT_IN_WORKOUTS.filter((t) => t.category === 'sprint');

  it.each(sprints.map((t) => [t.id, t] as const))(
    '%s sprints for 30 s at most, with at least 2 minutes of easy riding after each',
    (_, template) => {
      for (const targetMinutes of [undefined, ...offeredLengths(template)]) {
        const { timeline, main } = mainSegments(
          template,
          tailorWorkout(template, { targetMinutes }),
        );
        const efforts = main.filter(isSprint);
        expect(efforts.length, 'sprints in the main set').toBeGreaterThan(0);
        for (const [index, effort] of efforts.entries()) {
          expect(effort.endsAt - effort.startsAt).toBeLessThanOrEqual(SPRINT_LONGEST_SECONDS);
          const next = efforts[index + 1]?.startsAt ?? timeline.totalSeconds;
          expect(next - effort.endsAt, 'riding after a sprint').toBeGreaterThanOrEqual(
            SPRINT_SHORTEST_RECOVERY_SECONDS,
          );
          // The riding after it is easy: below Tempo, or another free ride.
          const after = timeline.segments.filter(
            (segment) => segment.startsAt >= effort.endsAt && segment.endsAt <= next,
          );
          for (const segment of after) {
            expect(segment.from ?? 0).toBeLessThan(zone(3));
            expect(segment.to ?? 0).toBeLessThan(zone(3));
          }
        }
      }
    },
  );

  it.each(BUILT_IN_WORKOUTS.map((t) => [t.id, t] as const))(
    '%s holds no sprint of 20 s or less in ERG: the trainer is released for it (ruling 6)',
    (_, template) => {
      const { main } = mainSegments(
        template,
        tailorWorkout(template, { intensityPercent: MAXIMUM_INTENSITY_PERCENT }),
      );
      for (const segment of main) {
        if (segment.from !== undefined && segment.from >= zone(7)) {
          expect(segment.endsAt - segment.startsAt).toBeGreaterThan(FREE_RIDE_SPRINT_SECONDS);
        }
      }
    },
  );
});

describe('the catalogue: heart-rate holds', () => {
  const held = BUILT_IN_WORKOUTS.filter((t) => zoneHolds(t).length > 0);

  it.each(held.map((t) => [t.id, t] as const))(
    '%s holds inside one heart-rate zone, with a ceiling at or below 0.85',
    (_, template) => {
      for (const hold of zoneHolds(template)) {
        expect(hold.ceilingShare).toBeLessThanOrEqual(MAXIMUM_HOLD_CEILING_SHARE);
        expect(hold.startShare).toBeLessThanOrEqual(hold.ceilingShare);
        const index = HEART_RATE_ZONE_LOWER_FRACTIONS.findLastIndex(
          (lower) => lower <= hold.rangeShare.low,
        );
        const upper = HEART_RATE_ZONE_LOWER_FRACTIONS[index + 1] ?? Infinity;
        expect(hold.rangeShare.high).toBeLessThan(upper);
        expect(hold.rangeShare.high).toBeGreaterThan(hold.rangeShare.low);
      }
    },
  );

  it.each(held.map((t) => [t.id, t] as const))(
    '%s rides a hold the player can read, inside the rider’s own endurance zone',
    (_, template) => {
      for (const thresholdHeartRate of [140, THRESHOLD_HEART_RATE, 200]) {
        const timeline = expandWorkout(tailorWorkout(template, { thresholdHeartRate }));
        const holds = timeline.segments.flatMap((segment) => segment.hold ?? []);
        expect(holds.length).toBe(zoneHolds(template).length);
        for (const hold of holds) {
          expect(hold.ceilingShare).toBeLessThanOrEqual(MAXIMUM_HOLD_CEILING_SHARE);
          expect(hold.range.low).toBeGreaterThanOrEqual(
            (HEART_RATE_ZONE_LOWER_FRACTIONS[1] ?? Infinity) * thresholdHeartRate,
          );
          expect(hold.range.high).toBeLessThan(
            (HEART_RATE_ZONE_LOWER_FRACTIONS[2] ?? 0) * thresholdHeartRate,
          );
        }
      }
    },
  );
});
