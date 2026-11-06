// SPDX-License-Identifier: Apache-2.0

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  encodeAppInformation,
  MAX_BUTTON_STATE_OCTETS,
  MAX_STEERING_ANGLE_DEGREES,
  OPEN_BIKE_CONTROL_APP_ID,
  OPEN_BIKE_CONTROL_APP_INFORMATION,
  OPEN_BIKE_CONTROL_BUTTON_STATE,
  OPEN_BIKE_CONTROL_HAPTIC,
  OPEN_BIKE_CONTROL_SERVICE,
  parseButtonState,
  type ButtonStateResult,
  type OpenBikeControlEvent,
} from './index';
import codecSource from './open-bike-control.ts?raw';
import {
  ANALOG_BUTTON,
  ANGLE_FULL_LEFT,
  ANGLE_FULL_RIGHT,
  ANGLE_NO_OP_HIGH,
  ANGLE_NO_OP_LOW,
  ANGLE_STRAIGHT_AHEAD,
  ANGLE_TEN_DEGREES_LEFT,
  ANGLE_TEN_DEGREES_RIGHT,
  ANGLE_THEN_STEER_LEFT,
  ANGLE_UNAVAILABLE,
  EMPTY,
  notification,
  ODD_LENGTH,
  ONE_BYTE,
  STEER_LEFT_PRESSED,
  STEER_LEFT_RELEASED,
  STEER_LEFT_WITH_ANGLE,
  STEER_LEFT_WITH_ANGLE_UNAVAILABLE,
  STEER_RIGHT_PRESSED,
  TWO_BUTTONS,
  UNKNOWN_BUTTON_PRESSED,
  UNKNOWN_MESSAGE_TYPE,
} from './open-bike-control-testing';

const parse = (bytes: readonly number[]): ButtonStateResult =>
  parseButtonState(notification(bytes));

function events(bytes: readonly number[]): readonly OpenBikeControlEvent[] {
  const result = parse(bytes);
  if (!result.ok) throw new Error(`expected events, refused as ${result.error.kind}`);
  return result.events;
}

describe('the OpenBikeControl UUIDs', () => {
  it('are the service and the three characteristics, lowercase 128-bit', () => {
    expect(OPEN_BIKE_CONTROL_SERVICE).toBe('d273f680-d548-419d-b9d1-fa0472345229');
    expect(OPEN_BIKE_CONTROL_BUTTON_STATE).toBe('d273f681-d548-419d-b9d1-fa0472345229');
    expect(OPEN_BIKE_CONTROL_HAPTIC).toBe('d273f682-d548-419d-b9d1-fa0472345229');
    expect(OPEN_BIKE_CONTROL_APP_INFORMATION).toBe('d273f683-d548-419d-b9d1-fa0472345229');
  });
});

describe('parseButtonState, on the synthetic fixtures', () => {
  it('reads a steer-left press and its release', () => {
    expect(events(STEER_LEFT_PRESSED)).toEqual([
      { kind: 'steer', direction: 'left', pressed: true, superseded: false },
    ]);
    expect(events(STEER_LEFT_RELEASED)).toEqual([
      { kind: 'steer', direction: 'left', pressed: false, superseded: false },
    ]);
  });

  it('reads a steer-right press', () => {
    expect(events(STEER_RIGHT_PRESSED)).toEqual([
      { kind: 'steer', direction: 'right', pressed: true, superseded: false },
    ]);
  });

  it('reads an angle left and right in half-degree steps about 0x80', () => {
    expect(events(ANGLE_TEN_DEGREES_LEFT)).toEqual([{ kind: 'steering-angle', degrees: -10 }]);
    expect(events(ANGLE_TEN_DEGREES_RIGHT)).toEqual([{ kind: 'steering-angle', degrees: 10 }]);
    expect(events(ANGLE_STRAIGHT_AHEAD)).toEqual([{ kind: 'steering-angle', degrees: 0 }]);
  });

  it('reads the extremes as ±63°', () => {
    expect(MAX_STEERING_ANGLE_DEGREES).toBe(63);
    expect(events(ANGLE_FULL_LEFT)).toEqual([{ kind: 'steering-angle', degrees: -63 }]);
    expect(events(ANGLE_FULL_RIGHT)).toEqual([{ kind: 'steering-angle', degrees: 63 }]);
  });

  it('reads 0x00 as no angle available, and ignores the no-op codes 0x01 and 0xFF', () => {
    expect(events(ANGLE_UNAVAILABLE)).toEqual([{ kind: 'steering-angle-unavailable' }]);
    expect(events(ANGLE_NO_OP_LOW)).toEqual([]);
    expect(events(ANGLE_NO_OP_HIGH)).toEqual([]);
  });

  it('passes an unknown button on as its id and state', () => {
    expect(events(UNKNOWN_BUTTON_PRESSED)).toEqual([
      { kind: 'button', button: 0xa7, pressed: true, state: 1 },
    ]);
  });

  it('reads several buttons in one message, in order, and keeps an analog state', () => {
    expect(events(TWO_BUTTONS)).toEqual([
      { kind: 'button', button: 0x01, pressed: true, state: 1 },
      { kind: 'button', button: 0x02, pressed: false, state: 0 },
    ]);
    expect(events(ANALOG_BUTTON)).toEqual([
      { kind: 'button', button: 0x10, pressed: true, state: 0x80 },
    ]);
  });

  it('reads a window onto a larger buffer from its own offset', () => {
    const buffer = Uint8Array.from([0xff, 0xff, ...STEER_RIGHT_PRESSED, 0xff]).buffer;
    expect(parseButtonState(new DataView(buffer, 2, 3))).toEqual({
      ok: true,
      events: [{ kind: 'steer', direction: 'right', pressed: true, superseded: false }],
    });
  });
});

describe('the angle is preferred', () => {
  it('marks a discrete steer superseded when an angle is in the same message', () => {
    expect(events(STEER_LEFT_WITH_ANGLE)).toEqual([
      { kind: 'steer', direction: 'left', pressed: true, superseded: true },
      { kind: 'steering-angle', degrees: -10 },
    ]);
  });

  it('does so whichever comes first', () => {
    expect(events(ANGLE_THEN_STEER_LEFT)).toEqual([
      { kind: 'steering-angle', degrees: -10 },
      { kind: 'steer', direction: 'left', pressed: true, superseded: true },
    ]);
  });

  it('does not supersede a steer when the angle beside it is unavailable', () => {
    expect(events(STEER_LEFT_WITH_ANGLE_UNAVAILABLE)).toEqual([
      { kind: 'steer', direction: 'left', pressed: true, superseded: false },
      { kind: 'steering-angle-unavailable' },
    ]);
  });
});

describe('hostile input is a typed refusal, never a throw', () => {
  it('refuses an empty notification', () => {
    expect(parse(EMPTY)).toEqual({ ok: false, error: { kind: 'empty' } });
  });

  it('refuses a message type with no pairs after it', () => {
    expect(parse(ONE_BYTE)).toEqual({ ok: false, error: { kind: 'no-buttons' } });
  });

  it('refuses a message type it does not know', () => {
    expect(parse(UNKNOWN_MESSAGE_TYPE)).toEqual({
      ok: false,
      error: { kind: 'unknown-message-type', messageType: 0x03 },
    });
  });

  it('refuses a button id with no state', () => {
    expect(parse(ODD_LENGTH)).toEqual({ ok: false, error: { kind: 'odd-length', octets: 4 } });
  });

  it('reads a notification at the cap and refuses one octet over it', () => {
    const atCap = [0x01, ...Array.from({ length: MAX_BUTTON_STATE_OCTETS - 1 }, () => 0x20)];
    expect(MAX_BUTTON_STATE_OCTETS).toBe(65);
    const read = parse(atCap);
    expect(read.ok && read.events.length).toBe(32);
    expect(parse([...atCap, 0x20, 0x00])).toEqual({
      ok: false,
      error: { kind: 'oversized', octets: MAX_BUTTON_STATE_OCTETS + 2 },
    });
  });

  it('reads no byte of an oversized notification', () => {
    let reads = 0;
    // A megabyte that counts its reads: only the length may be looked at.
    const counting = {
      byteLength: 1 << 20,
      getUint8: (): number => {
        reads += 1;
        return 0x01;
      },
    } as unknown as DataView;
    expect(parseButtonState(counting)).toEqual({
      ok: false,
      error: { kind: 'oversized', octets: 1 << 20 },
    });
    expect(reads).toBe(0);
  });

  it('returns a value or a typed refusal for 20 000 random notifications, seeded', () => {
    let state = 0x1822_2026;
    const below = (limit: number): number => {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      return (state >>> 8) % limit;
    };
    const kinds = new Set([
      'empty',
      'no-buttons',
      'oversized',
      'unknown-message-type',
      'odd-length',
    ]);
    for (let run = 0; run < 20_000; run += 1) {
      const length = below(MAX_BUTTON_STATE_OCTETS + 8);
      const bytes = Array.from({ length }, () => below(256));
      // Half the runs start with the button-state type, so the pair walk is exercised.
      if (length > 0 && run % 2 === 0) bytes[0] = 0x01;
      let result: ButtonStateResult | undefined;
      expect(() => (result = parse(bytes)), `run ${String(run)}`).not.toThrow();
      if (result === undefined) throw new Error('unreachable');
      if (result.ok) {
        for (const event of result.events) {
          if (event.kind === 'steering-angle') {
            expect(Math.abs(event.degrees)).toBeLessThanOrEqual(63);
          }
        }
      } else {
        expect(kinds.has(result.error.kind)).toBe(true);
      }
    }
  });
});

describe('encodeAppInformation', () => {
  it('is exactly the fixed id, an empty version and the chosen buttons', () => {
    // Hand-built: type 0x04, format 0x01, id length 10, "onyourleft",
    // version length 0, three buttons: steer left, steer right, the angle.
    const expected = [
      0x04, 0x01, 0x0a, 0x6f, 0x6e, 0x79, 0x6f, 0x75, 0x72, 0x6c, 0x65, 0x66, 0x74, 0x00, 0x03,
      0x18, 0x19, 0x1b,
    ];
    expect(OPEN_BIKE_CONTROL_APP_ID).toBe('onyourleft');
    expect(Array.from(encodeAppInformation([0x18, 0x19, 0x1b]))).toEqual(expected);
  });

  it('sends a count of zero for no buttons', () => {
    expect(Array.from(encodeAppInformation([])).slice(-2)).toEqual([0x00, 0x00]);
  });

  it('refuses a button id that is not one octet, and more than 255 ids', () => {
    expect(() => encodeAppInformation([256])).toThrow(RangeError);
    expect(() => encodeAppInformation([-1])).toThrow(RangeError);
    expect(() => encodeAppInformation([1.5])).toThrow(RangeError);
    expect(() => encodeAppInformation(Array.from({ length: 256 }, () => 1))).toThrow(RangeError);
  });
});

describe('not a trainer path', () => {
  const imports = [...codecSource.matchAll(/^import[\s\S]*?from\s+'([^']+)'/gmu)].map(
    (match) => match[1],
  );

  it('imports only the UUID type, and no module of the trainer-command seam', () => {
    expect(imports).toEqual(['./uuid']);
    for (const seam of [
      'fitness-machine-control',
      'simulation-writer',
      'erg-writer',
      'trainer-control-choice',
      'trainer/simulation',
    ]) {
      expect(codecSource).not.toContain(seam);
    }
  });

  it('has no event a trainer could take: steer, the angle, and a bare button id', () => {
    expectTypeOf<OpenBikeControlEvent['kind']>().toEqualTypeOf<
      'steer' | 'steering-angle' | 'steering-angle-unavailable' | 'button'
    >();
    expectTypeOf<Extract<OpenBikeControlEvent, { kind: 'button' }>>().toEqualTypeOf<{
      readonly kind: 'button';
      readonly button: number;
      readonly pressed: boolean;
      readonly state: number;
    }>();
  });
});
