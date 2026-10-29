// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1821 — Delivery's intents from a gamepad, read poll by poll as
 * `hud/GamepadIntents.tsx` reads them, from snapshots shaped as the Gamepad
 * API's. #1858 — a pad with no standard mapping, and the numbered buttons the
 * Android shell forwards, listed as `gamepad-port.ts` lists them.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import { FORWARDED_BUTTONS, FORWARDED_MAPPING, type PadSnapshot } from '../gamepad-port';
import {
  type GamepadIntent,
  type GamepadInputState,
  NO_PADS_HELD,
  NUMBERED_BUTTONS,
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

  it('reads no button of a pad whose mapping is not the standard one (#1858: only its axis 0)', () => {
    expect(polls([[pad([0, 1, 2, 14, 15], 0, { mapping: '' })]]).intents).toEqual([]);
    expect(polls([[pad([0], 0, { mapping: 'xr-standard' })]]).intents).toEqual([]);
  });

  it('reads each pad on its own, so two pads each throw', () => {
    expect(polls([[pad([2]), null, pad([1])]]).intents).toEqual(['left', 'right']);
  });
});

/** A pad the browser does not map, as spike 0027's generic USB pad: its d-pad on axes 0 and 1. */
function generic(dpadX = 0, dpadY = 0, down: readonly number[] = []): PadSnapshot {
  return pad(down, 0, { mapping: '', axes: [dpadX, dpadY, 0, 0] });
}

/** The pad `gamepad-port.ts` lists for the shell's forwarded buttons: button `n` at index `n - 1`. */
function forwarded(down: readonly number[]): PadSnapshot {
  return {
    connected: true,
    mapping: FORWARDED_MAPPING,
    axes: [],
    buttons: Array.from({ length: FORWARDED_BUTTONS }, (_, index) => ({
      pressed: down.includes(index + 1),
    })),
  };
}

describe('a pad with no standard mapping (#1858): its axis 0 changes lane', () => {
  it.each([
    [-1, 'lane-left'],
    [1, 'lane-right'],
  ] as const)('the d-pad at %d on axis 0 asks for %s', (x, intent) => {
    expect(polls([[generic(x)]]).intents).toEqual([intent]);
  });

  it('asks for nothing from axis 1, up and down, or from any button of its own', () => {
    expect(
      polls([[generic(0, -1)], [generic(0, 1)], [generic(0, 0, [0, 1, 2, 3, 14, 15])]]).intents,
    ).toEqual([]);
  });

  it('holds the standard stick’s hysteresis, on both sides', () => {
    const at = (x: number): PadSnapshot[] => [generic(x)];
    expect(
      polls([
        at(0.6),
        at(STICK_RELEASE + 0.05), // still over
        at(0.6),
        at(STICK_RELEASE - 0.05), // let go
        at(0.6),
        at(-0.6),
        at(-(STICK_RELEASE + 0.05)), // still over
        at(-0.6),
      ]).intents,
    ).toEqual(['lane-right', 'lane-right', 'lane-left']);
  });

  it('changes lane once for a d-pad held over many polls', () => {
    expect(polls(Array.from({ length: 50 }, () => [generic(-1)])).intents).toEqual(['lane-left']);
  });

  it('bounds its axis as a standard pad’s: no intent from NaN, Infinity or 5', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 5, -5]) {
      expect(polls([[generic(value)]]).intents).toEqual([]);
    }
    expect(polls([[generic(1)], [generic(Number.NaN)], [generic(1)]]).intents).toEqual([
      'lane-right',
    ]);
  });

  it('stops on a disconnect mid-round, and reads as new when it comes back', () => {
    const { intents, state } = polls([[generic(1)], [null]]);
    expect(intents).toEqual(['lane-right']);
    expect(state.held[0]).toBeUndefined();
    expect(
      polls([[generic(1)], [{ ...generic(1), connected: false }]]).state.held[0],
    ).toBeUndefined();
  });
});

describe('the numbered buttons the Android shell forwards (#1858)', () => {
  it('throws, and only throws: each numbered button asks for one throw, and every throw has one', () => {
    for (const intent of Object.values(NUMBERED_BUTTONS)) expect(THROW_INTENTS).toContain(intent);
    expect(Object.values(NUMBERED_BUTTONS)).toHaveLength(THROW_INTENTS.length);
    expect(new Set(Object.values(NUMBERED_BUTTONS))).toEqual(new Set(THROW_INTENTS));
    for (const button of Object.keys(NUMBERED_BUTTONS).map(Number)) {
      expect(Number.isInteger(button) && button >= 1 && button <= FORWARDED_BUTTONS).toBe(true);
    }
  });

  it.each([
    [4, 'left'],
    [2, 'right'],
    [3, 'next-house'],
  ] as const)('button %i asks for %s', (button, intent) => {
    expect(NUMBERED_BUTTONS[button]).toBe(intent);
    expect(polls([[forwarded([button])]]).intents).toEqual([intent]);
  });

  it('asks for nothing from the other numbered buttons', () => {
    const others = Array.from({ length: FORWARDED_BUTTONS }, (_, index) => index + 1).filter(
      (button) => !Object.hasOwn(NUMBERED_BUTTONS, button),
    );
    expect(others).toHaveLength(13);
    expect(polls([[forwarded(others)]]).intents).toEqual([]);
  });

  it('throws once for a button held across many polls, and again for the next press', () => {
    const held = Array.from({ length: 40 }, () => [forwarded([2])]);
    expect(polls([...held, [null], [forwarded([2])]]).intents).toEqual(['right', 'right']);
  });

  it('throws from the shell’s buttons and steers from the generic pad’s d-pad, side by side', () => {
    expect(
      polls([
        [null, generic(1)],
        [forwarded([4]), generic(1)],
        [forwarded([4, 3]), generic(0)],
        [null, generic(-1)],
      ]).intents,
    ).toEqual(['lane-right', 'left', 'next-house', 'lane-left']);
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

  it('holds the same hysteresis on the left: once over, it asks again only once let go', () => {
    const at = (stick: number): PadSnapshot[] => [pad([], stick)];
    expect(
      polls([
        at(-0.6),
        at(-(STICK_RELEASE + 0.05)), // still over: no second press
        at(-0.6),
        at(-(STICK_RELEASE - 0.05)), // let go
        at(-0.6), // a second press
        at(0.9), // straight across to the other side
      ]).intents,
    ).toEqual(['lane-left', 'lane-left', 'lane-right']);
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
