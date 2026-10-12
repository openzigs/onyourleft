// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a device may send its instance to ask for a re-plan during a ride**
 * — #1243, ADR 0048 D-10 (the owner's Q8: *"Per-block summaries only"*).
 *
 * `POST /v1/analysis/replans` carries `{ input, templateVersion, source }`.
 * The device built `input`, and the instance trusts none of it: it is read
 * here, key by key, and refused whole on the first fault.
 *
 * ## What it holds
 *
 * - `revision` and `summarySeq`: the plan revision and the summary the
 *   proposal will name (`@onyourleft/domain` §`Proposal`, P5). **The instance
 *   copies them into the proposal itself**; a model never writes either.
 * - `currentBlock`: which block is being ridden, so a move can name a later one.
 * - `goals`: the rider's typed goals (`readWorkoutGoals`, ADR 0048 D-10).
 * - `blocks`: the plan as it stands, as shares of threshold power and never
 *   watts (ADR 0017), with no label.
 * - `summaries`: one per block ridden, in the units {@link BLOCK_SUMMARY_KEYS}
 *   names.
 *
 * ## What has no key to arrive under
 *
 * A 1 Hz stream, a position, a date, a name, an id, a label, a watt, or any
 * environment figure such as a gradient or a temperature (#809's exclusions;
 * spike 0022 rule R4). **No string here is free text**: every one is an
 * enumeration, so nothing in an input can be a sentence a model reads.
 *
 * ⚠️ **No figure of how well the plan is being followed** (spike 0022 rule
 * R1). `secondsInRange` is seconds of ONE block. Nothing in this module, the
 * template or the tools turns it into a share, sums it across blocks, or
 * compares it with a goal; `replan-input.test.ts` holds the keys and scans
 * the re-plan's modules for such a figure's name.
 *
 * Every refusal names the field and the rule, never the value (ADR 0004 D).
 */

import {
  MAXIMUM_HOLD_BPM,
  MAXIMUM_SHARE,
  MINIMUM_HOLD_BPM,
  readWorkoutGoals,
  validateWorkout,
  WorkoutError,
  type WorkoutBlock,
  type WorkoutGoals,
} from '@onyourleft/domain';

import type { FieldProblem } from '../errors.ts';
import type { InputRead } from './job-input.ts';

/** The most one re-plan input may be, serialised: twice a ride input's 4 KiB, for the blocks. */
export const REPLAN_INPUT_BYTE_BUDGET = 8 * 1024;

/** The most blocks a plan may be sent with. */
export const MAXIMUM_PLAN_BLOCKS = 64;

/** The most summaries an input may carry: one for every block of the longest plan. */
export const MAXIMUM_INPUT_SUMMARIES = MAXIMUM_PLAN_BLOCKS;

/** The longest one block's summary may cover: a day. */
const MAXIMUM_SUMMARY_SECONDS = 86_400;

/** The highest cadence a summary may carry, in revolutions per minute. */
const MAXIMUM_CADENCE = 250;

/** The most rescues one block's summary may count. */
const MAXIMUM_RESCUES = 1_000;

/** The keys of a re-plan input: these six and no other. */
export const REPLAN_INPUT_KEYS = [
  'revision',
  'summarySeq',
  'currentBlock',
  'goals',
  'blocks',
  'summaries',
] as const;

/**
 * The keys of one block's summary, each in its own unit: `block` an index,
 * `seconds` and `secondsInRange` seconds, `meanHeartRate` and
 * `highestHeartRate` beats per minute, `meanPowerShare` a share of the
 * rider's own threshold power, `meanCadence` revolutions per minute,
 * `rescues` a count, and `effort` the rider's own 1 to 5 tap between blocks.
 */
export const BLOCK_SUMMARY_KEYS = [
  'block',
  'seconds',
  'meanHeartRate',
  'highestHeartRate',
  'secondsInRange',
  'meanPowerShare',
  'meanCadence',
  'rescues',
  'effort',
] as const;

/** One block already ridden, as the device measured it. */
export interface BlockSummary {
  readonly block: number;
  readonly seconds: number;
  readonly meanHeartRate?: number;
  readonly highestHeartRate?: number;
  readonly secondsInRange?: number;
  readonly meanPowerShare?: number;
  readonly meanCadence?: number;
  readonly rescues: number;
  readonly effort?: number;
}

/** What a re-plan job is run over. */
export interface ReplanInput {
  readonly revision: number;
  readonly summarySeq: number;
  readonly currentBlock: number;
  readonly goals: WorkoutGoals;
  readonly blocks: readonly WorkoutBlock[];
  readonly summaries: readonly BlockSummary[];
}

/** Thrown inside the reader and caught at its edge: one field, one rule. */
class Refused extends Error {
  readonly field: string;
  readonly problem: string;
  constructor(field: string, problem: string) {
    super(problem);
    this.field = field;
    this.problem = problem;
  }
}

type Json = Readonly<Record<string, unknown>>;

function object(value: unknown, at: string, allowed: readonly string[]): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Refused(at, 'must be an object');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new Refused(`${at}.${key}`, 'is not a field of a re-plan input');
    }
  }
  return value as Json;
}

function list(value: unknown, at: string, most: number): readonly unknown[] {
  if (!Array.isArray(value)) throw new Refused(at, 'must be a list');
  if (value.length === 0) throw new Refused(at, 'must not be empty');
  if (value.length > most) throw new Refused(at, `must hold at most ${String(most)}`);
  return value as readonly unknown[];
}

function number(value: unknown, at: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Refused(at, `must be a number from ${String(minimum)} to ${String(maximum)}`);
  }
  return value;
}

function whole(value: unknown, at: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Refused(at, `must be a whole number from ${String(minimum)} to ${String(maximum)}`);
  }
  return value;
}

/** A finite number, for a block's own figures: `validateWorkout` holds their ranges. */
function figure(value: unknown, at: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Refused(at, 'must be a number');
  }
  return value;
}

/** The keys each kind of block carries here. No `label`: a label is free text. */
const BLOCK_FIGURES: Readonly<Record<WorkoutBlock['kind'], readonly string[]>> = {
  steady: ['seconds', 'target'],
  ramp: ['seconds', 'from', 'to'],
  intervals: ['repeats', 'hardSeconds', 'hardTarget', 'easySeconds', 'easyTarget'],
  'free-ride': ['seconds'],
  'heart-rate-hold': ['seconds', 'startShare', 'ceilingShare'],
};

function isBlockKind(value: unknown): value is WorkoutBlock['kind'] {
  return typeof value === 'string' && Object.hasOwn(BLOCK_FIGURES, value);
}

/** One block's keys and number types. Its values are `validateWorkout`'s to hold. */
function block(value: unknown, at: string): WorkoutBlock {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Refused(at, 'must be an object');
  }
  const { kind } = value as Json;
  if (!isBlockKind(kind)) {
    throw new Refused(`${at}.kind`, 'is not one of the block kinds this instance knows');
  }
  const figures = BLOCK_FIGURES[kind];
  const json = object(value, at, [
    'kind',
    ...figures,
    ...(kind === 'heart-rate-hold' ? ['range'] : []),
  ]);
  const read: Record<string, unknown> = { kind };
  for (const key of figures) read[key] = figure(json[key], `${at}.${key}`);
  if (kind === 'heart-rate-hold') {
    const range = object(json.range, `${at}.range`, ['low', 'high']);
    read.range = {
      low: figure(range.low, `${at}.range.low`),
      high: figure(range.high, `${at}.range.high`),
    };
  }
  // Every key of the kind is present and a number; the brands are the domain's.
  return read as unknown as WorkoutBlock;
}

function summary(value: unknown, at: string, blocks: number): BlockSummary {
  const json = object(value, at, BLOCK_SUMMARY_KEYS);
  const optional = (key: string, minimum: number, maximum: number): number | undefined =>
    json[key] === undefined ? undefined : number(json[key], `${at}.${key}`, minimum, maximum);
  const seconds = number(json.seconds, `${at}.seconds`, 0, MAXIMUM_SUMMARY_SECONDS);
  const meanHeartRate = optional('meanHeartRate', MINIMUM_HOLD_BPM, MAXIMUM_HOLD_BPM);
  const highestHeartRate = optional('highestHeartRate', MINIMUM_HOLD_BPM, MAXIMUM_HOLD_BPM);
  const secondsInRange = optional('secondsInRange', 0, seconds);
  const meanPowerShare = optional('meanPowerShare', 0, MAXIMUM_SHARE);
  const meanCadence = optional('meanCadence', 0, MAXIMUM_CADENCE);
  const effort = json.effort === undefined ? undefined : whole(json.effort, `${at}.effort`, 1, 5);
  return {
    block: whole(json.block, `${at}.block`, 0, blocks - 1),
    seconds,
    ...(meanHeartRate === undefined ? {} : { meanHeartRate }),
    ...(highestHeartRate === undefined ? {} : { highestHeartRate }),
    ...(secondsInRange === undefined ? {} : { secondsInRange }),
    ...(meanPowerShare === undefined ? {} : { meanPowerShare }),
    ...(meanCadence === undefined ? {} : { meanCadence }),
    rescues: whole(json.rescues, `${at}.rescues`, 0, MAXIMUM_RESCUES),
    ...(effort === undefined ? {} : { effort }),
  };
}

/** `value` as a {@link ReplanInput} holding only the keys named here, or the field at fault. */
export function readReplanInput(value: unknown, at = 'input'): InputRead<ReplanInput> {
  try {
    const json = object(value, at, REPLAN_INPUT_KEYS);
    const blocks = list(json.blocks, `${at}.blocks`, MAXIMUM_PLAN_BLOCKS).map((each, index) =>
      block(each, `${at}.blocks[${String(index)}]`),
    );
    try {
      validateWorkout({ name: 'plan', blocks });
    } catch (error) {
      if (!(error instanceof WorkoutError)) throw error;
      throw new Refused(`${at}.blocks`, 'must be blocks this program would ride');
    }
    const goals = readWorkoutGoals(json.goals);
    if (!goals.ok) throw new Refused(`${at}.goals`, goals.fault.constraint);
    const read: ReplanInput = {
      revision: whole(json.revision, `${at}.revision`, 0, Number.MAX_SAFE_INTEGER),
      summarySeq: whole(json.summarySeq, `${at}.summarySeq`, 0, Number.MAX_SAFE_INTEGER),
      currentBlock: whole(json.currentBlock, `${at}.currentBlock`, 0, blocks.length - 1),
      goals: goals.goals,
      blocks,
      summaries: list(json.summaries, `${at}.summaries`, MAXIMUM_INPUT_SUMMARIES).map(
        (each, index) => summary(each, `${at}.summaries[${String(index)}]`, blocks.length),
      ),
    };
    if (new TextEncoder().encode(JSON.stringify(read)).byteLength > REPLAN_INPUT_BYTE_BUDGET) {
      throw new Refused(at, `must be at most ${String(REPLAN_INPUT_BYTE_BUDGET)} bytes`);
    }
    return { ok: true, value: read };
  } catch (error) {
    if (error instanceof Refused) {
      const fields: readonly FieldProblem[] = [{ field: error.field, problem: error.problem }];
      return { ok: false, fields };
    }
    throw error;
  }
}
