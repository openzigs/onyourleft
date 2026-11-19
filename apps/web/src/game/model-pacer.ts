// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The AI pacer during a ride** — #2712, ADR 0072, and since #2835 ADR 0083:
 * when to decide what the pacer does, when to ask the rider's instance for a
 * line, and what to do with each answer, on the ride's own clock.
 *
 * `GameView` calls {@link ModelPacer.frame} once per frame, after the
 * simulation has advanced, with the seconds ridden (`GameState.ridden`).
 * Every {@link MODEL_PACER_ASK_EVERY_S}, with no ask out:
 *
 * 1. **The device decides** (`@onyourleft/domain` §`pacerRuleDecision`): the
 *    intent and how far it goes, from the rider's gap and the road under the
 *    pacer. The decision is put in force on the simulation **at once**
 *    (§`GameSimulation.directPacer`).
 * 2. **It asks for a line**, telling the model what the pacer is doing and
 *    why (§`modelPacerInput`, and the director's own trends). **The ride
 *    never waits for the answer** (ADR 0072 D-7).
 * 3. When the answer has come back, the next frame logs the decision with
 *    what became of the ask — applied, late, invalid, refused or failed —
 *    and of its line, and shows a line that may be shown.
 *
 * **A failed, late or void answer costs a line, never the pacing** (ADR 0083
 * D-2): nothing a model writes reaches `direct`.
 *
 * ## What it never does
 *
 * - **Write to a trainer.** Nothing here names the trainer port, the
 *   gradient session or a workout: a direction moves the pacer, and the pacer
 *   reaches the rider only through the draft it gives, as riding harder does
 *   (ADR 0072 D-6). `model-pacer-wiring.test.tsx` holds it.
 * - **Decide or ask after a refusal.** A refused request (no consent, not
 *   offered, busy) ends the ride's asks and its decisions: the one in force
 *   lapses, the pacer rides #92's rule for the rest of the ride, and the
 *   rider loses nothing else (ADR 0072 D-7).
 * - **Keep a line of feedback.** The log holds the direction, the times, why,
 *   where the rider was and a word for what became of the line; the line is
 *   shown for {@link MODEL_PACER_SAY_SHOWN_S}. The last
 *   {@link MODEL_PACER_RECENT_LINES} are held in memory for the ride, sent
 *   back with the next asks so the model does not repeat itself (#2760), and
 *   used here to hide one it says again (#2835). None is stored.
 * - **Guess a sensor.** A reading that is not live is a field left out of the
 *   state (§`modelPacerSensorFields`, #2760), never a zero or a stale value.
 *
 * ## The log, and the end of the ride
 *
 * A decision is in force from its ask, but its record is written when its
 * answer settles, because the record says what became of the line. So
 * {@link ModelPacer.end} writes the record of an ask still out, as `failed`
 * with no arrival: without it a ride that ended mid-ask would replay its last
 * seconds under the decision before.
 */

import {
  beatsPerMinute,
  COURSE_ROUNDING_METRES,
  courseClimbing,
  courseHillsAhead,
  distanceOnRoute,
  gapTrendOf,
  gradeAt,
  heartRateZones,
  metres,
  MODEL_PACER_ASK_EVERY_S,
  MODEL_PACER_LOG_MOST,
  MODEL_PACER_RECENT_LINES,
  MODEL_PACER_SAY_SHOWN_S,
  PACER_EASE,
  PACER_LIFT,
  PACER_START_RAMP_S,
  pacerAskOutcome,
  pacerRuleDecision,
  pacerSayAgainstRidden,
  pacerSayRepeats,
  pacerTerrainAt,
  powerZones,
  riderPlaceOf,
  watts,
  zoneOf,
  type BotPacerPlan,
  type ModelPacerAnswer,
  type ModelPacerCourse,
  type ModelPacerInput,
  type PacerDecisionRecord,
  type PacerDirection,
  type PacerGapReading,
  type PacerHeartRateTrend,
  type PacerLineOutcome,
  type PacerPowerTrend,
  type PacerRuleDecision,
  type PacerTerrain,
  type RouteProfile,
} from '@onyourleft/domain';

import type { PacerPort, PacerReply } from '../instance/pacer-port';
import type { TraceSample } from './hud/recent-trace';
import type { GameState } from './simulation';

/** What the director needs of the instance: `instance/pacer-port.ts` §`PacerPort`'s ride half. */
export type ModelPacerLink = Pick<PacerPort, 'startPacerRide' | 'decidePacer' | 'endPacerRide'>;

/**
 * The ride as the model is shown it, less what the director adds when it
 * decides: the direction, why, and the trends it keeps between asks.
 */
export type ModelPacerRide = Omit<
  ModelPacerInput,
  'plan' | 'intent' | 'secondsInIntent' | 'reason' | 'byPct' | 'starting'
>;

/** What a frame hands the director: the seconds ridden, and how to read the ride and apply a direction. */
export interface ModelPacerFrame {
  readonly riddenSeconds: number;
  /**
   * Read only on a frame that decides: the ride (§`modelPacerInput`), and the
   * rider's speed, m/s, which the time gap is said at.
   */
  readonly ride: () => { readonly seen: ModelPacerRide; readonly riderSpeed: number };
  /**
   * Where the pacer is on the road now, for ADR 0082's rule:
   * `@onyourleft/domain` §`pacerTerrainAt`, or §`modelPacerTerrain`. Read
   * only on a frame that decides, beside `ride`.
   */
  readonly terrain: () => PacerTerrain;
  /** Put `direction` in force from `fromSeconds` ridden: `GameSimulation.directPacer`. */
  readonly direct: (direction: PacerDirection, fromSeconds: number) => void;
}

/** The pacer's plan and intent before any decision: #92's own rule. */
export const UNDIRECTED: PacerDirection = { plan: 'rolling', intent: 'hold' };

/** What a frame came to. */
export interface ModelPacerFrameResult {
  /** A line that arrived on this frame, for the announcer; `undefined` on every other. */
  readonly arrived?: string;
  /** The line on the screen now, or `undefined` for none. */
  readonly showing?: string;
}

/** Round to one decimal: the state is a summary, and a shorter one is a cheaper prompt. */
const tenth = (value: number): number => Math.round(value * 10) / 10;

/**
 * The pacer state as the model is shown it (ADR 0072 D-3), from the ride's
 * own state, less the direction the director decides (§`ModelPacerRide`):
 * the pacer's W/kg, the rider's gap and W/kg,
 * the draft, the grade 100 m ahead of the pacer, the metres to the finish
 * (none on a loop) and the seconds ridden, the course ahead
 * (§`modelPacerCourse`, #2794), and with `sensors`, what the rider's own
 * sensors say (§`modelPacerSensorFields`, #2760). **No coordinate, no
 * name**: the route enters as grades and distances, never a position.
 */
export function modelPacerInput(options: {
  readonly state: Pick<GameState, 'ride' | 'bot' | 'ridden' | 'input' | 'soloDraft'>;
  readonly plan: BotPacerPlan;
  readonly profile: RouteProfile;
  readonly riderMassKilograms: number;
  readonly sensors?: ModelPacerSensors;
}): ModelPacerRide {
  const { state, plan, profile, sensors } = options;
  const pacerAt = state.bot?.state.distance ?? 0;
  const ahead = gradeAt(profile, distanceOnRoute(profile, metres(pacerAt + 100)));
  const power = state.input.live ? (state.input.power as number) : undefined;
  const riderGapM = tenth(state.ride.distance - pacerAt);
  // #2777: where the rider is, in a word, at their own speed.
  const place = riderPlaceOf(riderGapM, state.ride.speed);
  return {
    pacerWPerKg: plan.intensityWattsPerKilogram,
    riderGapM,
    riderWPerKg:
      power === undefined || !(options.riderMassKilograms > 0)
        ? null
        : Math.min(40, Math.max(0, tenth(power / options.riderMassKilograms))),
    riderInDraft: state.soloDraft?.inDraft === true,
    gradeAheadPct: Math.min(100, Math.max(-100, tenth(ahead))),
    toFinishM: profile.loop ? null : Math.max(0, Math.round(profile.totalDistance - pacerAt)),
    rideS: Math.max(0, Math.floor(state.ridden)),
    ...(sensors === undefined ? {} : modelPacerSensorFields(sensors, options.riderMassKilograms)),
    ...(place === undefined ? {} : { riderPlace: place }),
    course: modelPacerCourse(profile, pacerAt),
  };
}

/** Where the ride's pacer is on `profile`, for ADR 0082's rule: read at the pacer, as the course is. */
export function modelPacerTerrain(
  state: Pick<GameState, 'bot'>,
  profile: RouteProfile,
): PacerTerrain {
  return pacerTerrainAt(profile, state.bot?.state.distance ?? 0);
}

/**
 * The course ahead of a pacer `pacerAt` metres along `profile` (#2794): the
 * next climb and descent (`@onyourleft/domain` §`courseHillsAhead`, within
 * 5 km and, on a route with a finish, before it), and the climbing left to
 * the finish or, on a loop, to the end of the lap, with the lap's metres.
 */
export function modelPacerCourse(profile: RouteProfile, pacerAt: number): ModelPacerCourse {
  const left = profile.loop
    ? profile.totalDistance - distanceOnRoute(profile, pacerAt)
    : Math.max(0, profile.totalDistance - pacerAt);
  return {
    ...courseHillsAhead(profile, pacerAt),
    lapLeftM: profile.loop
      ? Math.round(left / COURSE_ROUNDING_METRES) * COURSE_ROUNDING_METRES
      : null,
    climbLeftM: courseClimbing(profile, pacerAt, left),
  };
}

// --- #2760: the rider's own sensors ------------------------------------------

/**
 * What the rider's own sensors say as an ask is built — #2760. Each reading
 * is `undefined` when it is not live, and each threshold when the rider set
 * none: the state then leaves the field out.
 */
export interface ModelPacerSensors {
  /** The HUD's 3 s power, watts (`hud/power-average.ts`). */
  readonly power3s: number | undefined;
  /** The last seconds of power and heart rate, oldest first, one a second (`hud/recent-trace.ts`). */
  readonly trace: readonly TraceSample[];
  /** Cadence now, rpm. */
  readonly cadenceRpm: number | undefined;
  /** Heart rate now, bpm. */
  readonly heartRateBpm: number | undefined;
  /** The rider's OWN threshold power, watts. */
  readonly thresholdPower: number | undefined;
  /** The rider's OWN threshold heart rate, bpm. */
  readonly thresholdHeartRate: number | undefined;
}

/** The trend and the minute's average read the last **60 s** of the trace: "the last minute or so". */
export const SENSOR_WINDOW_S = 60;

/** A half-minute with fewer live seconds than this (**10**) says no trend; a minute with fewer than twice it, no average. */
export const SENSOR_LEAST_LIVE_S = 10;

/** Power has risen or faded when the last half-minute's mean differs by more than **5 %** of the one before. */
export const POWER_TREND_SHARE = 0.05;

/** Heart rate has risen or fallen when the last half-minute's mean differs by **3 bpm** or more. */
export const HEART_RATE_TREND_BPM = 3;

/** The live values of one channel in `samples`. */
function liveOf(samples: readonly TraceSample[], channel: keyof TraceSample): number[] {
  const out: number[] = [];
  for (const sample of samples) {
    const value = sample[channel];
    if (value !== undefined && Number.isFinite(value)) out.push(value);
  }
  return out;
}

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * The last half-minute's mean against the half-minute before, or `undefined`
 * when either half has fewer than {@link SENSOR_LEAST_LIVE_S} live seconds.
 */
function halves(
  trace: readonly TraceSample[],
  channel: keyof TraceSample,
): { readonly earlier: number; readonly later: number } | undefined {
  const window = trace.slice(-SENSOR_WINDOW_S);
  if (window.length < SENSOR_WINDOW_S) return undefined;
  const half = SENSOR_WINDOW_S / 2;
  const earlier = liveOf(window.slice(0, half), channel);
  const later = liveOf(window.slice(half), channel);
  if (earlier.length < SENSOR_LEAST_LIVE_S || later.length < SENSOR_LEAST_LIVE_S) return undefined;
  return { earlier: mean(earlier), later: mean(later) };
}

/** How power moved over the last minute, or `undefined` with too little of it. */
export function powerTrend(trace: readonly TraceSample[]): PacerPowerTrend | undefined {
  const read = halves(trace, 'power');
  if (read === undefined) return undefined;
  const change = read.later - read.earlier;
  if (change > read.earlier * POWER_TREND_SHARE) return 'rising';
  if (change < -read.earlier * POWER_TREND_SHARE) return 'fading';
  return 'steady';
}

/** How heart rate moved over the last minute, or `undefined` with too little of it. */
export function heartRateTrend(trace: readonly TraceSample[]): PacerHeartRateTrend | undefined {
  const read = halves(trace, 'heartRate');
  if (read === undefined) return undefined;
  const change = read.later - read.earlier;
  if (change >= HEART_RATE_TREND_BPM) return 'rising';
  if (change <= -HEART_RATE_TREND_BPM) return 'falling';
  return 'steady';
}

/** The whole seconds, newest back, that power has stayed at or above `threshold` without a break. */
export function secondsAtOrAbove(trace: readonly TraceSample[], threshold: number): number {
  let count = 0;
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const power = trace[index]?.power;
    if (power === undefined || !(power >= threshold)) break;
    count += 1;
  }
  return count;
}

/** W/kg to one decimal inside the domain's bounds, or `undefined` with no mass to divide by. */
function perKilogram(power: number, massKilograms: number): number | undefined {
  if (!(massKilograms > 0) || !Number.isFinite(power)) return undefined;
  return Math.min(40, Math.max(0, tenth(power / massKilograms)));
}

/** A whole number inside `[least, most]`, or `undefined` — an out-of-range reading is left out, never clamped into a guess. */
function wholeWithin(value: number | undefined, least: number, most: number): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const whole = Math.round(value);
  return whole >= least && whole <= most ? whole : undefined;
}

/**
 * The state's sensor fields — #2760: only those whose sensor is live, and a
 * zone only of a threshold the rider set. Nothing here is a default.
 */
export function modelPacerSensorFields(
  sensors: ModelPacerSensors,
  riderMassKilograms: number,
): Partial<ModelPacerInput> {
  const fields: { -readonly [K in keyof ModelPacerInput]?: ModelPacerInput[K] } = {};
  const { power3s, trace, thresholdPower, thresholdHeartRate } = sensors;
  if (power3s !== undefined && Number.isFinite(power3s) && power3s >= 0) {
    const threeSeconds = perKilogram(power3s, riderMassKilograms);
    if (threeSeconds !== undefined) fields.rider3sWPerKg = threeSeconds;
    if (thresholdPower !== undefined && thresholdPower > 0) {
      const zone = zoneOf(powerZones(watts(thresholdPower)), power3s);
      if (zone !== undefined) fields.powerZone = zone.name;
      fields.aboveThresholdS = secondsAtOrAbove(trace, thresholdPower);
    }
  }
  // The minute and the trend come from the recent trace, which outlives a
  // sensor that has just dropped: only while the sensor reads now.
  const powerLive = power3s !== undefined && Number.isFinite(power3s) && power3s >= 0;
  const minute = powerLive ? liveOf(trace.slice(-SENSOR_WINDOW_S), 'power') : [];
  if (minute.length >= SENSOR_LEAST_LIVE_S * 2) {
    const average = perKilogram(mean(minute), riderMassKilograms);
    if (average !== undefined) fields.riderMinuteWPerKg = average;
  }
  const trend = powerLive ? powerTrend(trace) : undefined;
  if (trend !== undefined) fields.powerTrend = trend;
  // #2835: the same half-minutes as a number, for a line that names what changed.
  const powerHalves = powerLive ? halves(trace, 'power') : undefined;
  if (powerHalves !== undefined && powerHalves.earlier > 0) {
    const drift = wholeWithin(
      (100 * (powerHalves.later - powerHalves.earlier)) / powerHalves.earlier,
      -MOST_DRIFT_PERCENT,
      MOST_DRIFT_PERCENT,
    );
    if (drift !== undefined) fields.powerDriftPct = drift;
  }
  const cadence = wholeWithin(sensors.cadenceRpm, 0, 250);
  if (cadence !== undefined) fields.cadenceRpm = cadence;
  const heartRate = wholeWithin(sensors.heartRateBpm, 20, 250);
  if (heartRate !== undefined) {
    fields.heartRateBpm = heartRate;
    if (thresholdHeartRate !== undefined && thresholdHeartRate > 0) {
      const zone = zoneOf(heartRateZones(beatsPerMinute(thresholdHeartRate)), heartRate);
      if (zone !== undefined) fields.heartRateZone = zone.name;
    }
  }
  const heartTrend = heartRate === undefined ? undefined : heartRateTrend(trace);
  if (heartTrend !== undefined) fields.heartRateTrend = heartTrend;
  const heartHalves = heartRate === undefined ? undefined : halves(trace, 'heartRate');
  if (heartHalves !== undefined) {
    const drift = wholeWithin(heartHalves.later - heartHalves.earlier, -250, 250);
    if (drift !== undefined) fields.heartRateDriftBpm = drift;
  }
  return fields;
}

/** The largest power drift said, percent: the domain's bound. */
const MOST_DRIFT_PERCENT = 1_000;

/** How far back the gap's drift is read, seconds ridden: **30** (#2835: "the last 30–60 s"). */
export const GAP_DRIFT_WINDOW_S = 30;

/** How many asks' cadence the drift is read from: **12**, a minute at one every 5 s, in two halves. */
export const CADENCE_DRIFT_ASKS = 12;

/** A half with fewer live cadence readings than this (**3**) says no drift. */
export const CADENCE_DRIFT_LEAST = 3;

/**
 * How cadence moved over the last {@link CADENCE_DRIFT_ASKS} asks, whole rpm:
 * the later half's mean less the earlier half's, or `undefined` with fewer
 * asks than that, or either half short of {@link CADENCE_DRIFT_LEAST} live
 * readings. `readings` is oldest first, `undefined` where cadence was not live.
 */
export function cadenceDrift(readings: readonly (number | undefined)[]): number | undefined {
  if (readings.length < CADENCE_DRIFT_ASKS) return undefined;
  const window = readings.slice(-CADENCE_DRIFT_ASKS);
  const live = (half: readonly (number | undefined)[]): number[] =>
    half.filter((each): each is number => each !== undefined && Number.isFinite(each));
  const earlier = live(window.slice(0, CADENCE_DRIFT_ASKS / 2));
  const later = live(window.slice(CADENCE_DRIFT_ASKS / 2));
  if (earlier.length < CADENCE_DRIFT_LEAST || later.length < CADENCE_DRIFT_LEAST) return undefined;
  return wholeWithin(mean(later) - mean(earlier), -250, 250);
}

/** How far `direction`'s intent moves the pacer, whole percent, as the model is told it. */
export function directionPercent(direction: PacerDirection): number {
  if (direction.intent === 'hold') return 0;
  return Math.round(
    100 * (direction.by ?? (direction.intent === 'lift' ? PACER_LIFT : PACER_EASE)),
  );
}

/** The reply as the domain's answer, for `pacerAskOutcome`. */
function answerOf(reply: PacerReply): ModelPacerAnswer | 'refused' | 'failed' {
  switch (reply.kind) {
    case 'answer':
      return { ok: true, say: reply.say };
    case 'invalid':
      // The port or the instance read it as no line; why is not kept.
      return { ok: false, reason: 'not-an-object' };
    case 'refused':
    case 'failed':
      return reply.kind;
  }
}

/** An ask that is out: when, and what the device decided as it asked. */
interface Asked {
  readonly at: number;
  readonly decision: PacerRuleDecision;
}

/** `asked` as the log keeps it, with what became of its ask and its line. */
function recordOf(
  asked: Asked,
  arrivedAtS: number | null,
  outcome: PacerDecisionRecord['outcome'],
  line: PacerLineOutcome,
): PacerDecisionRecord {
  const { direction, reason, place, gapS } = asked.decision;
  return {
    askedAtS: asked.at,
    arrivedAtS,
    outcome,
    plan: direction.plan,
    intent: direction.intent,
    ...(direction.by === undefined ? {} : { by: direction.by }),
    reason,
    ...(place === undefined ? {} : { place }),
    ...(gapS === undefined ? {} : { gapS }),
    line,
  };
}

/** The AI pacer for one ride. @see the module note */
export class ModelPacer {
  readonly #link: ModelPacerLink;
  readonly #onRecord: (record: PacerDecisionRecord) => void;
  readonly #log: PacerDecisionRecord[] = [];
  #asked: Asked | undefined;
  #lastAskAt: number | undefined;
  #settled: PacerReply | undefined;
  #stopped = false;
  #ended = false;
  #inForce: { direction: PacerDirection; since: number } = { direction: UNDIRECTED, since: 0 };
  #line: { readonly text: string; readonly until: number } | undefined;
  /** The last lines shown this ride, oldest first, for the next asks (#2760) and the repeat check (#2835). Never stored. */
  readonly #said: string[] = [];
  /** The gap at each ask of about the last {@link GAP_DRIFT_WINDOW_S}, oldest first (#2777, #2835). */
  readonly #gaps: PacerGapReading[] = [];
  /** Cadence at each of the last {@link CADENCE_DRIFT_ASKS} asks, oldest first (#2835). */
  readonly #cadences: (number | undefined)[] = [];
  /** Where the rider is, and the seconds ridden of the first ask in this unbroken run of it (#2835). */
  #placed: { readonly place: ModelPacerInput['riderPlace']; readonly since: number } | undefined;

  constructor(link: ModelPacerLink, onRecord: (record: PacerDecisionRecord) => void) {
    this.#link = link;
    this.#onRecord = onRecord;
    void link.startPacerRide();
  }

  /** Every decision this ride, oldest first, as it is stored with the ride. */
  log(): readonly PacerDecisionRecord[] {
    return this.#log;
  }

  /** One frame. @see the module note */
  frame(frame: ModelPacerFrame): ModelPacerFrameResult {
    const at = frame.riddenSeconds;
    let arrived: string | undefined;
    const settled = this.#settled;
    const asked = this.#asked;
    if (settled !== undefined && asked !== undefined) {
      this.#settled = undefined;
      this.#asked = undefined;
      const outcome = pacerAskOutcome(asked.at, at, answerOf(settled));
      const line =
        outcome === 'applied' && settled.kind === 'answer'
          ? this.#lineOf(settled.say, asked.decision)
          : 'none';
      this.#keep(recordOf(asked, at, outcome, line));
      if (settled.kind === 'refused') this.#stopped = true;
      if (line === 'shown' && settled.kind === 'answer') {
        this.#line = { text: settled.say, until: at + MODEL_PACER_SAY_SHOWN_S };
        arrived = settled.say;
        this.#said.push(settled.say);
        if (this.#said.length > MODEL_PACER_RECENT_LINES) this.#said.shift();
      }
    }
    if (
      !this.#stopped &&
      this.#asked === undefined &&
      this.#log.length < MODEL_PACER_LOG_MOST &&
      (this.#lastAskAt === undefined || at - this.#lastAskAt >= MODEL_PACER_ASK_EVERY_S)
    ) {
      const { seen, riderSpeed } = frame.ride();
      // ADR 0083 D-1: the device decides, and the decision is ridden from now
      // whatever the model then says, or does not.
      const decision = pacerRuleDecision({
        riderGapM: seen.riderGapM,
        riderSpeed,
        riderInDraft: seen.riderInDraft,
        terrain: frame.terrain(),
      });
      frame.direct(decision.direction, at);
      this.#inForce = {
        direction: decision.direction,
        since:
          decision.direction.intent === this.#inForce.direction.intent ? this.#inForce.since : at,
      };
      this.#ask({ at, decision }, this.#told(at, seen, decision));
    }
    if (this.#line !== undefined && at >= this.#line.until) this.#line = undefined;
    return {
      ...(arrived === undefined ? {} : { arrived }),
      ...(this.#line === undefined ? {} : { showing: this.#line.text }),
    };
  }

  /**
   * The ride has ended: no more decisions, the instance's slot let go, and
   * the record of an ask still out written, so the log holds every decision
   * the pacer rode.
   */
  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#stopped = true;
    const asked = this.#asked;
    this.#asked = undefined;
    if (asked !== undefined) this.#keep(recordOf(asked, null, 'failed', 'none'));
    void this.#link.endPacerRide();
  }

  #keep(record: PacerDecisionRecord): void {
    this.#log.push(record);
    this.#onRecord(record);
  }

  /**
   * What becomes of a line that arrived in time (#2835): nothing said is
   * `none`; one that says the opposite of what the pacer is doing is hidden
   * (`against`, ADR 0082 D-3), and so is one of its last lines said again
   * (`repeat`); any other is `shown`.
   */
  #lineOf(say: string, decision: PacerRuleDecision): PacerLineOutcome {
    if (say === '') return 'none';
    if (pacerSayAgainstRidden(say, decision.direction.intent)) return 'against';
    return pacerSayRepeats(say, this.#said) ? 'repeat' : 'shown';
  }

  /**
   * The state the model is told (#2835): the ride as it was seen, what the
   * device just decided and why, and what the director keeps between asks —
   * how the gap moved since the last ask (#2777) and over the last
   * {@link GAP_DRIFT_WINDOW_S}, how long the rider has been where they are,
   * how cadence drifted, and the model's own last lines (#2760).
   */
  #told(at: number, seen: ModelPacerRide, decision: PacerRuleDecision): ModelPacerInput {
    const now: PacerGapReading = { atS: at, riderGapM: seen.riderGapM };
    const last = this.#gaps.at(-1);
    const trend = last === undefined ? undefined : gapTrendOf(last, now);
    // The newest reading at least the window old is what the drift is read against.
    let from = -1;
    for (let index = 0; index < this.#gaps.length; index += 1) {
      const reading = this.#gaps[index];
      if (reading !== undefined && reading.atS <= at - GAP_DRIFT_WINDOW_S) from = index;
    }
    const before = from < 0 ? undefined : this.#gaps[from];
    if (from > 0) this.#gaps.splice(0, from);
    this.#gaps.push(now);
    const held = this.#placed;
    const placed =
      held !== undefined && held.place === decision.place
        ? held
        : { place: decision.place, since: at };
    this.#placed = placed;
    this.#cadences.push(seen.cadenceRpm);
    if (this.#cadences.length > CADENCE_DRIFT_ASKS) this.#cadences.shift();
    const cadence = cadenceDrift(this.#cadences);
    const { direction } = decision;
    return {
      ...seen,
      plan: direction.plan,
      intent: direction.intent,
      secondsInIntent: Math.max(0, Math.floor(at - this.#inForce.since)),
      reason: decision.reason,
      byPct: directionPercent(direction),
      starting: at < PACER_START_RAMP_S,
      ...(decision.gapS === undefined ? {} : { gapS: decision.gapS }),
      ...(decision.place === undefined
        ? {}
        : { placeForS: Math.max(0, Math.floor(at - placed.since)) }),
      ...(trend === undefined ? {} : { gapTrend: trend }),
      ...(before === undefined
        ? {}
        : { gapDriftM: Math.round((seen.riderGapM - before.riderGapM) * 10) / 10 }),
      ...(cadence === undefined ? {} : { cadenceDriftRpm: cadence }),
      ...(this.#said.length === 0 ? {} : { recentLines: [...this.#said] }),
    };
  }

  #ask(asked: Asked, input: ModelPacerInput): void {
    this.#asked = asked;
    this.#lastAskAt = asked.at;
    this.#link.decidePacer(input).then(
      (reply) => {
        this.#settled = reply;
      },
      () => {
        this.#settled = { kind: 'failed' };
      },
    );
  }
}
