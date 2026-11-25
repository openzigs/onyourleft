// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The simulated rider — #1992: a developer's debug mode that rides any of the
 * rider's own routes at a steady power with **no trainer or sensor at all**,
 * optionally faster than real time and from a chosen distance, so the world
 * drawn along a real route can be checked off the bike.
 *
 * ## Where it is switched on
 *
 * A query on the game's own route, beside `shell/routes.ts`
 * §`gameDeliveryFromHash`'s developer route, and nowhere on the Ride screen:
 *
 *     #/game?simulate=200            200 W, real time, from the start
 *     #/game?simulate=200&speedup=8  eight times faster than real time
 *     #/game?simulate=200&at=5000    from 5,000 m along the route
 *
 * The rider still chooses the route and presses *Ride* on the picker; nothing
 * starts a ride from a link.
 *
 * Since the owner's ruling on PR #2113 the picker also offers it — the tablet
 * app has no address bar — as *Preview without a trainer* (`StageChooser.tsx`
 * §`PreviewControl`), with a power ({@link previewPower}) and a speed-up of
 * 1×, 2×, 4× or 8×, always from the start line. `GameView` mounts a preview
 * as a NEW screen built the same way, and ending it mounts an ordinary one.
 *
 * ## What it refuses, and where that is enforced
 *
 * `GameView.tsx` §`useSimulatedRide` builds the ride with **no trainer port,
 * no room and no rooms**, and with no Delivery round. The trainer port is also
 * the only way a game ride reaches the recording (`trainer-port.ts`
 * §`GameTrainerPort.recordGameRide`, §`gameRideEnded`, §`courseLine`), so a
 * simulated ride cannot write a resistance, start a recording, add a lap to
 * one, or join a room — by the ports' absence rather than by a guard inside
 * the loop. `simulated-rider-wiring.test.tsx` holds both halves.
 *
 * ## Its cadence and heart rate are invented — #3210
 *
 * ⚠️ Nothing here is a reading from a device. Until the owner's ruling of
 * 2026-11-25 (*"For the preview I would like to see made up numbers"*) the
 * simulated rider said cadence and heart rate were unpaired, so the HUD
 * showed a dash for each and the legs did not turn. Now
 * {@link SimulatedRiderSensors} reports both, live and paired: a cadence and a
 * heart rate `simulated-body.ts` invents from the power and the gradient, made
 * realistic per the same day's *"make sure the made up numbers are
 * realistic"*, or the fixed values a developer asks for:
 *
 *     #/game?simulate=200&cadence=90&hr=140
 *
 * They reach the HUD and the cranks and nothing else: a simulated ride has no
 * trainer port, so they cannot reach a recording, an upload or a room, by the
 * same absence that keeps it from the trainer.
 */

import { watts } from '@onyourleft/domain';

import type { CaptureScene } from './capture-scene';
import type { GameSensors } from './sensors';
import { InventedBody, type OwnThresholds } from './simulated-body';

/** The highest power the query accepts, in watts. Beyond it the mode is off. */
const SIMULATED_RIDER_MAX_WATTS = 2000;

/**
 * The fastest a simulated ride runs against real time.
 *
 * `simulation.ts` §`MAXIMUM_STEPS_PER_ADVANCE` integrates at most ten seconds
 * of ride per call, so at 32× a frame may come as late as 312 ms before any
 * ride time is discarded, which a browser that is drawing at all meets. A
 * judgement, stated as one.
 */
const SIMULATED_RIDER_MAX_SPEEDUP = 32;

/** The highest fixed cadence the query accepts, rpm. Beyond it the cadence is invented. */
const SIMULATED_RIDER_MAX_CADENCE = 200;
/** The lowest and highest fixed heart rate it accepts, bpm. Outside them it is invented. */
const SIMULATED_RIDER_MIN_HEART_RATE = 30;
const SIMULATED_RIDER_MAX_HEART_RATE = 230;

/**
 * The seed of the invented readings' wobble (`simulated-body.ts`): one
 * number, so every preview at one power wobbles alike and a test can pin it.
 */
const SIMULATED_BODY_SEED = 3210;

/** What the developer asked for. */
export interface SimulatedRider {
  /** The steady power the rider is ridden at. */
  readonly watts: number;
  /** How many seconds of ride pass for each second of wall clock, 1 to 32. */
  readonly speedup: number;
  /** Where on the route the ride starts, in odometer metres; absent is the start line. */
  readonly startMetres: number | undefined;
  /** #3210: a fixed cadence, rpm, in place of the invented one (`&cadence=`). */
  readonly cadence?: number | undefined;
  /** #3210: a fixed heart rate, bpm, in place of the invented one (`&hr=`). */
  readonly heartRate?: number | undefined;
  /**
   * The capture scene this ride is scripted by — #3152, `capture-scene.ts`:
   * its readings in place of {@link watts}, and the HUD a rider sees. Absent
   * on the address switch's ride and the picker's preview.
   */
  readonly capture?: CaptureScene | undefined;
}

/** The query of a `#/…?…` fragment, or `undefined` with none. */
function queryOf(hash: string): URLSearchParams | undefined {
  const query = /^[^?]*\?([^#]*)/.exec(hash)?.[1];
  return query === undefined ? undefined : new URLSearchParams(query);
}

/** A query value as a finite number, or `undefined`. An empty value is no value. */
function numberOf(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The simulated rider the game's fragment asks for, or `undefined` for an
 * ordinary ride. Total: anything that is not a power above nought and no more
 * than {@link SIMULATED_RIDER_MAX_WATTS} leaves the mode off. A speed-up
 * outside 1 to {@link SIMULATED_RIDER_MAX_SPEEDUP} is held to that range, and
 * one that is not a number is real time; a start that is not a non-negative
 * number is the start line. #3210: a `cadence` from 0 to
 * {@link SIMULATED_RIDER_MAX_CADENCE} rpm and an `hr` from
 * {@link SIMULATED_RIDER_MIN_HEART_RATE} to {@link SIMULATED_RIDER_MAX_HEART_RATE}
 * bpm are fixed readings; anything else leaves that reading invented.
 */
export function simulatedRiderFromHash(hash: string): SimulatedRider | undefined {
  const query = queryOf(hash);
  if (query === undefined) return undefined;
  const power = numberOf(query.get('simulate'));
  if (power === undefined || power <= 0 || power > SIMULATED_RIDER_MAX_WATTS) {
    return undefined;
  }
  const speedup = numberOf(query.get('speedup')) ?? 1;
  const start = numberOf(query.get('at'));
  const cadence = within(numberOf(query.get('cadence')), 0, SIMULATED_RIDER_MAX_CADENCE);
  const heartRate = within(
    numberOf(query.get('hr')),
    SIMULATED_RIDER_MIN_HEART_RATE,
    SIMULATED_RIDER_MAX_HEART_RATE,
  );
  return {
    watts: power,
    speedup: Math.min(SIMULATED_RIDER_MAX_SPEEDUP, Math.max(1, speedup)),
    startMetres: start === undefined || start < 0 ? undefined : start,
    ...(cadence === undefined ? {} : { cadence }),
    ...(heartRate === undefined ? {} : { heartRate }),
  };
}

/** `value` when it lies in `[low, high]`, else `undefined`. */
function within(value: number | undefined, low: number, high: number): number | undefined {
  return value === undefined || value < low || value > high ? undefined : value;
}

/**
 * One string per distinct choice, `undefined` for an ordinary ride — what
 * `GameView` keys its screen on, so a change of mode is a new screen and a
 * ride never changes mode under the rider.
 */
export function simulatedRiderKey(rider: SimulatedRider | undefined): string {
  return rider === undefined
    ? 'ride'
    : `simulated:${String(rider.watts)}:${String(rider.speedup)}:${String(rider.startMetres)}` +
        (rider.cadence === undefined ? '' : `:cadence:${String(rider.cadence)}`) +
        (rider.heartRate === undefined ? '' : `:hr:${String(rider.heartRate)}`) +
        (rider.capture === undefined ? '' : `:capture:${rider.capture.id}`);
}

/**
 * What the game reads each frame while the simulated rider is on — #3210:
 * the chosen power, and a cadence and heart rate invented for it
 * (`simulated-body.ts`) or fixed by the query, all three live and paired so
 * the HUD shows them and the cranks turn.
 *
 * Like `capture-scene.ts` §`CaptureSensors`, read on the ride's own clock and
 * started with the ride, which also hands over the gradient under the rider
 * and the rider's own thresholds. Read before the ride starts, the body is at
 * rest.
 */
export class SimulatedRiderSensors {
  readonly #rider: SimulatedRider;
  #body: InventedBody;
  #startedAtMs: number | undefined;
  #grade: () => number = () => 0;

  constructor(rider: SimulatedRider) {
    this.#rider = rider;
    this.#body = new InventedBody(SIMULATED_BODY_SEED);
  }

  /**
   * The ride started at `nowMs`, on the road whose gradient under the rider
   * `grade` reads, by a rider with these thresholds: a body at rest again.
   */
  start(nowMs: number, grade: () => number, own: OwnThresholds): void {
    this.#startedAtMs = nowMs;
    this.#grade = grade;
    this.#body = new InventedBody(SIMULATED_BODY_SEED, own);
  }

  /** What every sensor reads at `nowMs`. */
  read(nowMs: number): GameSensors {
    if (this.#startedAtMs !== undefined) {
      this.#body.advanceTo(
        Math.max(0, (nowMs - this.#startedAtMs) / 1000),
        this.#rider.watts,
        this.#grade(),
      );
    }
    return {
      rider: { power: watts(this.#rider.watts), live: true, paired: true },
      cadence: { value: this.#rider.cadence ?? this.#body.cadence, live: true, paired: true },
      heartRate: { value: this.#rider.heartRate ?? this.#body.heartRate, live: true, paired: true },
    };
  }
}

/**
 * The game's clock, run {@link SimulatedRider.speedup} times faster from the
 * moment this is made. Monotonic and continuous, so the simulation's fixed
 * step, its interpolation and every timer the ride reads agree with each
 * other — they all read this one clock — and a ride at 8× is the ride a real
 * one would be, eight times sooner.
 */
export function simulatedClock(base: () => number, speedup: number): () => number {
  const origin = base();
  return () => origin + (base() - origin) * speedup;
}

/**
 * Where a simulated ride starts on a route `totalMetres` long: the asked
 * distance, held to the route, or `undefined` for the start line.
 */
export function simulatedStartMetres(
  rider: SimulatedRider,
  totalMetres: number,
): number | undefined {
  return rider.startMetres === undefined
    ? undefined
    : Math.min(Math.max(0, totalMetres), rider.startMetres);
}

/**
 * The HUD's mark — #1992's "clearly marked": a screenshot of a simulated ride
 * says so on the stage. Worded for the owner's approval.
 *
 * Short sentences, kept apart so the HUD breaks its lines BETWEEN them
 * rather than inside one (the owner's review of PR #2113): each fits the
 * actions panel on a 412 px phone and on the 1280 px tablet. The third says
 * why *Moving* shows a dash on this ride: its figure is the recorder's
 * (`hud/fields.ts` §`movingTimeReading`), and nothing is recorded. As a
 * clause of the second it was one long sentence, broken inside itself.
 */
export function simulatedRideSentences(rider: SimulatedRider): readonly string[] {
  const pace = rider.speedup === 1 ? '' : `, ${String(rider.speedup)}× real time`;
  return [
    `Simulated ride at ${String(rider.watts)} W${pace}.`,
    'Not recorded or shared.',
    SIMULATED_MOVING_SENTENCE,
  ];
}

/**
 * {@link simulatedRideSentences}' third sentence, which explains the *Moving*
 * field's dash. The focus readout (#2383) has no *Moving* field, so the HUD
 * leaves this sentence out while that readout is drawn (owner ruling of
 * 2026-11-09 on PR #2406) and keeps it with the full HUD.
 */
export const SIMULATED_MOVING_SENTENCE = 'Moving needs a recording.';

/**
 * {@link simulatedRideSentences} as one line, as the HUD's text reads.
 *
 * @test-facing held by `simulated-rider.test.ts` and the wiring test, which
 * read the HUD's note back against it; the HUD itself takes the sentences.
 */
export function simulatedRideText(rider: SimulatedRider): string {
  return simulatedRideSentences(rider).join(' ');
}

/**
 * The picker's *Preview without a trainer* — the owner's ruling on PR #2113:
 * the address switch cannot be typed in the tablet app, so the same simulated
 * ride is offered on the route picker, with a power and a speed-up.
 */
export const PREVIEW_DEFAULT_WATTS = 200;
/** The lowest power the preview takes: below it a ride barely leaves the line. */
export const PREVIEW_MINIMUM_WATTS = 50;
/** The highest: a sprint, held. The address switch keeps its own wider range. */
export const PREVIEW_MAXIMUM_WATTS = 1000;
/** The preview's speed-ups, each of them inside {@link SIMULATED_RIDER_MAX_SPEEDUP}. */
export const PREVIEW_SPEEDUPS = [1, 2, 4, 8] as const;
export type PreviewSpeedup = (typeof PREVIEW_SPEEDUPS)[number];

/** What the preview's power box holds: a power, or why it is not one. */
export type PreviewPower =
  | { readonly watts: number; readonly problem?: undefined }
  | { readonly watts?: undefined; readonly problem: string };

/**
 * The preview's power box, read. Whole watts from
 * {@link PREVIEW_MINIMUM_WATTS} to {@link PREVIEW_MAXIMUM_WATTS}; anything
 * else is refused with the sentence the picker shows, and the preview does
 * not start — as the pacer's box refuses (#237), rather than riding a power
 * the rider did not ask for.
 */
export function previewPower(text: string): PreviewPower {
  const parsed = numberOf(text.replace(',', '.'));
  if (
    parsed === undefined ||
    !Number.isInteger(parsed) ||
    parsed < PREVIEW_MINIMUM_WATTS ||
    parsed > PREVIEW_MAXIMUM_WATTS
  ) {
    return {
      problem: `Enter a whole number of watts from ${String(PREVIEW_MINIMUM_WATTS)} to ${String(PREVIEW_MAXIMUM_WATTS)}.`,
    };
  }
  return { watts: parsed };
}

/** The simulated rider a preview asks for: from the start line, always. */
export function previewRider(power: number, speedup: PreviewSpeedup): SimulatedRider {
  return { watts: power, speedup, startMetres: undefined };
}
