// SPDX-License-Identifier: AGPL-3.0-or-later

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import {
  createIndoorBikeDataProfile,
  createCyclingPowerProfile,
  createCyclingSpeedCadenceProfile,
  heartRateProfile,
  type GattProfile,
} from '@onyourleft/sensors/protocol';
import { createWebBluetoothTransport } from '@onyourleft/sensors/web-bluetooth';
import { metres, unixSeconds } from '@onyourleft/domain';
import { activityId, openActivityStore, recordingSessionId, routeId } from '@onyourleft/store';

import './design/theme.css';
import { browserClock, createRideController, type RideController } from './ride/controller';
import { openCapacitorTrainer, openWebBluetoothTrainer } from './ride/trainer';
import { gameSensors } from './game/sensors';
import { fastestAttempt, ghostFromSpeed } from './game/ghost-source';
import { isNativeShell, platformCapacitor } from './support/capacitor';
import { AppShell } from './shell/AppShell';
import { browserScreenLockSource, platformWakeLock } from './game/hud/wake-lock';
import type { GamePort, RidableRoute } from './game/GameView';
import type { GhostTrack } from '@onyourleft/domain';
import type { GameRenderer } from './game/port';
import { probeBrowser, type CapabilityProbe } from './support/bluetooth-support';
import { saveWithAnchor, webCryptoDigest } from './transfer/browser';
import { ensureLocalAthlete, LOCAL_ATHLETE, renderAfterAthlete } from './local-athlete';
import type { AnalysisPort } from './analysis/store-port';
import type { EffortPort } from './efforts/store-port';
import type { SegmentPort } from './segments/store-port';
import type { RoutePort } from './routes/store-port';
import type { WorkoutPort } from './workouts/store-port';
import type { DetailPort } from './detail/store-port';
import { browserBasemapConfig } from './map/basemap';
import type { MapPort } from './map/port';
import type { LibraryPort } from './library/store-port';
import type { TransferPort } from './transfer/store-port';

const found = document.getElementById('root');
if (found === null) {
  throw new Error('index.html is missing the #root element the client mounts into');
}
/**
 * The mount point, as a value rather than as a narrowing.
 *
 * `render` below is called from a closure, and TypeScript does not carry the
 * null check above into one — so the element is bound once here instead of
 * being asserted non-null at the call.
 */
const container: HTMLElement = found;

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
/**
 * The profiles, in preference order, shared by both transports.
 *
 * FTMS first: on a modern trainer it supplies power, cadence and speed from one
 * connection, and `resolveLink` fixes the source per capability at the earliest
 * profile that carries it. Pairing a trainer is then one of about three
 * connections rather than three.
 *
 * ⚠️ Hoisted out of `buildRideController` so the browser and the Android shell
 * pair against **the same list**. #39's promise is that one interface is
 * satisfied unchanged by both platforms; two profile lists would make that true
 * of the types and false of the behaviour, and the divergence would show up as
 * "my trainer pairs on the web and not on the phone".
 */
function rideProfiles(): GattProfile[] {
  return [
    createIndoorBikeDataProfile(),
    createCyclingPowerProfile(),
    createCyclingSpeedCadenceProfile({ wheelCircumference: DEFAULT_WHEEL_CIRCUMFERENCE }),
    heartRateProfile,
  ];
}

/**
 * The live ride screen's state machine, on whichever platform this is.
 *
 * ⚠️ **Asynchronous because the Android transport is loaded lazily**, and that
 * is the whole reason `apps/mobile` is no longer dead code. `capacitor.config.ts`
 * points the shell at `apps/web/dist`, so this bundle is what runs on the phone —
 * and until now it had no way to reach the native BLE adapter #87 wrote, so the
 * app could not pair with anything on Android. The `import()` is behind
 * `isNativeShell` so a browser never downloads a line of Capacitor.
 *
 * ⚠️ **Trainer control is deliberately absent on Android, and the screen says
 * so rather than pretending.** `openTrainer` is omitted for the Capacitor
 * transport because `openWebBluetoothTrainer` needs `openFitnessMachine`, which
 * is on `WebBluetoothTransport` and not on `SensorTransport` — driving an FTMS
 * control point through the Capacitor plugin is real work that #87 did not do
 * either. So on a phone a rider can pair, read power, cadence and heart rate,
 * and record; they cannot yet have the trainer's resistance driven for them.
 * `controller.ts` documents that omitting `openTrainer` makes the screen report
 * no controllable trainer, which is the honest state rather than a silent one.
 */
async function buildRideController(probe: CapabilityProbe): Promise<RideController | undefined> {
  const shared = {
    store: localStore(),
    athleteId: LOCAL_ATHLETE,
    // `crypto.randomUUID()` rather than a counter: two tabs recording at once
    // must not collide on a session id, and a counter in a module is per tab.
    newSessionId: () => recordingSessionId(globalThis.crypto.randomUUID()),
    now: browserClock,
    // ⚠️ Without this a recorded ride is checkpointed and then abandoned: it
    // never becomes an activity, so it is absent from the library, the
    // analysis screens, the matcher and export — which is what `finish.ts`
    // records as the "store it" that was missing from §1's milestone.
    rideSave: {
      store: localStore(),
      newActivityId: () => activityId(globalThis.crypto.randomUUID()),
      // Read once, at construction, from the device the ride is ridden on.
      // Stored on the activity so the fitness chart can aggregate to the day
      // the rider actually rode rather than to the day the reader is in.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };

  if (isNativeShell(platformCapacitor())) {
    const mobile = await import('@onyourleft/mobile');
    const plugin = mobile.capacitorBlePort();
    return createRideController({
      ...shared,
      transport: mobile.createCapacitorTransport({
        plugin,
        profiles: rideProfiles(),
        now: browserClock,
      }),
      // ⚠️ The **same** `plugin` object the transport holds, deliberately.
      // Building a second one would give the trainer control path its own
      // subscriptions and its own view of which links are up, and the first
      // symptom would be a setpoint written to a device the transport had
      // already seen disconnect.
      openTrainer: openCapacitorTrainer({
        readMachine: async (deviceId) => mobile.readCapacitorFitnessMachine(plugin, deviceId),
        openChannel: (deviceId) => mobile.createCapacitorFitnessMachineChannel(plugin, deviceId),
      }),
    });
  }

  if (probe.bluetooth === undefined || !probe.secureContext) {
    return undefined;
  }
  const transport = createWebBluetoothTransport({
    profiles: rideProfiles(),
    bluetooth: probe.bluetooth,
  });
  return createRideController({
    ...shared,
    transport,
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
 * The analysis screen's port (#78).
 *
 * Unconditional, like the library's: reading an athlete record, a stream
 * summary and a channel needs no `crypto.subtle` and no secure context. It is a
 * separate port from the detail view's for the reason that one is separate from
 * the library's — `DetailStore` deliberately offers no way to read the athlete
 * record, and `AnalysisStore` deliberately offers no way to read laps or
 * privacy zones. `ActivityStore` satisfies both structurally.
 */
function buildAnalysisPort(): AnalysisPort {
  return { store: localStore(), athleteId: LOCAL_ATHLETE };
}

/**
 * The segments screen's port (#64).
 *
 * Unconditional, like the library's and the analysis screen's: cutting a
 * segment out of a stored ride needs no `crypto.subtle` and no secure context.
 * `crypto.randomUUID` — which `SegmentsView` uses for the new segment's id — is
 * available outside a secure context, unlike `crypto.subtle`, so this screen
 * works from a `file://` bundle where the import screen deliberately does not.
 *
 * A fifth port over the **same** connection, and separate for the reason the
 * other four are: `SegmentStore` offers no way to read a whole stream set, no
 * way to read the athlete record and no way to delete an activity, and
 * `ActivityStore` satisfies every one of them structurally.
 */
function buildSegmentPort(): SegmentPort {
  return { store: localStore(), athleteId: LOCAL_ATHLETE };
}

/**
 * The routes screen's port (#73).
 *
 * Unconditional, like the segments screen's and for the same reasons: importing
 * a GPX route needs no `crypto.subtle` and no secure context — the file is read
 * with `File.text()` and parsed by `packages/fit`, which opens nothing — so
 * this screen works from a `file://` bundle where the import screen (#51)
 * deliberately does not.
 *
 * `RouteStore` names four route methods and one zone read and nothing else, so
 * a screen that lets a rider publish a route cannot reach a ride, a stream or
 * another athlete's anything. `ActivityStore` satisfies it structurally, like
 * the five ports above.
 */
function buildRoutePort(): RoutePort {
  return { store: localStore(), athleteId: LOCAL_ATHLETE };
}

/**
 * The workouts screen's port (#14).
 *
 * Unconditional, like the routes screen's and for the same reason: building a
 * workout needs no `crypto.subtle` and no secure context — nothing is read from
 * a file and nothing is signed — so this screen works from a `file://` bundle.
 *
 * `WorkoutStore` names four workout methods and nothing else, so the screen
 * that builds a session a trainer will ride cannot reach a ride, a stream or
 * another athlete's anything.
 */
function buildWorkoutPort(): WorkoutPort {
  return { store: localStore(), athleteId: LOCAL_ATHLETE };
}

/**
 * The effort-history screen's port (#67).
 *
 * The same store behind a narrower interface: `EffortStore` names five reads
 * and no writes, so the screen that shows a rider their own history cannot
 * alter it. Structural typing is what lets one object satisfy both this and
 * `SegmentStore` without either widening.
 */
function buildEffortPort(): EffortPort {
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
/**
 * The map engine (#63), fetched on first use.
 *
 * A dynamic `import()` rather than a static one, so `maplibre-gl` lands in its
 * own chunk: a rider who only ever opens indoor rides — most rides, in this
 * milestone — never downloads it. `map/maplibre.ts` records the reasoning and
 * `pnpm run build` shows the split.
 */
async function loadMapPort(): Promise<MapPort> {
  return (await import('./map/maplibre')).mapLibrePort;
}

/**
 * The trainer game's renderer (#91), lazily.
 *
 * The same split as `loadMapPort` and for the same reason: `three` is about
 * 600 kB and every rider who never opens the game screen must never download
 * it. `pnpm run build` shows it as its own chunk.
 */
async function loadGameRenderer(): Promise<GameRenderer> {
  return (await import('./game/three-renderer')).threeGameRenderer;
}

/**
 * The trainer game's reads (#85).
 *
 * Unconditional, like the routes and workouts ports: riding a saved route needs
 * no `crypto.subtle` and no secure context, so the game works from a `file://`
 * bundle exactly as the rest of the local milestone does.
 *
 * ⚠️ `loadGhost` is where #93's whole safety property lives, and it is one call:
 * `listRouteAttempts` cannot be queried without an athlete, because its index is
 * `[athleteId+routeId]`. Nothing in `packages/domain/src/ghost/` takes an athlete
 * id at all — the scoping is here, in the read, which is why
 * `activity-store.ghost-scope.test.ts` is the test that guards the patent line
 * rather than anything in the replay code.
 */
function buildGamePort(rideController: RideController | undefined): GamePort {
  const store = localStore();
  return {
    listRoutes: async (): Promise<readonly RidableRoute[]> => {
      const saved = await store.listRoutes(LOCAL_ATHLETE);
      const rows: RidableRoute[] = [];
      for (const route of saved) {
        const attempts = await store.listRouteAttempts(LOCAL_ATHLETE, route.id);
        rows.push({
          id: route.id,
          name: route.name,
          profile: route.profile,
          attempts: attempts.length,
        });
      }
      return rows;
    },
    loadGhost: async (route: string): Promise<GhostTrack | undefined> => {
      // ⚠️ The athlete is what makes this the rider's OWN attempt, and it is not
      // optional: `listRouteAttempts`' index is `[athleteId+routeId]` and cannot
      // be queried without one. Nothing in `packages/domain/src/ghost/` takes an
      // athlete id at all — the scoping lives here, which is why
      // `activity-store.ghost-scope.test.ts` is the test that guards #59's
      // patent line rather than anything in the replay code.
      const attempts = await store.listRouteAttempts(LOCAL_ATHLETE, routeId(route));
      const best = fastestAttempt(
        attempts.map((ride) => ({ id: ride.id, movingSeconds: ride.movingTime })),
      );
      if (best === undefined) {
        return undefined;
      }
      const chosen = activityId(best.id);
      const summary = await store.getStreamSetSummary(LOCAL_ATHLETE, chosen);
      if (summary === undefined) {
        return undefined;
      }
      const speed = await store.getStreamChannel(LOCAL_ATHLETE, chosen, 'speed');
      if (speed === undefined) {
        // A ride with no speed channel — an indoor session recorded from power
        // alone, for instance. There is no distance channel to fall back on
        // (`ghost-source.ts` says why), so there is no ghost, and offering none
        // is better than offering one that stands still.
        return undefined;
      }
      try {
        return ghostFromSpeed({
          sampleIntervalSeconds: summary.sampleInterval,
          speed,
        });
      } catch {
        // `ghost-unusable`: too short, or holed beyond what can honestly be
        // bridged. The rider gets no ghost rather than one built on a guess.
        return undefined;
      }
    },

    // ⚠️ Reads the SAME controller the ride screen reads, rather than opening a
    // second transport. Two transports would mean two pairing flows, two
    // connection budgets against an OS-wide limit of about three, and a rider
    // pairing their trainer twice to use two screens. `gameSensors` is the one
    // translation from the controller's four metric states to the three things
    // the HUD renders — `sensors.ts` records which is which and why the
    // difference matters.
    readSensors: () => gameSensors(rideController?.getSnapshot()),
  };
}

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

async function render(): Promise<void> {
  const rideController = await buildRideController(capabilities);
  createRoot(container).render(
    <StrictMode>
      <AppShell
        capabilities={capabilities}
        rideController={rideController}
        transfer={buildTransferPort()}
        library={buildLibraryPort()}
        detail={buildDetailPort()}
        analysis={buildAnalysisPort()}
        segments={buildSegmentPort()}
        routes={buildRoutePort()}
        workouts={buildWorkoutPort()}
        efforts={buildEffortPort()}
        game={buildGamePort(rideController)}
        gameRenderer={loadGameRenderer}
        screenLock={browserScreenLockSource(platformWakeLock())}
        map={loadMapPort}
        basemap={browserBasemapConfig()}
      />
    </StrictMode>,
  );
}

/**
 * Establish this device's athlete row, then render (#184).
 *
 * The ordering, the swallowed failure and the reasons for both are in
 * `local-athlete.ts` §{@link renderAfterAthlete}, which is where they can be
 * tested — this file is the composition root and has no test, which is exactly
 * how #184 survived four milestones.
 *
 * It awaits one read and at most one write on a connection `buildLibraryPort`
 * opens anyway, so it adds no failure this start-up did not already have.
 */
void renderAfterAthlete(
  async () => ensureLocalAthlete(localStore(), unixSeconds(Math.floor(Date.now() / 1000))),
  render,
);
