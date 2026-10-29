// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Delivery's throws and lane changes from a gamepad — #1821, resting on the
 * owner's ruling DL12 of 2026-10-27 and DL7 as revised on 2026-10-28 (epic
 * #1803).
 *
 * ## The same intents as the keys, and no more
 *
 * A pad asks for exactly what a key does: one of `throw-input.ts`
 * §`THROW_INTENTS` (#1810) or one of `steer.ts` §`STEER_INTENTS` (#1820).
 * {@link GamepadIntent} is that union and the test holds it there, so a pad
 * can ask for nothing a key cannot. None of it reaches the trainer (ADR 0059
 * D-2), and #1807's walk reads this module.
 *
 * ## The standard mapping, at the W3C indices
 *
 * Only a pad the browser reports with `mapping: 'standard'` is read, because
 * only then are the button indices known (W3C Gamepad, §"Remapping"). A pad
 * with any other mapping gives nothing, rather than a guess. Proposed in
 * #1821's pull request, for the owner's approval:
 *
 * - **Lanes**: the d-pad's left and right (buttons 14 and 15), and the left
 *   stick pushed past {@link STICK_PRESS} to a side (axis 0).
 * - **Throws**: the left face button (2, X on an Xbox layout) throws left,
 *   the right one (1, B) throws right, and the bottom one (0, A) throws
 *   toward the next house — the throw control's own left, right and middle.
 *
 * ⚠️ **Spike 0027 (#1819) has not run**: which index a given pad's buttons
 * land on in the Android shell, and whether the shell delivers pads at all,
 * is unmeasured. These are the W3C standard indices, which a desktop
 * browser reports for a standard pad.
 *
 * ## One press, one intent
 *
 * Polled once a frame, a held button reads pressed on every poll; it asks for
 * its intent once, on the poll it goes down. The stick has hysteresis: it
 * presses at {@link STICK_PRESS} and lets go only below {@link STICK_RELEASE},
 * so a thumb resting near the threshold does not change lane twice.
 *
 * ## Untrusted input (CLAUDE.md §6)
 *
 * An axis value that is not a finite number from −1 to 1 — NaN, ±Infinity,
 * 5.0 — produces no intent and changes nothing: the stick is held as it was
 * before the bad reading, so a pad that flickers to NaN does not press twice.
 * Only the buttons in {@link STANDARD_BUTTONS} are read, and only a `pressed`
 * that is exactly `true` counts, so a pad reporting 300 buttons, or none, is
 * read in the same handful of steps. Nothing here throws.
 *
 * ## A pad that goes
 *
 * A slot that is `null`, or a pad that is no longer `connected`, holds
 * nothing and asks for nothing; the round goes on, and the next poll that
 * finds a pad there reads it as new. A pad's first poll counts a button
 * already down as a press: a pad is listed only after a press, and that
 * press is the rider's.
 *
 * Nothing here is stored: the state is per poll, in memory.
 */

import type { SteerIntent } from './steer';
import type { ThrowIntent } from './throw-input';
import type { PadSnapshot } from '../gamepad-port';

/** Everything a pad can ask for: a throw (#1810) or a lane change (#1820). */
export type GamepadIntent = ThrowIntent | SteerIntent;

/** The standard mapping's buttons that ask for something, by W3C index. Proposed in #1821's pull request. */
export const STANDARD_BUTTONS: Readonly<Record<number, GamepadIntent>> = Object.freeze({
  0: 'next-house',
  1: 'right',
  2: 'left',
  14: 'lane-left',
  15: 'lane-right',
});

/** How far the left stick goes to a side before it asks for a lane: half way. */
export const STICK_PRESS = 0.5;

/** How far back toward the middle it comes before it may ask again: a quarter. */
export const STICK_RELEASE = 0.25;

/** The axis the left stick's side-to-side is on, in the standard mapping: negative is left. */
const STICK_AXIS = 0;

/** What one pad holds down: each standard button index, and the stick's side. */
type Held = ReadonlySet<number | 'stick-left' | 'stick-right'>;

/** What the pads held down at the last poll, by slot. */
export interface GamepadInputState {
  readonly held: readonly (Held | undefined)[];
}

/** No pad has held anything. */
export const NO_PADS_HELD: GamepadInputState = Object.freeze({ held: Object.freeze([]) });

export interface GamepadRead {
  readonly state: GamepadInputState;
  /** One for each button or stick that went down on this poll, in slot order; usually none. */
  readonly intents: readonly GamepadIntent[];
}

/** The stick's side this poll, from the side it held at the last one; `undefined` reads as no change. */
function stickSide(
  axis: unknown,
  before: 'stick-left' | 'stick-right' | undefined,
): 'stick-left' | 'stick-right' | 'none' | undefined {
  if (typeof axis !== 'number' || !Number.isFinite(axis) || axis < -1 || axis > 1) return undefined;
  if (before === 'stick-left' && axis < -STICK_RELEASE) return before;
  if (before === 'stick-right' && axis > STICK_RELEASE) return before;
  if (axis <= -STICK_PRESS) return 'stick-left';
  if (axis >= STICK_PRESS) return 'stick-right';
  return 'none';
}

/** What one pad holds down now. */
function heldBy(pad: PadSnapshot, before: Held | undefined): Held {
  const held = new Set<number | 'stick-left' | 'stick-right'>();
  for (const index of Object.keys(STANDARD_BUTTONS).map(Number)) {
    if (pad.buttons[index]?.pressed === true) held.add(index);
  }
  const was = before?.has('stick-left')
    ? 'stick-left'
    : before?.has('stick-right')
      ? 'stick-right'
      : undefined;
  const side = stickSide(pad.axes[STICK_AXIS], was);
  const now = side === undefined ? was : side === 'none' ? undefined : side;
  if (now !== undefined) held.add(now);
  return held;
}

/** The intent a held thing asks for. */
function intentOf(source: number | 'stick-left' | 'stick-right'): GamepadIntent | undefined {
  if (source === 'stick-left') return 'lane-left';
  if (source === 'stick-right') return 'lane-right';
  return STANDARD_BUTTONS[source];
}

/**
 * Read one poll of `pads` against what they held at the last one: the
 * intents asked for by every button or stick that went down since, and what
 * each pad holds now.
 */
export function readGamepads(
  state: GamepadInputState,
  pads: readonly (PadSnapshot | null)[],
): GamepadRead {
  const held: (Held | undefined)[] = [];
  const intents: GamepadIntent[] = [];
  pads.forEach((pad, slot) => {
    if (pad === null || pad.connected !== true || pad.mapping !== 'standard') {
      held[slot] = undefined;
      return;
    }
    const before = state.held[slot];
    const now = heldBy(pad, before);
    for (const source of now) {
      if (before?.has(source) === true) continue;
      const intent = intentOf(source);
      if (intent !== undefined) intents.push(intent);
    }
    held[slot] = now;
  });
  return { state: { held }, intents };
}
