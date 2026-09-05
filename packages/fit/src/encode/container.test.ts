// SPDX-License-Identifier: Apache-2.0

/**
 * The container writer, asserted byte by byte.
 *
 * ## Why the expected bytes are written out as literals
 *
 * #31's revision block asks for a byte-level assertion *"so a matched pair of
 * errors cannot hide"* — because a round trip through this project's own
 * decoder passes when the encoder and the decoder are wrong in the same
 * direction, which is exactly what happens when they are written by the same
 * person on the same afternoon.
 *
 * A snapshot of the encoder's own output would not close that gap; it would
 * record it. So the expectation below is **written out**, byte by byte, with
 * each byte's role named, from the container layout tabulated in
 * `packages/fit/README.md` §3 — and the two checksums were computed by an
 * independent CRC-16/ARC implementation outside this repository, cross-checked
 * against the CRC catalogue's published check value `0xBB3D` over the nine
 * ASCII bytes `123456789` before it was used. A reviewer can verify every byte
 * here against the protocol documentation without running anything.
 *
 * The corpus-wide round trip, and the cross-check against the fixture
 * generator's independently written CRC, are in
 * `tools/fixture-corpus/encode-corpus.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { readFitContainer } from '../decode/container';
import { BASE_TYPE, FitContainerWriter, LOCAL_MESSAGE_TYPE_COUNT, numericValue } from './container';
import { FitEncodeError } from './errors';

/** `file_id` carrying only its `type` field, as an enum. */
const FILE_ID_TYPE_ONLY = {
  globalMessageNumber: 0,
  fields: [{ number: 0, size: 1, baseType: BASE_TYPE.enum }],
};

describe('the bytes of the smallest useful FIT file', () => {
  const bytes = new FitContainerWriter().message(FILE_ID_TYPE_ONLY, [numericValue(4)]).finish();

  it('is exactly the twenty-seven bytes the protocol layout calls for', () => {
    expect([...bytes]).toEqual([
      // --- header, 14 bytes -------------------------------------------------
      0x0e, // header size: the 14-byte form, which carries its own CRC
      0x20, // protocol version 2.0: major in the high nibble, minor in the low
      0x01,
      0x00, // profile version 1, little-endian — this project's own constant
      0x0b,
      0x00,
      0x00,
      0x00, // data size: 11 bytes of records follow the header
      0x2e,
      0x46,
      0x49,
      0x54, // ".FIT", the data type signature at offset 8
      0x8c,
      0xf3, // header CRC over bytes 0..11, little-endian

      // --- definition message, 9 bytes --------------------------------------
      0x40, // record header: bit 6 set (definition), local message type 0
      0x00, // reserved
      0x00, // architecture: little-endian
      0x00,
      0x00, // global message number 0 (file_id)
      0x01, // one field
      0x00, // field definition number 0 (file_id.type)
      0x01, // one byte wide
      0x00, // base type 0 (enum); bit 7 clear, a one-byte type has no order

      // --- data message, 2 bytes --------------------------------------------
      0x00, // record header: bit 6 clear (data), local message type 0
      0x04, // file_id.type = 4, an activity file

      // --- footer, 2 bytes --------------------------------------------------
      0x54,
      0x2f, // file CRC over all 25 preceding bytes, little-endian
    ]);
  });

  it('is read back by this package’s own decoder', () => {
    const container = readFitContainer(bytes);
    expect(container.faults).toEqual([]);
    expect(container.header.dataSize).toBe(11);
    expect(container.messages).toHaveLength(1);
    expect(container.messages[0]?.globalMessageNumber).toBe(0);
    expect(container.messages[0]?.fields[0]?.numeric).toBe(4);
  });
});

describe('local message types', () => {
  it('emits one definition for a shape however many messages use it', () => {
    const writer = new FitContainerWriter();
    for (let index = 0; index < 5; index += 1) {
      writer.message(FILE_ID_TYPE_ONLY, [numericValue(index)]);
    }
    const container = readFitContainer(writer.finish());
    expect(container.messages).toHaveLength(5);
    expect(container.messages.map((message) => message.fields[0]?.numeric)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    // One definition record (9 bytes) plus five data records (2 bytes each).
    expect(container.header.dataSize).toBe(9 + 5 * 2);
  });

  it('gives a second shape its own local type rather than rebinding the first', () => {
    const writer = new FitContainerWriter();
    writer.message(FILE_ID_TYPE_ONLY, [numericValue(4)]);
    writer.message(
      { globalMessageNumber: 20, fields: [{ number: 7, size: 2, baseType: BASE_TYPE.uint16 }] },
      [numericValue(250)],
    );
    writer.message(FILE_ID_TYPE_ONLY, [numericValue(4)]);
    expect(writer.boundLocalTypeCount).toBe(2);

    const container = readFitContainer(writer.finish());
    expect(container.messages.map((message) => message.localMessageType)).toEqual([0, 1, 0]);
    expect(container.messages.map((message) => message.globalMessageNumber)).toEqual([0, 20, 0]);
  });

  it('refuses a seventeenth distinct shape rather than reusing a bound one', () => {
    const writer = new FitContainerWriter();
    for (let index = 0; index < LOCAL_MESSAGE_TYPE_COUNT; index += 1) {
      writer.message(
        { globalMessageNumber: index, fields: [{ number: 0, size: 1, baseType: BASE_TYPE.uint8 }] },
        [numericValue(1)],
      );
    }
    expect(() => {
      writer.message(
        { globalMessageNumber: 99, fields: [{ number: 0, size: 1, baseType: BASE_TYPE.uint8 }] },
        [numericValue(1)],
      );
    }).toThrow(FitEncodeError);
  });
});

describe('a gap', () => {
  it.each([
    ['uint8', BASE_TYPE.uint8, 1, [0xff]],
    ['sint8', BASE_TYPE.sint8, 1, [0x7f]],
    ['uint16', BASE_TYPE.uint16, 2, [0xff, 0xff]],
    ['sint16', BASE_TYPE.sint16, 2, [0xff, 0x7f]],
    ['uint32', BASE_TYPE.uint32, 4, [0xff, 0xff, 0xff, 0xff]],
    ['sint32', BASE_TYPE.sint32, 4, [0xff, 0xff, 0xff, 0x7f]],
    ['enum', BASE_TYPE.enum, 1, [0xff]],
  ] as const)('is the %s invalid marker, never zero', (_name, baseType, size, expected) => {
    const bytes = new FitContainerWriter()
      .message({ globalMessageNumber: 20, fields: [{ number: 3, size, baseType }] }, [
        numericValue(undefined),
      ])
      .finish();
    // The data message is the last `size` bytes before the two-byte file CRC.
    const written = [...bytes.subarray(bytes.length - 2 - size, bytes.length - 2)];
    expect(written).toEqual([...expected]);
    expect(written.every((byte) => byte === 0)).toBe(false);
  });

  it('reads back as undefined rather than as a number', () => {
    const bytes = new FitContainerWriter()
      .message(
        {
          globalMessageNumber: 20,
          fields: [{ number: 3, size: 1, baseType: BASE_TYPE.uint8 }],
        },
        [numericValue(undefined)],
      )
      .finish();
    expect(readFitContainer(bytes).messages[0]?.fields[0]?.numeric).toBeUndefined();
  });
});

describe('the header', () => {
  it('declares the data size the file actually holds, for a file of any length', () => {
    for (const count of [1, 17, 400]) {
      const writer = new FitContainerWriter();
      for (let index = 0; index < count; index += 1) {
        writer.message(FILE_ID_TYPE_ONLY, [numericValue(index % 200)]);
      }
      const bytes = writer.finish();
      const declared = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
      expect(declared).toBe(bytes.length - 14 - 2);
    }
  });

  it('grows the sink without corrupting anything already written', () => {
    // 400 messages is well past the 512-byte starting capacity, so the buffer
    // is regrown at least twice. A grow that lost the header would still
    // produce a plausible-looking file.
    const writer = new FitContainerWriter(16);
    for (let index = 0; index < 400; index += 1) {
      writer.message(FILE_ID_TYPE_ONLY, [numericValue(index % 200)]);
    }
    const container = readFitContainer(writer.finish());
    expect(container.faults).toEqual([]);
    expect(container.messages).toHaveLength(400);
    expect(container.messages.at(-1)?.fields[0]?.numeric).toBe(399 % 200);
  });
});
