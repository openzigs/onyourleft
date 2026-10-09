// SPDX-License-Identifier: AGPL-3.0-or-later

import { lookup } from 'node:dns/promises';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { createIdentity, type Identity } from './auth/identity.ts';
import { sweepPeriodMs } from './auth/rate-limit.ts';
import { createDiskBlobStore } from './blob/disk-blob-store.ts';
import { identitySettings, type Config } from './config.ts';
import { createHandler, type Handler } from './handler.ts';
import {
  HOSTED_KEY_NO_SECRET,
  HOSTED_KEY_UNREADABLE,
  hostedKeyState,
  importSecretKey,
  type HostedKeyState,
  type SecretKey,
} from './analysis/hosted-key.ts';
import { agentEngine } from './analysis/engine.ts';
import { hostedBehindMasking, readMaskingGuard } from './analysis/hosted.ts';
import {
  ANALYSIS_SWEEP_PERIOD_MS,
  createAnalysisJobs,
  type AnalysisJobs,
} from './analysis/jobs.ts';
import { createLocalModel } from './analysis/model.ts';
import {
  createInstanceKeys,
  InstanceKeysUnavailable,
  type InstanceKeys,
} from './keys/instance-keys.ts';
import type { ModelConnection } from './analysis/model-turn.ts';
import type { Resolver } from './history/address.ts';
import { createOllamaEmbedder } from './history/embedder.ts';
import { createHistory, RETRY_PERIOD_MS, type History } from './history/history.ts';
import { logEvent, logUnhandled, type LogSink } from './log.ts';
import { HttpCounters, renderMetrics } from './metrics.ts';
import { listen, sweepOnBoundaries, type Listening, type SweepTimers } from './node-listener.ts';
import { assessReadiness, type MigrationState } from './readiness.ts';
import type { InstanceProbes } from './route-kit.ts';
import { planFor } from './room/room-plan.ts';
import { RoomRouter, type RoomLookup } from './room/node/router.ts';
import { createRooms, ROOM_SWEEP_PERIOD_MS, type Rooms } from './rooms/rooms.ts';
import { createSealed } from './sealed/sealed.ts';
import type { ServerConfig } from './server-config.ts';
import { MIGRATE_COMMAND, migrationState, openServingStore } from './store/serving.ts';
import type { SqlStore } from './store/sql-store.ts';

/**
 * The running instance, put together (#780, #791): the store opened (never
 * migrated here), the accounts on it, the room router and its workers, the
 * HTTP handler, and the one Node listener that serves both — requests to the
 * handler and room sockets to the router.
 *
 * ## Start-up, and a box coming back from a reboot
 *
 * | The database is… | The instance… |
 * |---|---|
 * | at the head this build expects | opens it and is ready as soon as every room worker is |
 * | being migrated (`migrate` is running) | listens, answers `/health`, and is NOT ready — `/ready` is 503 and every room socket and identity route is refused — until the migration has finished, then opens it |
 * | behind, and nothing is migrating | **refuses to start**, naming the command ({@link InstanceRefusal}) |
 * | ahead (a newer build migrated it) | refuses to start: this build does not know the newer tables |
 *
 * ## Shutdown
 *
 * {@link StartedInstance.stop}: no new socket, every room socket closed
 * `1001 server-stopping`, every result a room worker handed over written, and
 * then the listener and the store closed. `serve.ts` calls it on SIGTERM,
 * which is what Docker sends.
 */

/**
 * Every address a name resolves to, as the operating system's resolver gives
 * them — what the history index's embedding address is checked against on
 * every connection (ADR 0040 D-6).
 */
export const systemResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

/**
 * The longest the instance waits between two passes over its keys (#1189):
 * an hour, so a key the operator rotated from the command line, or a clock
 * that moved, is picked up within it. The rule decides what a pass does; this
 * only bounds how stale its schedule can get.
 */
const KEYS_RETRY_SECONDS = 3600;

/**
 * How soon a key pass tries again when an operator's `instance-key` command
 * holds the key lease (#1203): long enough for the command to finish, which
 * takes milliseconds.
 */
const KEYS_BUSY_RETRY_MS = 5_000;

/** The instance will not start, and says why — with the command that fixes it. */
export class InstanceRefusal extends Error {
  override readonly name = 'InstanceRefusal';
}

export interface InstanceOptions {
  readonly config: Config;
  readonly server: ServerConfig;
  readonly version: string;
  readonly notices: string;
  readonly log: LogSink;
  /** Unix milliseconds. */
  readonly now?: () => number;
  /** How often a waiting instance looks at the migration again. */
  readonly migrationPollMs?: number;
  /** How soon a key pass tries again while the key lease is held elsewhere (#1203): 5 s unless a test says otherwise. */
  readonly keysBusyRetryMs?: number;
  /** How the embedding model's name is resolved: {@link systemResolver} unless a test says otherwise. */
  readonly resolve?: Resolver;
  /** The timers the rate-limit sweep runs on (#892) — Node's own unless a test's. */
  readonly sweepTimers?: SweepTimers;
  /**
   * The countdown a room gets when its own course names none — a race a rider
   * made over HTTP (`rooms.ts` stores `null` for one). Unset, the room core's
   * `DEFAULT_COUNTDOWN_MS` (10 s), which is what a running instance always
   * uses: `serve.ts` never sets this. A test sets it so a race made over HTTP
   * does not wait out ten real seconds before its first tick (#1076); every
   * other part of the countdown — the message, its riders, the start — is the
   * same code at either length.
   */
  readonly defaultCountdownMs?: number;
  /**
   * The endpoint (an ORIGIN) an athlete's own recorded hosted consent names,
   * or `undefined` when they have none — `analysis/source.ts`
   * §`SourceOptions.recordedConsent` (ADR 0046 D-9, Q10). ⚠️ **Nothing records
   * a consent yet: that is #1199**, so `serve.ts` never sets this and every
   * `instance-hosted` job on a running instance — the operator's included —
   * fails `hosted_unavailable` before the key is opened (#1223). A test sets
   * it to run a hosted job end to end; #1199 replaces it with the store's read.
   */
  readonly hostedConsent?: (athleteId: string) => Promise<string | undefined>;
  /** The `fetch` the hosted model is reached through: the platform's unless a test's. */
  readonly hostedFetch?: typeof globalThis.fetch;
}

export interface StartedInstance {
  readonly url: string;
  readonly listening: Listening;
  readonly router: RoomRouter;
  /** Resolves once the store is open and rooms may be admitted. */
  readonly opened: Promise<void>;
  /** How many rate-limit keys — internet addresses among them — the accounts hold now (#892). */
  heldRateLimitKeys(): number;
  /**
   * The analysis model (#1096), once the store is open and when one is
   * configured at a local address; `undefined` otherwise. The job engine
   * (#1095) runs the agent (#1098) over it.
   */
  analysisModel(): ModelConnection | undefined;
  /**
   * The analysis jobs (#1095), once the store is open on an instance with
   * accounts; `undefined` otherwise.
   */
  analysisJobs(): AnalysisJobs | undefined;
  /** Resolves once the jobs a stopped instance left unended have been failed `interrupted`. */
  readonly jobsRecovered: Promise<void>;
  /**
   * The hosted model key (#1097), opened with `OYL_INSTANCE_SECRET_KEY` if it
   * can be — what `analysis/source.ts` §`modelForSource` is handed by the
   * job engine (#1095). `none` until the store is open.
   */
  hostedModelKey(): Promise<HostedKeyState>;
  /** Resolves once the hosted key's state has been logged at opening. */
  readonly hostedKeyReported: Promise<void>;
  /**
   * The instance's own keys (#1189), once the store is open; `undefined`
   * before. What `/v1/sealed` (#1191) unwraps with.
   */
  instanceKeys(): InstanceKeys | undefined;
  /** Resolves once the first pass over the instance's keys has run and been logged. */
  readonly keysMaintained: Promise<void>;
  stop(): Promise<void>;
}

function refusalFor(state: MigrationState, databasePath: string): string | undefined {
  if (state === 'behind') {
    return `The database at ${databasePath} is not migrated to this build. Run \`${MIGRATE_COMMAND}\` first (the deploy's migrate step), then start the instance.`;
  }
  if (state === 'ahead') {
    return `The database at ${databasePath} was migrated by a newer build than this one. Run the newer build, or restore a backup taken before it (docs/operating-an-instance.md).`;
  }
  return undefined;
}

/**
 * Whether `Authorization: Bearer <token>` carries `expected`, compared over
 * every character whatever the first difference, so the time taken says
 * nothing about how much of a guess was right.
 */
export function bearerMatches(authorization: string | null, expected: string | undefined): boolean {
  if (expected === undefined || authorization === null) return false;
  const given = /^Bearer (.+)$/.exec(authorization)?.[1] ?? '';
  let difference = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i += 1) {
    difference |= expected.charCodeAt(i) ^ given.charCodeAt(i % Math.max(1, given.length));
  }
  return difference === 0;
}

export async function startInstance(options: InstanceOptions): Promise<StartedInstance> {
  const { server, log } = options;
  const now = options.now ?? (() => Date.now());
  const path = server.databasePath;
  await mkdir(dirname(path), { recursive: true });

  const initial = await migrationState(path);
  const refused = refusalFor(initial, path);
  if (refused !== undefined) throw new InstanceRefusal(refused);

  let store: SqlStore | undefined;
  let identity: Identity | undefined;
  let history: History | undefined;
  let analysisModel: ModelConnection | undefined;
  let analysisJobs: AnalysisJobs | undefined;
  let jobsRecovered: Promise<void> = Promise.resolve();
  let hostedKeyReported: Promise<void> = Promise.resolve();
  let instanceKeys: InstanceKeys | undefined;
  let keysMaintained: Promise<void> = Promise.resolve();
  let keysTimer: ReturnType<typeof setTimeout> | undefined;
  // Imported once, non-extractable; a failed import is no secret at all.
  const secretKey: Promise<SecretKey | undefined> =
    server.secretKey === undefined
      ? Promise.resolve(undefined)
      : importSecretKey(server.secretKey).catch(() => undefined);
  let rooms: Rooms | undefined;
  /** Stops the rate-limit sweeps, once an identity exists to sweep (#892). */
  let stopSweeping = (): void => undefined;
  let stopRetrying = (): void => undefined;
  let stopping = false;
  const counters = new HttpCounters();

  const lookup = async (roomId: string): Promise<RoomLookup> => {
    if (store === undefined) return { kind: 'unknown' };
    const room = await store.getRoom(roomId);
    if (room === undefined) return { kind: 'unknown' };
    // #784: a rider's room that is over is never opened again — its route is
    // gone, and a group ride that closed would otherwise reopen empty.
    const made = await store.getPrivateRoom(roomId);
    if (made !== undefined && made.closedAt !== null) return { kind: 'ended' };
    const course = await store.getRoomCourse(roomId);
    // The owner's ruling of 2026-09-30: a rider's room is started by its
    // creator alone; a room an operator opened has none (`RaceStarter`).
    const plan = planFor(
      room,
      course,
      made === undefined
        ? 'any-seated-rider'
        : { creator: (await store.getRoomCreator(roomId)) ?? null },
    );
    const started = course?.raceStartedAt !== null && course?.raceStartedAt !== undefined;
    if (plan === undefined) return started ? { kind: 'ended' } : { kind: 'unknown' };
    const timed =
      plan.countdownMs === null && options.defaultCountdownMs !== undefined
        ? { ...plan, countdownMs: options.defaultCountdownMs }
        : plan;
    // Live on a worker, it is rejoined there; on none, the router refuses it.
    return started ? { kind: 'started', plan: timed } : { kind: 'open', plan: timed };
  };

  const router: RoomRouter = new RoomRouter({
    workers: server.roomWorkers,
    worker: {
      compression: server.compression,
      maxBufferedBytes: server.maxBufferedBytes,
      pingIntervalMs: server.pingIntervalMs,
    },
    lookup,
    admit: (roomId, ticket) => identity?.admitterFor(roomId)(ticket),
    onResult: async (roomId, result) => {
      await store?.putResult({ roomId, ...result });
    },
    onRaceStarted: async (roomId) => {
      await store?.markRaceStarted(roomId, Math.floor(now() / 1000));
    },
    // #785: a race's result may be read from here, and not before.
    onRaceFinished: async (roomId) => {
      await store?.markRaceFinished(roomId, Math.floor(now() / 1000));
    },
    // #784: a room that is over lets its route go.
    onRoomClosed: async (roomId, phase) => {
      await rooms?.roomLetGo(roomId, phase);
    },
    ready: (): boolean => store !== undefined && router.healthy(),
    event: (event, detail) => {
      logEvent(log, event, detail);
    },
  });
  await router.start();

  const probes: InstanceProbes = {
    ready: () =>
      assessReadiness({
        database: async () => {
          if (store === undefined) return false;
          await store.getRoom('');
          return true;
        },
        migrations: () => migrationState(path),
        rooms: () => router.healthy(),
      }),
    ...(server.metrics && server.metricsToken !== undefined
      ? {
          metrics: async (authorization: string | null) => {
            if (!bearerMatches(authorization, server.metricsToken)) return undefined;
            const workers = await router.metrics();
            return renderMetrics(workers, counters);
          },
        }
      : {}),
    startRoom: async (roomId, athleteId) =>
      (await router.startRoom(roomId, athleteId)) ? 'started' : 'not_found',
  };

  const handlerOptions = {
    config: options.config,
    version: options.version,
    notices: options.notices,
    log,
    probes,
    observe: (route: string | null, status: number, code: string | undefined) => {
      counters.observe(route, status, code);
    },
  };
  // Until the store is open the handler has no accounts; it is replaced, not
  // mutated, once it does, so no request ever sees half of either.
  let handler: Handler = createHandler(handlerOptions);
  const listening = await listen((request, client) => handler(request, client), {
    host: options.config.host,
    port: options.config.port,
    clientAddressHeader: options.config.clientAddressHeader,
    trustedProxies: options.config.trustedProxies,
  });
  listening.server.on('upgrade', (request, socket, head) => {
    if (!router.upgrade(request, socket, head)) socket.destroy();
  });

  const open = (): void => {
    store = openServingStore(path);
    // The history index (#835, ADR 0040). Off, and saying why, when no local
    // embedding model is configured; the rest of the instance does not care.
    const settings = options.config.history;
    history = createHistory({
      store,
      embedder:
        settings.kind === 'on'
          ? createOllamaEmbedder({
              settings: settings.embedding,
              resolve: options.resolve ?? systemResolver,
            })
          : undefined,
      log,
      now,
    });
    logEvent(
      log,
      'history-index',
      settings.kind === 'on'
        ? { state: 'on', model: settings.embedding.model }
        : { state: 'off', code: settings.code },
    );
    // The analysis model (#1096, ADR 0046 D-9 source 1): off, and saying why,
    // when no local model is configured. Its address is checked again on
    // every turn (`analysis/model.ts`); no model name is logged.
    const analysis = options.config.analysis;
    analysisModel =
      analysis.kind === 'on'
        ? createLocalModel({ settings: analysis, resolve: options.resolve ?? systemResolver })
        : undefined;
    logEvent(
      log,
      'analysis-model',
      analysis.kind === 'on' ? { state: 'on' } : { state: 'off', code: analysis.code },
    );
    // The hosted model key (#1097): whether one is held, and whether this
    // secret opens it. A key that will not open — a restore onto a box with
    // another secret — is SAID, never a crash: the hosted source is then
    // unavailable, and the local model, or none, is all there is. Never the
    // key, its URL or its model.
    const opened = store;
    hostedKeyReported = (async () => {
      const state = await hostedKeyState(opened, await secretKey);
      logEvent(log, 'hosted-model-key', {
        state: state.kind,
        ...(state.kind === 'unreadable' ? { hostedKeyProblem: HOSTED_KEY_UNREADABLE } : {}),
        ...(state.kind === 'no-secret' ? { hostedKeyProblem: HOSTED_KEY_NO_SECRET } : {}),
      });
    })().catch((error: unknown) => {
      logUnhandled(log, null, error);
    });
    // The instance's own keys (#1189, ADR 0047 D-5): made on the first start
    // with a secret, rotated, re-signed and pruned by the one rule
    // `keys/instance-keys.ts` states — run now, before `/v1/instance/keys`
    // answers (it waits on this first pass), and again whenever the rule
    // says the next step falls due, by the box's clock. A pass holds the key
    // lease while it writes, so an operator's `instance-key` command and this
    // timer are never two writers at once (#1203); a pass that finds the
    // lease held tries again in a few seconds. No secret: no keys, and it
    // says so.
    const keys = createInstanceKeys({
      store,
      secret: server.secretKey,
      origin: server.origin,
      now: () => Math.floor(now() / 1000),
      log,
    });
    instanceKeys = keys;
    const maintainKeys = async (): Promise<void> => {
      if (stopping) return;
      let wakeInSeconds = KEYS_RETRY_SECONDS;
      let busy = false;
      try {
        const done = await keys.maintain();
        logEvent(log, 'instance-keys', {
          state: 'ready',
          made: done.made,
          rotated: done.rotated,
          signed: done.signed,
          deleted: done.deleted,
        });
        wakeInSeconds = done.nextDueAt - Math.floor(now() / 1000);
      } catch (error) {
        if (error instanceof InstanceKeysUnavailable) {
          logEvent(log, 'instance-keys', { state: error.code, keysProblem: error.message });
          busy = error.code === 'busy';
          if (!busy && error.code !== 'unreadable') return;
        } else {
          logUnhandled(log, null, error);
        }
      }
      if (stopping) return;
      const delayMs = busy
        ? (options.keysBusyRetryMs ?? KEYS_BUSY_RETRY_MS)
        : 1000 * Math.min(KEYS_RETRY_SECONDS, Math.max(1, wakeInSeconds));
      keysTimer = setTimeout(() => {
        keysMaintained = maintainKeys();
      }, delayMs);
      keysTimer.unref();
    };
    keysMaintained = maintainKeys();
    if (server.origin !== null) {
      identity = createIdentity({
        store,
        origin: server.origin,
        ...identitySettings(options.config),
        now,
      });
      // #784, #785: riders' rooms. Their routes are kept apart from the
      // synced files — under the blob directory's `rooms/` — and live only as
      // long as their room (`rooms/rooms.ts`), so a backup does not carry them.
      const people = identity;
      rooms = createRooms({
        store,
        routes: createDiskBlobStore(join(server.blobsPath, 'rooms')),
        nameFor: async (viewerId, subjectId) => {
          if (!(await people.moderation.canSee(viewerId, subjectId))) return undefined;
          const profile = await people.profile(subjectId);
          return profile.ok ? profile.value.displayName : undefined;
        },
        now,
      });
      // The identity's rate limits hold internet addresses; the privacy
      // policy says for at most an hour. Each window's keys are forgotten on
      // the boundary it ends on, whether or not anybody asks again (#892).
      // The rooms' join limit is keyed by address too (#784), under the same
      // promise, so ONE sweep runs both, on every boundary either's windows end.
      const swept = identity;
      const roomsSwept = rooms;
      // #784: rooms that are over and that no worker closed — nobody riding a
      // day after they were made, a race a restart interrupted, a creator who
      // is gone — end here and let their routes go. Once now, for whatever a
      // restart left, and every ten minutes after.
      const endRooms = (): void => {
        void roomsSwept
          .sweep((roomId) => router.holds(roomId))
          .catch((error: unknown) => {
            logEvent(log, 'rooms-sweep-failed', {
              error: error instanceof Error ? error.name : 'unknown',
            });
          });
      };
      endRooms();
      const stopEndingRooms = sweepOnBoundaries(
        { periodMs: ROOM_SWEEP_PERIOD_MS, run: endRooms },
        options.sweepTimers,
      );
      const stopRateLimitSweep = sweepOnBoundaries(
        {
          periodMs: sweepPeriodMs([
            { limit: 1, windowMs: swept.rateLimitSweepPeriodMs },
            { limit: 1, windowMs: roomsSwept.rateLimitSweepPeriodMs },
          ]),
          run: () => {
            swept.sweepRateLimits();
            roomsSwept.sweepRateLimits();
          },
        },
        options.sweepTimers,
      );
      // #1095: analysis jobs, on the accounts' sessions. Off — every start
      // `analysis_off` — while the instance has no model and holds no hosted
      // key. A job a stopped instance left unended is failed `interrupted`
      // before any new one is queued, and is never run again.
      const reading = store;
      const hostedKey = async (): Promise<HostedKeyState> =>
        hostedKeyState(reading, await secretKey);
      const local = analysisModel;
      const jobs = createAnalysisJobs({
        store,
        engine: agentEngine({
          reads: store,
          sources: {
            local,
            hostedKey,
            ...(options.hostedConsent === undefined
              ? {}
              : { recordedConsent: options.hostedConsent }),
            // #1223: every hosted request masked by the athlete's own guard (#1101).
            guard: (athleteId) => readMaskingGuard(reading, athleteId),
            behindMasking: (key, guard) => hostedBehindMasking(key, guard, options.hostedFetch),
          },
          clock: { now },
        }),
        available: async () => local !== undefined || (await hostedKey()).kind === 'held',
        now,
        log,
        heartbeatMs: server.analysisHeartbeatMs,
      });
      analysisJobs = jobs;
      jobsRecovered = jobs.recover().then(
        () => undefined,
        (error: unknown) => {
          logUnhandled(log, null, error);
        },
      );
      // Ended jobs go seven days after they ended (the owner's Q5 ruling), and
      // the start limit's ended windows with them: once now, and every hour.
      const sweepJobs = (): void => {
        void jobs.sweep().catch((error: unknown) => {
          logUnhandled(log, null, error);
        });
      };
      sweepJobs();
      const stopSweepingJobs = sweepOnBoundaries(
        { periodMs: ANALYSIS_SWEEP_PERIOD_MS, run: sweepJobs },
        options.sweepTimers,
      );
      stopSweeping = () => {
        stopRateLimitSweep();
        stopEndingRooms();
        stopSweepingJobs();
      };
    }
    // Replaced, not mutated (above): the accounts when there is an origin, and
    // the instance's keys whatever there is.
    handler = createHandler({
      ...handlerOptions,
      instanceKeys: keys,
      // #1191: sealed requests need the accounts, so they come with them.
      ...(identity === undefined
        ? {}
        : {
            identity,
            history,
            rooms,
            sealed: createSealed({ store, now }),
            ...(analysisJobs === undefined ? {} : { analysis: analysisJobs }),
          }),
    });
    // Whatever was synced while the model was off, or under another model, is indexed now (D-7).
    history.schedule();
    // And again every few minutes, so a model started after the instance —
    // or one that went away and came back — is picked up with no sync and no
    // restart, and an item it refused is tried again once its hour is up (#918).
    if (settings.kind === 'on') {
      const indexer = history;
      stopRetrying = sweepOnBoundaries(
        {
          periodMs: RETRY_PERIOD_MS,
          run: () => {
            indexer.schedule();
          },
        },
        options.sweepTimers,
      );
    }
    logEvent(log, 'ready', {
      identity: identity !== undefined,
      registration: options.config.registration,
      workers: server.roomWorkers,
      compression: server.compression,
      metrics: server.metrics,
    });
  };

  let opened: Promise<void>;
  if (initial === 'at-head') {
    open();
    opened = Promise.resolve();
  } else {
    // `migrating`: wait for the deploy's migrate step, answering /health meanwhile.
    logEvent(log, 'waiting', { state: 'migrating', command: MIGRATE_COMMAND });
    opened = new Promise<void>((done) => {
      const poll = async (): Promise<void> => {
        if (stopping) return;
        const state = await migrationState(path).catch((): MigrationState => 'migrating');
        // `stop()` may have run while the state was being read: opening now
        // would open a store and start a rate-limit sweep that nothing stops
        // (#892's merge review).
        if (stopping) return;
        if (state === 'at-head') {
          open();
          done();
          return;
        }
        if (state !== 'migrating') {
          // The migration finished without reaching this build's head: it failed.
          logEvent(log, 'refusing', { state, command: MIGRATE_COMMAND });
        }
        setTimeout(() => void poll(), options.migrationPollMs ?? 1_000).unref();
      };
      void poll();
    });
  }

  return {
    url: listening.url,
    listening,
    router,
    opened,
    heldRateLimitKeys: () =>
      (identity?.heldRateLimitKeys() ?? 0) + (rooms?.heldRateLimitKeys() ?? 0),
    analysisModel: () => analysisModel,
    analysisJobs: () => analysisJobs,
    jobsRecovered: opened.then(() => jobsRecovered),
    hostedModelKey: async () =>
      store === undefined ? { kind: 'none' } : hostedKeyState(store, await secretKey),
    hostedKeyReported: opened.then(() => hostedKeyReported),
    instanceKeys: () => instanceKeys,
    keysMaintained: opened.then(() => keysMaintained),
    async stop() {
      stopping = true;
      if (keysTimer !== undefined) clearTimeout(keysTimer);
      stopSweeping();
      stopRetrying();
      await analysisJobs?.stop();
      await router.stop();
      await listening.close();
      await history?.idle();
      await store?.close();
    },
  };
}
