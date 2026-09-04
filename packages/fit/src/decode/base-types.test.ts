// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  BASE_TYPE_ENDIAN_FLAG,
  BASE_TYPE_NUMBER,
  baseTypeElementSize,
  baseTypeName,
  baseTypeNumberOf,
  isInvalidByteArray,
  readFieldValue,
} from './base-types';

function read(
  raw: readonly number[],
  baseType: number,
  { littleEndian = true, size = raw.length, number = 7 } = {},
) {
  const bytes = Uint8Array.from(raw);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return readFieldValue(bytes, view, { number, size, baseType }, 0, littleEndian);
}

/** The base type byte a definition message writes, endian flag included. */
const BYTE = {
  enum: 0x00,
  sint8: 0x01,
  uint8: 0x02,
  sint16: 0x83,
  uint16: 0x84,
  sint32: 0x85,
  uint32: 0x86,
  string: 0x07,
  float32: 0x88,
  float64: 0x89,
  uint8z: 0x0a,
  uint16z: 0x8b,
  uint32z: 0x8c,
  byte: 0x0d,
} as const;

describe('base type bytes', () => {
  it('takes the type number from the low five bits and ignores the endian flag', () => {
    expect(baseTypeNumberOf(BYTE.sint32)).toBe(BASE_TYPE_NUMBER.sint32);
    expect(baseTypeNumberOf(BASE_TYPE_NUMBER.sint32)).toBe(BASE_TYPE_NUMBER.sint32);
    expect(BYTE.sint32 & BASE_TYPE_ENDIAN_FLAG).toBe(BASE_TYPE_ENDIAN_FLAG);
    expect(BYTE.uint8 & BASE_TYPE_ENDIAN_FLAG).toBe(0);
  });

  it('names and sizes every type in the subset', () => {
    expect(baseTypeName(BYTE.uint16)).toBe('uint16');
    expect(baseTypeElementSize(BYTE.uint16)).toBe(2);
    expect(baseTypeElementSize(BYTE.float64)).toBe(8);
    expect(baseTypeElementSize(BYTE.byte)).toBe(1);
  });

  it('has no name or size for a base type outside the subset', () => {
    // 14 is sint64 — legal FIT, outside this narrow profile.
    expect(baseTypeName(0x8e)).toBeUndefined();
    expect(baseTypeElementSize(0x8e)).toBeUndefined();
  });
});

describe('readFieldValue', () => {
  it('reads unsigned and signed integers of every width', () => {
    expect(read([0x2a], BYTE.uint8).numeric).toBe(42);
    expect(read([0xd6], BYTE.sint8).numeric).toBe(-42);
    expect(read([0x34, 0x12], BYTE.uint16).numeric).toBe(0x1234);
    expect(read([0xd6, 0xff], BYTE.sint16).numeric).toBe(-42);
    expect(read([0x78, 0x56, 0x34, 0x12], BYTE.uint32).numeric).toBe(0x12345678);
    expect(read([0xd6, 0xff, 0xff, 0xff], BYTE.sint32).numeric).toBe(-42);
    expect(read([0x04], BYTE.enum).numeric).toBe(4);
  });

  it('honours the definition message architecture', () => {
    expect(read([0x12, 0x34], BYTE.uint16, { littleEndian: false }).numeric).toBe(0x1234);
    expect(read([0x12, 0x34, 0x56, 0x78], BYTE.uint32, { littleEndian: false }).numeric).toBe(
      0x12345678,
    );
    // A one-byte type has no order to get wrong, whatever the architecture says.
    expect(read([0xd6], BYTE.sint8, { littleEndian: false }).numeric).toBe(-42);
  });

  it('maps every base type invalid marker to undefined rather than to a number', () => {
    const markers: readonly (readonly [number, readonly number[]])[] = [
      [BYTE.enum, [0xff]],
      [BYTE.sint8, [0x7f]],
      [BYTE.uint8, [0xff]],
      [BYTE.sint16, [0xff, 0x7f]],
      [BYTE.uint16, [0xff, 0xff]],
      [BYTE.sint32, [0xff, 0xff, 0xff, 0x7f]],
      [BYTE.uint32, [0xff, 0xff, 0xff, 0xff]],
      [BYTE.uint8z, [0x00]],
      [BYTE.uint16z, [0x00, 0x00]],
      [BYTE.uint32z, [0x00, 0x00, 0x00, 0x00]],
    ];
    for (const [baseType, raw] of markers) {
      expect(read(raw, baseType).numeric).toBeUndefined();
    }
  });

  it('keeps zero as a value for the base types whose invalid marker is not zero', () => {
    // The distinction the sensor-dropout fixture exists for: 0 W is a real
    // reading and 0xFFFF is the absence of one.
    expect(read([0x00, 0x00], BYTE.uint16).numeric).toBe(0);
    expect(read([0x00], BYTE.uint8).numeric).toBe(0);
  });

  it('reads floats and treats NaN as the invalid marker', () => {
    expect(read([0x00, 0x00, 0x80, 0x3f], BYTE.float32).numeric).toBe(1);
    expect(read([0xff, 0xff, 0xff, 0xff], BYTE.float32).numeric).toBeUndefined();
    expect(read([0, 0, 0, 0, 0, 0, 0xf0, 0x3f], BYTE.float64).numeric).toBe(1);
  });

  it('reads a NUL-padded string and reports an empty one as absent', () => {
    expect(read([0x68, 0x72, 0x00, 0x00], BYTE.string).text).toBe('hr');
    expect(read([0x00, 0x00], BYTE.string).text).toBeUndefined();
    expect(read([0x68, 0x72, 0x00, 0x00], BYTE.string).numeric).toBeUndefined();
  });

  it('keeps a byte array whole rather than reading its first element', () => {
    const value = read([1, 2, 3, 4], BYTE.byte);
    expect(value.numeric).toBeUndefined();
    expect([...value.bytes]).toEqual([1, 2, 3, 4]);
  });

  it('does not read an array of a numeric base type as a scalar', () => {
    const value = read([0x01, 0x00, 0x02, 0x00], BYTE.uint16, { size: 4 });
    expect(value.numeric).toBeUndefined();
    expect(value.bytes).toHaveLength(4);
  });

  it('keeps the bytes of a base type it cannot read, so nothing desynchronises', () => {
    const value = read([1, 2, 3, 4, 5, 6, 7, 8], 0x8e, { size: 8 });
    expect(value.numeric).toBeUndefined();
    expect(value.text).toBeUndefined();
    expect(value.bytes).toHaveLength(8);
    expect(value.size).toBe(8);
  });

  it('reports the field number, base type and byte offset it was read from', () => {
    const bytes = Uint8Array.from([0xff, 0xff, 0x2a]);
    const view = new DataView(bytes.buffer);
    const value = readFieldValue(
      bytes,
      view,
      { number: 13, size: 1, baseType: BYTE.uint8 },
      2,
      true,
    );
    expect(value).toMatchObject({ number: 13, baseType: BYTE.uint8, size: 1, byteOffset: 2 });
    expect(value.numeric).toBe(42);
  });
});

describe('isInvalidByteArray', () => {
  it('is true only when every byte is the marker', () => {
    expect(isInvalidByteArray(Uint8Array.from([0xff, 0xff]))).toBe(true);
    expect(isInvalidByteArray(Uint8Array.from([0xff, 0x00]))).toBe(false);
    expect(isInvalidByteArray(new Uint8Array(0))).toBe(true);
  });
});
