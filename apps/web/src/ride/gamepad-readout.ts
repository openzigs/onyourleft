// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the Devices screen's Controllers section says about each gamepad —
 * #2358. The pads come through `game/gamepad-port.ts` (#1821), the one
 * input path a gamepad has; this file only reads the snapshots it lists.
 *
 * ## Which pads are listed
 *
 * Every slot holding a pad that says it is `connected`, except the shell's
 * forwarded numbered buttons (`FORWARDED_MAPPING`, #1858): that slot is not
 * a device, only the presses Android drops, and it is `null` again once no
 * button is down. Its presses still reach {@link movedSince}, as "Button n".
 *
 * ## The name
 *
 * `Gamepad.id` carries the vendor and product codes: Chromium writes
 * "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)",
 * Firefox "045e-0b13-Xbox Wireless Controller". {@link padName} keeps the
 * name and drops the codes.
 *
 * ## Untrusted input (CLAUDE.md §6)
 *
 * A pad may not be what it claims. Its `id` may be missing, empty, not a
 * string or very long: it is read as a string only when it is one, cut to
 * {@link NAME_LIMIT} characters, and an empty one reads as
 * {@link UNNAMED_PAD}. An axis is read only when it is a finite number from
 * −1 to 1, a button only when `pressed` is exactly `true`, and at most
 * {@link READ_BUTTONS} buttons and {@link READ_AXES} axes of a pad are read,
 * so a pad reporting 300 of each costs the same handful of steps.
 */

import { STICK_PRESS, STICK_RELEASE } from '../game/delivery/gamepad-input';
import { FORWARDED_MAPPING, type PadSnapshot } from '../game/gamepad-port';

/** What a pad that reports no usable name is called. */
export const UNNAMED_PAD = 'Controller';

/** The longest name shown, in characters: longer is cut, with an ellipsis. */
export const NAME_LIMIT = 60;

/** How many of a pad's buttons are read: the standard mapping's 17, and the shell's 16, with room. */
export const READ_BUTTONS = 32;

/** How many of a pad's axes are read: the standard mapping's 4, with room. */
export const READ_AXES = 8;

/** One pad the screen lists: its slot, which the readout keys on, and its name. */
export interface ListedPad {
  readonly slot: number;
  readonly name: string;
}

/** Chromium's trailing "(STANDARD GAMEPAD Vendor: 045e Product: 0b13)", or "(XInput STANDARD GAMEPAD)". */
const CHROMIUM_CODES = /\s*\([^()]*(?:Vendor:|GAMEPAD)[^()]*\)\s*$/iu;

/** Firefox's leading "045e-0b13-". */
const FIREFOX_CODES = /^[0-9a-f]{1,4}-[0-9a-f]{1,4}-/iu;

/** The name a pad reports, without its vendor and product codes. @see the module header */
export function padName(id: unknown): string {
  if (typeof id !== 'string') return UNNAMED_PAD;
  const name = id
    .replace(CHROMIUM_CODES, '')
    .replace(FIREFOX_CODES, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (name === '') return UNNAMED_PAD;
  return name.length > NAME_LIMIT ? `${name.slice(0, NAME_LIMIT - 1)}…` : name;
}

/** Every connected pad, in slot order, but the shell's forwarded buttons. */
export function listedPads(pads: readonly (PadSnapshot | null)[]): readonly ListedPad[] {
  const listed: ListedPad[] = [];
  pads.forEach((pad, slot) => {
    if (pad === null || pad.connected !== true || pad.mapping === FORWARDED_MAPPING) return;
    listed.push({ slot, name: padName(pad.id) });
  });
  return listed;
}

/** What the screen says as a pad comes and goes, for its live region. */
export function connectionChange(
  before: readonly ListedPad[],
  after: readonly ListedPad[],
): string | undefined {
  const key = (pad: ListedPad): string => `${String(pad.slot)}:${pad.name}`;
  const was = new Set(before.map(key));
  const now = new Set(after.map(key));
  const came = after.filter((pad) => !was.has(key(pad))).map((pad) => `${pad.name} connected.`);
  const went = before.filter((pad) => !now.has(key(pad))).map((pad) => `${pad.name} disconnected.`);
  const said = [...went, ...came];
  return said.length === 0 ? undefined : said.join(' ');
}

/** The standard mapping's buttons, by W3C index, by where they are rather than by any maker's letter. */
const STANDARD_BUTTON_WORDS: readonly string[] = [
  'Bottom face button',
  'Right face button',
  'Left face button',
  'Top face button',
  'Left bumper',
  'Right bumper',
  'Left trigger',
  'Right trigger',
  'Back button',
  'Start button',
  'Left stick pressed in',
  'Right stick pressed in',
  'D-pad up',
  'D-pad down',
  'D-pad left',
  'D-pad right',
  'Home button',
];

/** The standard mapping's axes: the left stick's across and down, then the right's. Negative is left, or up. */
const STANDARD_AXIS_WORDS: readonly (readonly [string, string])[] = [
  ['Left stick left', 'Left stick right'],
  ['Left stick up', 'Left stick down'],
  ['Right stick left', 'Right stick right'],
  ['Right stick up', 'Right stick down'],
];

function buttonWords(mapping: string, index: number): string {
  return (
    (mapping === 'standard' ? STANDARD_BUTTON_WORDS[index] : undefined) ??
    `Button ${String(index + 1)}`
  );
}

function axisWords(mapping: string, index: number, side: 'minus' | 'plus'): string {
  const standard = mapping === 'standard' ? STANDARD_AXIS_WORDS[index] : undefined;
  if (standard !== undefined) return side === 'minus' ? standard[0] : standard[1];
  return `Axis ${String(index + 1)} ${side === 'minus' ? 'one way' : 'the other way'}`;
}

/** What one pad holds: each button index down, and each axis pushed to a side. */
type Held = ReadonlySet<string>;

/** What every pad held at the last poll, by slot. */
export interface ReadoutState {
  readonly held: readonly (Held | undefined)[];
}

export const NOTHING_HELD: ReadoutState = Object.freeze({ held: Object.freeze([]) });

export interface ReadoutRead {
  readonly state: ReadoutState;
  /** The words for the first button or stick that moved on this poll, or `undefined` where none did. */
  readonly moved: string | undefined;
}

/** An axis's side now, from the side it held: with the HUD's hysteresis; `undefined` keeps what it held. */
function axisSide(
  value: unknown,
  before: 'minus' | 'plus' | undefined,
): 'minus' | 'plus' | 'none' | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
    return undefined;
  }
  if (before === 'minus' && value < -STICK_RELEASE) return before;
  if (before === 'plus' && value > STICK_RELEASE) return before;
  if (value <= -STICK_PRESS) return 'minus';
  if (value >= STICK_PRESS) return 'plus';
  return 'none';
}

/**
 * Read one poll against the last: which button or stick went down since, in
 * words, and what each pad holds now. A pad's first poll counts what is
 * already down, as the HUD does: the press that listed it is the rider's.
 */
export function movedSince(
  state: ReadoutState,
  pads: readonly (PadSnapshot | null)[],
): ReadoutRead {
  const held: (Held | undefined)[] = [];
  let moved: string | undefined;
  pads.forEach((pad, slot) => {
    if (pad === null || pad.connected !== true) return;
    const before = state.held[slot];
    const now = new Set<string>();
    const note = (key: string, words: string): void => {
      now.add(key);
      if (moved === undefined && before?.has(key) !== true) moved = words;
    };
    const buttons = Math.min(pad.buttons.length, READ_BUTTONS);
    for (let index = 0; index < buttons; index += 1) {
      if (pad.buttons[index]?.pressed === true) {
        note(`b${String(index)}`, buttonWords(pad.mapping, index));
      }
    }
    const axes = Math.min(pad.axes.length, READ_AXES);
    for (let index = 0; index < axes; index += 1) {
      const was = before?.has(`a${String(index)}-`)
        ? 'minus'
        : before?.has(`a${String(index)}+`)
          ? 'plus'
          : undefined;
      const side = axisSide(pad.axes[index], was);
      const kept = side === undefined ? was : side === 'none' ? undefined : side;
      if (kept !== undefined) {
        note(
          `a${String(index)}${kept === 'minus' ? '-' : '+'}`,
          axisWords(pad.mapping, index, kept),
        );
      }
    }
    held[slot] = now;
  });
  return { state: { held }, moved };
}
