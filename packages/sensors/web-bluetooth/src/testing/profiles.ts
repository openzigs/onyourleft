// SPDX-License-Identifier: Apache-2.0

/**
 * Deliberately synthetic profiles, for exercising the adapter's plumbing.
 *
 * ⚠️ **These are not Heart Rate, Cycling Power, CSC or FTMS.** Their UUIDs are
 * in a private range and their payloads are three bytes of nothing in
 * particular. That is on purpose: #41–#43 write the real decoders from the
 * published specifications, with the field-presence flags, the counter wrap
 * handling and the bounds checks that make them correct, and a plausible-looking
 * near-miss sitting in this directory is exactly what would get copied instead.
 *
 * What they are for is everything above the payload: that the adapter resolves
 * a service and a characteristic, installs one handler, chooses one source per
 * capability when two profiles offer the same one, re-arms after a drop, and
 * hands the decoder the characteristic's own view.
 */

import { beatsPerMinute, metresPerSecond, revolutionsPerMinute, watts } from '@onyourleft/domain';

import type { GattProfile } from '../profile';
import type { FakeDeviceSpec } from './fake-bluetooth';

/**
 * Private-range UUIDs. The Bluetooth base UUID's 16-bit space is the assigned
 * numbers registry; nothing this program invents may live there, and a test
 * fixture that squatted on `0x180d` would read as a Heart Rate implementation.
 */
export const STUB_SINGLE_SERVICE = 'f0000001-0000-4000-8000-0123456789ab';
export const STUB_SINGLE_CHARACTERISTIC = 'f0000002-0000-4000-8000-0123456789ab';
export const STUB_MULTI_SERVICE = 'f0000011-0000-4000-8000-0123456789ab';
export const STUB_MULTI_CHARACTERISTIC = 'f0000012-0000-4000-8000-0123456789ab';
export const STUB_HEART_RATE_SERVICE = 'f0000021-0000-4000-8000-0123456789ab';
export const STUB_HEART_RATE_CHARACTERISTIC = 'f0000022-0000-4000-8000-0123456789ab';

/**
 * Power only, from a single-quantity characteristic.
 *
 * Registered *after* `stubMultiProfile` in the tests that use both, so that a
 * device offering both proves the earlier entry wins — the rule that stops a
 * modern trainer delivering two power readings a second.
 */
export const stubSingleProfile: GattProfile = {
  service: STUB_SINGLE_SERVICE,
  characteristic: STUB_SINGLE_CHARACTERISTIC,
  capabilities: ['power'],
  decode(value, sink) {
    sink.power(watts(value.getUint16(0, true)));
  },
};

/** Power, cadence and speed out of one frame, as a trainer's stream carries them. */
export const stubMultiProfile: GattProfile = {
  service: STUB_MULTI_SERVICE,
  characteristic: STUB_MULTI_CHARACTERISTIC,
  capabilities: ['power', 'cadence', 'speed'],
  decode(value, sink) {
    sink.power(watts(value.getUint16(0, true)));
    sink.cadence(revolutionsPerMinute(value.getUint8(2)));
    // Decimetres per second, so that a whole byte covers a plausible range.
    sink.speed(metresPerSecond(value.getUint8(3) / 10));
  },
};

/** One byte, one beat rate. */
export const stubHeartRateProfile: GattProfile = {
  service: STUB_HEART_RATE_SERVICE,
  characteristic: STUB_HEART_RATE_CHARACTERISTIC,
  capabilities: ['heart-rate'],
  decode(value, sink) {
    sink['heart-rate'](beatsPerMinute(value.getUint8(0)));
  },
};

/** A frame `stubMultiProfile` reads: power, cadence, speed. */
export function multiFrame(
  power: number,
  cadence: number,
  decimetresPerSecond: number,
): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint16(0, power, true);
  bytes[2] = cadence;
  bytes[3] = decimetresPerSecond;
  return bytes;
}

/** A frame `stubSingleProfile` reads. */
export function singleFrame(power: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, power, true);
  return bytes;
}

/** A frame `stubHeartRateProfile` reads. */
export function heartRateFrame(bpm: number): Uint8Array {
  return new Uint8Array([bpm]);
}

// --- Devices that serve them -------------------------------------------------

/**
 * A trainer: both stub services on one device, as a modern trainer serves FTMS
 * and Cycling Power and CSC on one.
 *
 * That overlap is the point. `#39`'s design decision is that capabilities are a
 * set on one device, and the adapter has to choose **one** source for power when
 * two services carry it — a device with one service per capability could not
 * catch an adapter that reports power twice a second.
 */
export function stubTrainerDevice(id = 'stub-trainer'): FakeDeviceSpec {
  return {
    id,
    name: 'STUB TRAINER 1F2A',
    services: [
      { uuid: STUB_MULTI_SERVICE, characteristics: [STUB_MULTI_CHARACTERISTIC] },
      { uuid: STUB_SINGLE_SERVICE, characteristics: [STUB_SINGLE_CHARACTERISTIC] },
    ],
  };
}

/** A strap: one service, one characteristic, one capability. */
export function stubStrapDevice(id = 'stub-strap'): FakeDeviceSpec {
  return {
    id,
    name: 'STUB STRAP 0C3F',
    services: [
      { uuid: STUB_HEART_RATE_SERVICE, characteristics: [STUB_HEART_RATE_CHARACTERISTIC] },
    ],
  };
}

/** A device that advertises the trainer's service and does not actually serve it. */
export function stubEmptyDevice(id = 'stub-empty'): FakeDeviceSpec {
  return { id, name: 'STUB EMPTY 9999', services: [] };
}

/** A beacon: it advertises the strap's service and exposes no GATT server. */
export function stubGattlessDevice(id = 'stub-gattless'): FakeDeviceSpec {
  return {
    id,
    name: 'STUB BEACON 4B4B',
    services: [
      { uuid: STUB_HEART_RATE_SERVICE, characteristics: [STUB_HEART_RATE_CHARACTERISTIC] },
    ],
    withoutGatt: true,
  };
}

/** A strap that advertises no name, which several sensors genuinely do. */
export function stubNamelessDevice(id = 'stub-nameless'): FakeDeviceSpec {
  return {
    id,
    services: [
      { uuid: STUB_HEART_RATE_SERVICE, characteristics: [STUB_HEART_RATE_CHARACTERISTIC] },
    ],
  };
}
