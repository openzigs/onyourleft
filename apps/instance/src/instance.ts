// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { createIdentity, type Identity } from './auth/identity.ts';
import { identitySettings, type Config } from './config.ts';
import { createHandler, type Handler } from './handler.ts';
import { logEvent, type LogSink } from './log.ts';
import { HttpCounters, renderMetrics } from './metrics.ts';
import { listen, sweepOnBoundaries, type Listening, type SweepTimers } from './node-listener.ts';
import { assessReadiness, type MigrationState } from './readiness.ts';
import type { InstanceProbes } from './route-kit.ts';
import { planFor } from './room/room-plan.ts';
import { RoomRouter, type RoomLookup } from './room/node/router.ts';
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
  /** The timers the rate-limit sweep runs on (#892) — Node's own unless a test's. */
  readonly sweepTimers?: SweepTimers;
}

export interface StartedInstance {
  readonly url: string;
  readonly listening: Listening;
  readonly router: RoomRouter;
  /** Resolves once the store is open and rooms may be admitted. */
  readonly opened: Promise<void>;
  /** How many rate-limit keys — internet addresses among them — the accounts hold now (#892). */
  heldRateLimitKeys(): number;
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
  /** Stops the rate-limit sweep, once an identity exists to sweep (#892). */
  let stopSweeping = (): void => undefined;
  let stopping = false;
  const counters = new HttpCounters();

  const lookup = async (roomId: string): Promise<RoomLookup> => {
    if (store === undefined) return { kind: 'unknown' };
    const room = await store.getRoom(roomId);
    if (room === undefined) return { kind: 'unknown' };
    const course = await store.getRoomCourse(roomId);
    const plan = planFor(room, course);
    const started = course?.raceStartedAt !== null && course?.raceStartedAt !== undefined;
    if (plan === undefined) return started ? { kind: 'ended' } : { kind: 'unknown' };
    // Live on a worker, it is rejoined there; on none, the router refuses it.
    return started ? { kind: 'started', plan } : { kind: 'open', plan };
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
    if (server.origin !== null) {
      identity = createIdentity({
        store,
        origin: server.origin,
        ...identitySettings(options.config),
        now,
      });
      handler = createHandler({ ...handlerOptions, identity });
      // The identity's rate limits hold internet addresses; the privacy
      // policy says for at most an hour. Each window's keys are forgotten on
      // the boundary it ends on, whether or not anybody asks again (#892).
      const swept = identity;
      stopSweeping = sweepOnBoundaries(
        {
          periodMs: swept.rateLimitSweepPeriodMs,
          run: () => {
            swept.sweepRateLimits();
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
    heldRateLimitKeys: () => identity?.heldRateLimitKeys() ?? 0,
    async stop() {
      stopping = true;
      stopSweeping();
      await router.stop();
      await listening.close();
      await store?.close();
    },
  };
}
