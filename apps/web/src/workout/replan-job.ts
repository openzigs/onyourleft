// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A re-plan job on the rider's instance, as the wire carries it** — #1244,
 * ADR 0048 D-10, over #1243's route and #1102's job calls.
 *
 * What a re-plan request carries ({@link replanRequest}), the start
 * ({@link startReplan}), the reading of the job's stream down to its one
 * `result` ({@link followReplan}), and nothing else. Cancelling is #1102's
 * own `cancelJob` (`ride-analysis/instance-job.ts`): a re-plan is a job in
 * the same table, cancelled through the same route. Nothing here decides
 * anything about a plan; `replan-session.ts` hands what arrives to the
 * device's validator.
 *
 * ## No network primitive here
 *
 * Every call goes through a `JobChannel`, which production fills with
 * `instance/instance-transport.ts` §`sealedInstance` — the ONE module the
 * client reaches an instance through (#777, ADR 0036 D-3 (a)), and the one
 * `privacy/no-network.test.ts` admits. Both routes are sealed-only (ADR 0047
 * D-7), so there is no plaintext call to fall back to.
 *
 * ## What leaves: the request, and nothing else
 *
 * {@link replanRequest} is the ONE builder of a start's body, and
 * {@link replanInput} of the input inside it: the plan's revision and the
 * summary's number, the block being ridden, the rider's typed goals, the
 * plan's blocks as shares of threshold power, and one summary for each block
 * ridden. **No 1 Hz stream, no position, no date, no name, no label, no id
 * and no watt** — the instance's reader (`apps/instance` §`replan-input.ts`)
 * has no key for any of them, and this builder writes none. It is a
 * `departing` boundary (`privacy/boundaries.test.ts`).
 *
 * ⚠️ **The goal's time-in-range target is NOT sent** ({@link goalsToSend}).
 * Spike 0022's rule R1 is that nothing on the ride path compares a block's
 * seconds in range with the goal's time-in-range target, and that a model is
 * not handed both. A summary carries a block's seconds in range, so the goal
 * is withheld. Whether it may be sent is an open question for the owner
 * (ADR 0048's amendment of 2026-10-12, on #1243); withholding is the answer
 * until they rule. The device's own validator still reads the whole goals.
 *
 * ## What arrives is untrusted
 *
 * A `result`'s `proposal` is handed on exactly as it was parsed: an
 * `unknown`. This module does not decode it, trim it or read a key of it.
 * The validator on the device (`@onyourleft/domain` §`validateProposal`)
 * decodes it whole or refuses it whole, so a proposal with one key too many
 * is refused there, in one place, and is never half-read here.
 */

import type { WorkoutBlock, WorkoutGoals } from '@onyourleft/domain';

import type { SealedInstanceAnswer } from '../instance/instance-transport';
import type { JobSession } from '../ride-analysis/instance-job';

/**
 * The instance's re-plan template version (`apps/instance`
 * §`replan-template.ts` §`REPLAN_TEMPLATE.version`), which is how it tells a
 * re-plan from a write-up. A request naming any other is refused
 * `validation_failed`, which is the static plan.
 *
 * ⚠️ **Written twice, and held together by one file.** `apps/web` and
 * `apps/instance` may not import each other, so this and the instance's own
 * are two constants. `packages/domain/src/workout/fixtures/replan-request.json`
 * is a request exactly as {@link replanRequest} builds it: `replan-job.test.ts`
 * fails when the builder stops producing it, and `apps/instance`
 * §`replan-golden.test.ts` fails when the instance's own start stops taking
 * it. So this constant, a key or a limit drifting on either side is a red
 * test on that side, not a feature that refuses every request.
 */
export const REPLAN_TEMPLATE_VERSION = 're-plan-1';

/**
 * Where the instance runs the job. Only its own local model: a hosted
 * re-plan (ADR 0048 D-11, on the rider's own key) needs the masking list
 * sent first, as a hosted write-up does, and is not built here.
 */
export const REPLAN_SOURCE = 'instance-local';

/** One block already ridden, as this device measured it. An absent figure was not recorded. */
export interface BlockSummary {
  readonly block: number;
  /** How long the block was ridden for, in seconds of the workout's own clock. */
  readonly seconds: number;
  readonly meanHeartRate?: number;
  readonly highestHeartRate?: number;
  /** Seconds the heart rate was inside a hold block's range. A hold block only. */
  readonly secondsInRange?: number;
  /** Mean power as a share of the rider's own threshold power. */
  readonly meanPowerShare?: number;
  readonly meanCadence?: number;
  /** How many times the stall rescue eased the target in this block. */
  readonly rescues: number;
}

/** What a re-plan job is run over: exactly these six keys. */
export interface ReplanInput {
  readonly revision: number;
  readonly summarySeq: number;
  readonly currentBlock: number;
  readonly goals: WorkoutGoals;
  readonly blocks: readonly Readonly<Record<string, unknown>>[];
  readonly summaries: readonly BlockSummary[];
}

/** A start's body: exactly these keys (`apps/instance` §`analysis/routes.ts`). */
export interface ReplanRequest {
  readonly input: ReplanInput;
  readonly templateVersion: string;
  readonly source: string;
}

/**
 * The goals as they are sent: each typed goal NAMED, as {@link blockToSend}
 * names a block's keys, and the time-in-range target not among them. So a
 * goal added to `WorkoutGoals` later is not sent until this says so, and the
 * privacy policy's list of the goals that leave is this list.
 *
 * @see the file comment — spike 0022's rule R1, withheld until the owner rules.
 */
export function goalsToSend(goals: WorkoutGoals): WorkoutGoals {
  return {
    ...(goals.sessionType === undefined ? {} : { sessionType: goals.sessionType }),
    ...(goals.durationMinutes === undefined ? {} : { durationMinutes: goals.durationMinutes }),
    ...(goals.holdRange === undefined
      ? {}
      : { holdRange: { low: goals.holdRange.low, high: goals.holdRange.high } }),
    ...(goals.heartRateAbove === undefined ? {} : { heartRateAbove: goals.heartRateAbove }),
    ...(goals.powerCeiling === undefined ? {} : { powerCeiling: goals.powerCeiling }),
    ...(goals.effortCheckIns === undefined ? {} : { effortCheckIns: goals.effortCheckIns }),
  };
}

/**
 * One block as it is sent: its kind and its figures, named key by key, so a
 * label (free text the rider typed) or a key added to a block later is not
 * sent until this says so.
 */
function blockToSend(block: WorkoutBlock): Readonly<Record<string, unknown>> {
  switch (block.kind) {
    case 'steady':
      return { kind: block.kind, seconds: block.seconds, target: block.target };
    case 'ramp':
      return { kind: block.kind, seconds: block.seconds, from: block.from, to: block.to };
    case 'intervals':
      return {
        kind: block.kind,
        repeats: block.repeats,
        hardSeconds: block.hardSeconds,
        hardTarget: block.hardTarget,
        easySeconds: block.easySeconds,
        easyTarget: block.easyTarget,
      };
    case 'free-ride':
      return { kind: block.kind, seconds: block.seconds };
    case 'heart-rate-hold':
      return {
        kind: block.kind,
        seconds: block.seconds,
        startShare: block.startShare,
        ceilingShare: block.ceilingShare,
        range: { low: block.range.low, high: block.range.high },
      };
  }
}

/** One summary as it is sent: the keys {@link BlockSummary} names, and no other. */
function summaryToSend(summary: BlockSummary): BlockSummary {
  return {
    block: summary.block,
    seconds: summary.seconds,
    ...(summary.meanHeartRate === undefined ? {} : { meanHeartRate: summary.meanHeartRate }),
    ...(summary.highestHeartRate === undefined
      ? {}
      : { highestHeartRate: summary.highestHeartRate }),
    ...(summary.secondsInRange === undefined ? {} : { secondsInRange: summary.secondsInRange }),
    ...(summary.meanPowerShare === undefined ? {} : { meanPowerShare: summary.meanPowerShare }),
    ...(summary.meanCadence === undefined ? {} : { meanCadence: summary.meanCadence }),
    rescues: summary.rescues,
  };
}

/** The ONE builder of a re-plan's input — see the file comment. */
export function replanInput(from: {
  readonly revision: number;
  readonly summarySeq: number;
  readonly currentBlock: number;
  readonly goals: WorkoutGoals;
  readonly blocks: readonly WorkoutBlock[];
  readonly summaries: readonly BlockSummary[];
}): ReplanInput {
  return {
    revision: from.revision,
    summarySeq: from.summarySeq,
    currentBlock: from.currentBlock,
    goals: goalsToSend(from.goals),
    blocks: from.blocks.map(blockToSend),
    summaries: from.summaries.map(summaryToSend),
  };
}

/**
 * The most a re-plan's input may be, serialised, in bytes (`apps/instance`
 * §`replan-input.ts` §`REPLAN_INPUT_BYTE_BUDGET`). An input over it is refused
 * `validation_failed`, which would end the asking for the workout.
 */
export const REPLAN_INPUT_BYTE_BUDGET = 8 * 1024;

/** The most summaries one input may carry (`apps/instance` §`MAXIMUM_INPUT_SUMMARIES`). */
export const REPLAN_MAXIMUM_SUMMARIES = 64;

const bytesOf = (input: ReplanInput): number =>
  new TextEncoder().encode(JSON.stringify(input)).byteLength;

/**
 * {@link replanInput}, held to what the instance reads: at most
 * {@link REPLAN_MAXIMUM_SUMMARIES} summaries and {@link REPLAN_INPUT_BYTE_BUDGET}
 * bytes. The plan's blocks and the goals are always sent whole; when the
 * summaries do not all fit, **the oldest are left out and the most recent
 * sent**, so a long workout is asked about with less history rather than not
 * at all. The instance takes any one or more of them (`replan-input.ts`
 * §`readReplanInput`: a list that is not empty).
 *
 * `undefined` when not even the latest summary fits beside the plan, or
 * there is none: nothing is sent then.
 */
export function replanInputWithin(
  from: Parameters<typeof replanInput>[0],
  budget: number = REPLAN_INPUT_BYTE_BUDGET,
): ReplanInput | undefined {
  let summaries = from.summaries.slice(-REPLAN_MAXIMUM_SUMMARIES);
  while (summaries.length > 0) {
    const input = replanInput({ ...from, summaries });
    if (bytesOf(input) <= budget) {
      return input;
    }
    summaries = summaries.slice(1);
  }
  return undefined;
}

/** The ONE builder of a re-plan request. The instance refuses any key it does not name. */
export function replanRequest(input: ReplanInput): ReplanRequest {
  return { input, templateVersion: REPLAN_TEMPLATE_VERSION, source: REPLAN_SOURCE };
}

/** A job id the instance writes: a path segment and nothing else. */
const JOB_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A refusal code the instance names: a short identifier. Anything else is read as no code. */
const CODE = /^[a-z][a-z0-9_-]{0,63}$/;

/** How a start went. */
export type StartedReplan =
  | { readonly kind: 'started'; readonly jobId: string }
  /** The instance refused; `code` is its error code, when it named one. */
  | { readonly kind: 'refused'; readonly code?: string }
  /** No answer: nothing is known to have been queued. */
  | { readonly kind: 'unreachable' };

/** `POST /v1/analysis/replans`. Settles; never rejects. */
export async function startReplan(
  session: Extract<JobSession, { kind: 'open' }>,
  request: ReplanRequest,
): Promise<StartedReplan> {
  let answer: Pick<SealedInstanceAnswer, 'status' | 'body'>;
  try {
    answer = await session.channel.call('POST', '/v1/analysis/replans', {
      token: session.token,
      body: { ...request },
    });
  } catch {
    return { kind: 'unreachable' };
  }
  const jobId = (answer.body as { jobId?: unknown } | null)?.jobId;
  if (answer.status === 202 && typeof jobId === 'string' && JOB_ID.test(jobId)) {
    return { kind: 'started', jobId };
  }
  const code = (answer.body as { error?: { code?: unknown } } | null)?.error?.code;
  return {
    kind: 'refused',
    ...(typeof code === 'string' && CODE.test(code) ? { code } : {}),
  };
}

/** How a re-plan job ended, as far as this device could read. */
export type ReplanResult =
  /**
   * The job succeeded and carried this. ⚠️ Untrusted and undecoded: `null`
   * is the model keeping the workout as it is, and anything else is for the
   * validator to read whole or refuse whole.
   */
  | { readonly kind: 'proposal'; readonly proposal: unknown }
  /** The job ended any other way: failed, cancelled, withheld. Never a proposal. */
  | { readonly kind: 'none' }
  /** The stream ended, was refused or could not be read before a result arrived. */
  | { readonly kind: 'lost' };

/** One `result` event's JSON, read. `undefined` when it is not one this build can read. */
function readResult(data: string): ReplanResult | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const body = parsed as Readonly<Record<string, unknown>>;
  if (body.status === 'succeeded') {
    return Object.hasOwn(body, 'proposal')
      ? { kind: 'proposal', proposal: body.proposal }
      : { kind: 'none' };
  }
  return typeof body.status === 'string' ? { kind: 'none' } : undefined;
}

/**
 * `GET /v1/analysis/jobs/{jobId}/events`, read to its `result`. A re-plan's
 * stream holds `progress` and `result` only; every other event is skipped.
 *
 * ⚠️ **One read, and no resume.** A write-up's stream is followed again after
 * a cut (`instance-job.ts` §`followJob`), because a write-up is worth waiting
 * minutes for. A re-plan that is late is dropped (ADR 0048 D-7), so a cut
 * stream is `lost` and the caller asks nothing more of this job. Settles;
 * never rejects.
 */
export async function followReplan(
  session: Extract<JobSession, { kind: 'open' }>,
  jobId: string,
  signal: AbortSignal,
): Promise<ReplanResult> {
  if (!JOB_ID.test(jobId)) {
    return { kind: 'lost' };
  }
  let result: ReplanResult | undefined;
  try {
    await session.channel.stream(`/v1/analysis/jobs/${jobId}/events`, {
      token: session.token,
      signal,
      onEvent: ({ kind, data }) => {
        if (result === undefined && kind === 'result') {
          result = readResult(data) ?? { kind: 'lost' };
        }
      },
    });
  } catch {
    // A result read before the stream broke is still the job's result.
  }
  return result ?? { kind: 'lost' };
}
