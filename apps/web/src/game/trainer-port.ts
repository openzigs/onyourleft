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
 * {@link GradientTrainer} is `setSimulationParameters` and `letGo` and
 * nothing else — narrowed for exactly the reason `workout/session.ts` narrows
 * `WorkoutTrainer`: **a method that is not on the type cannot be called by a
 * later edit**. The component that drives gradients cannot ask for control,
 * and that is unchanged by #503.
 *
 * ## Who asks for control, and when — #503
 *
 * ⚠️ **This note used to say the game never asks, and a reviewer who remembers
 * that is reading the old file.** Until [#503](https://github.com/openzigs/onyourleft/issues/503)
 * it read: *"`requestControl()` is a thing the *rider* does — a game screen
 * that took control on its own would be the screen deciding to apply physical
 * resistance to somebody, which CLAUDE.md §6 rules out and
 * `RideController.startWorkout` already rules out for the workout path."* So
 * the game had no way to ask, and its `no-control` notice sent the rider to
 * the Ride screen — where the only *Ask the trainer for control* lived inside
 * the ERG panel. On the owner's tablet that read as "set an ERG before the
 * game will work", which was never true.
 *
 * **What changed is who is deciding, not the rule.** §6's concern is a
 * *screen* deciding by itself to put resistance on a person. Pressing *Ride*
 * on a picker that has just said *"your trainer will follow this route's
 * hills"* ({@link trainerRoadPromise}) is the rider asking for resistance, with
 * the same informed intent the Ride screen's button carries. So
 * {@link GameTrainerPort.askForControlOnRide} exists, and `GameView` calls it from
 * the Ride press and from nowhere else — entering the game screen still asks
 * nothing and writes nothing. It goes through the ride controller's own
 * `requestTrainerControl`, never a second path to the control point
 * ({@link gameTrainerPortOver}).
 *
 * Every refusal that makes this safe is unchanged: a running workout keeps the
 * control point and is never asked over (`workout` is decided first, and
 * {@link gameTrainerPortOver} refuses as well); a machine without simulation
 * mode, or with no control point, is never asked or written to; a trainer that
 * refuses is said in a sentence ({@link trainerRoadNotice}, `riding`); and the
 * one release (#372) is untouched — nothing takes control back after it.
 *
 * ⚠️ **`stop` was on this type until #372, and `letGo` replaced it** — not
 * because it sends something different (both are an FTMS Stop, since #442 was
 * re-scoped away from a Reset) but because `letGo` is the ride controller's ONE
 * release, so a game ride that ends is joined with any release already in
 * flight and a refused one is reported like every other. `gradient.ts` calls it
 * from its `stop` alone, once, after which it writes nothing. The bare
 * `reset()` stays off this type: it revokes control, and on the trainer
 * measured it cleared nothing a Stop did not.
 *
 * ⚠️ **`setTargetPower` is absent too, and that is not an oversight.** ERG and
 * simulation are two different things the same machine can be told; the game
 * drives the second one only, and the first belongs to the workout session.
 */

import type { TrainerControl } from '@onyourleft/sensors/protocol';

/**
 * The trainer, narrowed to the two commands a ride in the game may give it.
 *
 * @see the module note for why the other methods of `TrainerControl` are
 * unreachable from here, and why `letGo` rather than `stop` (#372).
 */
export type GradientTrainer = Pick<TrainerControl, 'setSimulationParameters' | 'letGo'>;

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
   * machine which has stopped listening.
   * `ride/controller.ts`
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
   * Before a ride: the rider's press on *Ride* asks for it (#503). During one:
   * it was asked for and the trainer did not grant it. See the module note.
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
  /**
   * The last release the trainer did not confirm, if any (#372) — the ride
   * controller's `TrainerSnapshot.releaseFault`, carried to the route picker.
   *
   * ⚠️ Here because the game is where a ride that ends on a climb ends: a rider
   * who presses *End ride* lands on the picker, not on the Ride screen, and a
   * trainer that refused the Stop may still be holding the hill. Optional,
   * and absent in every state but the one that needs saying.
   */
  readonly releaseFault?: string | undefined;
  /**
   * Why the trainer did not grant control when the Ride press asked — #509.
   * The ride controller's `TrainerSnapshot.refusal`, which is the same text
   * the Ride screen shows: for example the Control Not Permitted guidance when
   * another app holds the machine, or a timeout. Present **only** when
   * {@link GameTrainerKind} is `no-control`, because that field is "why the
   * last setpoint was refused" and on a trainer that holds control it is about
   * an ERG target, not the road.
   *
   * ⚠️ A string the controller already rendered from the error's message —
   * never the error itself, and never anything a coordinate could be in.
   * `trainerRoadNotice` puts it in the in-ride sentence, because "press Ride
   * again" is the wrong instruction while another app has the trainer.
   */
  readonly refusal?: string | undefined;
  /**
   * `true` when {@link GameTrainerKind} is `workout` and that workout has
   * reached its END — #447, and #448's review. Absent otherwise.
   *
   * ⚠️ **The kind stays `workout`**, because a finished workout still holds
   * the control point until the rider ends it on the Ride screen
   * (`ride/controller.ts` §`simulationControl` refuses while it exists), so the
   * road notice is still true. What changes is the SOUND: a finished workout's
   * tone is silent and nothing will `rejoin` it, so a game ride that ends
   * while one is only finished may let the audio stop. `GameView` §`teardown`
   * re-reads this at the END of the ride for exactly that; nothing else here
   * reads it.
   */
  readonly workoutFinished?: true | undefined;
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
   *
   * ⚠️ **One exception, and it decides no write**: `GameView` §`teardown` reads
   * it again as the ride ENDS, to ask whether a workout still needs the audio
   * awake (#447). Whether a workout was running when the ride began is the
   * wrong question there — it may have finished while the rider was riding.
   */
  readTrainer(): GameTrainer;
  /**
   * Ask the paired trainer for control — #503.
   *
   * ⚠️ **Called from the rider's press on *Ride* and from nowhere else**, and
   * only when {@link readTrainer} says `no-control`: never on mount, never for a
   * workout's trainer, never for a machine that cannot simulate. Mounting the
   * game asks nothing — that is the line between the rider deciding and the
   * screen deciding. See the module note.
   *
   * Resolves once the trainer has answered, either way. A refusal is not
   * thrown: the next {@link readTrainer} is what says whether control was
   * granted, so there is one source of truth for the ride's trainer state.
   *
   * ⚠️ On the port rather than on {@link GradientTrainer} so that `WIRE003`
   * (CLAUDE.md §4j) goes red if the game stops calling it, and so that the
   * component driving gradients still cannot ask.
   *
   * ⚠️ **Not called `requestControl`, and that is measured rather than a
   * taste.** `WIRE003` matches a call by NAME (`check-wiring.mjs` §Limits), and
   * `ride/controller.ts` calls `TrainerControl.requestControl` — so with this
   * method spelled that way, deleting `GameView`'s call left `check:wiring`
   * green. A name nothing else in production calls is what makes the gate able
   * to fire.
   */
  askForControlOnRide(): Promise<void>;
}

/** What {@link gameTrainerFrom} reads of the ride screen's `TrainerSnapshot`. */
interface TrainerFacts {
  readonly paired: boolean;
  readonly controllable: boolean;
  readonly canSimulate: boolean;
  readonly hasControl: boolean;
  readonly releaseFault?: string | undefined;
  /** Why the last request was refused — #509. @see GameTrainer.refusal */
  readonly refusal?: string | undefined;
}

/**
 * What {@link gameTrainerPortOver} needs of the ride controller — the one
 * `main.tsx` builds, so a rider pairs once and the game finds it.
 */
interface GameTrainerSource {
  getSnapshot(): {
    readonly trainer: TrainerFacts;
    readonly workout: { readonly status: string } | undefined;
  };
  simulationControl(): GradientTrainer | undefined;
  requestTrainerControl(): Promise<void>;
}

/**
 * The game's trainer port over a ride controller, or over none — #362, #503.
 *
 * ⚠️ **The SAME controller the Ride screen uses**, so the request is the
 * controller's existing `requestTrainerControl` — one path to the control
 * point, with its refusal recorded where the Ride screen reads it too.
 *
 * @param controller `undefined` where there is no ride controller at all —
 * Safari, Firefox, a page served over plain HTTP.
 */
export function gameTrainerPortOver(controller: GameTrainerSource | undefined): GameTrainerPort {
  const readTrainer = (): GameTrainer => {
    // One snapshot read for both answers, so the workout state and the
    // trainer state cannot be a tick apart.
    const snapshot = controller?.getSnapshot();
    return gameTrainerFrom(
      snapshot?.trainer,
      controller?.simulationControl(),
      snapshot?.workout !== undefined,
      // #447: read only for the audio, at the end of a game ride.
      snapshot?.workout?.status === 'finished',
    );
  };
  return {
    readTrainer,
    askForControlOnRide: async () => {
      // ⚠️ Re-decided here rather than trusted from the caller: a workout that
      // started between the picker's read and this press owns the control
      // point, and a Request Control over it is a second client taking the
      // machine from a running workout.
      if (controller === undefined || readTrainer().kind !== 'no-control') {
        return;
      }
      await controller.requestTrainerControl();
    },
  };
}

/**
 * What a rider is told, before a ride, that their trainer WILL do — #503.
 *
 * The sentence that makes the *Ride* press an informed request for
 * resistance: it is on the picker, above the button, before anything is asked
 * of the machine. `undefined` in every state where the hills will not reach the
 * trainer — {@link trainerRoadNotice} says those.
 */
export function trainerRoadPromise(trainer: GameTrainer): string | undefined {
  switch (trainer.kind) {
    case 'ready':
      return 'Your trainer will follow this route’s hills: the gradient is sent to it as you ride.';
    case 'no-control':
      return (
        'Your trainer will follow this route’s hills. Pressing Ride asks it for control, and ' +
        'the gradient is sent to it as you ride.'
      );
    case 'none':
    case 'workout':
    case 'not-controllable':
    case 'no-simulation':
      return undefined;
  }
}

/**
 * When a notice is read: on the picker before the rider presses *Ride*, or
 * once the ride has begun. Only `no-control` differs — see
 * {@link trainerRoadNotice}.
 */
export type RoadNoticeMoment = 'before-ride' | 'riding';

/**
 * What a rider is told about the road their trainer is — or is not — simulating.
 *
 * `undefined` for the two states there is nothing to say about: `ready`, where
 * the gradient is being written and the session reports it, and `none`, where
 * the rider is not on a trainer this client can drive and has not asked to be.
 *
 * ⚠️ **`no-control` says nothing before a ride and says a refusal during one**
 * (#503). Before, the rider's press is what asks — {@link trainerRoadPromise}
 * says so. During, the press has already asked, so a trainer still without
 * control is one that did not grant it. Until #503 this sentence sent the rider
 * to the Ride screen *"before you start"*, which is the detour that issue
 * removed.
 *
 * ⚠️ **Not a "trainer control unavailable" message.** Every sentence here is
 * about the *road*, because that is what the rider is about to be misled about:
 * the screen shows a 6 % climb and the legs feel a flat one, and a notice that
 * said only "no trainer control" would leave them to join those up.
 */
export function trainerRoadNotice(
  trainer: GameTrainer,
  moment: RoadNoticeMoment,
): string | undefined {
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
      if (moment === 'before-ride') {
        return undefined;
      }
      // #509: with the reason the controller recorded, where there is one. If
      // another app holds the trainer, "press Ride again" on its own will not
      // help; the reason is what says what to put right first. Bracketed by
      // dashes whatever its own punctuation, and never anything but the string
      // the ride controller already rendered — no error object, no coordinate.
      return (
        'Your trainer did not grant control when you pressed Ride' +
        (trainer.refusal === undefined ? '' : ` — ${trainer.refusal} —`) +
        ', so the hills on this route are not being sent to it. End the ride and press Ride ' +
        'again to ask once more.'
      );
  }
}

/**
 * Decide what the game may say to the trainer the ride screen holds.
 *
 * A pure function of the two things a caller can observe, so every branch above
 * is reachable from a test without a Bluetooth adapter.
 * {@link gameTrainerPortOver} is the one production caller, and `main.tsx`
 * hands it **one** `RideController`
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
 * @param workoutFinished whether that workout has reached its end — carried
 * as {@link GameTrainer.workoutFinished}, and read only for the audio.
 */
export function gameTrainerFrom(
  snapshot: TrainerFacts | undefined,
  control: GradientTrainer | undefined,
  workoutRunning: boolean,
  workoutFinished = false,
): GameTrainer {
  if (snapshot === undefined || !snapshot.paired) {
    return NO_GAME_TRAINER;
  }
  const kind = trainerKindFrom(snapshot, control, workoutRunning);
  const finished: GameTrainer =
    kind.kind === 'workout' && workoutFinished ? { ...kind, workoutFinished: true } : kind;
  // #509: the reason travels only with the state it explains.
  const found: GameTrainer =
    finished.kind === 'no-control' && snapshot.refusal !== undefined
      ? { ...finished, refusal: snapshot.refusal }
      : finished;
  return snapshot.releaseFault === undefined
    ? found
    : { ...found, releaseFault: snapshot.releaseFault };
}

/** {@link gameTrainerFrom} for a paired trainer, before the release notice is attached. */
function trainerKindFrom(
  snapshot: {
    readonly controllable: boolean;
    readonly canSimulate: boolean;
    readonly hasControl: boolean;
  },
  control: GradientTrainer | undefined,
  workoutRunning: boolean,
): GameTrainer {
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
