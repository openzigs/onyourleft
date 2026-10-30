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
 * A pad's buttons are read by index only when the browser reports it with
 * `mapping: 'standard'`, because only then are the indices known (W3C
 * Gamepad, §"Remapping"); a pad with any other mapping gets no guess at its
 * buttons (but see #1858, below). Approved in #1821's pull request:
 *
 * - **Lanes**: the d-pad's left and right (buttons 14 and 15), and the left
 *   stick pushed past {@link STICK_PRESS} to a side (axis 0).
 * - **Throws**: the left face button (2, X on an Xbox layout) throws left,
 *   the right one (1, B) throws right, and the bottom one (0, A) throws
 *   toward the next house — the throw control's own left, right and middle.
 *
 * Spike 0027 (#1819) measured an Xbox pad over Bluetooth in the Android
 * shell: every button reached the page at these indices.
 *
 * ## A pad with no standard mapping, and the shell's numbered buttons (#1858)
 *
 * Spike 0027's generic USB pad reported `mapping: ''`. Its d-pad reached the
 * page as axes 0 and 1; none of its buttons did, because Android raises them
 * as KEYCODE_BUTTON_1 to 16 and the WebView passes those on in neither
 * `gamepad.buttons` nor `keydown`. So:
 *
 * - **Any pad with another mapping** changes lane from **axis 0** (left and
 *   right), with the standard stick's thresholds and hysteresis. Axis 1 is
 *   up and down, and Delivery has no intent for either. No button of such a
 *   pad is read: its indices are a layout nobody here knows.
 * - **The numbered buttons**, which `MainActivity` forwards to the page and
 *   `gamepad-port.ts` lists as one pad of its own with
 *   {@link FORWARDED_MAPPING} (button `n` at index `n − 1`), throw, by
 *   {@link NUMBERED_BUTTONS}. Proposed in #1858's pull request, for the
 *   owner's approval, from where a PlayStation-style generic pad's face
 *   buttons commonly sit (1 top, 2 right, 3 bottom, 4 left): **4 throws
 *   left, 2 throws right and 3 throws toward the next house**, the same
 *   left, right and bottom as a standard pad's X, B and A. ⚠️ Unmeasured:
 *   spike 0027 recorded which numbers the owner's pad sent, not which
 *   physical button each was, and the numbering is the pad maker's, so it
 *   will vary between pads. #1858's tablet step checks it on the owner's.
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
 * Only the buttons in {@link STANDARD_BUTTONS} or {@link NUMBERED_BUTTONS}
 * are read, and only a `pressed` that is exactly `true` counts, so a pad
 * reporting 300 buttons, or none, is read in the same handful of steps.
 * Nothing here throws.
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
import { FORWARDED_MAPPING, type PadSnapshot } from '../gamepad-port';

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

/**
 * The numbered buttons the Android shell forwards that ask for something, by
 * button number (KEYCODE_BUTTON_1 is 1). Proposed in #1858's pull request.
 */
export const NUMBERED_BUTTONS: Readonly<Record<number, ThrowIntent>> = Object.freeze({
  2: 'right',
  3: 'next-house',
  4: 'left',
});

/** How far the left stick goes to a side before it asks for a lane: half way. */
export const STICK_PRESS = 0.5;

/** How far back toward the middle it comes before it may ask again: a quarter. */
export const STICK_RELEASE = 0.25;

/** The axis the left stick's side-to-side is on, in the standard mapping, and a generic pad's d-pad: negative is left. */
const STICK_AXIS = 0;

/**
 * Which button index of a pad of one mapping asks for what. Every pad's axis
 * 0 changes lane; the shell's forwarded pad lists no axes, so it never does.
 */
type Layout = ReadonlyMap<number, GamepadIntent>;

const STANDARD: Layout = new Map(
  Object.entries(STANDARD_BUTTONS).map(([index, intent]) => [Number(index), intent]),
);

/** The shell's numbered buttons: button `n` is at index `n − 1`. */
const FORWARDED: Layout = new Map(
  Object.entries(NUMBERED_BUTTONS).map(([button, intent]) => [Number(button) - 1, intent]),
);

/** A pad whose layout nobody here knows: no button, only its axis 0. */
const UNMAPPED: Layout = new Map();

function layoutOf(mapping: string): Layout {
  if (mapping === 'standard') return STANDARD;
  if (mapping === FORWARDED_MAPPING) return FORWARDED;
  return UNMAPPED;
}

/** What one pad holds down: each button index its layout reads, and the stick's side. */
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
function heldBy(pad: PadSnapshot, layout: Layout, before: Held | undefined): Held {
  const held = new Set<number | 'stick-left' | 'stick-right'>();
  for (const index of layout.keys()) {
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
function intentOf(
  source: number | 'stick-left' | 'stick-right',
  layout: Layout,
): GamepadIntent | undefined {
  if (source === 'stick-left') return 'lane-left';
  if (source === 'stick-right') return 'lane-right';
  return layout.get(source);
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
    if (pad === null || pad.connected !== true) {
      held[slot] = undefined;
      return;
    }
    const layout = layoutOf(pad.mapping);
    const before = state.held[slot];
    const now = heldBy(pad, layout, before);
    for (const source of now) {
      if (before?.has(source) === true) continue;
      const intent = intentOf(source, layout);
      if (intent !== undefined) intents.push(intent);
    }
    held[slot] = now;
  });
  return { state: { held }, intents };
}
