// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2358 — what the Devices screen's Controllers section says about each pad,
 * read from snapshots as `game/gamepad-port.ts` lists them.
 */

import { describe, expect, it } from 'vitest';

import { FORWARDED_MAPPING, type PadSnapshot } from '../game/gamepad-port';

import {
  connectionChange,
  listedPads,
  movedSince,
  NAME_LIMIT,
  NOTHING_HELD,
  padName,
  READ_BUTTONS,
  UNNAMED_PAD,
  type ReadoutState,
} from './gamepad-readout';

function pad(
  options: {
    readonly id?: string;
    readonly mapping?: string;
    readonly down?: readonly number[];
    readonly axes?: readonly number[];
    readonly buttons?: number;
    readonly connected?: boolean;
  } = {},
): PadSnapshot {
  const down = options.down ?? [];
  return {
    ...(options.id === undefined ? {} : { id: options.id }),
    connected: options.connected ?? true,
    mapping: options.mapping ?? 'standard',
    axes: options.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: options.buttons ?? 17 }, (_, index) => ({
      pressed: down.includes(index),
    })),
  };
}

const XBOX = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';

describe('padName', () => {
  it('drops Chromium’s vendor and product codes: the id the owner’s tablet reported', () => {
    expect(padName(XBOX)).toBe('Xbox Wireless Controller');
    expect(padName('Generic USB Joystick (Vendor: 0079 Product: 0006)')).toBe(
      'Generic USB Joystick',
    );
    expect(padName('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('Xbox 360 Controller');
  });

  it('drops Firefox’s leading codes', () => {
    expect(padName('045e-0b13-Xbox Wireless Controller')).toBe('Xbox Wireless Controller');
  });

  it('keeps a name that carries no codes, and a bracket that is part of the name', () => {
    expect(padName('DualSense Wireless Controller')).toBe('DualSense Wireless Controller');
    expect(padName('Pad (blue)')).toBe('Pad (blue)');
  });

  it('reads an id that is missing, empty, only codes or not a string as unnamed', () => {
    expect(padName(undefined)).toBe(UNNAMED_PAD);
    expect(padName('')).toBe(UNNAMED_PAD);
    expect(padName('   ')).toBe(UNNAMED_PAD);
    expect(padName(' (STANDARD GAMEPAD Vendor: 045e Product: 0b13)')).toBe(UNNAMED_PAD);
    expect(padName(42)).toBe(UNNAMED_PAD);
  });

  it('cuts a very long id, which is untrusted, to the limit', () => {
    const name = padName('x'.repeat(10_000));
    expect(name).toHaveLength(NAME_LIMIT);
    expect(name.endsWith('…')).toBe(true);
  });
});

describe('listedPads', () => {
  it('lists every connected pad by slot, and skips empty slots, gone pads and the shell’s buttons', () => {
    expect(
      listedPads([
        { ...pad({ mapping: FORWARDED_MAPPING }), axes: [] },
        pad({ id: XBOX }),
        null,
        pad({ id: 'Gone pad', connected: false }),
        pad({ id: '' }),
      ]),
    ).toEqual([
      { slot: 1, name: 'Xbox Wireless Controller' },
      { slot: 4, name: UNNAMED_PAD },
    ]);
  });
});

describe('connectionChange', () => {
  const xbox = { slot: 0, name: 'Xbox Wireless Controller' };
  it('says a pad came and a pad went, and nothing when nothing changed', () => {
    expect(connectionChange([], [xbox])).toBe('Xbox Wireless Controller connected.');
    expect(connectionChange([xbox], [])).toBe('Xbox Wireless Controller disconnected.');
    expect(connectionChange([xbox], [xbox])).toBeUndefined();
    expect(connectionChange([xbox], [{ slot: 1, name: 'Pad' }])).toBe(
      'Xbox Wireless Controller disconnected. Pad connected.',
    );
  });
});

/** Read `polls` in turn from nothing held, returning each poll's words. */
function readAll(polls: readonly (readonly (PadSnapshot | null)[])[]): (string | undefined)[] {
  let state: ReadoutState = NOTHING_HELD;
  return polls.map((pads) => {
    const read = movedSince(state, pads);
    state = read.state;
    return read.moved;
  });
}

describe('movedSince', () => {
  it('names a standard pad’s buttons by where they are, once a press', () => {
    expect(
      readAll([
        [pad()],
        [pad({ down: [0] })],
        [pad({ down: [0] })],
        [pad()],
        [pad({ down: [12] })],
        [pad({ down: [12, 7] })],
        [pad({ down: [16] })],
      ]),
    ).toEqual([
      undefined,
      'Bottom face button',
      undefined,
      undefined,
      'D-pad up',
      'Right trigger',
      'Home button',
    ]);
  });

  it('counts a button already down on a pad’s first poll: the press that listed it', () => {
    expect(readAll([[pad({ down: [3] })]])).toEqual(['Top face button']);
  });

  it('names a standard pad’s sticks by side, with the HUD’s hysteresis', () => {
    expect(
      readAll([
        [pad({ axes: [-0.9, 0, 0, 0] })],
        [pad({ axes: [-0.3, 0, 0, 0] })],
        [pad({ axes: [-0.9, 0, 0, 0] })],
        [pad({ axes: [0, 0, 0, 0] })],
        [pad({ axes: [-0.9, 0, 0, 0] })],
        [pad({ axes: [0, 0, 0, 0.8] })],
        [pad({ axes: [0, 0, 0.6, 0] })],
        [pad({ axes: [0, -0.6, 0, 0] })],
      ]),
    ).toEqual([
      'Left stick left',
      undefined,
      undefined,
      undefined,
      'Left stick left',
      'Right stick down',
      'Right stick right',
      'Left stick up',
    ]);
  });

  it('numbers the buttons and axes of a pad with no standard mapping, and the shell’s', () => {
    expect(
      readAll([
        [pad({ mapping: '', down: [1] })],
        [pad({ mapping: '', axes: [0.9] })],
        [pad({ mapping: '', axes: [-0.9] })],
        [{ ...pad({ mapping: FORWARDED_MAPPING, buttons: 16, down: [3] }), axes: [] }],
      ]),
    ).toEqual(['Button 2', 'Axis 1 the other way', 'Axis 1 one way', 'Button 4']);
  });

  it('reads nothing from a bad axis, and holds the side it had', () => {
    expect(
      readAll([
        [pad({ axes: [0.9, 0, 0, 0] })],
        [pad({ axes: [Number.NaN, 0, 0, 0] })],
        [pad({ axes: [0.9, 0, 0, 0] })],
        [pad({ axes: [5, Number.POSITIVE_INFINITY, 0, 0] })],
      ]),
    ).toEqual(['Left stick right', undefined, undefined, undefined]);
  });

  it('reads only pads that are there, and forgets what a pad that went held', () => {
    expect(
      readAll([
        [pad({ down: [1] })],
        [null],
        [pad({ down: [1], connected: false })],
        [pad({ down: [1] })],
      ]),
    ).toEqual(['Right face button', undefined, undefined, 'Right face button']);
  });

  it('reads at most its limit of buttons from a pad reporting hundreds', () => {
    expect(readAll([[pad({ mapping: '', buttons: 300, down: [READ_BUTTONS + 5] })]])).toEqual([
      undefined,
    ]);
    expect(readAll([[pad({ mapping: '', buttons: 300, down: [READ_BUTTONS - 1] })]])).toEqual([
      `Button ${String(READ_BUTTONS)}`,
    ]);
  });

  it('counts only a pressed that is exactly true', () => {
    const truthy = {
      ...pad(),
      buttons: [{ pressed: 1 as unknown as boolean }, { pressed: true }],
    };
    expect(readAll([[truthy]])).toEqual(['Right face button']);
  });
});
