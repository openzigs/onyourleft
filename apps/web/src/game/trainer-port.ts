// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the trainer game may ask of a trainer, and what it is told when it may
 * not ask — [#362](https://github.com/openzigs/onyourleft/issues/362).
 *
 * ## The defect this seam is the fix for
 *
 * The game computed a gradient, drew the hill, put the number on the HUD and
 * **never told the trainer**. Both halves of #90 — `packages/domain`'s
 * `createSimulationDriver` and `packages/sensors/protocol`'s
 * `createSimulationWriter` — were written, tested, green and reachable from
 * nothing under `apps/`. Measured on the wire rather than only in the source:
 * a whole ride on Android produced **252** inbound Indoor Bike Data
 * notifications from service `0x1826` and **zero** writes. A rider on a 6 %
 * climb felt exactly what they felt on the flat.
 *
 * ## Why this is a `*-port.ts`, and why that is the load-bearing part
 *
 * The suffix is what puts `readTrainer` under `WIRE003` (CLAUDE.md §4j), so a
 * later edit that stops the game asking for a trainer is a red gate rather than
 * a silent return to #362. That matters more here than anywhere else this
 * repository has put a port: the wiring gate's own §Limits say a **prop
 * threaded through JSX** is invisible to it, and this seam is threaded through
 * JSX — so the suffix buys the one rule that looks at the interface rather than
 * at the thread.
 *
 * ## What the game may command, and what it deliberately may not
 *
 * {@link GradientTrainer} is `setSimulationParameters` and `stop` and nothing
 * else — narrowed for exactly the reason `workout/session.ts` narrows
 * `WorkoutTrainer` to `setTargetPower` and `stop`: **a method that is not on
 * the type cannot be called by a later edit**, and the two that are missing are
 * the dangerous ones. `reset()` revokes this client's control, and
 * `requestControl()` is a thing the *rider* does — a game screen that took
 * control on its own would be the screen deciding to apply physical resistance
 * to somebody, which CLAUDE.md §6 rules out and `RideController.startWorkout`
 * already rules out for the workout path.
 *
 * ⚠️ **`setTargetPower` is absent too, and that is not an oversight.** ERG and
 * simulation are two different things the same machine can be told; the game
 * drives the second one only, and the first belongs to the workout session.
 */

import type { TrainerControl } from '@onyourleft/sensors/protocol';

/**
 * The trainer, narrowed to the two commands a ride in the game may give it.
 *
 * @see the module note for why the other nine methods of `TrainerControl` are
 * unreachable from here.
 */
export type GradientTrainer = Pick<TrainerControl, 'setSimulationParameters' | 'stop'>;

/**
 * What the paired trainer can be told about the road, right now.
 *
 * Six states rather than a boolean, because five of them are things a rider
 * can act on and they call for different sentences. #362's fourth criterion is
 * that a machine which does not offer simulation mode *"is **not** written to,
 * and the rider is told rather than left believing the road is flat"* — a
 * boolean could carry the first half and not the second.
 */
export type GameTrainerKind =
  /** No trainer is paired at all. A ride from a power meter is the ordinary case. */
  | 'none'
  /**
   * A workout is in progress, and it already owns the machine's control point.
   *
   * ⚠️ **Not a variation on `not-controllable`.** The trainer is controllable;
   * something else is controlling it. `RideSession` is mounted above the router
   * (`shell/AppShell.tsx`), so a workout started on the Ride screen keeps
   * ticking while the rider is in the game — and a game ride that also wrote
   * would put two writers about 1 Hz each on one characteristic, then release
   * it with an FTMS **Stop** that leaves the workout's clock running against a
   * machine which has stopped listening. `ride/controller.ts`
   * §`simulationControl` refuses the handle; this is the sentence that goes
   * with the refusal.
   */
  | 'workout'
  /**
   * Paired, and it serves no control point or reported no power range.
   *
   * `ride/trainer.ts` returns `undefined` for both, and it is the same state as
   * far as the road is concerned: there is nothing to write to.
   */
  | 'not-controllable'
  /**
   * Controllable, and Fitness Machine Feature Target Setting **bit 13** is
   * clear — the machine does not accept Set Indoor Bike Simulation Parameters.
   *
   * ⚠️ The one state that must never be written to. #49's revision block:
   * *"Offering a control the trainer will refuse is worse than not offering
   * it."*
   */
  | 'no-simulation'
  /**
   * It would take a gradient, and the machine has not granted control.
   *
   * Taking it is the rider's to do, on the Ride screen. See the module note.
   */
  | 'no-control'
  /** Paired, controllable, offers simulation, and control is held. */
  | 'ready';

/** The trainer the game found, and what it may say to it. */
export interface GameTrainer {
  readonly kind: GameTrainerKind;
  /**
   * Present **only** when {@link GameTrainerKind} is `ready`.
   *
   * ⚠️ Not "present when a trainer exists". A control handed over in any other
   * state is a gradient waiting to be written to a machine that will refuse it
   * — or worse, one that will accept it having never said it could.
   */
  readonly control: GradientTrainer | undefined;
}

/** A trainer nothing can be said to. The state every non-trainer ride is in. */
export const NO_GAME_TRAINER: GameTrainer = { kind: 'none', control: undefined };

/** How the game reaches whatever trainer the rider paired on the Ride screen. */
export interface GameTrainerPort {
  /**
   * The trainer, as it is at this instant.
   *
   * Read **once per ride**, at the start, and held for its length — the same
   * rule `GameView` follows for the rider's mass and the ride's wind, and for
   * the same reason: a ride whose conditions could move under it is a different
   * claim from the deterministic one `simulation.ts` makes. Control lost
   * mid-ride therefore arrives as a **refused write**, which
   * `game/gradient.ts` reports rather than swallows.
   */
  readTrainer(): GameTrainer;
}

/**
 * What a rider is told about the road their trainer is — or is not — simulating.
 *
 * `undefined` for the two states there is nothing to say about: `ready`, where
 * the gradient is being written and the session reports it, and `none`, where
 * the rider is not on a trainer this client can drive and has not asked to be.
 *
 * ⚠️ **Not a "trainer control unavailable" message.** Every sentence here is
 * about the *road*, because that is what the rider is about to be misled about:
 * the screen shows a 6 % climb and the legs feel a flat one, and a notice that
 * said only "no trainer control" would leave them to join those up.
 */
export function trainerRoadNotice(trainer: GameTrainer): string | undefined {
  switch (trainer.kind) {
    case 'ready':
    case 'none':
      return undefined;
    case 'workout':
      return (
        'A workout is driving your trainer, so the hills on this route are not being sent to it — ' +
        'two things cannot set the resistance at once. End the workout on the Ride screen to ' +
        'feel the road instead.'
      );
    case 'not-controllable':
      return (
        'Your trainer is paired but cannot be controlled, so the hills on this route will not ' +
        'be felt — the resistance stays wherever the trainer has it.'
      );
    case 'no-simulation':
      return (
        'Your trainer does not offer simulation mode, so the hills on this route cannot be sent ' +
        'to it. The road on screen is real; the resistance under you is not.'
      );
    case 'no-control':
      return (
        'Your trainer has not granted control, so the hills on this route are not being sent to ' +
        'it. Take control on the Ride screen before you start, and the gradient will follow the ' +
        'road.'
      );
  }
}

/**
 * Decide what the game may say to the trainer the ride screen holds.
 *
 * A pure function of the two things a caller can observe, so every branch above
 * is reachable from a test without a Bluetooth adapter. `main.tsx` is the one
 * production caller and it supplies both halves from **one** `RideController`
 * — the same controller `readSensors` reads, because a second transport would
 * be a second pairing flow against an OS-wide budget of about three
 * connections.
 *
 * @param snapshot what the ride screen believes about the trainer, or
 * `undefined` where there is no ride controller at all — Safari, Firefox, a
 * page served over plain HTTP.
 * @param control the narrowed control, or `undefined`. Supplied separately
 * because {@link GameTrainer.control} is deliberately absent unless every gate
 * above it passed, and a snapshot cannot carry an object with methods on it.
 * @param workoutRunning whether a workout already owns the control point. See
 * the `workout` member of {@link GameTrainerKind}.
 */
export function gameTrainerFrom(
  snapshot:
    | {
        readonly paired: boolean;
        readonly controllable: boolean;
        readonly canSimulate: boolean;
        readonly hasControl: boolean;
      }
    | undefined,
  control: GradientTrainer | undefined,
  workoutRunning: boolean,
): GameTrainer {
  if (snapshot === undefined || !snapshot.paired) {
    return NO_GAME_TRAINER;
  }
  // ⚠️ **Before the `control === undefined` test, and that ordering is the
  // whole point.** `ride/controller.ts` §`simulationControl` already returns
  // `undefined` while a workout runs, so without this the very refusal that
  // keeps the rider safe would be reported as *"your trainer cannot be
  // controlled"* — a sentence that is false, and that sends the rider to
  // re-pair a trainer which is working perfectly.
  if (workoutRunning) {
    return { kind: 'workout', control: undefined };
  }
  if (!snapshot.controllable || control === undefined) {
    return { kind: 'not-controllable', control: undefined };
  }
  if (!snapshot.canSimulate) {
    return { kind: 'no-simulation', control: undefined };
  }
  if (!snapshot.hasControl) {
    return { kind: 'no-control', control: undefined };
  }
  return { kind: 'ready', control };
}
