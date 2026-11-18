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
 *   times; the line is shown for {@link MODEL_PACER_SAY_SHOWN_S} and dropped.
 */

import {
  distanceOnRoute,
  gradeAt,
  metres,
  MODEL_PACER_ASK_EVERY_S,
  MODEL_PACER_LOG_MOST,
  MODEL_PACER_SAY_SHOWN_S,
  pacerDecisionRecord,
  type BotPacerPlan,
  type ModelPacerAnswer,
  type ModelPacerInput,
  type PacerDecisionRecord,
  type PacerDirection,
  type RouteProfile,
} from '@onyourleft/domain';

import type { PacerPort, PacerReply } from '../instance/pacer-port';
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
 * (none on a loop) and the seconds ridden. **No coordinate, no name**: the
 * route enters as a grade and a distance, never a position.
 */
export function modelPacerInput(options: {
  readonly state: Pick<GameState, 'ride' | 'bot' | 'ridden' | 'input' | 'soloDraft'>;
  readonly plan: BotPacerPlan;
  readonly profile: RouteProfile;
  readonly riderMassKilograms: number;
  readonly inForce: { readonly direction: PacerDirection; readonly since: number };
}): ModelPacerInput {
  const { state, plan, profile, inForce } = options;
  const pacerAt = state.bot?.state.distance ?? 0;
  const ahead = gradeAt(profile, distanceOnRoute(profile, metres(pacerAt + 100)));
  const power = state.input.live ? (state.input.power as number) : undefined;
  return {
    pacerWPerKg: plan.intensityWattsPerKilogram,
    plan: inForce.direction.plan,
    intent: inForce.direction.intent,
    secondsInIntent: Math.max(0, Math.floor(state.ridden - inForce.since)),
    riderGapM: tenth(state.ride.distance - pacerAt),
    riderWPerKg:
      power === undefined || !(options.riderMassKilograms > 0)
        ? null
        : Math.min(40, Math.max(0, tenth(power / options.riderMassKilograms))),
    riderInDraft: state.soloDraft?.inDraft === true,
    gradeAheadPct: Math.min(100, Math.max(-100, tenth(ahead))),
    toFinishM: profile.loop ? null : Math.max(0, Math.round(profile.totalDistance - pacerAt)),
    rideS: Math.max(0, Math.floor(state.ridden)),
  };
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
      const record = pacerDecisionRecord(asked, at, answerOf(settled));
      this.#log.push(record);
      this.#onRecord(record);
      if (settled.kind === 'refused') this.#stopped = true;
      if (record.outcome === 'applied' && settled.kind === 'answer') {
        const { direction } = settled;
        frame.direct(direction, at);
        if (direction.intent !== this.#inForce.direction.intent) {
          this.#inForce = { direction, since: at };
        } else {
          this.#inForce = { direction, since: this.#inForce.since };
        }
        if (settled.say !== '') {
          this.#line = { text: settled.say, until: at + MODEL_PACER_SAY_SHOWN_S };
          arrived = settled.say;
        }
      }
    }
    if (
      !this.#stopped &&
      this.#asked === undefined &&
      this.#log.length < MODEL_PACER_LOG_MOST &&
      (this.#lastAskAt === undefined || at - this.#lastAskAt >= MODEL_PACER_ASK_EVERY_S)
    ) {
      this.#ask(at, frame.input(this.#inForce));
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
