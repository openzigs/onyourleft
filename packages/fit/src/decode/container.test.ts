// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';

import {
  COMPRESSED_TIME_OFFSET_PERIOD,
  expandCompressedTimestamp,
  FIT_HEADER_SIZE,
  FIT_LEGACY_HEADER_SIZE,
  readFitContainer,
} from './container';
import { FitDecodeError } from './errors';
import { bytes, FitBytes } from './testing/fit-bytes';

const UINT8 = 0x02;
const UINT16 = 0x84;
const UINT32 = 0x86;
const TIMESTAMP = 253;

/** A one-field `record` definition and `count` data messages carrying `first + n`. */
function simpleFile(count: number, options: { readonly bigEndian?: boolean } = {}): Uint8Array {
  const file = new FitBytes().definition(
    0,
    20,
    [{ number: 3, size: 1, baseType: UINT8 }],
    options.bigEndian === true ? { bigEndian: true } : {},
  );
  for (let index = 0; index < count; index += 1) {
    file.data(0, [100 + index]);
  }
  return file.finish();
}

describe('the file header', () => {
  it('reads the 14-byte form', () => {
    const container = readFitContainer(simpleFile(1));
    expect(container.header.headerSize).toBe(FIT_HEADER_SIZE);
    expect(container.header.protocolVersion).toBe(0x20);
    expect(container.header.headerCrc).toBeDefined();
    expect(container.faults).toEqual([]);
  });

  it('reads the legacy 12-byte form, which carries no header CRC', () => {
    const file = new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .data(0, [120])
      .finish({ headerSize: FIT_LEGACY_HEADER_SIZE });
    const container = readFitContainer(file);
    expect(container.header.headerSize).toBe(FIT_LEGACY_HEADER_SIZE);
    expect(container.header.headerCrc).toBeUndefined();
    expect(container.messages).toHaveLength(1);
  });

  it('rejects a file too short to hold a header', () => {
    for (const length of [0, 1, 11]) {
      expect(() => readFitContainer(new Uint8Array(length))).toThrowError(
        expect.objectContaining({ name: 'FitDecodeError', code: 'file-too-short', byteOffset: 0 }),
      );
    }
  });

  it('rejects a header whose declared size is not a size a header can have', () => {
    const file = simpleFile(1);
    file[0] = 11;
    expect(() => readFitContainer(file)).toThrowError(
      expect.objectContaining({ code: 'bad-header-size' }),
    );
    file[0] = 250;
    expect(() => readFitContainer(file)).toThrowError(
      expect.objectContaining({ code: 'bad-header-size' }),
    );
  });

  it('rejects a file whose signature is not ".FIT"', () => {
    const file = simpleFile(1);
    file[8] = 0x2f;
    expect(() => readFitContainer(file)).toThrowError(
      expect.objectContaining({ code: 'bad-signature', byteOffset: 8 }),
    );
  });

  it('rejects a header whose own CRC does not match its first twelve bytes', () => {
    const file = new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .data(0, [120])
      .finish({ corruptHeaderCrc: true });
    expect(() => readFitContainer(file)).toThrowError(
      expect.objectContaining({ code: 'bad-header-crc', byteOffset: 12 }),
    );
  });

  it('accepts a header CRC of zero, which means the writer did not compute one', () => {
    const file = simpleFile(1);
    file[12] = 0;
    file[13] = 0;
    // The file CRC covers the header, so it has to be rewritten too. Easiest is
    // to assert that the header check alone does not fire, by reading a file
    // whose trailing CRC is absent.
    const withoutFileCrc = file.subarray(0, file.length - 2);
    const container = readFitContainer(withoutFileCrc);
    expect(container.header.headerCrc).toBe(0);
    expect(container.faults.map((fault) => fault.code)).toEqual(['missing-file-crc']);
  });
});

describe('the file CRC', () => {
  it('accepts a file whose trailing CRC matches', () => {
    expect(readFitContainer(simpleFile(3)).faults).toEqual([]);
  });

  it('rejects a corrupted file', () => {
    const file = new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .data(0, [120])
      .finish({ corruptFileCrc: true });
    expect(() => readFitContainer(file)).toThrowError(
      expect.objectContaining({ name: 'FitDecodeError', code: 'bad-file-crc' }),
    );
  });

  it('rejects a file whose data was altered after it was written', () => {
    const file = simpleFile(3);
    // Flip one bit in a data message. The CRC is what notices.
    const target = FIT_HEADER_SIZE + 6;
    file[target] = (file[target] ?? 0) ^ 0x01;
    expect(() => readFitContainer(file)).toThrowError(
      expect.objectContaining({ code: 'bad-file-crc' }),
    );
  });

  it('reports a missing CRC as a fault rather than refusing the file', () => {
    const file = new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .data(0, [120])
      .finish({ omitFileCrc: true });
    const container = readFitContainer(file);
    expect(container.messages).toHaveLength(1);
    expect(container.faults.map((fault) => fault.code)).toEqual(['missing-file-crc']);
  });
});

describe('local message types', () => {
  it('reads a data message against the definition its local type is bound to', () => {
    const container = readFitContainer(simpleFile(2));
    expect(container.messages.map((message) => message.fields[0]?.numeric)).toEqual([100, 101]);
  });

  /**
   * #30's second acceptance criterion, and `fixtures/README.md` §6's named gap:
   * *"the most common source of silently-wrong FIT output"*. A decoder that
   * caches the first definition per local type reads the second block of
   * records against the first block's layout — and the file still parses.
   */
  it('honours a definition that rebinds a local message type mid-file', () => {
    const file = new FitBytes()
      .definition(3, 20, [
        { number: TIMESTAMP, size: 4, baseType: UINT32 },
        { number: 3, size: 1, baseType: UINT8 },
      ])
      .data(3, [...bytes.u32(1000), 140])
      .data(3, [...bytes.u32(1001), 141])
      // The same local type, now a two-field record with a 16-bit heart rate.
      .definition(3, 20, [
        { number: TIMESTAMP, size: 4, baseType: UINT32 },
        { number: 3, size: 2, baseType: UINT16 },
      ])
      .data(3, [...bytes.u32(1002), ...bytes.u16(300)])
      .data(3, [...bytes.u32(1003), ...bytes.u16(301)])
      .finish();

    const container = readFitContainer(file);
    expect(container.faults).toEqual([]);
    expect(container.messages).toHaveLength(4);
    expect(
      container.messages.map((message) => [message.fields[0]?.numeric, message.fields[1]?.numeric]),
    ).toEqual([
      [1000, 140],
      [1001, 141],
      [1002, 300],
      [1003, 301],
    ]);
  });

  it('rebinds a local message type to a different global message too', () => {
    const file = new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .data(0, [140])
      .definition(0, 19, [{ number: 254, size: 2, baseType: UINT16 }])
      .data(0, [...bytes.u16(7)])
      .finish();
    const container = readFitContainer(file);
    expect(container.messages.map((message) => message.globalMessageNumber)).toEqual([20, 19]);
    expect(container.messages[1]?.fields[0]?.numeric).toBe(7);
  });

  it('stops with a fault at a data message no definition has bound', () => {
    const file = new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .data(0, [140])
      .data(5, [140])
      .data(0, [141])
      .finish();
    const container = readFitContainer(file);
    expect(container.messages).toHaveLength(1);
    const fault = container.faults.at(0);
    expect(fault?.code).toBe('undefined-local-message-type');
    // A one-field definition message is 9 bytes and each data message is 2, so
    // the undefined one begins 11 bytes into the data section.
    expect(fault?.byteOffset).toBe(FIT_HEADER_SIZE + 11);
  });
});

describe('the architecture byte', () => {
  it('reads a big-endian definition and its data', () => {
    const file = new FitBytes()
      .definition(
        1,
        20,
        [
          { number: TIMESTAMP, size: 4, baseType: UINT32 },
          { number: 7, size: 2, baseType: UINT16 },
        ],
        { bigEndian: true },
      )
      .data(1, [...bytes.u32be(1_000_000), ...bytes.u16be(275)])
      .finish();

    const container = readFitContainer(file);
    expect(container.faults).toEqual([]);
    const message = container.messages.at(0);
    // The global message number is itself read with the declared architecture.
    expect(message?.globalMessageNumber).toBe(20);
    expect(message?.fields[0]?.numeric).toBe(1_000_000);
    expect(message?.fields[1]?.numeric).toBe(275);
  });

  it('reads the same values from a little-endian file, so the flag is doing the work', () => {
    const container = readFitContainer(simpleFile(1, { bigEndian: true }));
    expect(container.messages[0]?.globalMessageNumber).toBe(20);
    expect(readFitContainer(simpleFile(1)).messages[0]?.globalMessageNumber).toBe(20);
  });
});

describe('compressed timestamp headers', () => {
  it('expands an offset inside the current 32-second window', () => {
    expect(expandCompressedTimestamp(1000, 1000 % COMPRESSED_TIME_OFFSET_PERIOD)).toBe(1000);
    expect(expandCompressedTimestamp(1000, (1000 + 5) % COMPRESSED_TIME_OFFSET_PERIOD)).toBe(1005);
  });

  it('adds a period when the five-bit offset has rolled over', () => {
    // 1000 mod 32 is 8; an offset of 3 is behind it, so the window has turned.
    expect(expandCompressedTimestamp(1000, 3)).toBe(1027);
  });

  it('reads a run of compressed records relative to the last full timestamp', () => {
    const file = new FitBytes()
      .definition(0, 20, [
        { number: TIMESTAMP, size: 4, baseType: UINT32 },
        { number: 3, size: 1, baseType: UINT8 },
      ])
      .data(0, [...bytes.u32(1000), 140])
      // The compressed form carries no timestamp field, only the body of the
      // remaining fields the definition declares. Here that is the heart rate,
      // so the definition below is the one it is read against.
      .definition(1, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .compressed(1, (1001 % 32) & 0x1f, [141])
      .compressed(1, (1002 % 32) & 0x1f, [142])
      .finish();

    const container = readFitContainer(file);
    expect(container.faults).toEqual([]);
    expect(container.messages.map((message) => message.compressedTimestamp)).toEqual([
      undefined,
      1001,
      1002,
    ]);
  });

  it('walks the running timestamp across a rollover', () => {
    const start = 1000;
    const file = new FitBytes()
      .definition(0, 20, [
        { number: TIMESTAMP, size: 4, baseType: UINT32 },
        { number: 3, size: 1, baseType: UINT8 },
      ])
      .data(0, [...bytes.u32(start), 140])
      .definition(1, 20, [{ number: 3, size: 1, baseType: UINT8 }]);
    const expected: number[] = [];
    for (let step = 1; step <= 80; step += 1) {
      file.compressed(1, (start + step) & 0x1f, [140]);
      expected.push(start + step);
    }
    const container = readFitContainer(file.finish());
    expect(container.messages.slice(1).map((message) => message.compressedTimestamp)).toEqual(
      expected,
    );
  });

  it('reports a compressed record whose body runs off the end of the file', () => {
    const whole = new FitBytes()
      .definition(0, 20, [
        { number: TIMESTAMP, size: 4, baseType: UINT32 },
        { number: 3, size: 1, baseType: UINT8 },
      ])
      .data(0, [...bytes.u32(1000), 140])
      .definition(1, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .compressed(1, 5, [141]);
    // 12 + 6 + 9 = 27 bytes, then the compressed record's header byte alone.
    const file = whole.finish({ truncateDataToBytes: 28, omitFileCrc: true });

    expect(() => readFitContainer(file)).not.toThrow();
    const container = readFitContainer(file);
    expect(container.messages).toHaveLength(1);
    expect(container.faults.map((fault) => fault.code)).toEqual([
      'truncated-file',
      'truncated-record',
    ]);
    expect(container.faults.at(-1)?.byteOffset).toBe(FIT_HEADER_SIZE + 27);
  });

  it('reports a compressed record that has nothing to be relative to', () => {
    const file = new FitBytes()
      .definition(1, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .compressed(1, 5, [140])
      .finish();
    const container = readFitContainer(file);
    expect(container.faults.map((fault) => fault.code)).toEqual([
      'compressed-timestamp-without-reference',
    ]);
    expect(container.messages).toHaveLength(1);
    expect(container.messages[0]?.compressedTimestamp).toBeUndefined();
  });
});

describe('truncation', () => {
  it('keeps every record up to the cut and reports where it is', () => {
    const whole = new FitBytes().definition(0, 20, [
      { number: TIMESTAMP, size: 4, baseType: UINT32 },
      { number: 3, size: 1, baseType: UINT8 },
    ]);
    for (let index = 0; index < 10; index += 1) {
      whole.data(0, [...bytes.u32(1000 + index), 140 + index]);
    }
    // The two-field definition message is 1 + 5 + 2 * 3 = 12 bytes and each
    // record is 1 + 4 + 1 = 6. Cut three bytes into the eighth record.
    const cutAt = 12 + 7 * 6 + 3;
    const file = whole.finish({ truncateDataToBytes: cutAt, omitFileCrc: true });

    const container = readFitContainer(file);
    expect(container.messages).toHaveLength(7);
    expect(container.messages.at(-1)?.fields[0]?.numeric).toBe(1006);

    const codes = container.faults.map((fault) => fault.code);
    expect(codes).toEqual(['truncated-file', 'truncated-record']);

    const truncatedRecord = container.faults.at(-1);
    expect(truncatedRecord).toBeInstanceOf(FitDecodeError);
    // The byte offset names the start of the record that could not be read.
    expect(truncatedRecord?.byteOffset).toBe(FIT_HEADER_SIZE + 12 + 7 * 6);
    expect(truncatedRecord?.message).toContain('at byte');
  });

  it('reports a definition message cut off part-way through', () => {
    const whole = new FitBytes().definition(0, 20, [
      { number: TIMESTAMP, size: 4, baseType: UINT32 },
      { number: 3, size: 1, baseType: UINT8 },
    ]);
    const file = whole.finish({ truncateDataToBytes: 6, omitFileCrc: true });
    const container = readFitContainer(file);
    expect(container.messages).toEqual([]);
    expect(container.faults.map((fault) => fault.code)).toEqual([
      'truncated-file',
      'truncated-record',
    ]);
    expect(container.faults.at(-1)?.byteOffset).toBe(FIT_HEADER_SIZE);
  });

  it('does not verify the CRC of a truncated file, because there is not one', () => {
    const whole = new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }])
      .data(0, [140])
      .data(0, [141]);
    const file = whole.finish({ truncateDataToBytes: 6, omitFileCrc: true });
    expect(() => readFitContainer(file)).not.toThrow();
  });
});

describe('developer fields', () => {
  it('reads a definition that declares them and finds them after the native fields', () => {
    const file = new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }], {
        developerFields: [{ number: 0, size: 2, developerDataIndex: 0 }],
      })
      .data(0, [140, ...bytes.u16(1234)])
      .finish();

    const container = readFitContainer(file);
    expect(container.faults).toEqual([]);
    const message = container.messages.at(0);
    expect(message?.fields).toHaveLength(1);
    expect(message?.developerFields).toHaveLength(1);
    expect(message?.developerFields[0]).toMatchObject({
      developerDataIndex: 0,
      fieldDefinitionNumber: 0,
      littleEndian: true,
    });
    expect([...(message?.developerFields[0]?.bytes ?? [])]).toEqual(bytes.u16(1234));
  });

  it('counts a developer field in the record length, so nothing desynchronises', () => {
    const file = new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }], {
        developerFields: [{ number: 0, size: 2, developerDataIndex: 0 }],
      })
      .data(0, [140, ...bytes.u16(1)])
      .data(0, [141, ...bytes.u16(2)])
      .finish();
    const container = readFitContainer(file);
    expect(container.messages.map((message) => message.fields[0]?.numeric)).toEqual([140, 141]);
  });
});

describe('a definition message cut off inside itself', () => {
  /**
   * Every one of these is a file that ends part-way through a definition
   * message. `SECURITY.md` puts activity file parsing in scope and requires
   * malformed input to produce an error rather than an out-of-bounds read, so
   * each is asserted not to throw as well as to be reported.
   */
  function definitionTruncatedTo(dataBytes: number): Uint8Array {
    return new FitBytes()
      .definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }], {
        developerFields: [{ number: 0, size: 2, developerDataIndex: 0 }],
      })
      .finish({ truncateDataToBytes: dataBytes, omitFileCrc: true });
  }

  it.each([
    ['inside its fixed five-byte preamble', 4],
    ['inside its field definition triplets', 7],
    ['before the developer field count byte', 9],
    ['inside its developer field triplets', 10],
  ])('reports one cut %s', (_description, dataBytes) => {
    const file = definitionTruncatedTo(dataBytes);
    expect(() => readFitContainer(file)).not.toThrow();
    const container = readFitContainer(file);
    expect(container.messages).toEqual([]);
    expect(container.faults.map((fault) => fault.code)).toEqual([
      'truncated-file',
      'truncated-record',
    ]);
    expect(container.faults.at(-1)?.byteOffset).toBe(FIT_HEADER_SIZE);
  });
});

describe('truncation with developer fields', () => {
  /**
   * A developer field is part of the record's length, so a record cut inside
   * one is still a truncated record. A decoder that counted only the native
   * fields would believe the record complete and read four bytes past the end
   * of the file — which is an out-of-bounds `DataView` read, not a wrong value.
   */
  it('counts developer field widths when deciding a record is complete', () => {
    const whole = new FitBytes().definition(0, 20, [{ number: 3, size: 1, baseType: UINT8 }], {
      developerFields: [{ number: 0, size: 4, developerDataIndex: 0 }],
    });
    for (let index = 0; index < 4; index += 1) {
      whole.data(0, [140 + index, ...bytes.u32(index)]);
    }
    // The definition is 1 + 5 + 3 + 1 + 3 = 13 bytes and each record is 6.
    // Cut two bytes into the third record's developer field.
    const file = whole.finish({ truncateDataToBytes: 13 + 2 * 6 + 3, omitFileCrc: true });

    expect(() => readFitContainer(file)).not.toThrow();
    const container = readFitContainer(file);
    expect(container.messages).toHaveLength(2);
    expect(container.faults.map((fault) => fault.code)).toEqual([
      'truncated-file',
      'truncated-record',
    ]);
    expect(container.faults.at(-1)?.byteOffset).toBe(FIT_HEADER_SIZE + 13 + 2 * 6);
  });
});

describe('an empty but structurally valid file', () => {
  it('reads a header-only file as zero messages and no faults', () => {
    const container = readFitContainer(new FitBytes().finish());
    expect(container.header.dataSize).toBe(0);
    expect(container.messages).toEqual([]);
    expect(container.faults).toEqual([]);
  });
});
