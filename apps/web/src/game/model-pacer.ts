// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The AI pacer during a ride** — #2712, ADR 0072: when to ask the rider's
 * instance, what to send, and what to do with each answer, on the ride's own
 * clock.
 *
 * `GameView` calls {@link ModelPacer.frame} once per frame, after the
 * simulation has advanced, with the seconds ridden (`GameState.ridden`).
 * Every {@link MODEL_PACER_ASK_EVERY_S} it builds the pacer state
 * (§`modelPacerInput`) and asks; **the ride never waits for the answer**
 * (ADR 0072 D-7). When an answer has come back, the next frame logs it at
 * that frame's seconds ridden — `@onyourleft/domain` §`pacerDecisionRecord`:
 * applied, late, invalid, refused or failed — and an applied one is put in
 * force on the simulation (§`GameSimulation.directPacer`) from that instant,
 * and its line shown and offered to the announcer.
 *
 * ## What it never does
 *
 * - **Write to a trainer.** Nothing here names the trainer port, the
 *   gradient session or a workout: a direction moves the pacer, and the pacer
 *   reaches the rider only through the draft it gives, as riding harder does
 *   (ADR 0072 D-6). `model-pacer-wiring.test.tsx` holds it.
 * - **Ask after a refusal.** A refused request (no consent, not offered,
 *   busy) ends the ride's asks: the pacer rides #92's rule for the rest of it,
 *   and the rider loses nothing else (ADR 0072 D-7).
 * - **Keep a line of feedback.** The log holds the plan, the intent and the
 *   times; the line is shown for {@link MODEL_PACER_SAY_SHOWN_S}. The last
 *   {@link MODEL_PACER_RECENT_LINES} are held in memory for the ride, and
 *   sent back with the next asks so the model does not repeat itself (#2760),
 *   and dropped with the director. None is stored.
 * - **Guess a sensor.** A reading that is not live is a field left out of the
 *   state (§`modelPacerSensorFields`, #2760), never a zero or a stale value.
 *
 * ## Where the rider is, and the floor (#2777)
 *
 * Each ask carries `riderPlace` (`ahead`, `level` or `behind`, at the rider's
 * own speed) and, from the second ask on, `gapTrend`: how the gap moved since
 * the last ask. The director keeps the run of asks with the rider ahead, and
 * an `ease` that answers an ask built after `PACER_AHEAD_FLOOR_S` of it
 * is ridden, and logged, as `hold` (`@onyourleft/domain` §`flooredDirection`,
 * ADR 0078, Proposed).
 */

import {
  beatsPerMinute,
  distanceOnRoute,
  flooredDirection,
  gapTrendOf,
  gradeAt,
  heartRateZones,
  metres,
  MODEL_PACER_ASK_EVERY_S,
  MODEL_PACER_LOG_MOST,
  MODEL_PACER_RECENT_LINES,
  MODEL_PACER_SAY_SHOWN_S,
  pacerDecisionRecord,
  pacerSaysEasing,
  powerZones,
  riderPlaceOf,
  watts,
  zoneOf,
  type BotPacerPlan,
  type ModelPacerAnswer,
  type ModelPacerInput,
  type PacerDecisionRecord,
  type PacerDirection,
  type PacerGapReading,
  type PacerHeartRateTrend,
  type PacerPowerTrend,
  type RouteProfile,
} from '@onyourleft/domain';

import type { PacerPort, PacerReply } from '../instance/pacer-port';
import type { TraceSample } from './hud/recent-trace';
import type { GameState } from './simulation';

/** What the director needs of the instance: `instance/pacer-port.ts` §`PacerPort`'s ride half. */
export type ModelPacerLink = Pick<PacerPort, 'startPacerRide' | 'decidePacer' | 'endPacerRide'>;

/** What a frame hands the director: the seconds ridden, and how to build the state and apply a direction. */
export interface ModelPacerFrame {
  readonly riddenSeconds: number;
  /** Built only on a frame that asks. */
  readonly input: (inForce: {
    readonly direction: PacerDirection;
    readonly since: number;
  }) => ModelPacerInput;
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
 * own state: the pacer's W/kg, its direction now, the rider's gap and W/kg,
 * the draft, the grade 100 m ahead of the pacer, the metres to the finish
 * (none on a loop) and the seconds ridden, and with `sensors`, what the
 * rider's own sensors say (§`modelPacerSensorFields`, #2760). **No
 * coordinate, no name**: the route enters as a grade and a distance, never a
 * position.
 */
export function modelPacerInput(options: {
  readonly state: Pick<GameState, 'ride' | 'bot' | 'ridden' | 'input' | 'soloDraft'>;
  readonly plan: BotPacerPlan;
  readonly profile: RouteProfile;
  readonly riderMassKilograms: number;
  readonly inForce: { readonly direction: PacerDirection; readonly since: number };
  readonly sensors?: ModelPacerSensors;
}): ModelPacerInput {
  const { state, plan, profile, inForce, sensors } = options;
  const pacerAt = state.bot?.state.distance ?? 0;
  const ahead = gradeAt(profile, distanceOnRoute(profile, metres(pacerAt + 100)));
  const power = state.input.live ? (state.input.power as number) : undefined;
  const riderGapM = tenth(state.ride.distance - pacerAt);
  // #2777: where the rider is, in a word, at their own speed.
  const place = riderPlaceOf(riderGapM, state.ride.speed);
  return {
    pacerWPerKg: plan.intensityWattsPerKilogram,
    plan: inForce.direction.plan,
    intent: inForce.direction.intent,
    secondsInIntent: Math.max(0, Math.floor(state.ridden - inForce.since)),
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
  return fields;
}

/** The reply as the domain's answer, for {@link pacerDecisionRecord}. */
function answerOf(reply: PacerReply): ModelPacerAnswer | 'refused' | 'failed' {
  switch (reply.kind) {
    case 'answer':
      return { ok: true, direction: reply.direction, say: reply.say };
    case 'invalid':
      // The port or the instance read it as no decision; why is not kept.
      return { ok: false, reason: 'not-an-object' };
    case 'refused':
    case 'failed':
      return reply.kind;
  }
}

/** The AI pacer for one ride. @see the module note */
export class ModelPacer {
  readonly #link: ModelPacerLink;
  readonly #onRecord: (record: PacerDecisionRecord) => void;
  readonly #log: PacerDecisionRecord[] = [];
  #asked: number | undefined;
  #lastAskAt: number | undefined;
  #settled: PacerReply | undefined;
  #stopped = false;
  #ended = false;
  #inForce: { direction: PacerDirection; since: number } = { direction: UNDIRECTED, since: 0 };
  #line: { readonly text: string; readonly until: number } | undefined;
  /** The last lines shown this ride, oldest first, for the next asks (#2760). Never stored. */
  readonly #said: string[] = [];
  /** The gap at the last ask, for the next one's `gapTrend` (#2777). */
  #lastGap: PacerGapReading | undefined;
  /** The seconds ridden of the first ask in this unbroken run of asks with the rider `ahead` (#2777). */
  #aheadSince: number | undefined;
  /** How long the rider had been ahead when the ask now out was built, for the floor (ADR 0078). */
  #askedAheadForS: number | undefined;

  constructor(link: ModelPacerLink, onRecord: (record: PacerDecisionRecord) => void) {
    this.#link = link;
    this.#onRecord = onRecord;
    void link.startPacerRide();
  }

  /** Every ask this ride, oldest first, as it is stored with the ride. */
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
      const reply = this.#floored(settled);
      const record = pacerDecisionRecord(asked, at, answerOf(reply));
      this.#log.push(record);
      this.#onRecord(record);
      if (reply.kind === 'refused') this.#stopped = true;
      if (record.outcome === 'applied' && reply.kind === 'answer') {
        const { direction } = reply;
        frame.direct(direction, at);
        if (direction.intent !== this.#inForce.direction.intent) {
          this.#inForce = { direction, since: at };
        } else {
          this.#inForce = { direction, since: this.#inForce.since };
        }
        if (reply.say !== '') {
          this.#line = { text: reply.say, until: at + MODEL_PACER_SAY_SHOWN_S };
          arrived = reply.say;
          this.#said.push(reply.say);
          if (this.#said.length > MODEL_PACER_RECENT_LINES) this.#said.shift();
        }
      }
    }
    if (
      !this.#stopped &&
      this.#asked === undefined &&
      this.#log.length < MODEL_PACER_LOG_MOST &&
      (this.#lastAskAt === undefined || at - this.#lastAskAt >= MODEL_PACER_ASK_EVERY_S)
    ) {
      const input = this.#placed(at, frame.input(this.#inForce));
      this.#ask(at, this.#said.length === 0 ? input : { ...input, recentLines: [...this.#said] });
    }
    if (this.#line !== undefined && at >= this.#line.until) this.#line = undefined;
    return {
      ...(arrived === undefined ? {} : { arrived }),
      ...(this.#line === undefined ? {} : { showing: this.#line.text }),
    };
  }

  /** The ride has ended: no more asks, and the instance's slot let go. */
  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#stopped = true;
    void this.#link.endPacerRide();
  }

  /**
   * #2777: `input` with how the gap moved since the last ask, and the run of
   * asks with the rider ahead kept for the floor. Read off the state the
   * model is shown, so the floor answers what the model saw.
   */
  #placed(at: number, input: ModelPacerInput): ModelPacerInput {
    const now: PacerGapReading = { atS: at, riderGapM: input.riderGapM };
    const trend = this.#lastGap === undefined ? undefined : gapTrendOf(this.#lastGap, now);
    this.#lastGap = now;
    if (input.riderPlace === 'ahead') this.#aheadSince ??= at;
    else this.#aheadSince = undefined;
    this.#askedAheadForS = this.#aheadSince === undefined ? undefined : at - this.#aheadSince;
    return trend === undefined ? input : { ...input, gapTrend: trend };
  }

  /**
   * The reply as it is ridden: ADR 0078's floor (Proposed), an `ease` ridden
   * as `hold` once the rider has been ahead for `PACER_AHEAD_FLOOR_S`. The
   * log records the direction ridden, so the pacer still replays from the
   * log alone (ADR 0072 D-5.1). A line that says the pacer is easing is not
   * shown beside a `hold` it does not describe.
   */
  #floored(reply: PacerReply): PacerReply {
    if (reply.kind !== 'answer') return reply;
    const direction = flooredDirection(reply.direction, this.#askedAheadForS);
    if (direction === reply.direction) return reply;
    return { kind: 'answer', direction, say: pacerSaysEasing(reply.say) ? '' : reply.say };
  }

  #ask(at: number, input: ModelPacerInput): void {
    this.#asked = at;
    this.#lastAskAt = at;
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
