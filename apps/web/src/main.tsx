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
import { metres, unixSeconds } from '@onyourleft/domain';
import { activityId, athleteId, openActivityStore, recordingSessionId } from '@onyourleft/store';

import './design/theme.css';
import { browserClock, createRideController, type RideController } from './ride/controller';
import { openWebBluetoothTrainer } from './ride/trainer';
import { AppShell } from './shell/AppShell';
import { probeBrowser, type CapabilityProbe } from './support/bluetooth-support';
import { saveWithAnchor, webCryptoDigest } from './transfer/browser';
import type { DetailPort } from './detail/store-port';
import type { LibraryPort } from './library/store-port';
import type { TransferPort } from './transfer/store-port';

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
 * The tab's one connection to the local database.
 *
 * Lazy and memoised, and both halves matter. **One** because `openActivityStore`
 * opens a Dexie handle on `onyourleft`, and two handles in one tab are two
 * IndexedDB connections that must both be closed before a schema upgrade can
 * run — a `versionchange` a live handle blocks is how a migration hangs a tab
 * rather than failing it. **Lazy** because neither caller reaches this line in a
 * browser that cannot use it, and a module-scope `openActivityStore()` would
 * open a database on Safari, on Firefox and on a page opened from the disk, for
 * two features that render an explanation instead of a control there.
 */
let sharedStore: ReturnType<typeof openActivityStore> | undefined;

function localStore(): ReturnType<typeof openActivityStore> {
  sharedStore ??= openActivityStore();
  return sharedStore;
}

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
    store: localStore(),
    athleteId: LOCAL_ATHLETE,
    // `crypto.randomUUID()` rather than a counter: two tabs recording at once
    // must not collide on a session id, and a counter in a module is per tab.
    newSessionId: () => recordingSessionId(globalThis.crypto.randomUUID()),
    now: browserClock,
    openTrainer: openWebBluetoothTrainer(transport),
  });
}

/**
 * The activity library's port (#62).
 *
 * Unconditional, unlike `buildTransferPort` above: listing rides needs no
 * `crypto.subtle` — that check is there because fingerprinting a file for
 * deduplication does, and it needs a secure context. Reading summaries is a
 * plain IndexedDB read, so a page opened from the disk can still show a rider
 * their history even where importing a file is unavailable.
 *
 * `localStore()` is lazy and memoised, so this shares the one connection with
 * the transfer port and the recorder rather than opening a second.
 */
function buildLibraryPort(): LibraryPort {
  return { store: localStore(), athleteId: LOCAL_ATHLETE };
}

/**
 * The activity detail view's port (#50).
 *
 * A second port over the **same** connection rather than a widening of the
 * library's: `LibraryStore` deliberately offers no way to read a stream, and
 * `DetailStore` deliberately offers no way to read a whole stream *set*. Each
 * screen can reach exactly the reads its own budget allows, and `ActivityStore`
 * satisfies both structurally — so this is one object literal rather than an
 * adapter.
 */
function buildDetailPort(): DetailPort {
  return { store: localStore(), athleteId: LOCAL_ATHLETE };
}

/**
 * Build the import and export screen's port, or nothing.
 *
 * `undefined` where `crypto.subtle` is absent, which is every non-secure
 * context — a bundle opened from the disk as `file://`, or served over plain
 * `http://` on anything but localhost. Deduplication is a SHA-256 of the file's
 * bytes and there is no import worth offering without it, so #48's first
 * criterion applies: no control at all, and the page says why.
 *
 * ⚠️ The zone is this **browser's**, and #26 requires one per ride. That is the
 * right answer for a ride recorded here and a fallback for a ride imported from
 * somewhere else — none of the three formats carries an IANA identifier, so
 * there is nothing better to read. `import-batch.ts`'s `timeZone` records what
 * that costs and why `UTC` is not an improvement on it.
 */
function buildTransferPort(): TransferPort | undefined {
  if (globalThis.crypto?.subtle === undefined) {
    return undefined;
  }
  return {
    store: localStore(),
    athleteId: LOCAL_ATHLETE,
    newActivityId: () => activityId(globalThis.crypto.randomUUID()),
    now: () => unixSeconds(Math.floor(Date.now() / 1000)),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    digest: webCryptoDigest,
    save: saveWithAnchor,
  };
}

createRoot(container).render(
  <StrictMode>
    <AppShell
      capabilities={capabilities}
      rideController={buildRideController(capabilities)}
      transfer={buildTransferPort()}
      library={buildLibraryPort()}
      detail={buildDetailPort()}
    />
  </StrictMode>,
);
