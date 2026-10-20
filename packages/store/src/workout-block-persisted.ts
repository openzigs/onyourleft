// SPDX-License-Identifier: Apache-2.0

/**
 * The blocks of a workout ridden on a ride, on disk — #1319: as a saved
 * ride's facts ({@link WorkoutBlockFact}) and as a recording's header holds
 * them ({@link RecordedWorkoutBlock}).
 *
 * ⚠️ **Read the same way on the way in and on the way out, and never a
 * throw.** A list of blocks is something worked out ABOUT a ride. On the way in
 * a list that does not read is left out and the ride or header is written all
 * the same; on the way out it is dropped and the ride or recording reads all
 * the same, as a recording's laps are (`recording-persisted.ts`
 * §`fromPersistedCourseLaps`). A ride saved with no block table has lost a
 * table, and a ride that cannot be read has lost the ride.
 *
 * ⚠️ **All of the list or none of it**, for the laps' reason: a block is
 * numbered by where it stands, so a list with its second entry taken out
 * would call the third block the second.
 *
 * ⚠️ **A block goes back through `validateWorkout`**, as a saved workout does
 * (`persisted.ts` §`fromPersistedWorkout`). Nothing here is written to a
 * trainer, but the page says a block's target from it, and a row with
 * `target: 88` would be said as 8800 %.
 */

import {
  validateWorkout,
  type Seconds,
  type UnixSeconds,
  type WorkoutBlock,
} from '@onyourleft/domain';

import type { RecordedLapMark, RecordedWorkoutBlock } from './recording';
import { WORKOUT_BLOCK_OUTCOMES, type WorkoutBlockFact, type WorkoutBlockOutcome } from './records';

/** A plain object, as anything read back has to be before a field of it is read. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number that is not below nought, or `undefined`. */
function quantity(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** The label, kept only as a string. */
function labelOf(value: Readonly<Record<string, unknown>>): { label?: string } {
  return typeof value['label'] === 'string' ? { label: value['label'] } : {};
}

/**
 * One block, copied field by field once `validateWorkout` has taken it — or
 * `undefined` when it would not. A key that is not the block's is not kept.
 */
export function workoutBlockOf(value: unknown): WorkoutBlock | undefined {
  if (!isRecord(value)) return undefined;
  try {
    validateWorkout({ name: 'block', blocks: [value as unknown as WorkoutBlock] });
  } catch {
    return undefined;
  }
  const block = value as unknown as WorkoutBlock;
  switch (block.kind) {
    case 'steady':
      return { kind: 'steady', seconds: block.seconds, target: block.target, ...labelOf(value) };
    case 'ramp':
      return {
        kind: 'ramp',
        seconds: block.seconds,
        from: block.from,
        to: block.to,
        ...labelOf(value),
      };
    case 'intervals':
      return {
        kind: 'intervals',
        repeats: block.repeats,
        hardSeconds: block.hardSeconds,
        hardTarget: block.hardTarget,
        easySeconds: block.easySeconds,
        easyTarget: block.easyTarget,
        ...labelOf(value),
      };
    case 'free-ride':
      return { kind: 'free-ride', seconds: block.seconds, ...labelOf(value) };
    case 'heart-rate-hold':
      return {
        kind: 'heart-rate-hold',
        seconds: block.seconds,
        range: { low: block.range.low, high: block.range.high },
        startShare: block.startShare,
        ceilingShare: block.ceilingShare,
        ...labelOf(value),
      };
  }
}

function outcomeOf(value: unknown): WorkoutBlockOutcome | undefined {
  return WORKOUT_BLOCK_OUTCOMES.find((outcome) => outcome === value);
}

/** The optional figures a block states, each kept only as a number not below nought. */
const FIGURES = [
  'averagePower',
  'maxPower',
  'averageHeartRate',
  'maxHeartRate',
  'averageCadence',
] as const;

/** One saved block, or `undefined` when it does not read. */
function workoutBlockFactOf(value: unknown): WorkoutBlockFact | undefined {
  if (!isRecord(value)) return undefined;
  const outcome = outcomeOf(value['outcome']);
  const block = workoutBlockOf(value['block']);
  if (outcome === undefined || block === undefined) return undefined;
  if (outcome === 'skipped') return { outcome, block };
  const startedAt = quantity(value['startedAt']);
  const elapsedTime = quantity(value['elapsedTime']);
  const movingTime = quantity(value['movingTime']);
  if (startedAt === undefined || elapsedTime === undefined || movingTime === undefined) {
    return undefined;
  }
  const figures: Record<string, number> = {};
  for (const name of FIGURES) {
    if (value[name] === undefined) continue;
    const figure = quantity(value[name]);
    if (figure === undefined) return undefined;
    figures[name] = figure;
  }
  return {
    outcome,
    block,
    ...(value['eased'] === true ? { eased: true as const } : {}),
    startedAt: startedAt as UnixSeconds,
    elapsedTime: elapsedTime as Seconds,
    movingTime: movingTime as Seconds,
    ...(figures as Pick<WorkoutBlockFact & { outcome: 'ridden' }, (typeof FIGURES)[number]>),
  };
}

/**
 * A ride's workout blocks as they are kept: every one, in order, or
 * `undefined` for none — and for a list any entry of which does not read.
 * Never a throw. Used on the way in and on the way out.
 */
export function workoutBlockFactsOf(value: unknown): readonly WorkoutBlockFact[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const facts: WorkoutBlockFact[] = [];
  for (const each of value as unknown[]) {
    const fact = workoutBlockFactOf(each);
    if (fact === undefined) return undefined;
    facts.push(fact);
  }
  return facts;
}

function markOf(value: unknown): RecordedLapMark | undefined {
  if (!isRecord(value)) return undefined;
  const at = quantity(value['at']);
  const movingTime = quantity(value['movingTime']);
  return at === undefined || movingTime === undefined
    ? undefined
    : { at: at as UnixSeconds, movingTime: movingTime as Seconds };
}

/** One block of a recording's header, or `undefined` when it does not read. */
function recordedWorkoutBlockOf(value: unknown): RecordedWorkoutBlock | undefined {
  if (!isRecord(value)) return undefined;
  const outcome = outcomeOf(value['outcome']);
  const block = workoutBlockOf(value['block']);
  if (outcome === undefined || block === undefined) return undefined;
  if (outcome === 'skipped') return { outcome, block };
  const from = markOf(value['from']);
  const to = markOf(value['to']);
  if (from === undefined || to === undefined) return undefined;
  if (to.at < from.at || to.movingTime < from.movingTime) return undefined;
  return { outcome, block, from, to, ...(value['eased'] === true ? { eased: true as const } : {}) };
}

/**
 * A recording header's workout blocks: every one, in order, or `undefined`
 * for none — and for a list that does not read whole. Never a throw.
 *
 * Besides each entry reading, a block that was ridden must lie inside the
 * recording — no earlier than `startedAt`, no later than the header's own
 * `updatedAt` — and begin no earlier than the ridden block before it ended,
 * as a recording's laps must (`recording-persisted.ts`
 * §`fromPersistedCourseLaps`).
 */
export function recordedWorkoutBlocksOf(
  value: unknown,
  startedAt: number,
  updatedAt: number,
): readonly RecordedWorkoutBlock[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const blocks: RecordedWorkoutBlock[] = [];
  let cursor = startedAt;
  for (const each of value as unknown[]) {
    const block = recordedWorkoutBlockOf(each);
    if (block === undefined) return undefined;
    if (block.outcome !== 'skipped') {
      if (block.from.at < cursor || block.to.at > updatedAt) return undefined;
      cursor = block.to.at;
    }
    blocks.push(block);
  }
  return blocks;
}
