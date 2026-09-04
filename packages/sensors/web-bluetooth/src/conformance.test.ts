// SPDX-License-Identifier: Apache-2.0

/**
 * The transport conformance suite, pointed at this adapter.
 *
 * #44's fifth acceptance criterion asks that the suite *"can be pointed at a
 * real device as well as the simulator, so a contributor with hardware can run
 * it and report a diff"*. This is the second point on that line: the same
 * `describeTransportConformance` that
 * `packages/sensors/src/transport-conformance.test.ts` runs against the
 * simulator, run against the Web Bluetooth adapter with a scripted stack
 * underneath it. A line that is red here and green there is the diff the
 * criterion is for — and it is what makes #40's first acceptance criterion
 * ("satisfies the #39 interface with **no changes to that interface**")
 * something a test can hold rather than a claim in a pull request.
 *
 * `settle` drives the fake device's notifications rather than waiting: one
 * notification per simulated second, which is the rate every profile in this
 * program uses.
 */

import type { Seconds } from '@onyourleft/domain';

import { describeTransportConformance } from '../../src/simulator/conformance';

import { createWebBluetoothTransport } from './transport';
import { createFakeBluetooth } from './testing/fake-bluetooth';
import {
  multiFrame,
  STUB_MULTI_CHARACTERISTIC,
  STUB_MULTI_SERVICE,
  stubHeartRateProfile,
  stubMultiProfile,
  stubSingleProfile,
  stubTrainerDevice,
} from './testing/profiles';

describeTransportConformance('the Web Bluetooth adapter', {
  create() {
    const fake = createFakeBluetooth({ devices: [stubTrainerDevice()] });
    const transport = createWebBluetoothTransport({
      profiles: [stubMultiProfile, stubSingleProfile, stubHeartRateProfile],
      bluetooth: fake.bluetooth,
      hasUserActivation: () => true,
    });
    let tick = 0;
    return Promise.resolve({
      transport,
      // Not heart rate: the trainer serves no strap service, so a device that
      // declared it would be a device the suite could then not deliver it for.
      // That is the honest statement of what this fixture is.
      request: { capabilities: ['power', 'cadence', 'speed'] as const },
      settle: (duration: Seconds) => {
        const trainer = fake.bench.device('stub-trainer');
        for (let second = 0; second < duration; second += 1) {
          tick += 1;
          trainer.notify(
            STUB_MULTI_SERVICE,
            STUB_MULTI_CHARACTERISTIC,
            multiFrame(150 + (tick % 50), 80 + (tick % 10), 90),
          );
        }
        return Promise.resolve();
      },
    });
  },
});
