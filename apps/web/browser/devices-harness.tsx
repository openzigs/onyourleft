// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Pairing on the Devices screen, in a real engine — #659.
 *
 * The **real** `shell/AppShell.tsx`, opened at Home, under the **real**
 * `design/theme.css`, handed a **real** ride controller
 * (`ride/controller.ts` §`createRideController`) over the **real** Web
 * Bluetooth transport (`@onyourleft/sensors/web-bluetooth`) — whose
 * `navigator.bluetooth` is the package's own scripted stack
 * (`@onyourleft/sensors/web-bluetooth/testing`), holding a Fitness Machine
 * trainer and a heart rate strap. Nothing between the rider's press and the
 * chooser is this file's: the gesture is the engine's own user activation,
 * which the transport checks, so a pairing control wired to anything but a
 * click would be refused here as it would be in Chrome.
 *
 * `browser/devices.browser.spec.ts` walks it as a new rider does: Home's own
 * link, then *Pair a smart trainer*, then the Ride screen and Home again, which
 * read the connection back through the controller mounted above the router.
 *
 * ## The control
 *
 * `?control=dead-end` renders the same shell with **no ride controller** —
 * which, since #659, is the Devices screen's only state that is a platform able
 * to pair and a page with nothing to pair with: exactly the *"Not built yet"*
 * page #659 was filed against. The same walk must FAIL there. Without it, a
 * walk that found no control and asserted nothing would be green.
 *
 * ## What this page does NOT prove
 *
 * Anything about a real trainer, a real chooser, or the Android shell. The
 * chooser here picks the first device that serves a requested service, and
 * the tablet is where the owner pairs the real one (#659's hardware
 * criterion).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { athleteId, recordingSessionId } from '@onyourleft/store';
import {
  createIndoorBikeDataProfile,
  FITNESS_MACHINE_CONTROL_POINT,
  FITNESS_MACHINE_FEATURE,
  FITNESS_MACHINE_SERVICE,
  FITNESS_MACHINE_STATUS,
  HEART_RATE_MEASUREMENT,
  HEART_RATE_SERVICE,
  heartRateProfile,
  INDOOR_BIKE_DATA,
  SUPPORTED_POWER_RANGE,
  SUPPORTED_RESISTANCE_LEVEL_RANGE,
} from '@onyourleft/sensors/protocol';
import { createWebBluetoothTransport } from '@onyourleft/sensors/web-bluetooth';
import { createFakeBluetooth } from '@onyourleft/sensors/web-bluetooth/testing';

import { stubAnalysis } from '../src/analysis/testing';
import type { RecordingCheckpointStore } from '../src/recording/recorder';
import { browserClock, createRideController } from '../src/ride/controller';
import { openWebBluetoothTrainer } from '../src/ride/trainer';
import { AppShell } from '../src/shell/AppShell';
import { viewGroupsLoaded } from './views-loaded';
import type { CapabilityProbe } from '../src/support/bluetooth-support';

import { STRAP_NAME, TRAINER_NAME } from './devices-fixture';

// The shipping stylesheet, which is the whole point.
import '../src/design/theme.css';

/** What the spec reads back. */
export interface DevicesHarness {
  readonly ready: boolean;
  readonly errors: readonly string[];
  /** Whether this load is the control — the shell with no controller. */
  readonly control: boolean;
  /** How many times the page called `BluetoothDevice.forget()` on each device. */
  readonly forgets: () => { readonly trainer: number; readonly strap: number };
}

declare global {
  interface Window {
    __oylDevices?: DevicesHarness;
  }
}

const ATHLETE = athleteId('harness');
const errors: string[] = [];
const control = new URLSearchParams(window.location.search).get('control') === 'dead-end';

/** 0 W to 2000 W in 5 W steps, and Power Target plus Simulation set. */
const POWER_RANGE = Uint8Array.from([0, 0, 0xd0, 0x07, 5, 0]);
const RESISTANCE_RANGE = Uint8Array.from([0, 0, 200, 0, 5, 0]);
const FEATURE = Uint8Array.from([0x82, 0, 0, 0, 0x08, 0x20, 0, 0]);

const fake = createFakeBluetooth({
  devices: [
    {
      id: 'kickr',
      name: TRAINER_NAME,
      services: [
        {
          uuid: FITNESS_MACHINE_SERVICE,
          characteristics: [
            INDOOR_BIKE_DATA,
            FITNESS_MACHINE_CONTROL_POINT,
            FITNESS_MACHINE_STATUS,
            SUPPORTED_POWER_RANGE,
            SUPPORTED_RESISTANCE_LEVEL_RANGE,
            FITNESS_MACHINE_FEATURE,
          ],
          readValues: {
            [SUPPORTED_POWER_RANGE]: POWER_RANGE,
            [SUPPORTED_RESISTANCE_LEVEL_RANGE]: RESISTANCE_RANGE,
            [FITNESS_MACHINE_FEATURE]: FEATURE,
          },
          properties: { [FITNESS_MACHINE_CONTROL_POINT]: 'indicate' },
        },
      ],
    },
    {
      id: 'strap',
      name: STRAP_NAME,
      services: [{ uuid: HEART_RATE_SERVICE, characteristics: [HEART_RATE_MEASUREMENT] }],
    },
  ],
});

/** Nothing is recorded on this walk, so the checkpoint store holds nothing. */
const checkpoints: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(0),
  listRecordingSessions: () => Promise.resolve([]),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(false),
};

function run(): void {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('devices harness: #shell is missing from devices.html');
  }
  // As `main.tsx` §`buildPlatform` builds it for a browser, with the scripted
  // stack where `navigator.bluetooth` would be.
  const transport = createWebBluetoothTransport({
    profiles: [createIndoorBikeDataProfile(), heartRateProfile],
    bluetooth: fake.bluetooth,
  });
  const capabilities: CapabilityProbe = { bluetooth: fake.bluetooth, secureContext: true };
  let session = 0;
  const rideController = control
    ? undefined
    : createRideController({
        transport,
        store: checkpoints,
        athleteId: ATHLETE,
        newSessionId: () => recordingSessionId(`harness-${String((session += 1))}`),
        now: browserClock,
        openTrainer: openWebBluetoothTrainer(transport),
      });
  window.location.hash = '#/';
  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell
          capabilities={capabilities}
          rideController={rideController}
          // No rides, so Home opens on its getting-started card and its own
          // "Pair a sensor or a smart trainer" link — in the control too.
          analysis={stubAnalysis(ATHLETE, [])}
        />
      </StrictMode>,
    );
  });
}

const forgets = (): { trainer: number; strap: number } => ({
  trainer: fake.bench.device('kickr').forgets,
  strap: fake.bench.device('strap').forgets,
});

// #674: the view groups first, so every view renders on the render that asks. @see viewGroupsLoaded
try {
  await viewGroupsLoaded();
  run();
  window.__oylDevices = { ready: true, errors, control, forgets };
} catch (error: unknown) {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylDevices = { ready: false, errors, control, forgets };
}
