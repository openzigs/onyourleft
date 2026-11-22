// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test support for the open-world turn inputs (#2897): key events, pad
 * snapshots and controller events as each source sends them, and
 * {@link TURN_SOURCES}, every source's press for each choice. Never shipped.
 */

import type { OpenBikeControlEvent } from '@onyourleft/sensors/protocol';

import { FORWARDED_MAPPING, type PadSnapshot } from '../gamepad-port';
import type { SteerKeyEvent } from '../lanes';

import type { TurnPress } from './junction-choice';
import {
  NO_TURN_CONTROLLER_HELD,
  NO_TURN_PADS_HELD,
  readTurnController,
  readTurnPads,
  turnOfKey,
  turnOfSymbol,
} from './turn-input';

export function keyDown(key: string, extra: Partial<SteerKeyEvent> = {}): SteerKeyEvent {
  return {
    key,
    code: key.startsWith('Arrow') || key.startsWith('Page') ? key : '',
    target: null,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    defaultPrevented: false,
    ...extra,
  };
}

export function pad(
  mapping: string,
  down: readonly number[],
  axes: number[] = [0, 0],
): PadSnapshot {
  const buttons = Array.from({ length: 17 }, (_, index) => ({ pressed: down.includes(index) }));
  return { connected: true, mapping, axes, buttons };
}

export function controllerButton(button: number, pressed: boolean): OpenBikeControlEvent {
  return { kind: 'button', button, pressed, state: pressed ? 1 : 0 };
}

/** One press from a pad that was up, then down. */
export function padPress(mapping: string, button: number): readonly TurnPress[] {
  const up = readTurnPads(NO_TURN_PADS_HELD, [pad(mapping, [])]);
  return readTurnPads(up.state, [pad(mapping, [button])]).presses;
}

/** Each source, and what it sends for each press. `undefined`: that source has none. */
export const TURN_SOURCES: Readonly<
  Record<TurnPress, Readonly<Record<string, () => readonly TurnPress[]>>>
> = {
  left: {
    key: () => [turnOfKey(keyDown('ArrowLeft'))].filter((p) => p !== undefined),
    'page key': () => [turnOfKey(keyDown('PageUp'))].filter((p) => p !== undefined),
    gamepad: () => padPress('standard', 2),
    'numbered button': () => padPress(FORWARDED_MAPPING, 4 - 1),
    OpenBikeControl: () =>
      readTurnController(NO_TURN_CONTROLLER_HELD, [controllerButton(0x12, true)]).presses,
    screen: () => [turnOfSymbol('turn-left')],
  },
  straight: {
    key: () => [turnOfKey(keyDown('ArrowUp'))].filter((p) => p !== undefined),
    gamepad: () => padPress('standard', 0),
    'numbered button': () => padPress(FORWARDED_MAPPING, 3 - 1),
    OpenBikeControl: () =>
      readTurnController(NO_TURN_CONTROLLER_HELD, [controllerButton(0x10, true)]).presses,
    screen: () => [turnOfSymbol('turn-straight')],
  },
  right: {
    key: () => [turnOfKey(keyDown('ArrowRight'))].filter((p) => p !== undefined),
    'page key': () => [turnOfKey(keyDown('PageDown'))].filter((p) => p !== undefined),
    gamepad: () => padPress('standard', 1),
    'numbered button': () => padPress(FORWARDED_MAPPING, 2 - 1),
    OpenBikeControl: () =>
      readTurnController(NO_TURN_CONTROLLER_HELD, [controllerButton(0x13, true)]).presses,
    screen: () => [turnOfSymbol('turn-right')],
  },
  'u-turn': {
    key: () => [turnOfKey(keyDown('ArrowDown'))].filter((p) => p !== undefined),
    gamepad: () => padPress('standard', 3),
    OpenBikeControl: () =>
      readTurnController(NO_TURN_CONTROLLER_HELD, [controllerButton(0x11, true)]).presses,
    screen: () => [turnOfSymbol('turn-u-turn')],
  },
};
