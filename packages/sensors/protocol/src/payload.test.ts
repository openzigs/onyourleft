// SPDX-License-Identifier: Apache-2.0

/**
 * The bounds-checked cursor every decoder in this directory reads through.
 *
 * Sensor data is untrusted input (CLAUDE.md §6, SECURITY.md). A `DataView`
 * already refuses to read past its end, so the question these tests answer is
 * not "does it refuse" but "does it refuse **as a typed error a caller can
 * branch on**, and does it refuse for a view that does not start at octet
 * zero" — which is the shape Web Bluetooth actually hands over.
 */

import { describe, expect, it } from 'vitest';

import { isSensorError } from '../../src/errors';

import { createPayloadReader, flagSet, malformedPayload } from './payload';
import { createPayloadWriter } from './testing';

describe('reading a payload', () => {
  it('reads each width little-endian, advancing by the width it read', () => {
    const view = createPayloadWriter().u8(0x12).u16(0x3456).u24(0x789abc).u32(0x11223344).view();
    const reader = createPayloadReader(view, 'a fixture');

    expect(reader.u8('a')).toBe(0x12);
    expect(reader.u16('b')).toBe(0x3456);
    expect(reader.u24('c')).toBe(0x789abc);
    expect(reader.u32('d')).toBe(0x11223344);
    expect(reader.remaining()).toBe(0);
  });

  it('reads a sint16 as two’s complement, not as a uint16', () => {
    // The Cycling Power instantaneous power field is a `sint16`. Read as a
    // `uint16`, -1 W is 65 535 W: a number that passes every non-negative
    // check and lands in a ride file.
    const reader = createPayloadReader(createPayloadWriter().i16(-1).i16(-250).view(), 'a fixture');

    expect(reader.i16('a')).toBe(-1);
    expect(reader.i16('b')).toBe(-250);
  });

  it('honours a view that does not start at octet zero', () => {
    // Web Bluetooth hands over a window onto a larger, reused buffer. A reader
    // that indexed `view.buffer` would read whatever the browser put in front
    // of this notification.
    const backing = Uint8Array.from([0xff, 0xff, 0x07, 0x00, 0xff]);
    const window = new DataView(backing.buffer, 2, 2);

    expect(createPayloadReader(window, 'a windowed fixture').u16('a')).toBe(7);
  });

  it('refuses a read past the end, as a malformed-payload sensor error', () => {
    const reader = createPayloadReader(createPayloadWriter().u8(1).view(), 'a fixture');
    reader.u8('the only octet');

    let thrown: unknown;
    try {
      reader.u16('a field that is not there');
    } catch (error) {
      thrown = error;
    }

    // Typed, not a bare RangeError out of the DataView: a caller cannot tell
    // a RangeError from a bug in this package.
    expect(isSensorError(thrown, 'malformed-payload')).toBe(true);
  });

  it('names the field and the length in the failure, and the device in nothing', () => {
    const reader = createPayloadReader(createPayloadWriter().u8(1).view(), 'a CSC Measurement');

    expect(() => reader.u32('cumulative wheel revolutions')).toThrow(
      /cumulative wheel revolutions/,
    );
    expect(() => createPayloadReader(createPayloadWriter().view(), 'x').u8('f')).toThrow(
      /only 0 octets/,
    );

    // The second half of the title, which this test used to claim and not check.
    // A payload reader is given a LABEL and never an identity, so there is no
    // device id it could name — and that is the property worth pinning, because
    // the obvious "improvement" to these messages is to say which device sent
    // the bad frame. SECURITY.md puts anything that leaks a device or its
    // location through an error message in scope, and an error string reaches
    // logs and crash reports that the measurement itself never does.
    const identity = 'aa:bb:cc:dd:ee:ff';
    const labelled = createPayloadReader(createPayloadWriter().u8(1).view(), 'a CSC Measurement');
    let thrown: unknown;
    try {
      labelled.u32('cumulative wheel revolutions');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeDefined();
    const message = String(thrown);
    expect(message).not.toContain(identity);
    // Nothing that looks like a device identifier at all, rather than only the
    // one literal above — a message built from a template would pass that.
    expect(message).not.toMatch(/([0-9a-f]{2}:){5}[0-9a-f]{2}/i);
    expect(message).not.toMatch(/\bdevice\b/i);
  });

  it('refuses a partial read without consuming what it could have', () => {
    // A reader that advanced before checking would leave the cursor past the
    // end, so a decoder catching one failure and continuing would then read
    // silently wrong offsets.
    const reader = createPayloadReader(createPayloadWriter().u8(9).u8(8).view(), 'a fixture');
    expect(() => reader.u32('too wide')).toThrow();

    expect(reader.remaining()).toBe(2);
    expect(reader.u8('still there')).toBe(9);
  });

  it('skips octets it does not interpret, and refuses to skip past the end', () => {
    const reader = createPayloadReader(createPayloadWriter().u8(1).u8(2).u8(3).view(), 'a fixture');
    reader.skip(2, 'two reserved octets');

    expect(reader.u8('the third')).toBe(3);
    expect(() => reader.skip(1, 'one too many')).toThrow();
  });

  it('carries a cause when it is given one', () => {
    const underlying = new Error('the device said so');

    expect(malformedPayload('unreadable', underlying).cause).toBe(underlying);
    expect(malformedPayload('unreadable').cause).toBeUndefined();
  });
});

describe('testing a flag bit', () => {
  it('is true only for a bit that is set', () => {
    expect(flagSet(0b0000_0101, 0)).toBe(true);
    expect(flagSet(0b0000_0101, 1)).toBe(false);
    expect(flagSet(0b0000_0101, 2)).toBe(true);
  });

  it('reads the top bit of a uint32 feature field', () => {
    // `flags & (1 << 31)` is negative in two's complement. Truthy, but a
    // comparison against the mask is false — which is the bug this spelling
    // exists to avoid, on the one field wide enough to reach it.
    expect(flagSet(0x8000_0000, 31)).toBe(true);
    expect(flagSet(0x7fff_ffff, 31)).toBe(false);
  });
});
