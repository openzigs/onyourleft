// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Every turn input as one discrete press (#2897, ADR 0088 D-2, D-3): each
 * source's press for left, straight, right and U-turn, the keys' discipline,
 * a held button choosing once, and no lane input ever choosing a turn.
 */

import { describe, expect, it } from 'vitest';

import type { OpenBikeControlEvent } from '@onyourleft/sensors/protocol';

import { FORWARDED_MAPPING } from '../gamepad-port';
import { steerIntentOfKey } from '../lanes';

import { TURN_PRESSES, type TurnPress } from './junction-choice';
import {
  NO_TURN_CONTROLLER_HELD,
  NO_TURN_PADS_HELD,
  readTurnController,
  readTurnPads,
  turnOfKey,
  turnOfSymbol,
  type TurnSymbol,
} from './turn-input';
import { controllerButton, keyDown, pad, padPress, TURN_SOURCES } from './turn-input-testing';

describe('each input source gives the same discrete press (ADR 0088 D-3)', () => {
  for (const press of TURN_PRESSES) {
    for (const [source, read] of Object.entries(TURN_SOURCES[press])) {
      it(`${source}: ${press}`, () => {
        expect(read()).toEqual([press]);
      });
    }
  }

  it('the numbered buttons have no U-turn, and a pad of a layout nobody knows chooses nothing', () => {
    expect(padPress(FORWARDED_MAPPING, 1 - 1)).toEqual([]);
    expect(padPress('xinput-raw', 2)).toEqual([]);
  });

  it('every on-screen symbol is a press', () => {
    const symbols: TurnSymbol[] = ['turn-left', 'turn-straight', 'turn-right', 'turn-u-turn'];
    expect(symbols.map(turnOfSymbol)).toEqual(['left', 'straight', 'right', 'u-turn']);
  });
});

describe('one press, never a repeat', () => {
  it('takes a key only as lanes.ts takes one: no repeat, no modifier, no handled key, no form field', () => {
    expect(turnOfKey(keyDown('ArrowLeft', { repeat: true }))).toBeUndefined();
    expect(turnOfKey(keyDown('ArrowLeft', { ctrlKey: true }))).toBeUndefined();
    expect(turnOfKey(keyDown('ArrowLeft', { altKey: true }))).toBeUndefined();
    expect(turnOfKey(keyDown('ArrowLeft', { metaKey: true }))).toBeUndefined();
    expect(turnOfKey(keyDown('ArrowLeft', { defaultPrevented: true }))).toBeUndefined();
    const field = document.createElement('input');
    expect(turnOfKey(keyDown('ArrowLeft', { target: field }))).toBeUndefined();
    expect(turnOfKey(keyDown('Enter'))).toBeUndefined();
    expect(turnOfKey(keyDown(' '))).toBeUndefined();
    // Another layout: the key reads otherwise, the code is the arrow's.
    expect(turnOfKey(keyDown('Unidentified', { code: 'ArrowRight' }))).toBe('right');
  });

  it('a held pad button chooses once, and again only after it is let go', () => {
    let state = NO_TURN_PADS_HELD;
    const presses: TurnPress[] = [];
    for (const down of [[], [2], [2], [2], [], [2]]) {
      const read = readTurnPads(state, [pad('standard', down)]);
      state = read.state;
      presses.push(...read.presses);
    }
    expect(presses).toEqual(['left', 'left']);
    // A pad that goes away forgets what it held.
    const gone = readTurnPads(state, [null]);
    expect(readTurnPads(gone.state, [pad('standard', [2])]).presses).toEqual(['left']);
  });

  it('a held controller button chooses once, and again only after it is let go', () => {
    let state = NO_TURN_CONTROLLER_HELD;
    const presses: TurnPress[] = [];
    for (const events of [
      [controllerButton(0x13, true)],
      [controllerButton(0x13, true)],
      [controllerButton(0x13, false)],
      [controllerButton(0x13, true), controllerButton(0x12, true)],
    ]) {
      const read = readTurnController(state, events);
      state = read.state;
      presses.push(...read.presses);
    }
    expect(presses).toEqual(['right', 'right', 'left']);
  });
});

describe('a lane input never takes a turn (ADR 0088 D-2, D-4)', () => {
  it('A and D are lanes and never turns; the arrows are turns and never lanes', () => {
    for (const key of ['a', 'A', 'd', 'D']) {
      expect(turnOfKey(keyDown(key)), key).toBeUndefined();
      expect(steerIntentOfKey(keyDown(key)), key).toBeDefined();
    }
    expect(turnOfKey(keyDown('', { code: 'KeyA' }))).toBeUndefined();
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']) {
      expect(steerIntentOfKey(keyDown(key)), key).toBeUndefined();
    }
  });

  it('the D-pad and the left stick choose no turn', () => {
    let state = NO_TURN_PADS_HELD;
    for (const snapshot of [
      pad('standard', [14]),
      pad('standard', []),
      pad('standard', [15]),
      pad('standard', [], [-1, 0]),
      pad('standard', [], [1, 0]),
    ]) {
      const read = readTurnPads(state, [snapshot]);
      state = read.state;
      expect(read.presses).toEqual([]);
    }
  });

  it("OpenBikeControl's steer buttons and its steering angle choose no turn", () => {
    const events: OpenBikeControlEvent[] = [
      { kind: 'steer', direction: 'left', pressed: true, superseded: false },
      { kind: 'steer', direction: 'right', pressed: true, superseded: false },
      { kind: 'steering-angle', degrees: -40 },
      { kind: 'steering-angle', degrees: 40 },
      { kind: 'steering-angle-unavailable' },
      controllerButton(0x18, true),
      controllerButton(0x1b, true),
      controllerButton(0x50, true),
    ];
    expect(readTurnController(NO_TURN_CONTROLLER_HELD, events).presses).toEqual([]);
  });
});
