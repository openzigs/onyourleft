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
 * ## What it refuses, and where that is enforced
 *
 * `GameView.tsx` §`simulatedRideProps` builds the ride with **no trainer port,
 * no room and no rooms**, and with no Delivery round. The trainer port is also
 * the only way a game ride reaches the recording (`trainer-port.ts`
 * §`GameTrainerPort.recordGameRide`, §`gameRideEnded`, §`courseLine`), so a
 * simulated ride cannot write a resistance, start a recording, add a lap to
 * one, or join a room — by the ports' absence rather than by a guard inside
 * the loop. `simulated-rider-wiring.test.tsx` holds both halves.
 *
 * ⚠️ Nothing here is a reading from a device. {@link simulatedSensors} says
 * cadence and heart rate are unpaired, so the HUD shows a dash for each rather
 * than an invented number.
 */

import { watts } from '@onyourleft/domain';

import type { GameSensors } from './sensors';

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

/** What the developer asked for. */
export interface SimulatedRider {
  /** The steady power the rider is ridden at. */
  readonly watts: number;
  /** How many seconds of ride pass for each second of wall clock, 1 to 32. */
  readonly speedup: number;
  /** Where on the route the ride starts, in odometer metres; absent is the start line. */
  readonly startMetres: number | undefined;
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
 * number is the start line.
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
  return {
    watts: power,
    speedup: Math.min(SIMULATED_RIDER_MAX_SPEEDUP, Math.max(1, speedup)),
    startMetres: start === undefined || start < 0 ? undefined : start,
  };
}

/**
 * One string per distinct choice, `undefined` for an ordinary ride — what
 * `GameView` keys its screen on, so a change of mode is a new screen and a
 * ride never changes mode under the rider.
 */
export function simulatedRiderKey(rider: SimulatedRider | undefined): string {
  return rider === undefined
    ? 'ride'
    : `simulated:${String(rider.watts)}:${String(rider.speedup)}:${String(rider.startMetres)}`;
}

/** What the game reads each frame while the simulated rider is on. */
export function simulatedSensors(rider: SimulatedRider): GameSensors {
  return {
    rider: { power: watts(rider.watts), live: true, paired: true },
    cadence: { value: undefined, live: false, paired: false },
    heartRate: { value: undefined, live: false, paired: false },
  };
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
 */
export function simulatedRideText(rider: SimulatedRider): string {
  const pace = rider.speedup === 1 ? '' : `, ${String(rider.speedup)}× real time`;
  return `Simulated ride at ${String(rider.watts)} W${pace}. Not recorded or shared.`;
}
