// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  createIndoorBikeDataProfile,
  createCyclingPowerProfile,
  createCyclingSpeedCadenceProfile,
  heartRateProfile,
} from '@onyourleft/sensors/protocol';
import { createWebBluetoothTransport } from '@onyourleft/sensors/web-bluetooth';
import { metres } from '@onyourleft/domain';
import { athleteId, openActivityStore, recordingSessionId } from '@onyourleft/store';

import './design/theme.css';
import { browserClock, createRideController, type RideController } from './ride/controller';
import { openWebBluetoothTrainer } from './ride/trainer';
import { AppShell } from './shell/AppShell';
import { probeBrowser, type CapabilityProbe } from './support/bluetooth-support';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html is missing the #root element the client mounts into');
}

/**
 * Probed once, here, and passed down.
 *
 * Once because `useBluetoothSupport` takes it as an effect dependency and a new
 * object every render would re-probe forever. Here because this is the entry
 * point: everything below it takes the capabilities as a parameter, which is
 * what makes the Safari, Firefox and Chrome-on-Linux paths reachable from a
 * test on a machine that is none of those.
 */
const capabilities = probeBrowser();

/**
 * The one athlete this device has, until accounts exist.
 *
 * There is no server and no sign-in in Phase 1 (owner decision D6), so every
 * ride belongs to a fixed local identity. It is a **constant rather than a
 * generated id** deliberately: a per-install random id would be written into
 * every activity row, and a cleared browser profile would then orphan every
 * ride already on disk from the athlete who recorded them. #33 introduces real
 * athletes; the store's queries are already scoped by this key, which is what
 * makes that a migration rather than a rewrite.
 */
const LOCAL_ATHLETE = athleteId('local');

/**
 * The wheel circumference a Cycling Speed and Cadence sensor's speed is derived
 * from, in metres.
 *
 * 2.105 m is a 700 × 25c tyre, the most common road setup, and it is a
 * **default rather than a measurement**: a wheel sensor reports revolutions and
 * nothing else, so a rider on 700 × 32c reads about 3% slow until this is
 * configurable. Gear settings are their own issue; a trainer or a GPS-derived
 * speed does not go through this number at all.
 */
const DEFAULT_WHEEL_CIRCUMFERENCE = metres(2.105);

/**
 * Build the ride screen's state machine, or nothing.
 *
 * `undefined` in a browser with no Web Bluetooth — Safari, Firefox, plain HTTP
 * — where every control on that screen would be one that cannot work. #48's
 * first criterion rejects a silently non-functional pairing control, and the
 * `RideView` says so in words instead.
 */
function buildRideController(probe: CapabilityProbe): RideController | undefined {
  if (probe.bluetooth === undefined || !probe.secureContext) {
    return undefined;
  }
  const transport = createWebBluetoothTransport({
    // In preference order, and FTMS first: on a modern trainer it supplies
    // power, cadence and speed from one connection, and `resolveLink` fixes the
    // source per capability at the earliest profile that carries it. Pairing a
    // trainer is then one of about three connections rather than three.
    profiles: [
      createIndoorBikeDataProfile(),
      createCyclingPowerProfile(),
      createCyclingSpeedCadenceProfile({ wheelCircumference: DEFAULT_WHEEL_CIRCUMFERENCE }),
      heartRateProfile,
    ],
    bluetooth: probe.bluetooth,
  });
  return createRideController({
    transport,
    store: openActivityStore(),
    athleteId: LOCAL_ATHLETE,
    // `crypto.randomUUID()` rather than a counter: two tabs recording at once
    // must not collide on a session id, and a counter in a module is per tab.
    newSessionId: () => recordingSessionId(globalThis.crypto.randomUUID()),
    now: browserClock,
    openTrainer: openWebBluetoothTrainer(transport),
  });
}

createRoot(container).render(
  <StrictMode>
    <AppShell capabilities={capabilities} rideController={buildRideController(capabilities)} />
  </StrictMode>,
);
