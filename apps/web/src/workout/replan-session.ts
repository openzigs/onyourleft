// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The device half of re-plans during a ride** — #1244, ADR 0048 D-5 to
 * D-10.
 *
 * At a block boundary it sends the rider's instance a summary of each block
 * ridden, waits for one proposal, hands it to the device's own validator
 * (`@onyourleft/domain` §`validateProposal`), and gives an accepted one to
 * the workout's player to read from the next boundary. It keeps the record
 * of every decision (P9) and the words a screen shows.
 *
 * ## It writes nothing to the trainer, and cannot
 *
 * This module holds no trainer, no writer and no control point. The whole of
 * what it can do to a ride is {@link ReplanSessionOptions.revise}: hand the
 * player a timeline. The player checks that timeline itself, keeps it waiting
 * until the block being ridden has ended, and then asks for the next target
 * through the one ERG writer every workout target goes through (ADR 0048
 * D-2). So no proposal, and no failure in here, causes a write by itself.
 *
 * ## Every failure is the plan already on the device (P8, D-9)
 *
 * No instance, a session that will not open, a request refused, a stream
 * that breaks, a job that fails, an answer that is not a proposal, a proposal
 * the validator refuses: each leaves the plan as it is. At most
 * {@link REPLAN_UNAVAILABLE} is shown, and a refused proposal shows nothing.
 *
 * ## One job, and never a storm
 *
 * - **At most one job in flight.** A job is asked for only as a block
 *   begins, and one still out thirty seconds before the block ends is
 *   dropped, so none is out when the next could be asked for.
 * - **No job is started or left running while the ride is paused or the
 *   stall rescue holds the target** (P6).
 * - **Nothing is ever sent twice, and a failure is never followed at once.**
 *   A request that failed is not repeated: the next one is the next block
 *   boundary, and at least {@link REPLAN_ASK_INTERVAL_SECONDS} after the
 *   last, whatever the last one's fate. That is at most 20 an hour, under
 *   the instance's own limit of 24 (`apps/instance` §`jobs.ts`
 *   §`DEFAULT_REPLAN_STARTS`), which a refused start still spends.
 * - **A request the instance refuses with one of {@link PERMANENT_REFUSALS}**
 *   — a reason that will not change during this workout — **ends the asking
 *   for it**, and so does a sign-in this device no longer holds. **Anything
 *   else does not**: `job_running` (a write-up on the same worker),
 *   `unavailable`, a 5xx the tunnel relayed with no code, an answer this
 *   build cannot read, a session that threw as it was opened. Each is the
 *   plan as it stands and one short line, and the next boundary may ask.
 *   The list is of what is known to be permanent, so an answer nobody
 *   foresaw waits for the next block rather than switching re-plans off.
 *
 * ## What is sent is bounded
 *
 * `replan-job.ts` §`replanInputWithin` holds a request to the instance's 8 KB
 * input budget by leaving out the oldest summaries, so a long workout is
 * asked about with less history rather than refused `validation_failed`. A
 * plan too long for even one summary to fit beside it is not asked about.
 *
 * ## A late answer is dropped, and this is why it is not `useAnalysis.ts`
 *
 * `camera/useAnalysis.ts` lets *"a late answer still win"*: its answer fills a
 * panel the rider asked for, and late is better than never. Here an answer
 * changes what a trainer will be told, about a block that is getting nearer.
 * An answer older than {@link REPLAN_FRESHNESS_SECONDS} was computed from a
 * ride that has moved on, and one inside
 * {@link REPLAN_BOUNDARY_LEAD_SECONDS} of the boundary leaves the rider no
 * time to read it and press *Keep the plan*. So both are dropped, twice over:
 * the tick that sees either limit pass cancels the job and stops listening,
 * and the validator refuses the same proposal under P5 or P2 if it arrives
 * anyway. Dropped means nothing is shown and nothing is said (ADR 0048 D-7).
 *
 * ## What leaves the device
 *
 * `replan-job.ts` §`replanInput` builds it, and it is the whole of it: one
 * summary a block. Nothing leaves at all unless the rider switched re-plans
 * on for this ride, because this session is only made then
 * (`ride/controller.ts` §`startWorkout`).
 *
 * ⚠️ **No figure of how well the plan is being followed is computed here**
 * (spike 0022's rule R1). A block's seconds in range is counted and sent; it
 * is never divided by anything, summed across blocks or compared with a goal.
 */

import {
  expandWorkout,
  loadPlan,
  MAXIMUM_HOLD_BPM,
  MAXIMUM_SHARE,
  MINIMUM_HOLD_BPM,
  planNotApplied,
  planWorkout,
  REPLAN_BOUNDARY_LEAD_SECONDS,
  REPLAN_FRESHNESS_SECONDS,
  REPLAN_MOVE_INTERVAL_SECONDS,
  seconds,
  validateProposal,
  type OwnThresholds,
  type PlanRevision,
  type PlayerPlan,
  type PlayerStatus,
  type ReplanNotApplied,
  type ReplanRecord,
  type SavedWorkout,
  type Seconds,
  type TrainerPowerRange,
  type Workout,
  type WorkoutGoals,
  type WorkoutSegment,
  type WorkoutTimeline,
} from '@onyourleft/domain';

import { cancelJob, type JobSession } from '../ride-analysis/instance-job';

import {
  followReplan,
  replanInputWithin,
  replanRequest,
  startReplan,
  type BlockSummary,
  type ReplanInput,
} from './replan-job';
import { reasonPremiseHolds } from './replan-reason';
import { REPLAN_UNAVAILABLE, replanSentence, type WaitingReplan } from './replan-text';

/**
 * The least time between two requests, in seconds: ADR 0048 D-10's *"at most
 * every 3 minutes"*, which is also P4's interval between two accepted moves.
 */
export const REPLAN_ASK_INTERVAL_SECONDS = REPLAN_MOVE_INTERVAL_SECONDS;

/** The most blocks a plan may have and still be sent (`apps/instance` §`MAXIMUM_PLAN_BLOCKS`). */
export const REPLAN_MAXIMUM_BLOCKS = 64;

/** The most a block's summary may count (`apps/instance` §`replan-input.ts`). */
const MAXIMUM_SUMMARY_SECONDS = 86_400;
const MAXIMUM_CADENCE = 250;
const MAXIMUM_RESCUES = 1_000;

/** The longest one tick is counted as, so a stalled tab does not count a minute as in range. */
const LONGEST_TICK_SECONDS = 5;

/**
 * The refusals that end the asking for this workout: each is a reason that
 * will not change before it ends (`apps/instance` §`analysis/routes.ts`, the
 * re-plan start's `errors`). `unauthenticated` is a session the instance no
 * longer accepts; `validation_failed` is a request this build will build the
 * same way again; `rate_limited` is the hour's allowance spent, and asking
 * again would only spend the next; `analysis_off` is an instance with no
 * model. **Every other answer is tried again at the next block boundary.**
 */
export const PERMANENT_REFUSALS: readonly string[] = [
  'unauthenticated',
  'validation_failed',
  'rate_limited',
  'analysis_off',
];

/** The ride as it is now, read by the session whenever it needs it. */
export interface ReplanRideFacts {
  readonly status: PlayerStatus;
  /** How far into the workout, in seconds of its own clock. */
  readonly elapsed: number;
  /** P6: the stall rescue holds the target. */
  readonly rescue: boolean;
  /** P6: trainer control is held. */
  readonly control: boolean;
  /** P6, H1: a heart-rate strap is paired. */
  readonly heartRatePaired: boolean;
  /** Live readings, each `undefined` when it is not live. Never a zero for a gap. */
  readonly power: number | undefined;
  readonly heartRate: number | undefined;
  readonly cadence: number | undefined;
}

export interface ReplanSessionOptions {
  /** The workout the rider loaded: revision 0 of the plan. */
  readonly loaded: Workout;
  /** The rider's own thresholds (H1); the validator refuses a substituted one. */
  readonly athlete: OwnThresholds;
  /** The Supported Power Range the trainer itself reported. */
  readonly machine: TrainerPowerRange;
  /** The rider's typed goals, as this device holds them. */
  readonly goals: WorkoutGoals;
  /** The rider's own saved workouts, the only source of a swap. */
  readonly library: readonly SavedWorkout[];
  /** The sealed session a job runs under, asked for each job. */
  readonly session: () => Promise<JobSession>;
  readonly ride: () => ReplanRideFacts;
  /** `WorkoutSession.plan`. */
  readonly plan: () => PlayerPlan;
  /** `WorkoutSession.revise`: the ONE thing this session can do to a ride. */
  readonly revise: (timeline: WorkoutTimeline) => boolean;
  /** `WorkoutSession.keepPlan`. */
  readonly keepPlan: () => boolean;
  /** The ride's clock, the one every `tick` is stamped on. */
  readonly clock: () => Seconds;
  /**
   * When this RIDE last sent a request, across every workout in it — the
   * ride controller's memory, since a ride can hold more than one workout and
   * each has a session of its own. *"Never more often than every 3 minutes"*
   * is said of the ride (#1245's disclosure), and so is the hour's bound that
   * follows from it: a rider who starts a second workout a minute after the
   * first asked does not make a second request a minute after the first.
   * Absent, the session's own last request is all it knows.
   */
  readonly asked?:
    { readonly last: () => Seconds | undefined; readonly note: (at: Seconds) => void } | undefined;
  readonly onChange?: (() => void) | undefined;
}

/** What a screen reads. */
export interface ReplanState {
  /** An accepted move waiting for its boundary: the sentence, and *Keep the plan*. */
  readonly waiting: WaitingReplan | undefined;
  /** The rider pressed *Keep the plan* in the block being ridden. */
  readonly kept: boolean;
  /** {@link REPLAN_UNAVAILABLE}, after a request that failed. */
  readonly notice: string | undefined;
  /**
   * The rider switched re-plans off for the rest of this workout
   * ({@link ReplanSession.switchOff}). Nothing more is sent, and it does not
   * come back on until another workout is started with the switch on.
   */
  readonly off: boolean;
  /**
   * The revision of a waiting move that a pause or a lost trainer discarded
   * in the block being ridden (ADR 0048 D-8), for the one sentence that says
   * so. `undefined` once that block has ended, or another move is accepted.
   */
  readonly discarded: number | undefined;
  /**
   * What a re-plan replaced, from its boundary on, for the graph: the
   * waiting move's while one waits, else that of the last move that REACHED
   * the plan. So a move the rider kept the plan from, or one that was
   * discarded, takes its own outline away with it and leaves the outline of
   * an earlier applied move, if there was one, where it was.
   */
  readonly replaced: readonly WorkoutSegment[] | undefined;
}

export interface ReplanSession {
  /** Once a second, after the workout's own tick. Never throws. */
  tick(now: Seconds): void;
  /** *Keep the plan*: drop the waiting move. `false` when none was waiting. */
  keepThePlan(): boolean;
  /**
   * The rider's mid-workout switch (ADR 0048 D-7: *"A per-ride switch turns
   * re-plans off"*): from this call no request leaves for this workout, a
   * job in flight is cancelled and never listened to, and a move waiting for
   * the next block is DROPPED, so the plan being ridden carries on — a rider
   * who has just said "no more changes" is not then handed one. It cannot be
   * switched back on: the session is over, as after {@link stop}. `false`
   * when it was already off or over. It writes nothing to the trainer.
   */
  switchOff(): boolean;
  /** The workout is over: drop everything, cancel a job in flight, and listen to nothing more. */
  stop(): void;
  state(): ReplanState;
  /** P9: every decision so far, oldest first. */
  records(): readonly ReplanRecord[];
  /** Resolves once the request in flight, if any, has run its course. For tests. */
  settled(): Promise<void>;
}

/** Where a workout offset falls in a plan. */
interface Where {
  readonly block: number;
  /** Seconds until the block being ridden ends. */
  readonly remaining: number;
  readonly last: boolean;
}

function whereIn(timeline: WorkoutTimeline, elapsed: number): Where | undefined {
  const riding = timeline.segments.find(
    (segment) => elapsed >= segment.startsAt && elapsed < segment.endsAt,
  );
  if (riding === undefined) {
    return undefined;
  }
  let end: number = riding.endsAt;
  for (const segment of timeline.segments) {
    if (segment.block === riding.block && segment.endsAt > end) {
      end = segment.endsAt;
    }
  }
  return {
    block: riding.block,
    remaining: end - elapsed,
    last: riding.block === (timeline.segments.at(-1)?.block ?? riding.block),
  };
}

/** What is counted while a block is ridden. Sums and counts: a mean is taken once, at the end. */
interface Gathering {
  readonly block: number;
  readonly startedAt: number;
  /** The hold's range, when the block is a hold: what "in range" is counted against. */
  readonly range: { readonly low: number; readonly high: number } | undefined;
  heartRateSum: number;
  heartRateCount: number;
  highestHeartRate: number;
  secondsInRange: number;
  powerSum: number;
  powerCount: number;
  cadenceSum: number;
  cadenceCount: number;
  rescues: number;
  inRescue: boolean;
  lastElapsed: number;
}

function gatheringFor(timeline: WorkoutTimeline, block: number, elapsed: number): Gathering {
  const hold = timeline.segments.find((segment) => segment.block === block)?.hold;
  return {
    block,
    startedAt: elapsed,
    range: hold === undefined ? undefined : { low: hold.range.low, high: hold.range.high },
    heartRateSum: 0,
    heartRateCount: 0,
    highestHeartRate: 0,
    secondsInRange: 0,
    powerSum: 0,
    powerCount: 0,
    cadenceSum: 0,
    cadenceCount: 0,
    rescues: 0,
    inRescue: false,
    lastElapsed: elapsed,
  };
}

/**
 * Count the time from the last tick up to `until` as in or out of the hold's
 * range, by the heart rate read now. Time only: no reading is added to a
 * mean, a highest or a count.
 */
function gatherTime(into: Gathering, facts: ReplanRideFacts, until: number): void {
  const step = Math.min(LONGEST_TICK_SECONDS, Math.max(0, until - into.lastElapsed));
  into.lastElapsed = until;
  if (
    into.range !== undefined &&
    facts.heartRate !== undefined &&
    facts.heartRate >= into.range.low &&
    facts.heartRate <= into.range.high
  ) {
    into.secondsInRange += step;
  }
}

/** One tick of the block being ridden: its time, and one reading of each figure. */
function gather(into: Gathering, facts: ReplanRideFacts): void {
  gatherTime(into, facts, facts.elapsed);
  if (facts.heartRate !== undefined) {
    into.heartRateSum += facts.heartRate;
    into.heartRateCount += 1;
    into.highestHeartRate = Math.max(into.highestHeartRate, facts.heartRate);
  }
  if (facts.power !== undefined) {
    into.powerSum += facts.power;
    into.powerCount += 1;
  }
  if (facts.cadence !== undefined) {
    into.cadenceSum += facts.cadence;
    into.cadenceCount += 1;
  }
  if (facts.rescue && !into.inRescue) {
    into.rescues += 1;
  }
  into.inRescue = facts.rescue;
}

/** `value` when it is inside what the instance reads for that figure, else nothing. */
function within(value: number, minimum: number, maximum: number): number | undefined {
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

/**
 * One block's summary. A figure with no reading behind it, or outside what
 * the instance reads, is left out: an absent figure is "not recorded", and a
 * made-up or clamped one would be read as a measurement.
 */
function summaryOf(from: Gathering, endedAt: number, thresholdPower: number): BlockSummary {
  const length = Math.min(
    MAXIMUM_SUMMARY_SECONDS,
    Math.max(0, Math.round(endedAt - from.startedAt)),
  );
  const meanHeartRate =
    from.heartRateCount === 0
      ? undefined
      : within(
          Math.round(from.heartRateSum / from.heartRateCount),
          MINIMUM_HOLD_BPM,
          MAXIMUM_HOLD_BPM,
        );
  const highestHeartRate =
    from.heartRateCount === 0
      ? undefined
      : within(Math.round(from.highestHeartRate), MINIMUM_HOLD_BPM, MAXIMUM_HOLD_BPM);
  const meanPowerShare =
    from.powerCount === 0
      ? undefined
      : within(
          Math.round((from.powerSum / from.powerCount / thresholdPower) * 1000) / 1000,
          0,
          MAXIMUM_SHARE,
        );
  const meanCadence =
    from.cadenceCount === 0
      ? undefined
      : within(Math.round(from.cadenceSum / from.cadenceCount), 0, MAXIMUM_CADENCE);
  return {
    block: from.block,
    seconds: length,
    ...(meanHeartRate === undefined ? {} : { meanHeartRate }),
    ...(highestHeartRate === undefined ? {} : { highestHeartRate }),
    ...(from.range === undefined || from.heartRateCount === 0
      ? {}
      : { secondsInRange: Math.min(length, Math.round(from.secondsInRange)) }),
    ...(meanPowerShare === undefined ? {} : { meanPowerShare }),
    ...(meanCadence === undefined ? {} : { meanCadence }),
    rescues: Math.min(MAXIMUM_RESCUES, from.rescues),
  };
}

/** A request that has left, or is about to. */
interface Flight {
  readonly abort: AbortController;
  readonly sentAt: number;
  /** What left: a reason is said only when its premise holds in THIS (`replan-reason.ts`). */
  readonly sent: ReplanInput;
  session: Extract<JobSession, { kind: 'open' }> | undefined;
  jobId: string | undefined;
}

/** An accepted move waiting for its boundary. */
interface Waiting {
  readonly plan: PlanRevision;
  readonly timeline: WorkoutTimeline;
  readonly sentence: string;
  readonly replaced: readonly WorkoutSegment[];
}

export function createReplanSession(options: ReplanSessionOptions): ReplanSession {
  const { athlete, machine, goals, library } = options;

  /** The plan the player is riding. */
  let riding: PlanRevision = loadPlan(options.loaded);
  /** The plan as last revised: {@link riding}, or the revision {@link waiting} holds. */
  let latest: PlanRevision = riding;
  let waiting: Waiting | undefined;
  /** What the last move that reached the plan replaced. */
  let replaced: readonly WorkoutSegment[] | undefined;
  let kept = false;
  /** @see ReplanState.off */
  let off = false;
  /** The revision of a waiting move a pause or a lost trainer discarded. @see ReplanState.discarded */
  let discarded: number | undefined;
  let notice: string | undefined;

  const summaries: BlockSummary[] = [];
  let gathering: Gathering | undefined;
  /** The latest summary sent: its number, and when it left. P5 reads both. */
  let summary: { readonly seq: number; readonly sentAt: Seconds } | undefined;
  let flight: Flight | undefined;
  /** Set by a refusal that will not change, and by `stop`: nothing more is asked. */
  let shut = false;
  let stopped = false;
  const records: ReplanRecord[] = [];
  let lastTick: { readonly at: number; readonly elapsed: number; readonly running: boolean } = {
    at: 0,
    elapsed: 0,
    running: false,
  };
  let running: Promise<void> = Promise.resolve();

  const changed = (): void => {
    options.onChange?.();
  };

  /** When a request last left: this session's, or an earlier workout's in the same ride. */
  const lastAskedAt = (): number | undefined => {
    const mine = summary?.sentAt;
    const rides = options.asked?.last();
    if (mine === undefined) return rides;
    return rides === undefined ? mine : Math.max(mine, rides);
  };

  /** Stop listening to the request in flight, and cancel its job if it has one. */
  const drop = (): void => {
    const dropped = flight;
    if (dropped === undefined) {
      return;
    }
    flight = undefined;
    dropped.abort.abort();
    if (dropped.session !== undefined && dropped.jobId !== undefined) {
      void cancelJob(dropped.session, dropped.jobId);
    }
  };

  /** The request failed: the plan stands, and one short line says so. */
  const failed = (from: Flight, forGood: boolean): void => {
    if (flight === from) {
      flight = undefined;
    }
    shut ||= forGood;
    notice = REPLAN_UNAVAILABLE;
    changed();
  };

  /**
   * Bring this session's view of the plan up to the player's. A waiting move
   * the player has started reading is now the plan; one the player no longer
   * holds was dropped — by *Keep the plan*, a pause, a lost link or the end.
   */
  const reconcile = (why: ReplanNotApplied): void => {
    if (waiting === undefined) {
      return;
    }
    const plan = options.plan();
    if (plan.waiting === waiting.timeline) {
      return;
    }
    if (plan.riding === waiting.timeline) {
      riding = waiting.plan;
      replaced = waiting.replaced;
    } else {
      latest = planNotApplied(riding, waiting.plan);
      riding = latest;
      records.push({
        decision: 'not-applied',
        why,
        revision: waiting.plan.revision,
        at: options.clock(),
      });
      if (why === 'paused') {
        discarded = waiting.plan.revision;
      }
    }
    waiting = undefined;
    changed();
  };

  /**
   * What a screen is shown of the waiting move, read against the PLAYER now
   * and not against the last tick. The player drops a waiting revision the
   * moment a ride pauses or the trainer is lost, and the screen's plan is
   * the player's (`ride/controller.ts` §`workoutSnapshot`), so the sentence,
   * the control, the dotted outline and the plan ahead all change in the
   * same snapshot. {@link reconcile} writes the record on the next tick.
   */
  const shown = (): Pick<ReplanState, 'waiting' | 'discarded' | 'replaced'> => {
    if (waiting === undefined) {
      return { waiting: undefined, discarded, replaced };
    }
    const plan = options.plan();
    if (plan.waiting === waiting.timeline) {
      return {
        waiting: { revision: waiting.plan.revision, sentence: waiting.sentence },
        discarded: undefined,
        replaced: waiting.replaced,
      };
    }
    if (plan.riding === waiting.timeline) {
      // Its boundary has passed: it is the plan, and nothing waits.
      return { waiting: undefined, discarded: undefined, replaced: waiting.replaced };
    }
    // The player no longer holds it, and no press of *Keep the plan* did that
    // (`keepThePlan` reconciles at once): a pause or a lost trainer.
    return { waiting: undefined, discarded: waiting.plan.revision, replaced };
  };

  /** A proposal arrived in time to be read. The validator decides; nothing here does. */
  const arrived = (proposal: unknown, sent: ReplanInput): void => {
    const now = options.clock();
    const facts = options.ride();
    reconcile('paused');
    const position = lastTick.running
      ? lastTick.elapsed + Math.max(0, now - lastTick.at)
      : lastTick.elapsed;
    const decided = validateProposal(
      proposal,
      {
        plan: latest,
        position: seconds(Math.max(0, position)),
        summary,
        // P7: this session exists only for a ride the rider switched re-plans on for.
        enabled: true,
        paused: facts.status !== 'running',
        rescue: facts.rescue,
        control: facts.control,
        heartRatePaired: facts.heartRatePaired,
        library,
      },
      goals,
      athlete,
      machine,
      now,
    );
    notice = undefined;
    if (!decided.ok || decided.record.decision !== 'accepted') {
      // Refused: the plan stands, and nothing is shown or said (D-7).
      records.push(decided.record);
      changed();
      return;
    }
    const before = options.plan().riding;
    const timeline = expandWorkout(decided.workout);
    // The reason is the model's. It is SAID only when this device can see its
    // premise in what it sent, and the record says when it was not.
    const reasonShown = reasonPremiseHolds(decided.record.reason, sent);
    // Before the record is kept: a hand-over that throws leaves no record of
    // a move that was never handed over (`run`'s caller says the one line).
    const taken = options.revise(timeline);
    records.push(reasonShown ? decided.record : { ...decided.record, reasonNotShown: true });
    if (!taken) {
      // The player would not take it, so it is not the plan and never was.
      latest = planNotApplied(riding, decided.plan);
      riding = latest;
      records.push({
        decision: 'not-applied',
        why: 'not-taken',
        revision: decided.plan.revision,
        at: now,
      });
      changed();
      return;
    }
    latest = decided.plan;
    kept = false;
    discarded = undefined;
    waiting = {
      plan: decided.plan,
      timeline,
      sentence: replanSentence(
        decided.record.move,
        reasonShown ? decided.record.reason : undefined,
        decided.fromBlock,
      ),
      replaced: before.segments.filter((segment) => segment.block >= decided.fromBlock),
    };
    changed();
  };

  const run = async (from: Flight, input: ReplanInput): Promise<void> => {
    let opened: JobSession;
    try {
      opened = await options.session();
    } catch {
      // Nothing is known about the sign-in: the next boundary may ask.
      if (!from.abort.signal.aborted) {
        failed(from, false);
      }
      return;
    }
    if (from.abort.signal.aborted) {
      return;
    }
    if (opened.kind !== 'open') {
      // This device holds no sign-in the instance would take.
      failed(from, true);
      return;
    }
    from.session = opened;
    const started = await startReplan(opened, replanRequest(input));
    if (started.kind === 'started') {
      from.jobId = started.jobId;
    }
    if (from.abort.signal.aborted) {
      // Dropped while the start was on the wire: the job it made is cancelled.
      if (started.kind === 'started') {
        void cancelJob(opened, started.jobId);
      }
      return;
    }
    if (started.kind !== 'started') {
      failed(
        from,
        started.kind === 'refused' &&
          started.code !== undefined &&
          PERMANENT_REFUSALS.includes(started.code),
      );
      return;
    }
    const result = await followReplan(opened, started.jobId, from.abort.signal);
    if (from.abort.signal.aborted || flight !== from) {
      return;
    }
    flight = undefined;
    if (result.kind === 'lost') {
      // Nobody is listening for it any more, so it is not left running.
      void cancelJob(opened, started.jobId);
      failed(from, false);
      return;
    }
    if (result.kind === 'none') {
      failed(from, false);
      return;
    }
    if (result.proposal === null) {
      // The model kept the workout as it is: a job that worked, and no move.
      notice = undefined;
      changed();
      return;
    }
    arrived(result.proposal, from.sent);
  };

  const ask = (now: Seconds, where: Where): void => {
    const seq = (summary?.seq ?? 0) + 1;
    const input = replanInputWithin({
      revision: latest.revision,
      summarySeq: seq,
      currentBlock: where.block,
      goals,
      blocks: planWorkout(latest).blocks,
      summaries,
    });
    if (input === undefined) {
      // The plan leaves no room for a summary beside it: nothing is sent.
      return;
    }
    summary = { seq, sentAt: now };
    options.asked?.note(now);
    const leaving: Flight = {
      abort: new AbortController(),
      sentAt: now,
      sent: input,
      session: undefined,
      jobId: undefined,
    };
    flight = leaving;
    running = run(leaving, input).catch(() => {
      failed(leaving, false);
    });
  };

  return {
    tick(now: Seconds): void {
      if (stopped) {
        return;
      }
      const facts = options.ride();
      reconcile('paused');
      lastTick = { at: now, elapsed: facts.elapsed, running: facts.status === 'running' };
      const timeline = options.plan().riding;
      const where = facts.status === 'running' ? whereIn(timeline, facts.elapsed) : undefined;
      if (where === undefined) {
        // Paused, finished or past the end: no job is left running (P6).
        drop();
        return;
      }

      let boundary = false;
      // Where the block being ridden began, which is where the one before ended.
      const beganAt =
        timeline.segments.find((segment) => segment.block === where.block)?.startsAt ??
        facts.elapsed;
      if (gathering === undefined) {
        gathering = gatheringFor(timeline, where.block, beganAt);
      } else if (gathering.block !== where.block) {
        // The time up to the boundary is the ended block's own. The READING
        // of this tick is not: it is counted once, below, in the block that
        // has begun, so no sample is in two blocks' means.
        gatherTime(gathering, facts, beganAt);
        summaries.push(summaryOf(gathering, beganAt, athlete.thresholdPower));
        gathering = gatheringFor(timeline, where.block, beganAt);
        boundary = true;
        kept = false;
        discarded = undefined;
        // No job is out here: the last thirty seconds of a block drop one.
        changed();
      }
      gather(gathering, facts);

      // ⚠️ Without trainer control, or with no strap PAIRED, as well as in a
      // rescue (P6): a job out when control goes — a lost trainer link takes
      // control with it — is cancelled HERE, so its answer is not accepted
      // seconds after control returns, from summaries of a block that was
      // interrupted. D-8 drops a waiting move on a lost link; this is the
      // same rule for a move that has not arrived yet.
      //
      // ⚠️ The strap's half is a LIVE strap, not only a paired one (#1329).
      // `heartRatePaired` is H1's word: a heart-rate sensor is in the list
      // of paired devices. A strap that goes QUIET, or drops its own link,
      // is still paired, and until #1329 a job out then was not cancelled
      // and its answer was read. Now a heart rate that is not live (the
      // controller's `liveReading`, which goes `undefined` once a reading is
      // stale) cancels a job in flight as unpairing does, and no job is
      // started without one. The next boundary may ask again.
      const strap = facts.heartRatePaired && facts.heartRate !== undefined;
      if (
        flight !== undefined &&
        (facts.rescue ||
          !facts.control ||
          !strap ||
          now - flight.sentAt > REPLAN_FRESHNESS_SECONDS ||
          where.remaining < REPLAN_BOUNDARY_LEAD_SECONDS)
      ) {
        drop();
      }

      if (
        boundary &&
        !shut &&
        flight === undefined &&
        !facts.rescue &&
        facts.control &&
        strap &&
        !where.last &&
        where.remaining >= REPLAN_BOUNDARY_LEAD_SECONDS &&
        latest.blocks.length <= REPLAN_MAXIMUM_BLOCKS &&
        (lastAskedAt() === undefined || now - (lastAskedAt() ?? 0) >= REPLAN_ASK_INTERVAL_SECONDS)
      ) {
        ask(now, where);
      }
    },

    keepThePlan(): boolean {
      if (stopped || waiting === undefined) {
        return false;
      }
      const dropped = options.keepPlan();
      reconcile('kept');
      // `false`: the player was no longer holding it (its boundary had just
      // passed), so nothing was kept and nothing says the plan stayed.
      kept = dropped;
      changed();
      return dropped;
    },

    switchOff(): boolean {
      if (stopped) {
        return false;
      }
      if (waiting !== undefined) {
        // The rider said no more changes: the one waiting goes too.
        options.keepPlan();
        reconcile('switched-off');
      }
      stopped = true;
      shut = true;
      off = true;
      kept = false;
      discarded = undefined;
      notice = undefined;
      drop();
      changed();
      return true;
    },

    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      shut = true;
      drop();
      if (waiting !== undefined) {
        records.push({
          decision: 'not-applied',
          why: 'ended',
          revision: waiting.plan.revision,
          at: options.clock(),
        });
        waiting = undefined;
      }
      notice = undefined;
    },

    state: () => ({ ...shown(), kept, notice, off }),

    records: () => records,

    settled: () => running,
  };
}
