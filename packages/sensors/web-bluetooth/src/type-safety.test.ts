// SPDX-License-Identifier: Apache-2.0

/**
 * The guarantees that hold at compile time, and the mutation that proves each.
 *
 * CLAUDE.md section 5 states the rule for a compile-time guarantee: *"Remove the
 * brand from the signature and confirm the suite goes red with `TS2578: Unused
 * '@ts-expect-error' directive`."* That error is the mechanism — if a guard is
 * later widened away, the directive that documented it becomes the thing that
 * fails the build.
 *
 * It also names two ways of checking that do not work and have both produced a
 * wrong answer in this repository: grepping for a type name, which finds a brand
 * that is not reachable from the signature; and probing a dirty working tree,
 * which credits an uncommitted change to committed code.
 */

import { beatsPerMinute, metresPerSecond, revolutionsPerMinute, watts } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { MeasurementCapability } from '../../src/capability';

import type { MeasurementSink, MeasurementValueFor } from './profile';
import { canonicalUuid } from './profile';
import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth } from './testing/fake-bluetooth';
import { stubHeartRateProfile } from './testing/profiles';

describe('the measurement sink', () => {
  it('has one method per capability, and no method that is not one', () => {
    // ⚠️ Mutation: add `| 'temperature'` to `MeasurementCapability` and this
    // goes red, because `MeasurementSink` is a mapped type over the union and
    // `MeasurementValueFor` is checked against it in both directions. Review of
    // PR #108 established why that matters here: a hand-written interface with
    // four methods checks only that every method is in the union, and stays
    // silently stale when the union grows — leaving a capability with no way to
    // be reported and no compile error anywhere.
    type SinkKeys = keyof MeasurementSink;
    type ValueKeys = keyof MeasurementValueFor;
    const everySinkKeyIsACapability: SinkKeys extends MeasurementCapability ? true : never = true;
    const everyCapabilityIsASinkKey: MeasurementCapability extends SinkKeys ? true : never = true;
    const valuesCoverTheSameKeys: [SinkKeys] extends [ValueKeys]
      ? [ValueKeys] extends [SinkKeys]
        ? true
        : never
      : never = true;

    expect([everySinkKeyIsACapability, everyCapabilityIsASinkKey, valuesCoverTheSameKeys]).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('will not take an unlabelled number for a labelled quantity', () => {
    const sink: MeasurementSink = {
      power: () => undefined,
      cadence: () => undefined,
      'heart-rate': () => undefined,
      speed: () => undefined,
    };

    // The first unlabelled number on this boundary is the one that costs a
    // ride. #41–#43 decode bytes; the labelling functions are where an
    // unlabelled integer off the wire becomes a quantity, and this is what makes
    // skipping them impossible rather than merely discouraged.
    // @ts-expect-error a plain number is not Watts
    sink.power(214);
    // @ts-expect-error a plain number is not RevolutionsPerMinute
    sink.cadence(88);
    // @ts-expect-error a plain number is not BeatsPerMinute
    sink['heart-rate'](152);
    // @ts-expect-error a plain number is not MetresPerSecond
    sink.speed(9.5);

    // And it will not take the *wrong* quantity either, which is the failure a
    // brand exists for: every one of these is a number at runtime.
    // @ts-expect-error beats per minute are not watts
    sink.power(beatsPerMinute(152));
    // @ts-expect-error watts are not a cadence
    sink.cadence(watts(214));
    // @ts-expect-error metres per second are not a heart rate
    sink['heart-rate'](metresPerSecond(9.5));
    // @ts-expect-error revolutions per minute are not a speed
    sink.speed(revolutionsPerMinute(88));

    expect(sink).toBeTypeOf('object');
  });

  it('accepts the labelled quantities', () => {
    const seen: unknown[] = [];
    const sink: MeasurementSink = {
      power: (value) => seen.push(value),
      cadence: (value) => seen.push(value),
      'heart-rate': (value) => seen.push(value),
      speed: (value) => seen.push(value),
    };
    sink.power(watts(214));
    sink.cadence(revolutionsPerMinute(88));
    sink['heart-rate'](beatsPerMinute(152));
    sink.speed(metresPerSecond(9.5));
    expect(seen).toEqual([214, 88, 152, 9.5]);
  });
});

describe('the transport surface', () => {
  it('will not take a bare string where a device id is required', async () => {
    const fake = createFakeBluetooth({ devices: [] });
    const transport = createWebBluetoothTransport({
      profiles: [stubHeartRateProfile],
      bluetooth: fake.bluetooth,
    });

    // A name typed by an athlete, or an id read out of storage without checking
    // which platform wrote it, is not a `DeviceId`. `device.ts` explains why
    // that matters more here than anywhere: within one platform the transport is
    // always the same, so comparing ids alone passes every single-platform test.
    // @ts-expect-error a bare string is not a DeviceId
    await expect(transport.connect('some-device')).rejects.toThrow();
  });

  it('types the listener by the capability, with no narrowing at the call site', () => {
    // Not a runtime assertion: the point is that this compiles. A listener
    // subscribed to `'power'` is handed a `PowerMeasurement`, so reading `.power`
    // needs no cast — and reading `.heartRate` is a compile error.
    const check = (): void => {
      const fake = createFakeBluetooth({ devices: [] });
      const transport = createWebBluetoothTransport({
        profiles: [stubHeartRateProfile],
        bluetooth: fake.bluetooth,
      });
      void transport.subscribe('x' as never, 'power', (measurement) => {
        const watts: number = measurement.power;
        void watts;
        // @ts-expect-error a power measurement carries no heart rate
        void measurement.heartRate;
      });
    };
    expect(check).toBeTypeOf('function');
  });
});

describe('canonicalUuid', () => {
  it('normalises the three spellings of one service to one string', () => {
    const long = '0000180d-0000-1000-8000-00805f9b34fb';
    expect(canonicalUuid(0x180d)).toBe(long);
    expect(canonicalUuid('0x180d')).toBe(long);
    expect(canonicalUuid('180D')).toBe(long);
    expect(canonicalUuid('0000180D-0000-1000-8000-00805F9B34FB')).toBe(long);
    // The browser normalises before it compares anything, so an adapter that
    // did not would look for a characteristic under a key nothing ever matches
    // — which surfaces as a sensor that pairs and then reports nothing, the
    // hardest failure in this stack to diagnose.
  });

  it('refuses anything that is neither an assigned number nor a UUID', () => {
    expect(() => canonicalUuid('heart_rate')).toThrow(RangeError);
    expect(() => canonicalUuid('')).toThrow(RangeError);
    expect(() => canonicalUuid('0000180d-0000-1000-8000')).toThrow(RangeError);
    expect(() => canonicalUuid(-1)).toThrow(RangeError);
    expect(() => canonicalUuid(0x1_0000)).toThrow(RangeError);
    expect(() => canonicalUuid(1.5)).toThrow(RangeError);
  });
});
