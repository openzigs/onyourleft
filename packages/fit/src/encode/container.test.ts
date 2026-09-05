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

/**
 * A field wider than the base type's own element — a `byte` field carrying a
 * UUID, or a developer field carried verbatim — has a **declared size** that is
 * not the one, two or four bytes a scalar occupies. A gap in such a field is
 * still exactly `size` bytes wide: the definition message said so, and a reader
 * counts the field's bytes off the record by that number and nothing else.
 *
 * ⚠️ This is the case a round trip through a corpus cannot see. `developer-fields.fit`
 * carries the same two-byte field on all thirty of its records, and two happens
 * to be a width a scalar writer gets right — so the corpus exercises exactly one
 * of the widths this covers. Writing four bytes where sixteen were declared
 * desynchronises every record after it, and the encoder reports `faults: []`
 * while the decoder reports `truncated-record`.
 */
describe('a gap in a field wider than one element', () => {
  const SENTINEL = { number: 253, size: 1, baseType: BASE_TYPE.uint8 };

  it.each([1, 2, 3, 4, 5, 8, 16])(
    'writes exactly the %i bytes the definition declared, all invalid markers',
    (size) => {
      const bytes = new FitContainerWriter()
        .message(
          {
            globalMessageNumber: 207,
            fields: [{ number: 1, size, baseType: BASE_TYPE.byte }, SENTINEL],
          },
          [numericValue(undefined), numericValue(9)],
        )
        .finish();

      // The data message is the record header, the field, then the sentinel,
      // sitting immediately before the two-byte file CRC.
      const body = [...bytes.subarray(bytes.length - 2 - size - 1, bytes.length - 2)];
      expect(body).toEqual([...new Array<number>(size).fill(0xff), 9]);
    },
  );

  it.each([1, 2, 3, 4, 5, 8, 16])(
    'leaves every following record readable, at a declared width of %i',
    (size) => {
      const shape = {
        globalMessageNumber: 207,
        fields: [{ number: 1, size, baseType: BASE_TYPE.byte }, SENTINEL],
      };
      const container = readFitContainer(
        new FitContainerWriter()
          .message(shape, [numericValue(undefined), numericValue(1)])
          .message(shape, [numericValue(undefined), numericValue(2)])
          .finish(),
      );

      expect(container.faults).toEqual([]);
      expect(container.messages).toHaveLength(2);
      expect(container.messages.map((message) => message.fields[1]?.numeric)).toEqual([1, 2]);
      expect(container.messages[0]?.fields[0]?.bytes).toHaveLength(size);
    },
  );

  it('writes one marker per element for a multi-element numeric field', () => {
    // Three `uint16` elements in one six-byte field: six bytes of 0xFF, not a
    // single 0xFFFF and not a four-byte write.
    const bytes = new FitContainerWriter()
      .message(
        {
          globalMessageNumber: 207,
          fields: [{ number: 1, size: 6, baseType: BASE_TYPE.uint16 }, SENTINEL],
        },
        [numericValue(undefined), numericValue(9)],
      )
      .finish();
    expect([...bytes.subarray(bytes.length - 9, bytes.length - 2)]).toEqual([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 9,
    ]);
  });
});

/**
 * A definition whose declared width and base type do not fit each other.
 *
 * `encodeActivity` never builds one — its numeric fields take their size from
 * the base type — but {@link FitContainerWriter} is exported, so the shapes
 * below are reachable, and the answer that matters for both is the same one:
 * **exactly the declared number of bytes, whatever else is true.** Anything
 * else moves every record after it.
 */
describe('a definition the base type cannot fill exactly', () => {
  const SENTINEL = { number: 253, size: 1, baseType: BASE_TYPE.uint8 };

  /** The data message's payload: everything between its header and the CRC. */
  function payload(bytes: Uint8Array, width: number): number[] {
    return [...bytes.subarray(bytes.length - 2 - width - 1, bytes.length - 2)];
  }

  it('fills a base type this writer emits no numbers for with markers', () => {
    // Base type 9 is `float64`. It is in the decoder's table with an element
    // width of eight and in no candidate list, so nothing chooses it — but a
    // caller can declare it, and a four-byte write would truncate the field.
    const bytes = new FitContainerWriter()
      .message(
        { globalMessageNumber: 207, fields: [{ number: 1, size: 8, baseType: 9 }, SENTINEL] },
        [numericValue(1.5), numericValue(9)],
      )
      .finish();
    expect(payload(bytes, 8)).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 9]);
  });

  it('writes a marker rather than overrunning a field narrower than its element', () => {
    // Two bytes declared for a `uint32`. The value does not fit the space the
    // definition gave it, so it is a gap — and it is two bytes, not four.
    const bytes = new FitContainerWriter()
      .message(
        {
          globalMessageNumber: 207,
          fields: [{ number: 1, size: 2, baseType: BASE_TYPE.uint32 }, SENTINEL],
        },
        [numericValue(70_000), numericValue(9)],
      )
      .finish();
    expect(payload(bytes, 2)).toEqual([0xff, 0xff, 9]);
  });

  it('pads the tail of a width that is not a whole number of elements', () => {
    // Five bytes of `uint16`: two elements, then one byte left over.
    const bytes = new FitContainerWriter()
      .message(
        {
          globalMessageNumber: 207,
          fields: [{ number: 1, size: 5, baseType: BASE_TYPE.uint16 }, SENTINEL],
        },
        [numericValue(0x1234), numericValue(9)],
      )
      .finish();
    expect(payload(bytes, 5)).toEqual([0x34, 0x12, 0xff, 0xff, 0xff, 9]);
  });
});
