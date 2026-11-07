// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  BUILT_IN_WORKOUTS,
  beatsPerMinute,
  expandWorkout,
  seconds,
  tailorWorkout,
  thresholdShare,
  watts,
  type WorkoutTemplate,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  copyName,
  EMPTY_TAILOR_DRAFT,
  initialTailorDraft,
  lengthText,
  previewRow,
  previewRows,
  repeatsIn,
  TAILOR_LENGTHS,
  tailorFromDraft,
  tailorOffer,
  withChoice,
} from './tailor';

function template(id: string): WorkoutTemplate {
  const found = BUILT_IN_WORKOUTS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no built-in ${id}`);
  return found;
}

const SWEET_SPOT = template('sweet-spot-3x12');
const STEADY_HOUR = template('endurance-steady-hour');
const HEART_RATE = template('endurance-heart-rate');
const RAMP_TEST = template('ramp-test');

describe('what a template offers — #2305', () => {
  it('a length, the intensity, the repeats and the recovery, for an interval session', () => {
    expect(tailorOffer(SWEET_SPOT)).toEqual({
      length: true,
      intensity: { minimum: -25, maximum: 10 },
      repeats: { minimum: 2, maximum: 6, default: 3 },
      recovery: { minimum: 120, maximum: 360, default: 240 },
    });
  });

  it('a length and the intensity, and no repeats, for a session that stretches', () => {
    expect(tailorOffer(STEADY_HOUR)).toMatchObject({
      length: true,
      repeats: undefined,
      recovery: undefined,
    });
  });

  it('nothing at all for a test ridden as written', () => {
    expect(tailorOffer(RAMP_TEST)).toEqual({
      length: false,
      intensity: undefined,
      repeats: undefined,
      recovery: undefined,
    });
  });

  it('offers the five lengths every library is browsed by', () => {
    expect(TAILOR_LENGTHS).toEqual([30, 45, 60, 75, 90]);
  });
});

describe('a length and a repeat count are not both chosen — #2305', () => {
  it('choosing a length lets go of the repeats, and choosing repeats of the length', () => {
    const repeats = withChoice(EMPTY_TAILOR_DRAFT, 'repeats', '5');
    expect(withChoice(repeats, 'length', '45')).toMatchObject({ length: '45', repeats: '' });
    const length = withChoice(EMPTY_TAILOR_DRAFT, 'length', '60');
    expect(withChoice(length, 'repeats', '4')).toMatchObject({ length: '', repeats: '4' });
  });

  it('keeps the other when one is emptied', () => {
    const both = { ...EMPTY_TAILOR_DRAFT, length: '60' };
    expect(withChoice(both, 'repeats', '')).toMatchObject({ length: '60', repeats: '' });
    expect(withChoice({ ...EMPTY_TAILOR_DRAFT, repeats: '4' }, 'length', '')).toMatchObject({
      repeats: '4',
    });
  });

  it('leaves the length and repeats alone for intensity and recovery', () => {
    const draft = { ...EMPTY_TAILOR_DRAFT, length: '60' };
    expect(withChoice(draft, 'intensity', '-5')).toEqual({ ...draft, intensity: '-5' });
    expect(withChoice(draft, 'recovery', '180')).toEqual({ ...draft, recovery: '180' });
  });
});

describe('the workout the choices make is tailorWorkout’s — #2305', () => {
  it('with nothing chosen, the template as written', () => {
    const outcome = tailorFromDraft(SWEET_SPOT, EMPTY_TAILOR_DRAFT);
    expect(outcome).toEqual({ status: 'tailored', workout: tailorWorkout(SWEET_SPOT, {}) });
  });

  it('passes every choice through, a typographic minus and a comma included', () => {
    const draft = { length: '45', intensity: '−5', repeats: '', recovery: '150' };
    expect(tailorFromDraft(SWEET_SPOT, draft)).toEqual({
      status: 'tailored',
      workout: tailorWorkout(SWEET_SPOT, {
        targetMinutes: 45,
        intensityPercent: -5,
        recoverySeconds: 150,
      }),
    });
    expect(tailorFromDraft(SWEET_SPOT, { ...EMPTY_TAILOR_DRAFT, intensity: '2,5' })).toEqual({
      status: 'tailored',
      workout: tailorWorkout(SWEET_SPOT, { intensityPercent: 2.5 }),
    });
  });

  it('says the domain’s own refusal, as a sentence', () => {
    expect(tailorFromDraft(SWEET_SPOT, { ...EMPTY_TAILOR_DRAFT, length: '30' })).toEqual({
      status: 'refused',
      control: 'length',
      message:
        '"Sweet spot, three by twelve" can be no shorter than 40 minutes; you asked for 30 minutes.',
    });
    expect(tailorFromDraft(SWEET_SPOT, { ...EMPTY_TAILOR_DRAFT, intensity: '20' })).toEqual({
      status: 'refused',
      control: 'intensity',
      message:
        'The intensity of "Sweet spot, three by twelve" can be set from −25% to +10%; you asked for +20%.',
    });
  });

  it('names the control that is refused when the rider has also made a valid choice after it', () => {
    const draft = { ...EMPTY_TAILOR_DRAFT, length: '30', intensity: '-5' };
    expect(tailorFromDraft(SWEET_SPOT, draft)).toMatchObject({
      status: 'refused',
      control: 'length',
    });
    const other = { ...EMPTY_TAILOR_DRAFT, length: '45', intensity: '20' };
    expect(tailorFromDraft(SWEET_SPOT, other)).toMatchObject({
      status: 'refused',
      control: 'intensity',
    });
  });

  it('refuses a box that holds no number, naming what to type', () => {
    expect(tailorFromDraft(SWEET_SPOT, { ...EMPTY_TAILOR_DRAFT, repeats: 'three' })).toEqual({
      status: 'refused',
      control: 'repeats',
      message: 'Type the number of repeats as a whole number.',
    });
    expect(tailorFromDraft(SWEET_SPOT, { ...EMPTY_TAILOR_DRAFT, intensity: 'more' })).toEqual({
      status: 'refused',
      control: 'intensity',
      message: 'Type the intensity as a number of percent, such as −5 or 5.',
    });
    expect(tailorFromDraft(SWEET_SPOT, { ...EMPTY_TAILOR_DRAFT, recovery: '2m' })).toEqual({
      status: 'refused',
      control: 'recovery',
      message: 'Type the recovery as a number of seconds.',
    });
  });

  it('turns a heart-rate zone hold into a range from the rider’s own threshold heart rate', () => {
    const without = tailorFromDraft(HEART_RATE, EMPTY_TAILOR_DRAFT);
    const withRate = tailorFromDraft(HEART_RATE, EMPTY_TAILOR_DRAFT, 170);
    expect(without.status === 'tailored' && without.workout.blocks[1]?.kind).toBe('steady');
    expect(withRate).toEqual({
      status: 'tailored',
      workout: tailorWorkout(HEART_RATE, { thresholdHeartRate: 170 }),
    });
  });
});

describe('a block in words, watts and zones — #2305', () => {
  const steady = {
    kind: 'steady',
    seconds: seconds(600),
    target: thresholdShare(0.9),
  } as const;

  it('says a 0.90 block at a 250 W threshold as 225 W, in zone 3', () => {
    expect(previewRow(steady, watts(250))).toEqual({
      text: '10 min at 90%',
      power: '225 W',
      zone: 'zone 3 Tempo',
    });
  });

  it('invents no watts without a threshold, and still names the zone', () => {
    expect(previewRow(steady, undefined)).toEqual({ text: '10 min at 90%', zone: 'zone 3 Tempo' });
  });

  it('says a ramp’s two ends, and each zone it passes through once', () => {
    expect(
      previewRow(
        {
          kind: 'ramp',
          seconds: seconds(600),
          from: thresholdShare(0.45),
          to: thresholdShare(0.7),
        },
        watts(200),
      ),
    ).toEqual({
      text: '10 min ramping 45% to 70%',
      power: '90 W to 140 W',
      zone: 'zone 1 Recovery to zone 2 Endurance',
    });
  });

  it('says an interval’s hard and easy targets', () => {
    expect(
      previewRow(
        {
          kind: 'intervals',
          repeats: 3,
          hardSeconds: seconds(720),
          hardTarget: thresholdShare(0.9),
          easySeconds: seconds(240),
          easyTarget: thresholdShare(0.55),
        },
        watts(250),
      ),
    ).toEqual({
      text: '3 × 12 min at 90%, 4 min at 55%',
      power: '225 W, then 138 W',
      zone: 'zone 3 Tempo, then zone 1 Recovery',
    });
  });

  it('says a free ride releases the trainer, and a hold needs a strap, with no watts', () => {
    expect(previewRow({ kind: 'free-ride', seconds: seconds(180) }, watts(250))).toEqual({
      text: '3 min free riding',
      note: 'The trainer is released.',
    });
    expect(
      previewRow(
        {
          kind: 'heart-rate-hold',
          seconds: seconds(1800),
          range: { low: beatsPerMinute(138), high: beatsPerMinute(151) },
          startShare: thresholdShare(0.62),
          ceilingShare: thresholdShare(0.75),
        },
        watts(250),
      ),
    ).toEqual({ text: '30 min holding 138–151 bpm', note: 'Needs a heart-rate strap.' });
  });

  it('says every block of a workout, in order', () => {
    const workout = tailorWorkout(SWEET_SPOT, {});
    expect(previewRows(workout, undefined).map((row) => row.text)).toEqual([
      '10 min ramping 45% to 70%',
      '3 × 12 min at 90%, 4 min at 55%',
      '5 min ramping 60% to 45%',
    ]);
  });
});

describe('the name a copy is saved under — #2305', () => {
  it('is the template’s, with its length and any intensity', () => {
    expect(copyName(SWEET_SPOT, 2700, EMPTY_TAILOR_DRAFT)).toBe(
      'Sweet spot, three by twelve (45 min)',
    );
    expect(copyName(SWEET_SPOT, 2700, { ...EMPTY_TAILOR_DRAFT, intensity: '-5' })).toBe(
      'Sweet spot, three by twelve (45 min, −5%)',
    );
    expect(copyName(SWEET_SPOT, 3600, { ...EMPTY_TAILOR_DRAFT, intensity: '3' })).toBe(
      'Sweet spot, three by twelve (1 h, +3%)',
    );
  });
});

describe('the owner’s ruling of 2026-11-07 — #2305', () => {
  const lengthOf = (id: string, minutes: number): number =>
    expandWorkout(tailorWorkout(template(id), { targetMinutes: minutes })).totalSeconds;

  it('opens with the template’s repeats and recovery as values, and nothing else chosen', () => {
    expect(initialTailorDraft(tailorOffer(SWEET_SPOT))).toEqual({
      ...EMPTY_TAILOR_DRAFT,
      repeats: '3',
      recovery: '240',
    });
    // Nothing to put in a box a template does not offer.
    expect(initialTailorDraft(tailorOffer(STEADY_HOUR))).toEqual(EMPTY_TAILOR_DRAFT);
    // The defaults make the workout as written.
    expect(tailorFromDraft(SWEET_SPOT, initialTailorDraft(tailorOffer(SWEET_SPOT)))).toEqual({
      status: 'tailored',
      workout: tailorWorkout(SWEET_SPOT, {}),
    });
  });

  it('says why a length is not the one chosen, in one line', () => {
    expect(lengthText(SWEET_SPOT, lengthOf('sweet-spot-3x12', 45), '45')).toBe(
      '47 min, the nearest with whole repeats',
    );
    expect(lengthText(SWEET_SPOT, lengthOf('sweet-spot-3x12', 75), '75')).toBe('1 h 15 min');
    const rising = template('tempo-rising-steps');
    expect(lengthText(rising, lengthOf('tempo-rising-steps', 90), '90')).toBe(
      '1 h 27 min, the nearest it stretches to',
    );
    // No length chosen: the length alone.
    expect(lengthText(SWEET_SPOT, 63 * 60, '')).toBe('1 h 3 min');
  });

  it('reads the repeat count a length chose off the workout', () => {
    expect(repeatsIn(SWEET_SPOT, tailorWorkout(SWEET_SPOT, { targetMinutes: 45 }))).toBe(2);
    // A repetition of several blocks, written out each time.
    const overUnder = template('over-under-3x3');
    expect(repeatsIn(overUnder, tailorWorkout(overUnder, { targetMinutes: 60 }))).toBe(3);
    expect(repeatsIn(overUnder, tailorWorkout(overUnder, { repeats: 5 }))).toBe(5);
    expect(repeatsIn(STEADY_HOUR, tailorWorkout(STEADY_HOUR, {}))).toBeUndefined();
  });
});
