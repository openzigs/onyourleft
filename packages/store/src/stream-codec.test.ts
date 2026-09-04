// SPDX-License-Identifier: Apache-2.0

/**
 * The encoding, on its own — no database, no harness.
 *
 * `stream-store.test.ts` proves the round trip through IndexedDB. This file
 * proves the two properties that round trip rests on and that a whole-set
 * assertion cannot separate: that the declared resolution is real, and that a
 * gap is not a zero.
 */

import {
  beatsPerMinute,
  degreesCelsius,
  degreesLatitude,
  degreesLongitude,
  fitAltitudeToMetres,
  latitudeSemicircles,
  longitudeSemicircles,
  metresPerSecond,
  revolutionsPerMinute,
  semicirclesToDegreesLatitude,
  semicirclesToDegreesLongitude,
  watts,
} from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { StoreDecodeError, StoreValidationError } from './errors';
import {
  channelBytesPerSample,
  decodeChannel,
  encodeChannel,
  type EncodedChannel,
} from './stream-codec';
import { CHANNEL_RESOLUTION, STREAM_CHANNELS, type Samples, type StreamChannel } from './streams';

/** Samples that cannot be constructed through the domain, for the rejection cases. */
function unchecked<C extends StreamChannel>(values: readonly (number | undefined)[]): Samples<C> {
  return values as Samples<C>;
}

describe('the declared resolution is the contract', () => {
  it('round trips a value on every channel’s grid exactly', () => {
    const onGrid: { [C in StreamChannel]: Samples<C> } = {
      power: [watts(0), watts(250), watts(1_499)],
      heartRate: [beatsPerMinute(0), beatsPerMinute(142), beatsPerMinute(255)],
      cadence: [revolutionsPerMinute(0), revolutionsPerMinute(92), revolutionsPerMinute(200)],
      speed: [metresPerSecond(0), metresPerSecond(8.234), metresPerSecond(19.999)],
      // Stated as raw semicircles and converted out, rather than as a decimal
      // literal rounded until it happened to land: a decimal that is "about
      // 51.5074" is off the grid, and a fixture that quietly rounds to fit is
      // the rigged version of this test.
      latitude: [
        degreesLatitude(0),
        semicirclesToDegreesLatitude(latitudeSemicircles(614_443_100)),
      ],
      longitude: [
        degreesLongitude(0),
        semicirclesToDegreesLongitude(longitudeSemicircles(-1_524_531)),
      ],
      // Also stated in raw units. FIT's scale of 5 makes `raw / 5 - 500` the
      // grid, and 35.2 m is not on it — the nearest point is
      // 35.200000000000045, which is what a decoder produces and what a device
      // that wrote 2,676 meant. Writing the decimal instead is the same rigging
      // as writing an off-grid latitude.
      altitude: [fitAltitudeToMetres(350), fitAltitudeToMetres(2_500), fitAltitudeToMetres(2_676)],
      temperature: [degreesCelsius(-40), degreesCelsius(0), degreesCelsius(41)],
    };

    for (const channel of STREAM_CHANNELS) {
      const samples = onGrid[channel];
      expect(decodeChannel(channel, encodeChannel(channel, samples)), channel).toEqual(samples);
    }
  });

  it('quantises a value between grid points to within the resolution it declares', () => {
    // Deliberately off grid: half a millimetre of latitude, a third of a
    // millisecond of speed, a tenth of a FIT altitude unit.
    const offGrid: readonly { channel: StreamChannel; value: number }[] = [
      { channel: 'power', value: 250.4 },
      { channel: 'speed', value: 8.2347 },
      { channel: 'altitude', value: 35.27 },
      { channel: 'latitude', value: 51.5074001234 },
      { channel: 'longitude', value: -0.1278001234 },
      { channel: 'temperature', value: 20.4 },
    ];

    for (const { channel, value } of offGrid) {
      const back = decodeChannel(channel, encodeChannel(channel, unchecked([value])))[0];
      expect(back, `${channel} came back absent`).toBeDefined();
      const step = CHANNEL_RESOLUTION[channel];
      expect(Math.abs((back ?? Number.NaN) - value), channel).toBeLessThanOrEqual(step / 2);
      // And it really did move: a channel whose codec silently stored the
      // double unchanged would pass the bound above and fail this.
      expect(back, channel).not.toBe(value);
    }
  });

  it('stores each channel at the width the cost model assumes', () => {
    expect(
      Object.fromEntries(
        STREAM_CHANNELS.map((channel) => [channel, channelBytesPerSample(channel)]),
      ),
    ).toEqual({
      power: 2,
      heartRate: 1,
      cadence: 1,
      speed: 2,
      latitude: 4,
      longitude: 4,
      altitude: 2,
      temperature: 1,
    });
  });
});

describe('a gap is absent, and absent is not zero', () => {
  it('round trips a gap sitting between two genuine zeros', () => {
    const samples: Samples<'heartRate'> = [
      beatsPerMinute(0),
      undefined,
      beatsPerMinute(0),
      beatsPerMinute(61),
    ];

    const back = decodeChannel('heartRate', encodeChannel('heartRate', samples));

    expect(back).toEqual([0, undefined, 0, 61]);
    // Spelled out, because `toEqual` treats a hole and an `undefined` alike and
    // the whole criterion is that a reader can tell 0 from absent.
    expect(back[0]).toBe(0);
    expect(back[1]).toBeUndefined();
    expect(back[2]).toBe(0);
  });

  it('round trips a thirty-second dropout in the middle of a run of readings', () => {
    const samples = Array.from({ length: 120 }, (_, index) =>
      index >= 40 && index < 70 ? undefined : beatsPerMinute(120 + (index % 5)),
    );

    const back = decodeChannel('heartRate', encodeChannel('heartRate', samples));

    expect(back.slice(40, 70)).toEqual(Array.from({ length: 30 }, () => undefined));
    expect(back[39]).toBe(120 + (39 % 5));
    expect(back[70]).toBe(120 + (70 % 5));
  });

  it('stores no presence bitmap at all when the channel is dense', () => {
    const encoded = encodeChannel('power', [watts(1), watts(2), watts(3)]);

    expect(encoded.present).toBeUndefined();
    expect(encoded.values.byteLength).toBe(6);
  });

  it('stores one packed bit per sample when the channel has a gap', () => {
    const samples = Array.from({ length: 17 }, (_, index) =>
      index === 16 ? undefined : watts(index),
    );

    const encoded = encodeChannel('power', samples);

    expect(encoded.present).toBeDefined();
    expect(encoded.present?.byteLength).toBe(3);
    // Bits 0-15 set, bit 16 clear.
    expect([...(encoded.present ?? [])]).toEqual([0xff, 0xff, 0x00]);
  });

  it('round trips a channel that is nothing but gaps', () => {
    const samples: Samples<'power'> = [undefined, undefined, undefined];

    expect(decodeChannel('power', encodeChannel('power', samples))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('round trips an empty channel', () => {
    expect(decodeChannel('power', encodeChannel('power', []))).toEqual([]);
  });
});

describe('values the encoding cannot represent are refused, not clamped', () => {
  it('refuses a power above the uint16 range, and names the value', () => {
    // Not a coordinate, so ADR 0004 decision D keeps the number in the message:
    // "the value is most of the diagnostic" for every quantity but a position.
    expect(() => encodeChannel('power', unchecked([70_000]))).toThrow(StoreValidationError);
    expect(() => encodeChannel('power', unchecked([70_000]))).toThrow(/70000/);
  });

  it('refuses a speed above the range the milli-encoding can carry', () => {
    expect(() => encodeChannel('speed', unchecked([100]))).toThrow(StoreValidationError);
  });

  it('refuses a temperature outside the sint8 range', () => {
    expect(() => encodeChannel('temperature', unchecked([-200]))).toThrow(StoreValidationError);
  });
});

describe('ADR 0004 decision D — a coordinate’s value never reaches an error message', () => {
  const latitude = 91.234567;
  const longitude = -181.234567;
  const altitude = 99_999.5;

  it('refuses an impossible latitude without naming it', () => {
    expect(() => encodeChannel('latitude', unchecked([latitude]))).toThrow(StoreValidationError);
    const message = messageOf(() => encodeChannel('latitude', unchecked([latitude])));
    expect(message).toContain('latitude');
    expect(message).not.toContain('91');
    expect(message).not.toContain('234567');
  });

  it('refuses an impossible longitude without naming it', () => {
    const message = messageOf(() => encodeChannel('longitude', unchecked([longitude])));
    expect(message).toContain('longitude');
    expect(message).not.toContain('181');
    expect(message).not.toContain('234567');
  });

  it('refuses an altitude outside the FIT field without naming it', () => {
    // An altitude in a stream always sits beside a position, which is what
    // brings it inside decision D's "reported together with one".
    const message = messageOf(() => encodeChannel('altitude', unchecked([altitude])));
    expect(message).toContain('altitude');
    expect(message).not.toContain('99999');
    expect(message).not.toContain('99,999');
  });

  it('does not name the value when a corrupt semicircle is read back off disk', () => {
    // A latitude semicircle past a quarter turn: on disk it is a valid sint32,
    // and it is not a latitude. The message must say so without repeating it.
    const values = new Uint8Array(4);
    new DataView(values.buffer).setInt32(0, 2_000_000_000, true);
    const corrupt: EncodedChannel = {
      channel: 'latitude',
      encoding: 'sint32-semicircle',
      sampleCount: 1,
      values,
    };

    const message = messageOf(() => decodeChannel('latitude', corrupt));

    expect(message).toContain('latitude');
    expect(message).not.toContain('2000000000');
    expect(message).not.toContain('1073741824');
  });

  it('still names the value for a non-coordinate channel read back off disk', () => {
    // The counterpart, so the narrowness of the rule is asserted rather than
    // assumed: a blanket strip would make this pass too and would cost every
    // other quantity its diagnostic.
    const values = new Uint8Array(4);
    new DataView(values.buffer).setInt32(0, 7, true);
    expect(() =>
      decodeChannel('power', {
        channel: 'power',
        encoding: 'uint16',
        sampleCount: 1,
        values,
      }),
    ).toThrow(/4 bytes|expected 2 bytes/);
  });
});

describe('bytes read back off disk are not trusted', () => {
  const good = encodeChannel('power', [watts(10), watts(20)]);

  it('refuses an encoding this build does not write', () => {
    expect(() => decodeChannel('power', { ...good, encoding: 'sint8' })).toThrow(StoreDecodeError);
  });

  it('refuses a values array that is the wrong length for the sample count', () => {
    expect(() => decodeChannel('power', { ...good, sampleCount: 3 })).toThrow(
      /expected 6 bytes for 3 samples, found 4/,
    );
  });

  it('refuses a negative or fractional sample count', () => {
    expect(() => decodeChannel('power', { ...good, sampleCount: -1 })).toThrow(StoreDecodeError);
    expect(() => decodeChannel('power', { ...good, sampleCount: 1.5 })).toThrow(StoreDecodeError);
  });

  it('refuses a presence bitmap that is the wrong size', () => {
    expect(() => decodeChannel('power', { ...good, present: new Uint8Array(2) })).toThrow(
      /presence bitmap is 2 bytes, expected 1/,
    );
  });
});

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the call to throw, and it did not');
}
