// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1821 — Delivery's intents from a gamepad, read poll by poll as
 * `hud/GamepadIntents.tsx` reads them, from snapshots shaped as the Gamepad
 * API's.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { PadSnapshot } from '../gamepad-port';
import {
  type GamepadIntent,
  type GamepadInputState,
  NO_PADS_HELD,
  readGamepads,
  STANDARD_BUTTONS,
  STICK_PRESS,
  STICK_RELEASE,
} from './gamepad-input';
import { STEER_INTENTS, type SteerIntent } from './steer';
import { THROW_INTENTS, type ThrowIntent } from './throw-input';

/** A standard pad with the given buttons down and the left stick at `stick`. */
function pad(
  down: readonly number[] = [],
  stick = 0,
  extra: Partial<PadSnapshot> = {},
): PadSnapshot {
  return {
    connected: true,
    mapping: 'standard',
    axes: [stick, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: down.includes(index) })),
    ...extra,
  };
}

/** Poll each reading in turn, from nothing held, and gather every intent asked for. */
function polls(readings: readonly (readonly (PadSnapshot | null)[])[]): {
  intents: GamepadIntent[];
  state: GamepadInputState;
} {
  let state = NO_PADS_HELD;
  const intents: GamepadIntent[] = [];
  for (const pads of readings) {
    const read = readGamepads(state, pads);
    state = read.state;
    intents.push(...read.intents);
  }
  return { intents, state };
}

describe('a pad asks for what a key does, and no more', () => {
  it('has the intent type of the throws and the lanes together', () => {
    expectTypeOf<GamepadIntent>().toEqualTypeOf<ThrowIntent | SteerIntent>();
  });

  it('maps every button to one of those intents, and reaches each of them', () => {
    const known: readonly string[] = [...THROW_INTENTS, ...STEER_INTENTS];
    for (const intent of Object.values(STANDARD_BUTTONS)) expect(known).toContain(intent);
    expect(new Set(Object.values(STANDARD_BUTTONS))).toEqual(new Set(known));
  });
});

describe('a standard pad, at the W3C indices', () => {
  it.each([
    [0, 'next-house'],
    [1, 'right'],
    [2, 'left'],
    [14, 'lane-left'],
    [15, 'lane-right'],
  ] as const)('button %i asks for %s', (button, intent) => {
    expect(polls([[pad([button])]]).intents).toEqual([intent]);
  });

  it.each([
    [-0.8, 'lane-left'],
    [0.8, 'lane-right'],
  ] as const)('the left stick at %d asks for %s', (stick, intent) => {
    expect(polls([[pad([], stick)]]).intents).toEqual([intent]);
  });

  it('leaves every other button, the stick near the middle and the other axes asking for nothing', () => {
    const others = Array.from({ length: 17 }, (_, index) => index).filter(
      (index) => !Object.hasOwn(STANDARD_BUTTONS, index),
    );
    expect(others).toHaveLength(12);
    expect(polls([[pad(others, STICK_PRESS - 0.01, { axes: [0.3, 1, -1, 1] })]]).intents).toEqual(
      [],
    );
  });

  it('reads nothing from a pad whose mapping is not the standard one', () => {
    expect(polls([[pad([0, 1, 2, 14, 15], 1, { mapping: '' })]]).intents).toEqual([]);
    expect(polls([[pad([0], 0, { mapping: 'xr-standard' })]]).intents).toEqual([]);
  });

  it('reads each pad on its own, so two pads each throw', () => {
    expect(polls([[pad([2]), null, pad([1])]]).intents).toEqual(['left', 'right']);
  });
});

describe('one press, one intent', () => {
  it('throws once for a button held across many polls, and again for the next press', () => {
    const held = Array.from({ length: 100 }, () => [pad([1])]);
    expect(polls([...held, [pad()], [pad([1])], [pad([1])]]).intents).toEqual(['right', 'right']);
  });

  it('changes lane once for a stick held over, with hysteresis before it can ask again', () => {
    const at = (stick: number): PadSnapshot[] => [pad([], stick)];
    expect(
      polls([
        at(0.6),
        at(STICK_RELEASE + 0.05), // still over: no second press
        at(0.6),
        at(STICK_RELEASE - 0.05), // let go
        at(0.6), // a second press
        at(-0.9), // straight across to the other side
      ]).intents,
    ).toEqual(['lane-right', 'lane-right', 'lane-left']);
  });

  it('counts a button already down on a pad’s first poll: that press is what listed the pad', () => {
    expect(polls([[null], [pad([0])]]).intents).toEqual(['next-house']);
  });
});

describe('hostile values are bounded (CLAUDE.md §6)', () => {
  const HOSTILE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 5, -5, 1.0001];

  it('produces no intent from an axis outside −1..1 or not a number, and throws nothing', () => {
    for (const value of HOSTILE) {
      expect(() => polls([[pad([], value)]])).not.toThrow();
      expect(polls([[pad([], value)]]).intents).toEqual([]);
    }
    const strange = { axes: ['0.9' as unknown as number, null as unknown as number] };
    expect(polls([[pad([], 0, strange)]]).intents).toEqual([]);
    expect(polls([[pad([], 0, { axes: [] })]]).intents).toEqual([]);
  });

  it('keeps the stick as it was across a bad reading, so a flicker to NaN does not press twice', () => {
    expect(polls(HOSTILE.flatMap((value) => [[pad([], 0.9)], [pad([], value)]])).intents).toEqual([
      'lane-right',
    ]);
    // …and a bad reading does not let go of a stick held over.
    expect(
      polls([[pad([], 0.9)], [pad([], Number.NaN)], [pad([], 0.1)], [pad([], 0.9)]]).intents,
    ).toEqual(['lane-right', 'lane-right']);
  });

  it('reads 300 buttons, or none, in the same few steps: only the mapped ones, and only `pressed: true`', () => {
    const many: PadSnapshot = pad([], Number.NaN, {
      buttons: Array.from({ length: 300 }, (_, index) => ({ pressed: index > 16 })),
    });
    expect(() => polls([[many]])).not.toThrow();
    expect(polls([[many]]).intents).toEqual([]);
    const truthy = pad([], 0, {
      buttons: Array.from({ length: 300 }, () => ({ pressed: 1 as unknown as boolean })),
    });
    expect(polls([[truthy]]).intents).toEqual([]);
    expect(polls([[pad([], 0, { buttons: [] })]]).intents).toEqual([]);
  });
});

describe('a pad that disconnects mid-round', () => {
  it('stops producing intents, holds nothing, and reads as new when it comes back', () => {
    const { intents, state } = polls([
      [pad([1], 0.9)],
      [null], // gone: the slot is empty
      [null],
    ]);
    expect(intents).toEqual(['right', 'lane-right']);
    expect(state.held[0]).toBeUndefined();
    // Back, with the button still down: the press that listed it again.
    expect(readGamepads(state, [pad([1])]).intents).toEqual(['right']);
  });

  it('reads a pad reported as no longer connected as gone', () => {
    const { intents, state } = polls([[pad([2])], [pad([2, 15], 0.9, { connected: false })]]);
    expect(intents).toEqual(['left']);
    expect(state.held[0]).toBeUndefined();
    expect(polls([[pad([0], 0, { connected: false })]]).intents).toEqual([]);
  });

  it('reads an empty list of pads as nothing, from any state', () => {
    const { state } = polls([[pad([0, 14])]]);
    expect(readGamepads(state, [])).toEqual({ state: { held: [] }, intents: [] });
  });
});
