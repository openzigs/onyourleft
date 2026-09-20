// SPDX-License-Identifier: Apache-2.0

/**
 * `resolvedUuids` — what a link actually resolved, for #370.
 *
 * `openFitnessMachine` can only answer two of the three states a machine can be
 * in: it throws for anything that serves no Fitness Machine Service, so a
 * trainer whose only control point is its manufacturer's is indistinguishable
 * from a heart rate strap. `../../protocol`'s `chooseTrainerControl` has always
 * been able to tell those apart and had nothing to read. This is the read.
 *
 * ⚠️ **Nothing here names a vendor**, and that is the property under test as
 * much as the enumeration is: the transport answers services and
 * characteristics flat, and the protocol decides what any of them mean.
 */

import { describe, expect, it } from 'vitest';

import {
  createCyclingPowerProfile,
  createIndoorBikeDataProfile,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_SERVICE,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  INDOOR_BIKE_DATA,
  heartRateProfile,
} from '../../protocol/src/index';
import { deviceId } from '../../src/device';
import { SensorError } from '../../src/errors';

import {
  createFakeBluetooth,
  type FakeBluetoothBench,
  type FakeDeviceSpec,
} from './testing/fake-bluetooth';
import { createWebBluetoothTransport, type WebBluetoothTransport } from './transport';

const TRAINER = deviceId('kickr');

/**
 * Wahoo's control characteristic, written out rather than imported.
 *
 * ⚠️ Deliberate. The transport must not know this value, and a test that
 * reached for `WAHOO_TRAINER_CONTROL_POINT` would still pass against a
 * transport that special-cased it — the point is that an arbitrary
 * characteristic inside a granted service comes back.
 */
const VENDOR_CONTROL_POINT = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';

function deviceServing(services: FakeDeviceSpec['services']): FakeDeviceSpec {
  return { id: 'kickr', name: 'KICKR SNAP', services };
}

interface Paired {
  readonly transport: WebBluetoothTransport;
  readonly bench: FakeBluetoothBench;
}

async function paired(
  device: FakeDeviceSpec,
  capabilities: readonly ('power' | 'cadence' | 'speed' | 'heart-rate' | 'trainer-control')[],
): Promise<Paired> {
  const fake = createFakeBluetooth({ devices: [device] });
  const transport = createWebBluetoothTransport({
    profiles: [createIndoorBikeDataProfile(), createCyclingPowerProfile(), heartRateProfile],
    bluetooth: fake.bluetooth,
  });
  await transport.discover({ capabilities: [...capabilities] });
  await transport.connect(TRAINER);
  return { transport, bench: fake.bench };
}

describe('resolvedUuids', () => {
  it('reports the services and their characteristics, flat', async () => {
    const { transport } = await paired(
      deviceServing([
        {
          uuid: CYCLING_POWER_SERVICE,
          characteristics: [CYCLING_POWER_MEASUREMENT, VENDOR_CONTROL_POINT],
        },
      ]),
      ['power'],
    );

    const resolved = await transport.resolvedUuids(TRAINER);

    expect([...resolved].sort()).toEqual(
      [CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT, VENDOR_CONTROL_POINT].sort(),
    );
  });

  /**
   * ⚠️ The bound that matters. `DeviceRecord.granted` is what stops a device
   * paired for heart rate being read for a control point — the same rule
   * `controlCharacteristicsFor` applies, and CLAUDE.md §6 is why trainer
   * control gets one at all. Without it this method would be a way to
   * enumerate a machine the athlete never authorised for control.
   */
  it('cannot reach a service this origin was not granted', async () => {
    const { transport, bench } = await paired(
      deviceServing([
        { uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] },
        {
          uuid: FITNESS_MACHINE_SERVICE,
          characteristics: [INDOOR_BIKE_DATA, FITNESS_MACHINE_CONTROL_POINT],
        },
      ]),
      ['heart-rate'],
    );

    const resolved = await transport.resolvedUuids(TRAINER);

    expect(resolved).not.toContain(FITNESS_MACHINE_CONTROL_POINT);
    expect(resolved).not.toContain(FITNESS_MACHINE_SERVICE);
    expect([...resolved].sort()).toEqual([HEART_RATE_SERVICE, HEART_RATE_MEASUREMENT].sort());
    // ⚠️ And it was never ASKED for, which is the assertion that goes red when
    // the grant is dropped from the walk. Measured: without this line,
    // iterating every service the DEVICE serves rather than every service the
    // ORIGIN was granted leaves this case green — the fake refuses the
    // ungranted one exactly as Chrome does, so the answer is identical and only
    // the wasted, logged `SecurityError` differs.
    expect(bench.operations).not.toContain(`kickr:getPrimaryService:${FITNESS_MACHINE_SERVICE}`);
  });

  /**
   * A granted service the device does not serve contributes nothing and is not
   * an error: a machine that serves three of four is a machine that serves
   * three.
   */
  it('skips a granted service the device does not serve', async () => {
    const { transport } = await paired(
      deviceServing([
        { uuid: CYCLING_POWER_SERVICE, characteristics: [CYCLING_POWER_MEASUREMENT] },
      ]),
      ['power', 'cadence', 'speed', 'trainer-control'],
    );

    const resolved = await transport.resolvedUuids(TRAINER);

    expect([...resolved].sort()).toEqual([CYCLING_POWER_SERVICE, CYCLING_POWER_MEASUREMENT].sort());
  });

  it('answers nothing when there is no link, rather than refusing', async () => {
    const { transport } = await paired(
      deviceServing([
        { uuid: CYCLING_POWER_SERVICE, characteristics: [CYCLING_POWER_MEASUREMENT] },
      ]),
      ['power'],
    );
    await transport.disconnect(TRAINER);

    await expect(transport.resolvedUuids(TRAINER)).resolves.toEqual([]);
  });

  /**
   * ⚠️ And an id this transport never issued is a refusal rather than an empty
   * answer. Silence there would report a typo as a trainer with no control
   * point, which is the same failure this whole method exists to remove.
   */
  it('refuses an id this transport did not issue', async () => {
    const { transport } = await paired(
      deviceServing([
        { uuid: CYCLING_POWER_SERVICE, characteristics: [CYCLING_POWER_MEASUREMENT] },
      ]),
      ['power'],
    );

    await expect(transport.resolvedUuids(deviceId('never-seen'))).rejects.toBeInstanceOf(
      SensorError,
    );
  });
});
