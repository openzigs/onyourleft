// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Worker `workerd` loads for `test:workerd` (#781) — bundled by
 * `workerd-testing.ts` and never deployed. It is the only module that turns
 * the runtime's globals into {@link WorkersPlatform}, and it mounts the
 * adapter twice:
 *
 * - **`ConformanceRoom`**, on a clock the suite sets and with ticks the suite
 *   fires, so the conformance script's room times are the room's times. The
 *   tick it fires is the adapter's own `alarm()`; only the scheduling of it is
 *   the suite's.
 * - **`WallClockRoom`**, on `Date.now` and real storage alarms — the adapter as
 *   it would run — for the alarm case and the hibernation case.
 *
 * Both answer three things a production object would not, all under `/__`:
 * the room's state as JSON, and on the conformance room the clock and the
 * tick. And both answer a text `__sync` on a socket with `__synced` **before**
 * the room sees it, which is how the suite knows a socket's earlier messages
 * have been handled: a Durable Object handles one socket's messages in order.
 * A production mount has none of these.
 *
 * Routing: `/room/<CLASS>/<name>/…` goes to the object `<name>` of that class.
 */

import { admitConformance, conformanceSettings, wallClockSettings } from '../conformance-room.ts';
import type { Admit } from '../core/room.ts';
import type { RoomSettings } from '../core/settings.ts';
import type {
  DurableObjectContext,
  HibernatableSocket,
  IncomingRequest,
  WorkersPlatform,
} from './platform.ts';
import { connectionOf, DurableRoom } from './room-object.ts';

/** What this module needs of the runtime's globals, and nothing else. */
interface RuntimeGlobals {
  readonly Response: new (
    body: string | null,
    init: { readonly status: number; readonly webSocket?: unknown },
  ) => unknown;
  readonly WebSocketPair: new () => { readonly 0: unknown; readonly 1: HibernatableSocket };
}

const runtime = globalThis as unknown as RuntimeGlobals;

const PLATFORM: WorkersPlatform<unknown> = {
  socketPair() {
    const pair = new runtime.WebSocketPair();
    return { client: pair[0], server: pair[1] };
  },
  upgraded(client) {
    return new runtime.Response(null, { status: 101, webSocket: client });
  },
  status(code, text) {
    return new runtime.Response(text, { status: code });
  },
};

/**
 * The text a socket sends to ask whether its earlier messages have been
 * handled. Not exported: `workerd` reads every export of this module as a
 * handler or a class, and refuses to start over a string.
 */
const SYNC = '__sync';
const SYNCED = '__synced';

/** Counts constructions across the isolate: a new number is a new object, so an eviction happened. */
let constructions = 0;

interface Observed {
  clockMs: number;
  admissions: number;
  readonly closed: number[];
  readonly generation: number;
}

function pathOf(url: string): string {
  return /^[a-z]+:\/\/[^/?#]*([^?#]*)/i.exec(url)?.[1] ?? '';
}

function atOf(url: string): number {
  return Number(/[?&]at=(\d+)/.exec(url)?.[1] ?? 'NaN');
}

class ObservedRoom extends DurableRoom<unknown> {
  readonly #observed: Observed;
  readonly #ctx: DurableObjectContext;

  constructor(
    ctx: DurableObjectContext,
    settings: RoomSettings,
    admit: Admit,
    observed: Observed,
    driven: boolean,
  ) {
    super(ctx, {
      settings,
      admit: (ticket) => {
        observed.admissions += 1;
        return admit(ticket);
      },
      now: driven ? () => observed.clockMs : () => Date.now(),
      platform: PLATFORM,
      ...(driven ? { scheduleTick: () => Promise.resolve() } : {}),
    });
    this.#observed = observed;
    this.#ctx = ctx;
  }

  protected get observed(): Observed {
    return this.#observed;
  }

  override async fetch(request: IncomingRequest): Promise<unknown> {
    if (pathOf(request.url).endsWith('/__state')) {
      return PLATFORM.status(
        200,
        JSON.stringify({
          generation: this.#observed.generation,
          admissions: this.#observed.admissions,
          closed: this.#observed.closed,
          view: await this.view(),
          nextTickAtMs: (await this.nextTickAtMs()) ?? null,
          alarm: await this.#ctx.storage.getAlarm(),
          sockets: this.#ctx.getWebSockets().length,
        }),
      );
    }
    return super.fetch(request);
  }

  override async webSocketMessage(
    socket: HibernatableSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (message === SYNC) {
      socket.send(SYNCED);
      return;
    }
    await super.webSocketMessage(socket, message);
  }

  override async webSocketClose(socket: HibernatableSocket): Promise<void> {
    await super.webSocketClose(socket);
    const connection = connectionOf(socket);
    if (connection !== undefined) this.#observed.closed.push(connection);
  }
}

function observed(): Observed {
  constructions += 1;
  return { clockMs: 0, admissions: 0, closed: [], generation: constructions };
}

export class ConformanceRoom extends ObservedRoom {
  constructor(ctx: DurableObjectContext) {
    super(ctx, conformanceSettings(), admitConformance, observed(), true);
  }

  override async fetch(request: IncomingRequest): Promise<unknown> {
    const path = pathOf(request.url);
    if (path.endsWith('/__clock')) {
      this.observed.clockMs = atOf(request.url);
      return PLATFORM.status(200, 'set');
    }
    if (path.endsWith('/__tick')) {
      await this.alarm();
      return PLATFORM.status(200, 'ticked');
    }
    return super.fetch(request);
  }
}

export class WallClockRoom extends ObservedRoom {
  constructor(ctx: DurableObjectContext) {
    super(ctx, wallClockSettings(), admitConformance, observed(), false);
  }
}

interface Namespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: unknown): Promise<unknown> };
}

export default {
  fetch(request: IncomingRequest, env: Readonly<Record<string, Namespace>>): Promise<unknown> {
    const match = /^\/room\/([A-Z_]+)\/([^/]+)/.exec(pathOf(request.url));
    const namespace = match === null ? undefined : env[match[1] ?? ''];
    if (match === null || namespace === undefined) {
      return Promise.resolve(PLATFORM.status(404, 'no such room'));
    }
    return namespace.get(namespace.idFromName(match[2] ?? '')).fetch(request);
  },
};
