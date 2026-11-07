// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  beatsPerMinute,
  BUILT_IN_WORKOUTS,
  seconds,
  tailorWorkout,
  validateProposal,
  loadPlan,
  planWorkout,
  watts,
  type PlanMove,
  type PlanState,
  type Workout,
  type WorkoutTemplate,
} from '@onyourleft/domain';
import { athleteId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { matchHash } from '../shell/routes';
import {
  BUILT_IN_RIDE_PREFIX,
  builtInRideFromQuery,
  hrefForRidingBuiltIn,
  offeredWorkout,
} from './built-in-ride';
import { EMPTY_TAILOR_DRAFT } from './tailor';

const OWNER = athleteId('athlete-a');

function template(id: string): WorkoutTemplate {
  const found = BUILT_IN_WORKOUTS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no built-in ${id}`);
  return found;
}

const SWEET_SPOT = template('sweet-spot-3x12');
const CHOSEN = { ...EMPTY_TAILOR_DRAFT, length: '45', intensity: '-5' };

describe('Ride it’s address — #2306', () => {
  it('is the Ride screen, with the built-in and every choice that is not its own', () => {
    expect(hrefForRidingBuiltIn(SWEET_SPOT, CHOSEN)).toBe(
      '#/ride?workout=built-in%3Asweet-spot-3x12&length=45&intensity=-5',
    );
    expect(hrefForRidingBuiltIn(SWEET_SPOT, EMPTY_TAILOR_DRAFT)).toBe(
      '#/ride?workout=built-in%3Asweet-spot-3x12',
    );
    expect(
      hrefForRidingBuiltIn(SWEET_SPOT, { ...EMPTY_TAILOR_DRAFT, repeats: '5', recovery: '180' }),
    ).toBe('#/ride?workout=built-in%3Asweet-spot-3x12&repeats=5&recovery=180');
  });

  it('is read back by the router as the Ride route, and its query as the same choices', () => {
    const match = matchHash(hrefForRidingBuiltIn(SWEET_SPOT, CHOSEN));
    expect(match.route.id).toBe('ride');
    expect(builtInRideFromQuery(match.query)).toEqual({ template: SWEET_SPOT, draft: CHOSEN });
  });

  it('asks for nothing with no query, or an id that names no built-in', () => {
    expect(builtInRideFromQuery(undefined)).toBeUndefined();
    expect(builtInRideFromQuery('')).toBeUndefined();
    expect(builtInRideFromQuery('workout=workout-4f1c')).toBeUndefined();
    expect(builtInRideFromQuery('workout=built-in%3Ano-such-workout')).toBeUndefined();
    expect(builtInRideFromQuery('length=45')).toBeUndefined();
  });
});

describe('the workout offered on the Ride screen — #2306', () => {
  it('is tailorWorkout’s, as an in-memory record whose id is the built-in’s and no saved one’s', () => {
    const outcome = offeredWorkout(
      { template: SWEET_SPOT, draft: CHOSEN },
      OWNER,
      undefined,
      1_800,
    );
    if (outcome.status !== 'offered') throw new Error(outcome.message);
    const tailored = tailorWorkout(SWEET_SPOT, { targetMinutes: 45, intensityPercent: -5 });
    expect(outcome.record.workout.blocks).toStrictEqual(tailored.blocks);
    expect(outcome.record.id).toBe(`${BUILT_IN_RIDE_PREFIX}sweet-spot-3x12`);
    expect(outcome.record.id.startsWith('workout-')).toBe(false);
    expect(outcome.record.name).toBe('Sweet spot, three by twelve (47 min, −5%)');
    expect(outcome.record.workout.name).toBe(outcome.record.name);
    expect(outcome.record.createdBy).toBe(OWNER);
  });

  it('turns a heart-rate zone hold into a range from the rider’s own threshold heart rate', () => {
    const hold = template('endurance-heart-rate');
    const outcome = offeredWorkout(
      { template: hold, draft: EMPTY_TAILOR_DRAFT },
      OWNER,
      170,
      1_800,
    );
    if (outcome.status !== 'offered') throw new Error(outcome.message);
    expect(outcome.record.workout.blocks).toStrictEqual(
      tailorWorkout(hold, { thresholdHeartRate: 170 }).blocks,
    );
  });

  it('is refused, in the domain’s words, for choices an address typed by hand', () => {
    expect(
      offeredWorkout(
        { template: SWEET_SPOT, draft: { ...EMPTY_TAILOR_DRAFT, intensity: '40' } },
        OWNER,
        undefined,
        1_800,
      ),
    ).toEqual({
      status: 'refused',
      name: 'Sweet spot, three by twelve',
      message:
        'The intensity of "Sweet spot, three by twelve" can be set from −25% to +10%; you asked for +40%.',
    });
  });
});

/*
 * A tailored built-in is an ordinary workout: a re-plan (#1242, ADR 0048) is
 * accepted or refused against it exactly as against the same blocks saved.
 * Every move below is decided twice, once on each plan, and the two answers
 * must be the same — accepted with the same blocks after, or refused by the
 * same rule.
 */
describe('a re-plan decides a tailored built-in as it decides the same blocks saved — #2306', () => {
  const offered = offeredWorkout({ template: SWEET_SPOT, draft: CHOSEN }, OWNER, undefined, 0);
  if (offered.status !== 'offered') throw new Error('not offered');
  const tailored = offered.record.workout;
  const saved: Workout = { name: 'Saved by hand', blocks: [...tailored.blocks] };

  function stateFor(workout: Workout): PlanState {
    return {
      plan: loadPlan(workout),
      position: seconds(100),
      summary: { seq: 7, sentAt: seconds(1000) },
      enabled: true,
      paused: false,
      rescue: false,
      control: true,
      heartRatePaired: true,
      library: [{ id: 'workout-other', workout: saved }],
    };
  }

  // Moves as an agent sends them: data, decoded by the validator, so one of
  // them can be out of its vocabulary (a 50 % scale is no allowed step).
  const MOVES: readonly (PlanMove | { readonly kind: string; readonly percent: number })[] = [
    { kind: 'extend-block', block: 0, minutes: 2 },
    { kind: 'extend-block', block: 1, minutes: 2 },
    { kind: 'shorten-block', block: 1, minutes: 5 },
    { kind: 'shorten-block', block: 2, minutes: 1 },
    { kind: 'scale-remaining-intervals', percent: -10 },
    { kind: 'scale-remaining-intervals', percent: 5 },
    { kind: 'scale-remaining-intervals', percent: 50 },
    { kind: 'move-hold-range', block: 1, bpm: -3 },
    { kind: 'swap-next-block', workoutId: 'workout-other', blockIndex: 0 },
    { kind: 'end-main-set' },
  ];

  function decide(workout: Workout, move: unknown) {
    const result = validateProposal(
      { revision: 0, summarySeq: 7, move, reason: 'on-plan' },
      stateFor(workout),
      {},
      {
        thresholdPower: watts(250),
        thresholdHeartRate: beatsPerMinute(165),
        assumed: { power: false, heartRate: false },
      },
      { minimum: watts(0), maximum: watts(1000) },
      seconds(1030),
    );
    return result.ok
      ? { ok: true, blocks: planWorkout(result.plan).blocks }
      : { ok: false, rule: result.rule };
  }

  it.each(MOVES.map((move) => [move.kind, move] as const))('%s', (_, move) => {
    expect(decide(tailored, move)).toEqual(decide(saved, move));
  });

  it('accepts some of those moves and refuses others, so the comparison compares something', () => {
    const answers = MOVES.map((move) => decide(tailored, move).ok);
    expect(answers).toContain(true);
    expect(answers).toContain(false);
  });
});
