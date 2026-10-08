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
import { createLocalModel } from './analysis/model.ts';
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
   * configured at a local address; `undefined` otherwise. ⚠️ **Nothing calls
   * it yet**: the agent that runs over it (`analysis/agent.ts`, #1098) is
   * started by #1095's job engine, which is not built.
   */
  analysisModel(): ModelConnection | undefined;
  /**
   * The hosted model key (#1097), opened with `OYL_INSTANCE_SECRET_KEY` if it
   * can be — what `analysis/source.ts` §`modelForSource` is handed once the
   * job engine (#1095) calls it. `none` until the store is open.
   */
  hostedModelKey(): Promise<HostedKeyState>;
  /** Resolves once the hosted key's state has been logged at opening. */
  readonly hostedKeyReported: Promise<void>;
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
  let hostedKeyReported: Promise<void> = Promise.resolve();
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
        ...(state.kind === 'unreadable' ? { reason: HOSTED_KEY_UNREADABLE } : {}),
        ...(state.kind === 'no-secret' ? { reason: HOSTED_KEY_NO_SECRET } : {}),
      });
    })().catch((error: unknown) => {
      logUnhandled(log, null, error);
    });
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
      handler = createHandler({ ...handlerOptions, identity, history, rooms });
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
      stopSweeping = () => {
        stopRateLimitSweep();
        stopEndingRooms();
      };
    }
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
    hostedModelKey: async () =>
      store === undefined ? { kind: 'none' } : hostedKeyState(store, await secretKey),
    hostedKeyReported: opened.then(() => hostedKeyReported),
    async stop() {
      stopping = true;
      stopSweeping();
      stopRetrying();
      await router.stop();
      await listening.close();
      await history?.idle();
      await store?.close();
    },
  };
}
