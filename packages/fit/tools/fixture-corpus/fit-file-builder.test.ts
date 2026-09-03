// SPDX-License-Identifier: Apache-2.0

import {
  degreesLatitude,
  degreesLatitudeToSemicircles,
  degreesLongitude,
  degreesLongitudeToSemicircles,
  geographicPosition,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { fitCrc16 } from './fit-crc';
import {
  FIT_HEADER_SIZE,
  FIT_PROTOCOL_VERSION,
  FitFileBuilder,
  FIXTURE_PROFILE_VERSION,
  positionValue,
} from './fit-file-builder';
import { BASE_TYPE, GLOBAL_MESSAGE } from './fit-profile';

const at = (latitude: number, longitude: number) =>
  geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));

const readInt32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(offset, true);

const readUint16 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);

const readUint32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);

describe('the file header', () => {
  it('is 14 bytes, protocol 2.0, and carries the .FIT signature', () => {
    const { bytes } = new FitFileBuilder().finish();
    expect(bytes[0]).toBe(FIT_HEADER_SIZE);
    expect(bytes[1]).toBe(FIT_PROTOCOL_VERSION);
    expect(readUint16(bytes, 2)).toBe(FIXTURE_PROFILE_VERSION);
    expect([...bytes.subarray(8, 12)]).toEqual([0x2e, 0x46, 0x49, 0x54]);
  });

  it('records the data size, and the file is header + data + CRC long', () => {
    const { bytes } = new FitFileBuilder()
      .definition(0, GLOBAL_MESSAGE.fileId, [{ number: 0, size: 1, baseType: BASE_TYPE.enum }])
      .data(0, [{ kind: 'u8', value: 4 }])
      .finish();
    const dataSize = readUint32(bytes, 4);
    expect(dataSize).toBe(bytes.length - FIT_HEADER_SIZE - 2);
    // 1 header byte + 5 fixed bytes + 3 per field, then 1 + 1 for the data message.
    expect(dataSize).toBe(11);
  });

  it('carries a header CRC over its first twelve bytes', () => {
    const { bytes } = new FitFileBuilder().finish();
    expect(readUint16(bytes, 12)).toBe(fitCrc16(bytes.subarray(0, 12)));
  });

  it('ends with a file CRC over the header and every data byte', () => {
    const { bytes } = new FitFileBuilder()
      .definition(0, GLOBAL_MESSAGE.fileId, [{ number: 0, size: 1, baseType: BASE_TYPE.enum }])
      .data(0, [{ kind: 'u8', value: 4 }])
      .finish();
    expect(readUint16(bytes, bytes.length - 2)).toBe(fitCrc16(bytes.subarray(0, bytes.length - 2)));
    // The CRC of a message with its own CRC appended is zero, which is the
    // cheapest whole-file integrity check a decoder can make.
    expect(fitCrc16(bytes)).toBe(0);
  });
});

describe('definition messages', () => {
  it('sets the definition bit and the local message type in the record header', () => {
    const { bytes } = new FitFileBuilder()
      .definition(5, GLOBAL_MESSAGE.record, [{ number: 0, size: 1, baseType: BASE_TYPE.uint8 }])
      .finish();
    expect(bytes[FIT_HEADER_SIZE]).toBe(0x45);
  });

  it('lays out reserved, architecture, global message number and field count', () => {
    const { bytes } = new FitFileBuilder()
      .definition(0, GLOBAL_MESSAGE.record, [
        { number: 3, size: 1, baseType: BASE_TYPE.uint8 },
        { number: 7, size: 2, baseType: BASE_TYPE.uint16 },
      ])
      .finish();
    const body = bytes.subarray(FIT_HEADER_SIZE + 1);
    expect(body[0]).toBe(0); // reserved
    expect(body[1]).toBe(0); // little endian
    expect(readUint16(bytes, FIT_HEADER_SIZE + 3)).toBe(GLOBAL_MESSAGE.record);
    expect(body[4]).toBe(2); // field count
    expect([...body.subarray(5, 11)]).toEqual([3, 1, BASE_TYPE.uint8, 7, 2, BASE_TYPE.uint16]);
  });

  it('sets the developer-data bit and appends the developer field definitions', () => {
    const { bytes } = new FitFileBuilder()
      .definition(
        1,
        GLOBAL_MESSAGE.record,
        [{ number: 3, size: 1, baseType: BASE_TYPE.uint8 }],
        [{ number: 0, size: 2, developerDataIndex: 0 }],
      )
      .finish();
    expect(bytes[FIT_HEADER_SIZE]).toBe(0x61);
    const body = bytes.subarray(FIT_HEADER_SIZE + 1);
    expect(body[4]).toBe(1); // one native field
    expect(body[8]).toBe(1); // one developer field
    expect([...body.subarray(9, 12)]).toEqual([0, 2, 0]);
  });

  it('refuses a local message type outside the four bits the header has for it', () => {
    expect(() => new FitFileBuilder().definition(16, 20, [])).toThrow(RangeError);
    expect(() => new FitFileBuilder().data(-1, [])).toThrow(RangeError);
  });
});

describe('positions', () => {
  it('writes latitude then longitude as little-endian semicircles', () => {
    const position = at(-48.5, -123.5);
    const { bytes, positionOffsets } = new FitFileBuilder()
      .definition(0, GLOBAL_MESSAGE.record, [
        { number: 0, size: 4, baseType: BASE_TYPE.sint32 },
        { number: 1, size: 4, baseType: BASE_TYPE.sint32 },
      ])
      .data(0, [positionValue(position)])
      .finish();

    const offsets = positionOffsets[0];
    expect(offsets).toBeDefined();
    expect(readInt32(bytes, offsets?.latitudeOffset ?? 0)).toBe(
      degreesLatitudeToSemicircles(position.latitude),
    );
    expect(readInt32(bytes, offsets?.longitudeOffset ?? 0)).toBe(
      degreesLongitudeToSemicircles(position.longitude),
    );
    expect(offsets?.longitudeOffset).toBe((offsets?.latitudeOffset ?? 0) + 4);
  });

  it('records an offset for every position written, in order', () => {
    const builder = new FitFileBuilder().definition(0, GLOBAL_MESSAGE.record, [
      { number: 0, size: 4, baseType: BASE_TYPE.sint32 },
      { number: 1, size: 4, baseType: BASE_TYPE.sint32 },
    ]);
    for (let index = 0; index < 5; index += 1) {
      builder.data(0, [positionValue(at(index / 10, -index / 10))]);
    }
    const { bytes, positionOffsets } = builder.finish();

    expect(positionOffsets).toHaveLength(5);
    positionOffsets.forEach((offsets, index) => {
      expect(readInt32(bytes, offsets.latitudeOffset)).toBe(
        degreesLatitudeToSemicircles(degreesLatitude(index / 10)),
      );
    });
  });

  it('drops a position the truncation cut in half, so the guard never reads past the end', () => {
    const builder = new FitFileBuilder().definition(0, GLOBAL_MESSAGE.record, [
      { number: 0, size: 4, baseType: BASE_TYPE.sint32 },
      { number: 1, size: 4, baseType: BASE_TYPE.sint32 },
    ]);
    for (let index = 0; index < 3; index += 1) {
      builder.data(0, [positionValue(at(index / 10, -index / 10))]);
    }
    const whole = builder.finish();
    const dataLength = whole.bytes.length - FIT_HEADER_SIZE - 2;

    // Cut four bytes early: the last longitude is gone, its latitude remains.
    const cut = builder.finish({ truncateDataToBytes: dataLength - 4 });
    expect(whole.positionOffsets).toHaveLength(3);
    expect(cut.positionOffsets).toHaveLength(2);
    for (const offsets of cut.positionOffsets) {
      expect(offsets.longitudeOffset + 4).toBeLessThanOrEqual(cut.bytes.length);
    }
  });
});

describe('truncation', () => {
  it('leaves the header claiming the full data size and drops the file CRC', () => {
    const builder = new FitFileBuilder()
      .definition(0, GLOBAL_MESSAGE.record, [{ number: 3, size: 1, baseType: BASE_TYPE.uint8 }])
      .data(0, [{ kind: 'u8', value: 120 }])
      .data(0, [{ kind: 'u8', value: 121 }]);
    const whole = builder.finish();
    const wholeDataSize = readUint32(whole.bytes, 4);
    const cut = builder.finish({ truncateDataToBytes: wholeDataSize - 1 });

    expect(readUint32(cut.bytes, 4)).toBe(wholeDataSize);
    expect(cut.bytes.length).toBe(FIT_HEADER_SIZE + wholeDataSize - 1);
    // No trailing CRC at all: the length is header + data with nothing after it.
    expect(cut.bytes.length).toBe(whole.bytes.length - 3);
  });
});
