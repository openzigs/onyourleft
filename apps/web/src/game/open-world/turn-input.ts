// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every input that can choose a turn, as one {@link TurnPress} — #2897, under
 * ADR 0088 D-2 and D-3.
 *
 * | Input | Left | Straight | Right | U-turn |
 * |---|---|---|---|---|
 * | Keyboard (`key`, and `code` for other layouts) | ArrowLeft, Page Up | ArrowUp | ArrowRight, Page Down | ArrowDown |
 * | A bar remote | whichever of those keys it sends (unmeasured: #733) | | | |
 * | A gamepad, standard mapping | face button 2 | face button 0 | face button 1 | face button 3 |
 * | The Android shell's numbered buttons | 4 | 3 | 2 | none |
 * | OpenBikeControl v1 | Navigate Left `0x12` | Navigate Up `0x10` | Navigate Right `0x13` | Navigate Down `0x11` |
 * | The screen | the prompt's left symbol | its straight symbol | its right symbol | its U-turn button |
 *
 * The OpenBikeControl ids are the specification's **Navigation** group, read
 * at the protocol repository's commit `7af7c41f` on 2026-11-20 (MIT); only
 * ids it names are mapped, and nothing of its text is reproduced.
 *
 * ## A lane press never takes a turn (D-2)
 *
 * A and D, the D-pad's left and right (buttons 14 and 15), the left stick,
 * OpenBikeControl's Steer Left and Steer Right (`0x18`, `0x19`) and its
 * steering angle (`0x1B`) keep their one job, a lane, and none of them is in a
 * table here. ⚠️ **The steering angle never chooses a turn** (D-4): a
 * continuous or lean-to-turn steer is out of scope until a patent reading is
 * re-run or the owner names it.
 *
 * ## One press, never a repeat
 *
 * Keys follow `lanes.ts` §`intentOfKeyIn`'s discipline: never from a form
 * field, never with Ctrl, Alt or Meta, never one a handler already took, never
 * a held key's repeats; Enter and Space are never ride keys. A pad button and
 * an OpenBikeControl button choose once as they go down, and nothing more
 * until they are released.
 *
 * ## Nothing here can reach the trainer
 *
 * It imports the lane keys' discipline (`lanes.ts`, which imports nothing),
 * the pad layout's name (`gamepad-port.ts`, which imports nothing), and types.
 * `open-world-cannot-reach-trainer.test.ts` holds it.
 *
 * @unwired the open-world ride session (#2896) reads the keyboard, the pads
 * and the controller through these, and the junction prompt (#2898) maps its
 * symbols through {@link turnOfSymbol}; neither exists yet. The tests drive
 * each table as they will.
 */

import type { OpenBikeControlEvent } from '@onyourleft/sensors/protocol';

import { FORWARDED_MAPPING, type PadSnapshot } from '../gamepad-port';
import { intentOfKeyIn, type SteerKeyEvent } from '../lanes';

import type { TurnPress } from './junction-choice';

/** The turn keys, by `KeyboardEvent.key`. */
export const TURN_KEYS: Readonly<Record<string, TurnPress>> = Object.freeze({
  ArrowLeft: 'left',
  PageUp: 'left',
  ArrowUp: 'straight',
  ArrowRight: 'right',
  PageDown: 'right',
  ArrowDown: 'u-turn',
});

/** The same keys by `KeyboardEvent.code`, for a layout whose `key` differs. */
export const TURN_CODES: Readonly<Record<string, TurnPress>> = TURN_KEYS;

/** The turn a key event asks for, or `undefined` for one that is not a turn key, or not one now. */
export function turnOfKey(event: SteerKeyEvent): TurnPress | undefined {
  return intentOfKeyIn(event, TURN_KEYS, TURN_CODES);
}

/** A standard-mapping pad's face buttons, in Delivery's throw places. */
export const TURN_PAD_BUTTONS: Readonly<Record<number, TurnPress>> = Object.freeze({
  0: 'straight',
  1: 'right',
  2: 'left',
  3: 'u-turn',
});

/** The Android shell's numbered buttons (1-based), in Delivery's throw places. No U-turn. */
export const TURN_NUMBERED_BUTTONS: Readonly<Record<number, TurnPress>> = Object.freeze({
  2: 'right',
  3: 'straight',
  4: 'left',
});

/** The buttons held on each pad slot, as the last poll saw them. */
export interface TurnPadState {
  readonly held: readonly (ReadonlySet<number> | undefined)[];
}

export const NO_TURN_PADS_HELD: TurnPadState = Object.freeze({ held: Object.freeze([]) });

const STANDARD = new Map(
  Object.entries(TURN_PAD_BUTTONS).map(([at, press]) => [Number(at), press] as const),
);

// The shell forwards numbered button N as pad button N - 1 (`gamepad-port.ts`).
const FORWARDED = new Map(
  Object.entries(TURN_NUMBERED_BUTTONS).map(([at, press]) => [Number(at) - 1, press] as const),
);

const UNMAPPED = new Map<number, TurnPress>();

function layoutOf(mapping: string): ReadonlyMap<number, TurnPress> {
  if (mapping === 'standard') return STANDARD;
  if (mapping === FORWARDED_MAPPING) return FORWARDED;
  return UNMAPPED;
}

/** One poll of every pad: a press for each turn button that went down since the last. */
export function readTurnPads(
  state: TurnPadState,
  pads: readonly (PadSnapshot | null)[],
): { readonly state: TurnPadState; readonly presses: readonly TurnPress[] } {
  const held: (ReadonlySet<number> | undefined)[] = [];
  const presses: TurnPress[] = [];
  pads.forEach((pad, slot) => {
    if (pad === null || pad.connected !== true) {
      held[slot] = undefined;
      return;
    }
    const before = state.held[slot];
    const now = new Set<number>();
    for (const [button, press] of layoutOf(pad.mapping)) {
      if (pad.buttons[button]?.pressed !== true) continue;
      now.add(button);
      if (before?.has(button) !== true) presses.push(press);
    }
    held[slot] = now;
  });
  return { state: { held }, presses };
}

/** OpenBikeControl v1's Navigation buttons, by id. */
export const TURN_CONTROLLER_BUTTONS: Readonly<Record<number, TurnPress>> = Object.freeze({
  0x10: 'straight',
  0x11: 'u-turn',
  0x12: 'left',
  0x13: 'right',
});

/** The controller's Navigation buttons held down, as its last events left them. */
export type TurnControllerState = ReadonlySet<number>;

export const NO_TURN_CONTROLLER_HELD: TurnControllerState = Object.freeze(new Set<number>());

/**
 * A controller's events as presses: one for each Navigation button that goes
 * down, none for a button already down, and none for a steer or an angle.
 */
export function readTurnController(
  state: TurnControllerState,
  events: readonly OpenBikeControlEvent[],
): { readonly state: TurnControllerState; readonly presses: readonly TurnPress[] } {
  const held = new Set(state);
  const presses: TurnPress[] = [];
  for (const event of events) {
    if (event.kind !== 'button' || !Object.hasOwn(TURN_CONTROLLER_BUTTONS, event.button)) continue;
    if (!event.pressed) {
      held.delete(event.button);
    } else if (!held.has(event.button)) {
      held.add(event.button);
      presses.push(TURN_CONTROLLER_BUTTONS[event.button] as TurnPress);
    }
  }
  return { state: held, presses };
}

/** The prompt's on-screen symbols (ADR 0088 D-3.1), each one discrete press. */
export type TurnSymbol = 'turn-left' | 'turn-straight' | 'turn-right' | 'turn-u-turn';

/**
 * The press a tap on a symbol is: the same press the matching key gives, so a
 * tap goes through the one discrete-press path (D-3.1.1). Where the finger
 * lands decides nothing. The touch lock is the prompt's region's (#2898): with
 * it on, no tap arrives here (D-3.1.3).
 */
export function turnOfSymbol(symbol: TurnSymbol): TurnPress {
  return TURN_SYMBOLS[symbol];
}

/** Each symbol's press: the key table's, symbol by symbol. */
export const TURN_SYMBOLS: Readonly<Record<TurnSymbol, TurnPress>> = Object.freeze({
  'turn-left': 'left',
  'turn-straight': 'straight',
  'turn-right': 'right',
  'turn-u-turn': 'u-turn',
});
