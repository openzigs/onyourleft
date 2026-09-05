// SPDX-License-Identifier: Apache-2.0

/**
 * The encoder run against the **committed** #29 corpus, fixture by fixture.
 *
 * #31's first acceptance criterion: *"Encoding an activity and decoding the
 * result with #30 yields a semantically equal activity, asserted field by
 * field. Byte equality with the original input is explicitly **not** the
 * criterion — a re-encode legitimately differs in message ordering and local
 * type assignment."*
 *
 * ## What this test can and cannot see
 *
 * A round trip through this project's own decoder is *"the only test that fails
 * when the encoder and the decoder are wrong in the same direction... which is
 * also its blind spot"* (#31's revision block). Three things close it, and none
 * of them is this file alone:
 *
 * 1. **`src/encode/container.test.ts`** asserts the finished bytes of a small
 *    file against a literal expectation written from the protocol layout, with
 *    both checksums computed outside this repository. A matched pair of errors
 *    changes those bytes.
 * 2. **The checksum cross-check below** recomputes the trailing CRC of every
 *    encoded file with `tools/fixture-corpus/fit-crc.ts` — the fixture
 *    generator's own implementation, written separately from `src/decode/crc.ts`
 *    for exactly this purpose, as `fixtures/README.md` §6 requires.
 * 3. **`third-party-acceptance.test.ts`** puts the output through a reader
 *    nobody here wrote.
 *
 * This file lives under `tools/` because it reads the committed fixtures off
 * disk. The encoder it exercises has no such dependency.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { FitActivity } from '../../src/decode';
import { decodeFitActivity, FIELD, GLOBAL_MESSAGE, readFitContainer } from '../../src/decode';
import { encodeFitActivity } from '../../src/encode';
import { CORPUS_DIRECTORY } from './corpus-files';
import { fitCrc16 as generatorCrc16 } from './fit-crc';

function fixture(name: string): Uint8Array {
  return Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name)));
}

/**
 * Everything about a decoded activity that a re-encode must preserve.
 *
 * The file header is excluded and nothing else is. A re-encode legitimately
 * writes a different `dataSize` and a different header CRC — it is a different
 * file — and `profileVersion` is this project's own constant either way. Every
 * other field, down to each record's developer field bytes, has to come back.
 */
function semantic(activity: FitActivity): Omit<FitActivity, 'header'> {
  const rest: Record<string, unknown> = { ...activity };
  delete rest['header'];
  return rest as unknown as Omit<FitActivity, 'header'>;
}

/** The fixtures that hold a decodable activity. The other two are below. */
const ROUND_TRIP_FIXTURES = [
  'nominal-outdoor-ride.fit',
  'indoor-trainer-no-position.fit',
  'paused-laps.fit',
  'sensor-dropout-30s.fit',
  'antimeridian-crossing.fit',
  'point-nemo-southern-western.fit',
  'truncated-mid-record.fit',
  'developer-fields.fit',
  'heart-rate-16-bit.fit',
  'timestamp-epoch-boundary.fit',
  'event-timestamp-1024-wrap.fit',
] as const;

describe.each(ROUND_TRIP_FIXTURES)('%s', (name) => {
  const original = decodeFitActivity(fixture(name));
  const encoded = encodeFitActivity(original.activity);
  const reread = decodeFitActivity(encoded.bytes);

  it('encodes with no faults', () => {
    expect(encoded.faults).toEqual([]);
  });

  it('re-decodes cleanly, whatever was wrong with the original file', () => {
    expect(reread.faults).toEqual([]);
    expect([...reread.activity.skippedGlobalMessages.keys()]).toEqual([]);
  });

  it('is semantically equal to what was decoded, field by field', () => {
    expect(semantic(reread.activity)).toEqual(semantic(original.activity));
  });

  it('carries a trailing CRC the fixture generator’s independent implementation agrees with', () => {
    const bytes = encoded.bytes;
    const stored = new DataView(bytes.buffer, bytes.byteOffset).getUint16(bytes.length - 2, true);
    expect(stored).toBe(generatorCrc16(bytes.subarray(0, bytes.length - 2)));
  });

  it('declares a data size that matches the bytes it actually wrote', () => {
    const bytes = encoded.bytes;
    const declared = new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true);
    expect(declared).toBe(bytes.length - 14 - 2);
  });

  it('writes every definition before the first data message that uses it', () => {
    // `readFitContainer` reports `undefined-local-message-type` when a data
    // message names a local type nothing has bound, and stops. An empty fault
    // list over a non-empty message list is the assertion.
    const container = readFitContainer(encoded.bytes);
    expect(container.faults).toEqual([]);
    expect(container.messages.length).toBeGreaterThan(0);
  });
});

describe('a channel no record carries', () => {
  const original = decodeFitActivity(fixture('indoor-trainer-no-position.fit'));
  const encoded = encodeFitActivity(original.activity);

  it('is not declared at all, rather than written as invalid markers', () => {
    const container = readFitContainer(encoded.bytes);
    const record = container.messages.find(
      (message) => message.globalMessageNumber === GLOBAL_MESSAGE.record,
    );
    expect(record).toBeDefined();
    const numbers = record?.fields.map((field) => field.number) ?? [];
    expect(numbers).not.toContain(FIELD.record.positionLatitude);
    expect(numbers).not.toContain(FIELD.record.positionLongitude);
    // The channels that *are* there are still there, so this is not vacuous.
    expect(numbers).toContain(FIELD.record.power);
    expect(numbers).toContain(FIELD.record.cadence);
  });
});

describe('a gap inside a channel other records carry', () => {
  const original = decodeFitActivity(fixture('sensor-dropout-30s.fit'));
  const encoded = encodeFitActivity(original.activity);
  const container = readFitContainer(encoded.bytes);
  const records = container.messages.filter(
    (message) => message.globalMessageNumber === GLOBAL_MESSAGE.record,
  );

  it('is written as the base type’s invalid marker, not as zero', () => {
    const dropped = records.filter(
      (record) =>
        record.fields.find((field) => field.number === FIELD.record.heartRate)?.numeric ===
        undefined,
    );
    expect(dropped).toHaveLength(30);

    for (const record of dropped) {
      for (const number of [FIELD.record.heartRate, FIELD.record.cadence, FIELD.record.power]) {
        const field = record.fields.find((candidate) => candidate.number === number);
        expect(field).toBeDefined();
        expect([...(field?.bytes ?? [])].every((byte) => byte === 0xff)).toBe(true);
        expect([...(field?.bytes ?? [])].some((byte) => byte === 0x00)).toBe(false);
      }
    }
  });

  it('leaves the channels either side of it untouched', () => {
    const present = records.filter(
      (record) =>
        record.fields.find((field) => field.number === FIELD.record.heartRate)?.numeric !==
        undefined,
    );
    expect(present.length).toBeGreaterThan(0);
    expect(present.length + 30).toBe(records.length);
  });
});

describe('a pause', () => {
  const original = decodeFitActivity(fixture('paused-laps.fit'));
  const encoded = encodeFitActivity(original.activity);
  const reread = decodeFitActivity(encoded.bytes);

  it('is an absence of records, not a run of zero-valued ones', () => {
    const seconds = reread.activity.records.map((record) =>
      record.timestamp?.kind === 'instant' ? record.timestamp.instant : Number.NaN,
    );
    const gaps = seconds
      .map((value, index) => (index === 0 ? 0 : value - (seconds[index - 1] ?? 0)))
      .filter((delta) => delta > 1);
    expect(gaps).toEqual([300]);
    expect(reread.activity.records).toHaveLength(original.activity.records.length);
  });
});

describe('a channel whose values do not fit its natural base type', () => {
  const original = decodeFitActivity(fixture('heart-rate-16-bit.fit'));
  const encoded = encodeFitActivity(original.activity);

  it('is widened rather than truncated', () => {
    const container = readFitContainer(encoded.bytes);
    const record = container.messages.find(
      (message) => message.globalMessageNumber === GLOBAL_MESSAGE.record,
    );
    const heartRate = record?.fields.find((field) => field.number === FIELD.record.heartRate);
    expect(heartRate?.size).toBe(2);
    expect(heartRate?.numeric).toBeGreaterThan(255);
  });
});

describe('a value that collides with its base type’s invalid marker', () => {
  it('widens the whole channel so the value survives', () => {
    // 255 bpm in a uint8 is 0xFF, which every reader treats as "not recorded".
    const { bytes, faults } = encodeFitActivity({
      records: [
        { ...EMPTY_RECORD, heartRate: 255 as never },
        { ...EMPTY_RECORD, heartRate: 120 as never },
      ],
    });
    expect(faults).toEqual([]);
    const container = readFitContainer(bytes);
    const heartRate = container.messages[0]?.fields.find(
      (field) => field.number === FIELD.record.heartRate,
    );
    expect(heartRate?.size).toBe(2);
    expect(decodeFitActivity(bytes).activity.records[0]?.heartRate).toBe(255);
  });
});

const EMPTY_RECORD = {
  timestamp: undefined,
  position: undefined,
  altitude: undefined,
  distance: undefined,
  speed: undefined,
  heartRate: undefined,
  cadence: undefined,
  power: undefined,
  temperature: undefined,
  developerFields: [],
} as const;

describe('a structurally valid file with no messages in it', () => {
  it('encodes to a header and a checksum, and says so rather than pretending', () => {
    const original = decodeFitActivity(fixture('header-only.fit'));
    const { bytes, faults } = encodeFitActivity(original.activity);
    expect(faults.map((fault) => fault.code)).toEqual(['nothing-to-encode']);
    expect(bytes).toHaveLength(16);
    expect(decodeFitActivity(bytes).activity.records).toEqual([]);
  });
});

describe('the four-hour budget', () => {
  /**
   * #31's last acceptance criterion is *"Encoding a 4-hour activity completes
   * within a stated time budget, measured."*
   *
   * The budget is **two seconds** for 14 400 one-second records carrying every
   * channel. It is set an order of magnitude above the measurement rather than
   * at it: the number that matters to a rider is "the export does not appear to
   * hang", and a budget pinned to this machine's timing is a test that fails on
   * a loaded CI runner and teaches everyone to rerun it. The measured figure is
   * printed and recorded in the pull request.
   */
  const BUDGET_MILLISECONDS = 2000;

  it(`encodes 14 400 records in under ${String(BUDGET_MILLISECONDS)} ms`, () => {
    const template = decodeFitActivity(fixture('nominal-outdoor-ride.fit')).activity;
    const one = template.records[0];
    expect(one).toBeDefined();
    const records = Array.from({ length: 14_400 }, () => one as NonNullable<typeof one>);

    const started = performance.now();
    const { bytes, faults } = encodeFitActivity({ ...template, records });
    const elapsed = performance.now() - started;

    expect(faults).toEqual([]);
    expect(decodeFitActivity(bytes).activity.records).toHaveLength(14_400);
    // The measurement is the deliverable, not a debugging leftover: #31 asks
    // for a stated budget "measured", and this is where the figure in the pull
    // request comes from.
    console.log(
      `encoded a 4-hour activity (${String(bytes.length)} bytes) in ${elapsed.toFixed(1)} ms`,
    );
    expect(elapsed).toBeLessThan(BUDGET_MILLISECONDS);
  });
});
