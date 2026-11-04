// SPDX-License-Identifier: Apache-2.0

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Percent } from '@onyourleft/domain';

import {
  batteryValue,
  EMPTY_PAYLOAD,
  LEVEL_101,
  LEVEL_255,
  LEVEL_37,
  LEVEL_EMPTY_BATTERY,
  LEVEL_FULL,
  TWO_BYTE_PAYLOAD,
} from './battery-testing';
import { MAX_BATTERY_LEVEL_PERCENT, parseBatteryLevel, type BatteryLevelResult } from './index';

const parse = (bytes: readonly number[]): BatteryLevelResult =>
  parseBatteryLevel(batteryValue(bytes));

describe('parseBatteryLevel', () => {
  it('reads a valid one-octet level as a Percent', () => {
    const result = parse(LEVEL_37);
    expect(result).toEqual({ ok: true, level: 37 });
    if (!result.ok) throw new Error('unreachable');
    expectTypeOf(result.level).toEqualTypeOf<Percent>();
  });

  it('reads both ends of the scale', () => {
    expect(parse(LEVEL_EMPTY_BATTERY)).toEqual({ ok: true, level: 0 });
    expect(parse(LEVEL_FULL)).toEqual({ ok: true, level: MAX_BATTERY_LEVEL_PERCENT });
  });

  it('refuses an empty payload, naming the field and the constraint', () => {
    expect(parse(EMPTY_PAYLOAD)).toEqual({
      ok: false,
      error: {
        kind: 'wrong-length',
        field: 'battery level',
        constraint: 'exactly 1 octet',
        octets: 0,
        message: 'battery level must be exactly 1 octet, received 0',
      },
    });
  });

  it('refuses a two-octet payload rather than reading its first octet', () => {
    // The first octet, 37, is a valid level on its own: a decoder that read it
    // and ignored the rest would pass every other test here.
    expect(parse(TWO_BYTE_PAYLOAD)).toEqual({
      ok: false,
      error: {
        kind: 'wrong-length',
        field: 'battery level',
        constraint: 'exactly 1 octet',
        octets: 2,
        message: 'battery level must be exactly 1 octet, received 2',
      },
    });
  });

  it.each([
    ['101', LEVEL_101, 101],
    ['255', LEVEL_255, 255],
  ] as const)('refuses %s rather than clamping it to a full battery', (_, bytes, value) => {
    expect(parse(bytes)).toEqual({
      ok: false,
      error: {
        kind: 'out-of-range',
        field: 'battery level',
        constraint: 'a whole percent from 0 to 100',
        value,
        message: `battery level must be a whole percent from 0 to 100, received ${String(value)}`,
      },
    });
  });

  it('honours the byteOffset of a view onto a larger buffer', () => {
    // Web Bluetooth often hands over a window onto a reused buffer.
    const buffer = Uint8Array.from([0xff, 0x25, 0xff]).buffer;
    expect(parseBatteryLevel(new DataView(buffer, 1, 1))).toEqual({ ok: true, level: 37 });
  });

  it('returns a level or a typed refusal for 20 000 random payloads, seeded', () => {
    let state = 0x2046_2026;
    const below = (limit: number): number => {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      return (state >>> 8) % limit;
    };
    let levels = 0;
    for (let run = 0; run < 20_000; run += 1) {
      // Lengths 0..4, weighted towards one octet so the range check is reached.
      const length = run % 2 === 0 ? 1 : below(5);
      const bytes = Array.from({ length }, () => below(256));
      let result: BatteryLevelResult | undefined;
      expect(() => (result = parse(bytes)), `run ${String(run)}`).not.toThrow();
      if (result === undefined) throw new Error('unreachable');
      if (result.ok) {
        levels += 1;
        expect(length).toBe(1);
        expect(result.level).toBe(bytes[0]);
        expect(result.level).toBeLessThanOrEqual(MAX_BATTERY_LEVEL_PERCENT);
      } else if (result.error.kind === 'wrong-length') {
        expect(result.error.octets).not.toBe(1);
      } else {
        expect(result.error.value).toBeGreaterThan(MAX_BATTERY_LEVEL_PERCENT);
      }
    }
    // Both branches were exercised, or the run proved nothing.
    expect(levels).toBeGreaterThan(0);
    expect(levels).toBeLessThan(20_000);
  });
});
