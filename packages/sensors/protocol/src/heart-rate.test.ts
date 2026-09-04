// SPDX-License-Identifier: Apache-2.0

/**
 * The Heart Rate Service client, from captured byte arrays with no hardware
 * attached — #41's last acceptance criterion.
 *
 * Three of #41's criteria live here: the 16-bit flag, RR intervals including
 * more than one per notification, and sensor contact surfaced rather than
 * reported as a heart rate of zero.
 */

import { describe, expect, it, vi } from 'vitest';

import { beatsPerMinute, unixSeconds } from '@onyourleft/domain';

import { isSensorError } from '../../src/errors';

import { decodeHeartRateMeasurement, heartRateProfile } from './heart-rate';
import type { MeasurementSink } from './profile';
import { createPayloadWriter, flagsOf } from './testing';

/** Flag bit indices, GSS v9 §3.113. */
const WIDE = 0;
const CONTACT_DETECTED = 1;
const CONTACT_SUPPORTED = 2;
const ENERGY = 3;
const RR = 4;

const AT = unixSeconds(1_800_000_000);

function recordingSink(): { sink: MeasurementSink; beats: number[] } {
  const beats: number[] = [];
  const sink: MeasurementSink = {
    power: vi.fn(),
    cadence: vi.fn(),
    'heart-rate': (value) => beats.push(value),
    speed: vi.fn(),
  };
  return { sink, beats };
}

describe('the heart rate value format flag', () => {
  it('reads an 8-bit heart rate when bit 0 is clear', () => {
    const view = createPayloadWriter().u8(flagsOf()).u8(142).view();

    expect(decodeHeartRateMeasurement(view).heartRate).toBe(beatsPerMinute(142));
  });

  it('reads a 16-bit heart rate when bit 0 is set', () => {
    // ⚠️ The value has to exceed 255, or the assertion is vacuous. Written
    // first with `.u16(142)`, this test stayed green against a decoder that
    // ignored bit 0 entirely: little-endian, the low octet of 142 *is* 142, so
    // a `uint8` read gets the right answer for the wrong reason. Found by
    // mutation, which is the only thing that finds it.
    const view = createPayloadWriter().u8(flagsOf(WIDE)).u16(300).view();

    expect(decodeHeartRateMeasurement(view).heartRate).toBe(beatsPerMinute(300));
  });

  it('parses an 8-bit and a 16-bit notification from the same device', () => {
    // A strap is allowed to change the format between notifications; a decoder
    // that latched the first one would misread every later frame. 300 again,
    // for the reason above.
    const narrow = createPayloadWriter().u8(flagsOf()).u8(120).view();
    const wide = createPayloadWriter().u8(flagsOf(WIDE)).u16(300).view();

    expect(decodeHeartRateMeasurement(narrow).heartRate).toBe(beatsPerMinute(120));
    expect(decodeHeartRateMeasurement(wide).heartRate).toBe(beatsPerMinute(300));
  });

  it('shifts every following field by the width the flag chose', () => {
    // The whole reason bit 0 matters: it moves the offset of everything after
    // it. A 16-bit read against an 8-bit packet takes the energy field's low
    // octet as the heart rate's high octet.
    const wide = createPayloadWriter().u8(flagsOf(WIDE, ENERGY)).u16(300).u16(4200).view();
    const narrow = createPayloadWriter().u8(flagsOf(ENERGY)).u8(200).u16(4200).view();

    expect(decodeHeartRateMeasurement(wide)).toMatchObject({
      heartRate: 300,
      energyExpended: 4200,
    });
    expect(decodeHeartRateMeasurement(narrow)).toMatchObject({
      heartRate: 200,
      energyExpended: 4200,
    });
  });
});

describe('RR intervals', () => {
  it('extracts one, in seconds at 1/1024 s resolution', () => {
    const view = createPayloadWriter().u8(flagsOf(RR)).u8(60).u16(1024).view();

    expect(decodeHeartRateMeasurement(view).rrIntervals).toEqual([1]);
  });

  it('extracts more than one from a single notification, oldest first', () => {
    // At 1 Hz notifications and any heart rate above 60 this is the normal
    // case, not an edge one — and the count is inferred from the remaining
    // length, so a decoder that read exactly one would silently discard HRV
    // data that cannot be recovered later.
    const view = createPayloadWriter().u8(flagsOf(RR)).u8(75).u16(820).u16(810).u16(805).view();

    expect(decodeHeartRateMeasurement(view).rrIntervals).toEqual([
      820 / 1024,
      810 / 1024,
      805 / 1024,
    ]);
  });

  it('reads them after the energy field when both flags are set', () => {
    const view = createPayloadWriter().u8(flagsOf(ENERGY, RR)).u8(75).u16(9000).u16(1024).view();

    expect(decodeHeartRateMeasurement(view)).toMatchObject({
      energyExpended: 9000,
      rrIntervals: [1],
    });
  });

  it('reports none when the flag is clear, whatever trails the packet', () => {
    const view = createPayloadWriter().u8(flagsOf()).u8(75).view();

    expect(decodeHeartRateMeasurement(view).rrIntervals).toEqual([]);
  });

  it('refuses a packet that claims intervals and ends mid-interval', () => {
    const view = createPayloadWriter().u8(flagsOf(RR)).u8(75).u16(820).u8(0x2c).view();

    let thrown: unknown;
    try {
      decodeHeartRateMeasurement(view);
    } catch (error) {
      thrown = error;
    }
    expect(isSensorError(thrown, 'malformed-payload')).toBe(true);
  });

  it('refuses a packet that claims intervals and carries none', () => {
    const view = createPayloadWriter().u8(flagsOf(RR)).u8(75).view();

    expect(() => decodeHeartRateMeasurement(view)).toThrow(/not a whole number/);
  });
});

describe('sensor contact status', () => {
  it('is unsupported when the supported bit is clear, whatever the detected bit says', () => {
    // The correction revision 2 of #1 made. Bit 1 alone is meaningless: a
    // strap with no contact detection leaves both clear, and a client reading
    // bit 1 as a boolean reports it as off the chest for the whole ride.
    const neither = createPayloadWriter().u8(flagsOf()).u8(150).view();
    const detectedOnly = createPayloadWriter().u8(flagsOf(CONTACT_DETECTED)).u8(150).view();

    expect(decodeHeartRateMeasurement(neither).sensorContact).toBe('unsupported');
    expect(decodeHeartRateMeasurement(detectedOnly).sensorContact).toBe('unsupported');
  });

  it('is detected when both bits are set', () => {
    const view = createPayloadWriter()
      .u8(flagsOf(CONTACT_DETECTED, CONTACT_SUPPORTED))
      .u8(150)
      .view();

    expect(decodeHeartRateMeasurement(view).sensorContact).toBe('detected');
  });

  it('is not-detected when the strap can tell and is not on', () => {
    const view = createPayloadWriter().u8(flagsOf(CONTACT_SUPPORTED)).u8(0).view();

    expect(decodeHeartRateMeasurement(view).sensorContact).toBe('not-detected');
  });
});

describe('the heart rate profile', () => {
  it('is registered against the Heart Rate Service and reports heart rate', () => {
    expect(heartRateProfile.service).toBe('0000180d-0000-1000-8000-00805f9b34fb');
    expect(heartRateProfile.characteristic).toBe('00002a37-0000-1000-8000-00805f9b34fb');
    expect(heartRateProfile.capabilities).toEqual(['heart-rate']);
  });

  it('reports a heart rate a strap with contact detection is reporting', () => {
    const { sink, beats } = recordingSink();
    const view = createPayloadWriter()
      .u8(flagsOf(CONTACT_DETECTED, CONTACT_SUPPORTED))
      .u8(148)
      .view();

    heartRateProfile.decode(view, sink, AT);

    expect(beats).toEqual([148]);
  });

  it('reports a heart rate from a strap that cannot tell about contact', () => {
    // The common case. Refusing to report here would silence most straps.
    const { sink, beats } = recordingSink();

    heartRateProfile.decode(createPayloadWriter().u8(flagsOf()).u8(148).view(), sink, AT);

    expect(beats).toEqual([148]);
  });

  it('reports NO heart rate when the strap says it has lost contact', () => {
    // #41's third criterion. `beatsPerMinute(0)` is a valid quantity, so the
    // zero a detached strap transmits would otherwise be recorded as a resting
    // heart rate in the middle of an interval session.
    const { sink, beats } = recordingSink();

    heartRateProfile.decode(
      createPayloadWriter().u8(flagsOf(CONTACT_SUPPORTED)).u8(0).view(),
      sink,
      AT,
    );

    expect(beats).toEqual([]);
  });

  it('reports nothing at all from a payload it could not read', () => {
    const { sink, beats } = recordingSink();

    expect(() =>
      heartRateProfile.decode(createPayloadWriter().u8(flagsOf(WIDE)).u8(70).view(), sink, AT),
    ).toThrow();
    expect(beats).toEqual([]);
  });
});
