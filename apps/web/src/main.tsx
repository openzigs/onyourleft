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
import {
  activityId,
  openActivityStore,
  recordingSessionId,
  routeId,
  type AthleteRecord,
} from '@onyourleft/store';

import './design/theme.css';
import {
  browserClock,
  createRideController,
  rideInProgress,
  type RideController,
} from './ride/controller';
import { openCapacitorTrainer, openWebBluetoothTrainer } from './ride/trainer';
import { gameSensors } from './game/sensors';
import { fastestAttempt, ghostFromSpeed } from './game/ghost-source';
import { isNativeShell, platformCapacitor } from './support/capacitor';
import { platformServiceWorkerContainer, registerServiceWorker } from './offline/register';
import {
  createUpdateWatcher,
  platformControllerChanges,
  type UpdateWatcher,
} from './offline/update';
import { AppShell } from './shell/AppShell';
import { browserScreenLockSource, platformWakeLock } from './game/hud/wake-lock';
import type { GamePort, RidableRoute } from './game/GameView';
import { gameTrainerFrom, type GameTrainerPort } from './game/trainer-port';
import type { GhostTrack } from '@onyourleft/domain';
import type { GameRenderer } from './game/port';
import { probeBrowser, type CapabilityProbe } from './support/bluetooth-support';
import { capacitorShellSupport } from './support/shell-support';
import { platformStorage, requestPersistenceOnce } from './support/persistent-storage';
import type { ShellSupportPort } from './support/shell-support-port';
import { saveWithAnchor, webCryptoDigest } from './transfer/browser';
import { browserDraftStorage } from './routing/draft-storage';
import {
  ensureLocalAthlete,
  LOCAL_ATHLETE,
  localAthleteRecord,
  renderAfterAthlete,
} from './local-athlete';
import type { AnalysisPort } from './analysis/store-port';
import type { EffortPort } from './efforts/store-port';
import type { MatchPort } from './segments/match-port';
import type { SegmentPort } from './segments/store-port';
import type { RoutePort } from './routes/store-port';
import type { WorkoutPort } from './workouts/store-port';
import type { DetailPort } from './detail/store-port';
import { browserBasemapConfig } from './map/basemap';
import type { MapPort } from './map/port';
import type { LibraryPort } from './library/store-port';
import type { TransferPort } from './transfer/store-port';
import type { UnitsPort } from './units/store-port';
import type { AthleteMassPort } from './athlete/store-port';

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
 * ⚠️ Hoisted out of `buildPlatform` so the browser and the Android shell
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
 * What this platform gives the client: a ride screen, and — inside the Android
 * shell — the Devices screen's own answer about Bluetooth (#284).
 *
 * The two are built together because they must share **one** transport. A
 * second one would mean a second plugin initialisation, a second permission
 * prompt, and two views of which links are up against an OS-wide budget of
 * about three connections. It also means a permission granted from the Devices
 * screen is granted for pairing, because `ensureInitialized` is memoised per
 * transport and this is the same transport.
 */
interface ClientPlatform {
  readonly rideController: RideController | undefined;
  /** `undefined` in a browser, where `DevicesView` reads {@link capabilities}. */
  readonly shell: ShellSupportPort | undefined;
}

/**
 * The live ride screen's state machine, on whichever platform this is — and,
 * on Android, the Devices screen's read of the same transport (#284).
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
async function buildPlatform(probe: CapabilityProbe): Promise<ClientPlatform> {
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
      // #232: a file the rider decides was a course after all. A separate
      // generator rather than a cast, for the reason `store-port.ts` gives.
      newRouteId: () => routeId(globalThis.crypto.randomUUID()),
      // Read once, at construction, from the device the ride is ridden on.
      // Stored on the activity so the fitness chart can aggregate to the day
      // the rider actually rode rather than to the day the reader is in.
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };

  if (isNativeShell(platformCapacitor())) {
    const mobile = await import('@onyourleft/mobile');
    const plugin = mobile.capacitorBlePort();
    const transport = mobile.createCapacitorTransport({
      plugin,
      profiles: rideProfiles(),
      now: browserClock,
    });
    // ⚠️ #284. `permissionNotice` and `mayShowDeviceList` are #87's answer to
    // "what does a rider see when Bluetooth will not work", and until this line
    // nothing in `apps/web` imported either of them — so the Devices screen
    // reported the WebView's Web Bluetooth verdict about a stack this build
    // does not use. They are passed rather than imported by the module that
    // uses them so that a browser downloads no line of `@onyourleft/mobile`,
    // which is the same reason this whole branch is behind an `import()`.
    const shell = capacitorShellSupport({
      availability: async () => transport.availability(),
      notice: mobile.permissionNotice,
      mayShowDeviceList: mobile.mayShowDeviceList,
    });
    const rideController = createRideController({
      ...shared,
      transport,
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
    return { rideController, shell };
  }

  if (probe.bluetooth === undefined || !probe.secureContext) {
    return { rideController: undefined, shell: undefined };
  }
  const browserTransport = createWebBluetoothTransport({
    profiles: rideProfiles(),
    bluetooth: probe.bluetooth,
  });
  return {
    rideController: createRideController({
      ...shared,
      transport: browserTransport,
      openTrainer: openWebBluetoothTrainer(browserTransport),
    }),
    // No port, which is what puts `DevicesView` on the browser probe. The
    // absence is the decision, taken here, in the one file that may read a
    // global.
    shell: undefined,
  };
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
 * The segment matcher's sweep (#66), wired by #282.
 *
 * ⚠️ **This port is the whole of #282.** Everything under it — the matcher, the
 * resumable sweep, `putActivityEfforts`, the match checkpoint — was built,
 * tested and green, and `main.tsx` never constructed one, so no segment effort
 * had ever been written and the effort screens read a table only a test filled.
 * #278's wiring gate is what found it; `segments/sweep.ts` is the driver this
 * hands the store to.
 *
 * A sixth port over the **same** connection, and separate from
 * {@link buildSegmentPort} for the reason the others are separate: `MatchStore`
 * is the only one in this client that may write an effort or touch the sweep's
 * cursor, and `SegmentStore` is the only one that may create a segment. Neither
 * can reach a whole stream set, and `ActivityStore` satisfies both
 * structurally.
 */
function buildMatchPort(): MatchPort {
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
  const renderer = await import('./game/three-renderer');
  // ⚠️ **Awaited here, and this is the only place it can be.** #341's scenery
  // models are files, and `GameRenderer.create` is synchronous because
  // `port.ts` says it is — so the shapes have to be in hand before the first
  // view is built, and this is the one seam between "the renderer module
  // arrived" and "a view exists". A `create` that raced the load would draw a
  // world of primitives and report success, which is exactly the shape
  // `three-renderer.ts` §`sceneryGeometries` warns about.
  await renderer.loadSceneryModels();
  return renderer.threeGameRenderer;
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

/**
 * The trainer the game sends the road to (#362).
 *
 * ⚠️ **This port is the whole of #362.** `packages/domain`'s
 * `createSimulationDriver` and `packages/sensors/protocol`'s
 * `createSimulationWriter` were both written for #90, both unit-tested, both
 * green — and nothing under `apps/` named either, so the trainer game computed
 * a gradient, drew the hill, put the number on the HUD and never told the
 * trainer. A whole ride on Android produced 252 inbound Indoor Bike Data
 * notifications and zero writes.
 *
 * ⚠️ **The SAME controller `buildGamePort` reads**, deliberately. A second
 * transport would be a second pairing flow and a second view of which links are
 * up against an OS-wide budget of about three connections — and the first
 * symptom would be a gradient written to a device the transport had already
 * seen disconnect. It is also why a rider pairs their trainer once, on the Ride
 * screen, and the game finds it.
 *
 * ⚠️ **`undefined` where there is no ride controller at all** — Safari,
 * Firefox, a page served over plain HTTP. The absence is the decision, taken
 * here, and `trainer-port.ts` §`gameTrainerFrom` turns the states a present
 * controller can be in into the sentences a rider is told.
 *
 * ⚠️ **The snapshot's `workout` is read here too**, because a workout already
 * holds the one control point the machine has. `simulationControl()` refuses
 * the handle and this supplies the sentence that goes with the refusal; see
 * `trainer-port.ts` §`GameTrainerKind` member `workout`.
 */
function buildGameTrainerPort(controller: RideController | undefined): GameTrainerPort {
  return {
    readTrainer: () => {
      // One snapshot read for both answers, so the workout state and the
      // trainer state cannot be a tick apart.
      const snapshot = controller?.getSnapshot();
      return gameTrainerFrom(
        snapshot?.trainer,
        controller?.simulationControl(),
        snapshot?.workout !== undefined,
      );
    },
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
    // #232: a file the rider decides was a course after all. A separate
    // generator rather than a cast, for the reason `store-port.ts` gives.
    newRouteId: () => routeId(globalThis.crypto.randomUUID()),
    now: () => unixSeconds(Math.floor(Date.now() / 1000)),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    digest: webCryptoDigest,
    save: saveWithAnchor,
    drafts: browserDraftStorage(typeof localStorage === 'undefined' ? undefined : localStorage),
    athleteRow: localAthleteRecord(unixSeconds(Math.floor(Date.now() / 1000))),
  };
}

/**
 * The settings screen's one write (#238).
 *
 * A ninth port over the same connection, and narrow for the reason the others
 * are: `UnitsStore` names one method, so a screen that lets a rider choose
 * kilometres or miles cannot reach a ride, a stream or another athlete's
 * anything.
 */
function buildUnitsPort(): UnitsPort {
  return { store: localStore(), athleteId: LOCAL_ATHLETE };
}

/**
 * The settings screen's other write: what the rider weighs (#325).
 *
 * A tenth port over the same connection, and separate from
 * {@link buildUnitsPort} for the reason `athlete/store-port.ts` gives.
 *
 * ⚠️ **This port is the whole of #325's sixth criterion.** `AthleteRecord.mass`
 * had been migrated since schema 6 and read by two consumers, and nothing in
 * this client had ever constructed a way to write one — so the game's new read
 * of it would have found `undefined` on every device for ever, and the fix
 * would have been indistinguishable from the defect.
 */
function buildAthleteMassPort(): AthleteMassPort {
  return { store: localStore(), athleteId: LOCAL_ATHLETE };
}

/**
 * Watch for a new version of the app, or not (#407).
 *
 * `undefined` wherever `registerServiceWorker` did not register one — inside
 * the Android shell (ADR 0024 D-4), and in any browser without a
 * `serviceWorker` — because there is no worker that could ever be waiting and
 * a watcher over nothing would be a control that can never fire.
 *
 * ⚠️ **The ride controller is handed in as the interlock**, which is the whole
 * of ADR 0024 D-3 rule 3: activation ends in a page reload, and a ride is the
 * one thing in this app a rider cannot redo. `rideInProgress` is the one place
 * that decides what "in progress" means, so the unload guard and this cannot
 * disagree about a paused ride.
 */
function buildUpdateWatcher(
  registered: Awaited<ReturnType<typeof registerServiceWorker>>,
  rideController: RideController | undefined,
): UpdateWatcher | undefined {
  const changes = platformControllerChanges();
  if (registered.kind !== 'registered' || changes === undefined) {
    return undefined;
  }
  return createUpdateWatcher({
    registration: registered.registration,
    controllerChanges: changes,
    recording:
      rideController === undefined
        ? undefined
        : {
            inProgress: () => rideInProgress(rideController.getSnapshot().phase),
            subscribe: (listener) => rideController.subscribe(listener),
          },
    reload: () => {
      globalThis.location.reload();
    },
  });
}

async function render(athlete: AthleteRecord | undefined): Promise<void> {
  const platform = await buildPlatform(capabilities);
  const rideController = platform.rideController;
  const registered = await workerRegistration;
  const update = buildUpdateWatcher(registered, rideController);
  if (registered.kind === 'registered') {
    // ⚠️ **Only once a worker registered, and ADR 0024 D-5 is why**: Chrome
    // grants persistence silently on a heuristic that includes the site having
    // been installed, which needs the manifest (#405) AND this worker (#406) —
    // so the request is made at the moment it has a chance of being granted
    // rather than on every load of every browser. In a browser that has no
    // service worker at all, `persist()` is a permission prompt arriving out of
    // nowhere, and the rides there stay on the best-effort tier with the
    // Settings panel saying so.
    //
    // Not awaited: a rider waits for no permission before the first paint, and
    // `requestPersistence` resolves on every path rather than rejecting.
    void requestPersistenceOnce(platformStorage());
  }
  createRoot(container).render(
    <StrictMode>
      <AppShell
        capabilities={capabilities}
        {...(update === undefined ? {} : { update })}
        {...(platformStorage() === undefined ? {} : { storage: platformStorage() })}
        {...(platform.shell === undefined ? {} : { shell: platform.shell })}
        settings={buildUnitsPort()}
        athleteMass={buildAthleteMassPort()}
        // ⚠️ The **stored** mass, read before the first paint, and passed on
        // undefaulted: `athlete/mass.ts` is the one place a missing one is
        // substituted, and a default applied here would be a second.
        {...(athlete?.mass === undefined ? {} : { riderMass: athlete.mass })}
        // ⚠️ The **stored** preference, read before the first paint. The
        // fallback is `DEFAULT_UNIT_SYSTEM` and it is applied in exactly one
        // place — `AppShell`'s own default — so "a row with no setting" and "no
        // row at all" read the same, which is what they mean.
        {...(athlete?.units === undefined ? {} : { units: athlete.units })}
        rideController={rideController}
        transfer={buildTransferPort()}
        library={buildLibraryPort()}
        detail={buildDetailPort()}
        analysis={buildAnalysisPort()}
        segments={buildSegmentPort()}
        match={buildMatchPort()}
        routes={buildRoutePort()}
        workouts={buildWorkoutPort()}
        efforts={buildEffortPort()}
        game={buildGamePort(rideController)}
        gameTrainer={buildGameTrainerPort(rideController)}
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
/**
 * Register the service worker, so a cold start with the network off renders
 * the app (#406).
 *
 * ⚠️ **A literal import and a direct call, on purpose.** `check:wiring` cannot
 * see a call made through a string key or a non-literal dynamic import
 * (`scripts/check-wiring.mjs` §Limits), so routing this through either and
 * reading a green gate as proof it is wired would be exactly the false pass
 * #278 exists to catch. Deleting this call turns `check:wiring` red.
 *
 * ⚠️ **Started here and awaited only inside `render`**, which is already
 * asynchronous. The app has worked with no worker since it existed and must
 * carry on doing so — registration is an improvement to a *later* visit, never
 * a precondition for this one — and `registerServiceWorker` resolves on every
 * path rather than rejecting, so awaiting it cannot fail a start-up. What the
 * outcome is needed for is #407: a registration is what an update watcher
 * watches, and `RegistrationOutcome.failed` is what a future notice would
 * read.
 *
 * `import.meta.env.BASE_URL` rather than `/`: the worker's scope is the base
 * path this build was compiled for, so a deployment under a subdirectory
 * registers a worker that controls its own subtree and not the whole origin.
 */
const workerRegistration = registerServiceWorker({
  container: platformServiceWorkerContainer(),
  // ⚠️ ADR 0024 D-4. Asked through the one function in this client that
  // answers it, so the worker and the BLE transport cannot disagree about
  // which platform this is.
  nativeShell: isNativeShell(platformCapacitor()),
  script: `${import.meta.env.BASE_URL}sw.js`,
  scope: import.meta.env.BASE_URL,
});

void renderAfterAthlete(
  async () => ensureLocalAthlete(localStore(), unixSeconds(Math.floor(Date.now() / 1000))),
  render,
);
