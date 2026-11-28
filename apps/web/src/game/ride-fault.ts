// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ride says, and logs, when a frame of the ride throws — #3404.
 *
 * `GameView.tsx` §"The loop" runs the whole ride on one `requestAnimationFrame`
 * callback that asks for the next frame only at its end. Before #3404 a throw
 * anywhere in it escaped, the next frame was never asked for, and the ride
 * froze with the trainer holding the last grade it had been sent: a load on a
 * rider with nothing on screen moving (SECURITY.md, trainer control is a
 * safety issue). The loop now catches it, and decides between two answers:
 *
 * - **A mode was running** — a group ride, a lap race, a Delivery round, the
 *   AI pacer: each is optional, writes nothing the trainer is sent, and can be
 *   ended without ending the ride. A frame cannot say which of them threw, or
 *   whether one did, so every one that was running ends, and the ride goes on.
 *   A core fault in such a ride costs one more frame: the next one throws with
 *   no mode left to end, and takes the second answer.
 * - **None was** — the core of the ride failed. The trainer is let go the way
 *   *End ride* lets a game ride go (`gradient.ts` §`stop`), the loop stops,
 *   and the rider is told. *End ride* still works, and saves what was recorded.
 *
 * ⚠️ **The log names the error's class and never its message** — ADR 0004 D.
 * A message thrown from inside a step can carry any number the step was
 * handed, a coordinate among them, and a log line on a device is a place a
 * coordinate can leave from. The class says which kind of fault it was; the
 * modes ended say where.
 */

/** An optional mode of a game ride, which a fault in a frame ends. */
export type RideMode = 'group-ride' | 'lap-race' | 'delivery' | 'ai-pacer';

/** Each mode as a sentence names it. */
const MODE_NAME: Readonly<Record<RideMode, string>> = {
  'group-ride': 'the group ride',
  'lap-race': 'the lap race',
  delivery: 'the Delivery round',
  'ai-pacer': 'the AI pacer',
};

/** `a`, `a and b`, `a, b and c`. */
function listed(modes: readonly RideMode[]): string {
  const names = modes.map((mode) => MODE_NAME[mode]);
  const last = names.pop();
  return names.length === 0 ? (last ?? '') : `${names.join(', ')} and ${last ?? ''}`;
}

/** The HUD notice's label for a mode a fault ended. */
export const MODE_ENDED_LABEL = 'Ended';

/** What the rider is told when a fault ended the modes the frame was running. */
export function modeEndedText(modes: readonly RideMode[]): string {
  const named = listed(modes);
  return `Something went wrong, so ${named} ${modes.length === 1 ? 'has' : 'have'} ended. Your ride goes on.`;
}

/** The HUD notice's label for a ride a fault stopped. */
export const RIDE_STOPPED_LABEL = 'Ride stopped';

/**
 * What the rider is told when the core of the ride failed.
 *
 * ⚠️ **"asked to let go", never "let go"** — `gradient.ts`
 * §`HELD_AFTER_LETTING_GO`'s reason: the release is an FTMS Stop, which the
 * trainer may refuse, and on the trainer measured (#372) an acknowledged one
 * kept its grade. A refused one is said by the gradient's own fault notice.
 *
 * @param released whether this ride was driving the trainer and was let go.
 * A ride that was not (a workout owns the trainer, or there is none) says
 * nothing about one.
 */
export function rideStoppedText(released: boolean): string {
  return released
    ? 'Something went wrong in this app and the ride stopped. The hills are no longer being sent to your trainer, and it was asked to let go. End the ride when you are ready.'
    : 'Something went wrong in this app and the ride stopped. End the ride when you are ready.';
}

/**
 * The console line for a fault in a frame: what it ended, and the error's
 * class. Never the message nor the stack, whose first line is the message —
 * the module note says why.
 */
export function rideFaultLog(ended: readonly RideMode[], error: unknown): string {
  const kind = error instanceof Error ? error.name : typeof error;
  return ended.length === 0
    ? `On Your Left: a fault in the ride's frame (${kind}) stopped the ride.`
    : `On Your Left: a fault in the ride's frame (${kind}) ended ${listed(ended)}; the ride goes on.`;
}
