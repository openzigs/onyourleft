// SPDX-License-Identifier: Apache-2.0

import { FIT_EPOCH_UNIX_SECONDS, FIT_SYSTEM_TIME_MAX } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { decodeFitActivity } from './index';
import { FIELD, GLOBAL_MESSAGE } from './profile';
import { bytes, FitBytes } from './testing/fit-bytes';

const ENUM = 0x00;
const SINT8 = 0x01;
const UINT8 = 0x02;
const UINT16 = 0x84;
const SINT32 = 0x85;
const UINT32 = 0x86;
const STRING = 0x07;
const BYTE = 0x0d;

/** A `date_time` comfortably past the reserved system-time range. */
const FIT_TIME = FIT_SYSTEM_TIME_MAX + 1000;

const RECORD_FIELDS = [
  { number: FIELD.timestamp, size: 4, baseType: UINT32 },
  { number: FIELD.record.positionLatitude, size: 4, baseType: SINT32 },
  { number: FIELD.record.positionLongitude, size: 4, baseType: SINT32 },
  { number: FIELD.record.altitude, size: 2, baseType: UINT16 },
  { number: FIELD.record.distance, size: 4, baseType: UINT32 },
  { number: FIELD.record.speed, size: 2, baseType: UINT16 },
  { number: FIELD.record.heartRate, size: 1, baseType: UINT8 },
  { number: FIELD.record.cadence, size: 1, baseType: UINT8 },
  { number: FIELD.record.power, size: 2, baseType: UINT16 },
  { number: FIELD.record.temperature, size: 1, baseType: SINT8 },
];

/** One record with every channel present. Altitude raw 3000 is 100 m. */
function nominalRecordBody(): number[] {
  return [
    ...bytes.u32(FIT_TIME),
    ...bytes.u32(-1_073_741_824 >>> 0), // -2^30 semicircles: -90 degrees exactly
    ...bytes.u32(1_073_741_824), // +2^30 semicircles: +90 degrees of longitude
    ...bytes.u16(3000),
    ...bytes.u32(123_456), // 1234.56 m
    ...bytes.u16(7500), // 7.5 m/s
    ...bytes.u8(142),
    ...bytes.u8(88),
    ...bytes.u16(231),
    ...bytes.u8(0xf6), // -10 degrees Celsius as a sint8
  ];
}

function decodeOneRecord(body: readonly number[]) {
  const file = new FitBytes()
    .definition(0, GLOBAL_MESSAGE.record, RECORD_FIELDS)
    .data(0, body)
    .finish();
  return decodeFitActivity(file);
}

describe('record fields become domain quantities', () => {
  it('applies each field its own scale and offset', () => {
    const { activity, faults } = decodeOneRecord(nominalRecordBody());
    expect(faults).toEqual([]);
    const record = activity.records.at(0);
    expect(record?.timestamp).toEqual({
      kind: 'instant',
      instant: FIT_TIME + FIT_EPOCH_UNIX_SECONDS,
    });
    expect(record?.position).toEqual({ latitude: -90, longitude: 90 });
    // FIT altitude is (raw / 5) - 500.
    expect(record?.altitude).toBe(100);
    // distance is centimetres, speed is millimetres per second.
    expect(record?.distance).toBe(1234.56);
    expect(record?.speed).toBe(7.5);
    expect(record?.heartRate).toBe(142);
    expect(record?.cadence).toBe(88);
    expect(record?.power).toBe(231);
    expect(record?.temperature).toBe(-10);
  });

  it('reads a gap as absent rather than as zero or as the marker', () => {
    const body = nominalRecordBody();
    // heart rate, cadence and power set to their base types' invalid markers.
    const heartRateAt = 4 + 4 + 4 + 2 + 4 + 2;
    body[heartRateAt] = 0xff;
    body[heartRateAt + 1] = 0xff;
    body[heartRateAt + 2] = 0xff;
    body[heartRateAt + 3] = 0xff;

    const { activity, faults } = decodeOneRecord(body);
    expect(faults).toEqual([]);
    const record = activity.records.at(0);
    expect(record?.heartRate).toBeUndefined();
    expect(record?.cadence).toBeUndefined();
    expect(record?.power).toBeUndefined();
    // The channels either side of the hole are untouched.
    expect(record?.speed).toBe(7.5);
    expect(record?.temperature).toBe(-10);
  });

  it('keeps a genuine zero, which is a different fact from a gap', () => {
    const body = nominalRecordBody();
    const powerAt = 4 + 4 + 4 + 2 + 4 + 2 + 1 + 1;
    body[powerAt] = 0;
    body[powerAt + 1] = 0;
    expect(decodeOneRecord(body).activity.records[0]?.power).toBe(0);
  });
});

describe('the position channel', () => {
  it('is absent, not zeroed, when the definition declares no position fields', () => {
    const file = new FitBytes()
      .definition(0, GLOBAL_MESSAGE.record, [
        { number: FIELD.timestamp, size: 4, baseType: UINT32 },
        { number: FIELD.record.power, size: 2, baseType: UINT16 },
      ])
      .data(0, [...bytes.u32(FIT_TIME), ...bytes.u16(200)])
      .finish();
    const { activity, faults } = decodeFitActivity(file);
    expect(faults).toEqual([]);
    expect(activity.records.at(0)?.position).toBeUndefined();
    expect(activity.records.at(0)?.power).toBe(200);
  });

  it('is absent when both coordinates carry the sint32 invalid marker', () => {
    const body = nominalRecordBody();
    for (let index = 4; index < 12; index += 1) body[index] = 0xff;
    body[7] = 0x7f;
    body[11] = 0x7f;
    const { activity, faults } = decodeOneRecord(body);
    expect(activity.records.at(0)?.position).toBeUndefined();
    expect(faults).toEqual([]);
  });

  it('reports a record carrying one coordinate without the other', () => {
    const body = nominalRecordBody();
    for (let index = 8; index < 12; index += 1) body[index] = 0xff;
    body[11] = 0x7f;
    const { activity, faults } = decodeOneRecord(body);
    expect(activity.records.at(0)?.position).toBeUndefined();
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-field-value']);
    // Named specifically, so that a decoder which paired the surviving
    // coordinate with a zero and then had the domain reject it cannot pass
    // this test by producing a fault of the same code for a different reason.
    expect(faults.at(0)?.message).toContain('one half of a position');
  });

  it('drops a latitude outside the range a latitude can take, without printing it', () => {
    const body = nominalRecordBody();
    // A longitude-sized value in the latitude field: beyond +/-2^30 semicircles.
    body.splice(4, 4, ...bytes.u32(2_000_000_000));
    const { activity, faults } = decodeOneRecord(body);
    expect(activity.records.at(0)?.position).toBeUndefined();
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-field-value']);
    // ADR 0004 decision D: the field and the constraint, never the value.
    expect(faults.at(0)?.message).not.toContain('2000000000');
  });
});

describe('date_time', () => {
  function fileWithTimestamp(raw: number): Uint8Array {
    return new FitBytes()
      .definition(0, GLOBAL_MESSAGE.record, [
        { number: FIELD.timestamp, size: 4, baseType: UINT32 },
        { number: FIELD.record.heartRate, size: 1, baseType: UINT8 },
      ])
      .data(0, [...bytes.u32(raw), 120])
      .finish();
  }

  it('reads a value above the reserved range as an instant', () => {
    const { activity } = decodeFitActivity(fileWithTimestamp(FIT_SYSTEM_TIME_MAX + 1));
    expect(activity.records.at(0)?.timestamp).toEqual({
      kind: 'instant',
      instant: FIT_SYSTEM_TIME_MAX + 1 + FIT_EPOCH_UNIX_SECONDS,
    });
  });

  it('reads a value inside the reserved range as time since the device started', () => {
    for (const raw of [0, 1, FIT_SYSTEM_TIME_MAX]) {
      const { activity } = decodeFitActivity(fileWithTimestamp(raw));
      expect(activity.records.at(0)?.timestamp).toEqual({
        kind: 'systemTime',
        sinceDeviceStart: raw,
      });
    }
  });

  it('reads the uint32 invalid marker as no timestamp at all', () => {
    const { activity, faults } = decodeFitActivity(fileWithTimestamp(0xffffffff));
    expect(activity.records.at(0)?.timestamp).toBeUndefined();
    expect(faults).toEqual([]);
  });

  it('takes a compressed record timestamp when the record carries no timestamp field', () => {
    const file = new FitBytes()
      .definition(0, GLOBAL_MESSAGE.record, [
        { number: FIELD.timestamp, size: 4, baseType: UINT32 },
        { number: FIELD.record.heartRate, size: 1, baseType: UINT8 },
      ])
      .data(0, [...bytes.u32(FIT_TIME), 120])
      .definition(1, GLOBAL_MESSAGE.record, [
        { number: FIELD.record.heartRate, size: 1, baseType: UINT8 },
      ])
      .compressed(1, (FIT_TIME + 3) & 0x1f, [121])
      .finish();
    const { activity } = decodeFitActivity(file);
    expect(activity.records.at(1)?.timestamp).toEqual({
      kind: 'instant',
      instant: FIT_TIME + 3 + FIT_EPOCH_UNIX_SECONDS,
    });
  });
});

describe('a field value the domain rejects', () => {
  /**
   * The boundary `@onyourleft/domain` describes: *"Validation happens at
   * construction, once, at the boundary where an untrusted number becomes a
   * typed quantity … a field read out of a FIT file."* A hostile or unusual
   * file must not be able to throw out of the decoder — `SECURITY.md` puts
   * activity file parsing in scope — so the rejection becomes a fault and the
   * rest of the record still decodes.
   */
  it('drops an altitude too large for the FIT altitude field, and keeps the record', () => {
    const file = new FitBytes()
      .definition(0, GLOBAL_MESSAGE.record, [
        // Declared as a uint32, which the format permits: a definition message
        // carries each field's size and base type. The value is far outside
        // what `fitAltitudeToMetres` will accept.
        { number: FIELD.record.altitude, size: 4, baseType: UINT32 },
        { number: FIELD.record.heartRate, size: 1, baseType: UINT8 },
      ])
      .data(0, [...bytes.u32(4_000_000), 140])
      .finish();

    expect(() => decodeFitActivity(file)).not.toThrow();
    const { activity, faults } = decodeFitActivity(file);
    expect(activity.records.at(0)?.altitude).toBeUndefined();
    expect(activity.records.at(0)?.heartRate).toBe(140);
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-field-value']);
    expect(faults.at(0)?.message).toContain('record.altitude');
    // ADR 0004 decision D, applied to every field: the field and the
    // constraint, never the value.
    expect(faults.at(0)?.message).not.toContain('4000000');
  });

  it('drops an hr event timestamp wider than the uint16 counter it is read as', () => {
    const file = new FitBytes()
      .definition(9, GLOBAL_MESSAGE.hr, [
        { number: FIELD.hr.eventTimestamp, size: 4, baseType: UINT32 },
      ])
      .data(9, [...bytes.u32(100_000)])
      .finish();
    const { activity, faults } = decodeFitActivity(file);
    expect(activity.heartRateEvents.at(0)?.eventTimestamp).toBeUndefined();
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-field-value']);
  });

  it('drops a date_time a signed field made negative, rather than throwing', () => {
    const file = new FitBytes()
      .definition(0, GLOBAL_MESSAGE.record, [
        { number: FIELD.timestamp, size: 4, baseType: SINT32 },
        { number: FIELD.record.heartRate, size: 1, baseType: UINT8 },
      ])
      .data(0, [...bytes.u32(-2 >>> 0), 140])
      .finish();
    const { activity, faults } = decodeFitActivity(file);
    expect(activity.records.at(0)?.timestamp).toBeUndefined();
    expect(activity.records.at(0)?.heartRate).toBe(140);
    expect(faults.map((fault) => fault.code)).toEqual(['invalid-field-value']);
    expect(faults.at(0)?.message).toContain('record.timestamp');
  });
});

describe('developer fields', () => {
  const APPLICATION_ID = [
    0x4f, 0x59, 0x4c, 0x2d, 0x54, 0x45, 0x53, 0x54, 0x2d, 0x30, 0x30, 0x30, 0x30, 0x30, 0x30, 0x31,
  ];

  function developerDataId(file: FitBytes): FitBytes {
    return file
      .definition(7, GLOBAL_MESSAGE.developerDataId, [
        { number: FIELD.developerDataId.applicationId, size: 16, baseType: BYTE },
        { number: FIELD.developerDataId.developerDataIndex, size: 1, baseType: UINT8 },
        { number: FIELD.developerDataId.applicationVersion, size: 4, baseType: UINT32 },
      ])
      .data(7, [...APPLICATION_ID, 0, ...bytes.u32(1)]);
  }

  function fieldDescription(file: FitBytes): FitBytes {
    return file
      .definition(8, GLOBAL_MESSAGE.fieldDescription, [
        { number: FIELD.fieldDescription.developerDataIndex, size: 1, baseType: UINT8 },
        { number: FIELD.fieldDescription.fieldDefinitionNumber, size: 1, baseType: UINT8 },
        { number: FIELD.fieldDescription.fitBaseTypeId, size: 1, baseType: UINT8 },
        { number: FIELD.fieldDescription.fieldName, size: 24, baseType: STRING },
        { number: FIELD.fieldDescription.units, size: 8, baseType: STRING },
      ])
      .data(8, [0, 0, UINT16, ...asciiField('Doubtfulness Index', 24), ...asciiField('dbt', 8)]);
  }

  function asciiField(value: string, size: number): number[] {
    const out = new Array<number>(size).fill(0);
    for (let index = 0; index < value.length; index += 1) {
      out[index] = value.charCodeAt(index);
    }
    return out;
  }

  function recordsWithDeveloperField(file: FitBytes): FitBytes {
    return file
      .definition(
        3,
        GLOBAL_MESSAGE.record,
        [{ number: FIELD.record.heartRate, size: 1, baseType: UINT8 }],
        { developerFields: [{ number: 0, size: 2, developerDataIndex: 0 }] },
      )
      .data(3, [140, ...bytes.u16(1042)]);
  }

  it('resolves a field against a description that came before it', () => {
    const file = recordsWithDeveloperField(
      fieldDescription(developerDataId(new FitBytes())),
    ).finish();
    const { activity, faults } = decodeFitActivity(file);
    expect(faults).toEqual([]);
    expect(activity.records.at(0)?.developerFields).toEqual([
      {
        developerDataIndex: 0,
        fieldDefinitionNumber: 0,
        name: 'Doubtfulness Index',
        units: 'dbt',
        numeric: 1042,
        text: undefined,
        bytes: Uint8Array.from(bytes.u16(1042)),
      },
    ]);
    expect(activity.developerApplications).toEqual([
      {
        developerDataIndex: 0,
        applicationId: Uint8Array.from(APPLICATION_ID),
        manufacturerId: undefined,
        applicationVersion: 1,
      },
    ]);
  });

  /**
   * The alignment requirement #30's revision block calls out by name: a
   * decoder must preserve record alignment *"when descriptions arrive after
   * their definitions"*.
   */
  it('resolves a field against a description that came after it', () => {
    const file = fieldDescription(
      recordsWithDeveloperField(developerDataId(new FitBytes())),
    ).finish();
    const { activity, faults } = decodeFitActivity(file);
    expect(faults).toEqual([]);
    expect(activity.records.at(0)?.developerFields.at(0)).toMatchObject({
      name: 'Doubtfulness Index',
      units: 'dbt',
      numeric: 1042,
    });
  });

  it('carries a field the file never describes, rather than throwing', () => {
    const file = recordsWithDeveloperField(new FitBytes()).finish();
    const { activity, faults } = decodeFitActivity(file);
    expect(faults).toEqual([]);
    const developerField = activity.records.at(0)?.developerFields.at(0);
    expect(developerField).toMatchObject({
      developerDataIndex: 0,
      fieldDefinitionNumber: 0,
      name: undefined,
      units: undefined,
      numeric: undefined,
    });
    expect([...(developerField?.bytes ?? [])]).toEqual(bytes.u16(1042));
    // The native field beside it is still read correctly.
    expect(activity.records.at(0)?.heartRate).toBe(140);
  });

  it('treats an all-0xFF application id as absent, which is the byte array marker', () => {
    const file = new FitBytes()
      .definition(7, GLOBAL_MESSAGE.developerDataId, [
        { number: FIELD.developerDataId.applicationId, size: 16, baseType: BYTE },
        { number: FIELD.developerDataId.developerDataIndex, size: 1, baseType: UINT8 },
      ])
      .data(7, [...new Array<number>(16).fill(0xff), 0])
      .finish();
    expect(
      decodeFitActivity(file).activity.developerApplications.at(0)?.applicationId,
    ).toBeUndefined();
  });

  it('ignores a field_description that does not say which field it describes', () => {
    // The two indices are what make a description addressable. Without them it
    // describes nothing, and dropping it is better than filing it under a
    // guess.
    const file = new FitBytes()
      .definition(8, GLOBAL_MESSAGE.fieldDescription, [
        { number: FIELD.fieldDescription.developerDataIndex, size: 1, baseType: UINT8 },
        { number: FIELD.fieldDescription.fieldDefinitionNumber, size: 1, baseType: UINT8 },
        { number: FIELD.fieldDescription.fieldName, size: 8, baseType: STRING },
      ])
      // 0xFF is the uint8 invalid marker, so neither index is present.
      .data(8, [0xff, 0xff, ...asciiField('nameless', 8)])
      .finish();
    const { activity, faults } = decodeFitActivity(file);
    expect(faults).toEqual([]);
    expect(activity.developerFieldDescriptions).toEqual([]);
  });

  it('lists every description the file carried', () => {
    const file = fieldDescription(developerDataId(new FitBytes())).finish();
    expect(decodeFitActivity(file).activity.developerFieldDescriptions).toEqual([
      {
        developerDataIndex: 0,
        fieldDefinitionNumber: 0,
        fitBaseTypeId: UINT16,
        name: 'Doubtfulness Index',
        units: 'dbt',
      },
    ]);
  });
});

describe('the messages around the records', () => {
  it('reads file_id, event, lap, session and activity into their own shapes', () => {
    const file = new FitBytes()
      .definition(0, GLOBAL_MESSAGE.fileId, [
        { number: FIELD.fileId.type, size: 1, baseType: ENUM },
        { number: FIELD.fileId.manufacturer, size: 2, baseType: UINT16 },
        { number: FIELD.fileId.timeCreated, size: 4, baseType: UINT32 },
      ])
      .data(0, [4, ...bytes.u16(255), ...bytes.u32(FIT_TIME)])
      .definition(2, GLOBAL_MESSAGE.event, [
        { number: FIELD.timestamp, size: 4, baseType: UINT32 },
        { number: FIELD.event.event, size: 1, baseType: ENUM },
        { number: FIELD.event.eventType, size: 1, baseType: ENUM },
      ])
      .data(2, [...bytes.u32(FIT_TIME), 0, 0])
      .definition(4, GLOBAL_MESSAGE.lap, [
        { number: FIELD.messageIndex, size: 2, baseType: UINT16 },
        { number: FIELD.lap.startTime, size: 4, baseType: UINT32 },
        { number: FIELD.lap.totalElapsedTime, size: 4, baseType: UINT32 },
        { number: FIELD.lap.totalTimerTime, size: 4, baseType: UINT32 },
        { number: FIELD.lap.totalDistance, size: 4, baseType: UINT32 },
      ])
      .data(4, [
        ...bytes.u16(0),
        ...bytes.u32(FIT_TIME),
        ...bytes.u32(359_000),
        ...bytes.u32(59_000),
        ...bytes.u32(123_400),
      ])
      .definition(5, GLOBAL_MESSAGE.session, [
        { number: FIELD.session.sport, size: 1, baseType: ENUM },
        { number: FIELD.session.numLaps, size: 2, baseType: UINT16 },
        { number: FIELD.session.totalDistance, size: 4, baseType: UINT32 },
      ])
      .data(5, [2, ...bytes.u16(2), ...bytes.u32(246_800)])
      .definition(6, GLOBAL_MESSAGE.activity, [
        { number: FIELD.activity.totalTimerTime, size: 4, baseType: UINT32 },
        { number: FIELD.activity.numSessions, size: 2, baseType: UINT16 },
      ])
      .data(6, [...bytes.u32(118_000), ...bytes.u16(1)])
      .finish();

    const { activity, faults } = decodeFitActivity(file);
    expect(faults).toEqual([]);
    expect(activity.fileId).toEqual({
      type: 4,
      manufacturer: 255,
      product: undefined,
      serialNumber: undefined,
      timeCreated: { kind: 'instant', instant: FIT_TIME + FIT_EPOCH_UNIX_SECONDS },
    });
    expect(activity.events.at(0)).toMatchObject({ event: 0, eventType: 0 });
    expect(activity.laps.at(0)).toMatchObject({
      messageIndex: 0,
      // Elapsed time includes the pause; timer time does not. Both are read.
      totalElapsedTime: 359,
      totalTimerTime: 59,
      totalDistance: 1234,
    });
    expect(activity.sessions.at(0)).toMatchObject({
      sport: 2,
      numLaps: 2,
      totalDistance: 2468,
    });
    expect(activity.summary).toMatchObject({ totalTimerTime: 118, numSessions: 1 });
  });

  it('reads an hr event timestamp as a raw counter reading, unscaled', () => {
    const file = new FitBytes()
      .definition(9, GLOBAL_MESSAGE.hr, [
        { number: FIELD.timestamp, size: 4, baseType: UINT32 },
        { number: FIELD.hr.eventTimestamp, size: 2, baseType: UINT16 },
      ])
      .data(9, [...bytes.u32(FIT_TIME), ...bytes.u16(65_024)])
      .data(9, [...bytes.u32(FIT_TIME), ...bytes.u16(12)])
      .finish();
    const { activity, faults } = decodeFitActivity(file);
    expect(faults).toEqual([]);
    // 65024 and 12, not 63.5 and 0.01: dividing a wrapped counter by its tick
    // rate destroys the modulus unsignedCounterDelta needs.
    expect(activity.heartRateEvents.map((event) => event.eventTimestamp)).toEqual([65_024, 12]);
  });
});

describe('messages outside the profile subset', () => {
  it('skips them and counts them rather than failing', () => {
    const file = new FitBytes()
      // 49 is file_creator; 78 is hrv. Neither is in this profile subset.
      .definition(0, 49, [{ number: 0, size: 2, baseType: UINT16 }])
      .data(0, [...bytes.u16(700)])
      .data(0, [...bytes.u16(701)])
      .definition(1, 78, [{ number: 0, size: 2, baseType: UINT16 }])
      .data(1, [...bytes.u16(1000)])
      .definition(2, GLOBAL_MESSAGE.record, [
        { number: FIELD.record.heartRate, size: 1, baseType: UINT8 },
      ])
      .data(2, [140])
      .finish();

    const { activity, faults } = decodeFitActivity(file);
    expect(faults).toEqual([]);
    expect(activity.records).toHaveLength(1);
    expect([...activity.skippedGlobalMessages.entries()]).toEqual([
      [49, 2],
      [78, 1],
    ]);
  });
});

describe('faults from the container', () => {
  it('reach the caller alongside the records that were readable', () => {
    const whole = new FitBytes().definition(0, GLOBAL_MESSAGE.record, [
      { number: FIELD.record.heartRate, size: 1, baseType: UINT8 },
    ]);
    for (let index = 0; index < 5; index += 1) whole.data(0, [140 + index]);
    const file = whole.finish({ truncateDataToBytes: 9 + 3 * 2, omitFileCrc: true });

    const { activity, faults } = decodeFitActivity(file);
    expect(activity.records.map((record) => record.heartRate)).toEqual([140, 141, 142]);
    expect(faults.map((fault) => fault.code)).toEqual(['truncated-file']);
  });

  it('never returns a silently empty activity for a file with records in it', () => {
    const whole = new FitBytes().definition(0, GLOBAL_MESSAGE.record, [
      { number: FIELD.timestamp, size: 4, baseType: UINT32 },
      { number: FIELD.record.heartRate, size: 1, baseType: UINT8 },
    ]);
    for (let index = 0; index < 5; index += 1) {
      whole.data(0, [...bytes.u32(FIT_TIME + index), 140 + index]);
    }
    const file = whole.finish({ truncateDataToBytes: 12 + 3 * 6 + 2, omitFileCrc: true });
    const { activity, faults } = decodeFitActivity(file);
    expect(activity.records.length).toBeGreaterThan(0);
    expect(faults.some((fault) => fault.code === 'truncated-record')).toBe(true);
  });
});
