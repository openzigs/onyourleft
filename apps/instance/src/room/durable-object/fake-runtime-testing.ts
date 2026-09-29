// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Workers runtime, faked in memory, so the Durable Object adapter (#781)
 * runs in every `pnpm run test` and not only under `workerd`. Test support,
 * never mounted.
 *
 * ⚠️ **The fakes are only as right as their reading of the platform.** What
 * holds them to it is `room-object.workerd.test.ts`, which runs the same
 * adapter under the real runtime and the same conformance script through it.
 *
 * **An eviction** is modelled the way the platform does one: the object is
 * constructed again on the same {@link FakeContext}, so storage, the alarm and
 * every open socket with its attachment survive, and nothing the old object
 * held in memory does.
 */

import { CLOSED_BY_ROOM, type RoomUnderTest, type Transcript } from '../conformance-testing.ts';
import type { Admit } from '../core/room.ts';
import type { RoomSettings } from '../core/settings.ts';
import type {
  DurableObjectContext,
  DurableStorage,
  HibernatableSocket,
  WorkersPlatform,
} from './platform.ts';
import { DurableRoom } from './room-object.ts';

/** The platform's limit on a serialised attachment (developers.cloudflare.com, read 2026-09-28). */
export const MAXIMUM_ATTACHMENT_BYTES = 16_384;

/**
 * The platform's limit on the keys one storage call may take: 128 per
 * `get`/`put`/`delete` (developers.cloudflare.com, the SQLite storage API and
 * the KV API pages, read 2026-09-29). ⚠️ A local `workerd` does NOT enforce
 * it — #781's review sent 200 lobby reports through one and it started — so
 * this fake is the only thing in the repository that goes red for a call
 * over it.
 */
export const MAXIMUM_KEYS_PER_STORAGE_CALL = 128;

export class FakeSocket implements HibernatableSocket {
  /** Every text the object sent, and {@link CLOSED_BY_ROOM} where the object closed it. */
  readonly sent: string[] = [];
  closedByObject = false;
  closedByClient = false;
  #attachment: string | undefined;

  send(message: string): void {
    if (this.closedByObject || this.closedByClient) throw new Error('send on a closed socket');
    this.sent.push(message);
  }

  close(): void {
    if (this.closedByObject) return;
    this.closedByObject = true;
    this.sent.push(CLOSED_BY_ROOM);
  }

  serializeAttachment(value: unknown): void {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > MAXIMUM_ATTACHMENT_BYTES) {
      throw new Error('an attachment is at most 16 384 bytes');
    }
    this.#attachment = text;
  }

  deserializeAttachment(): unknown {
    return this.#attachment === undefined ? null : (JSON.parse(this.#attachment) as unknown);
  }
}

/** Storage as the platform gives it: values copied in and out, keys listed in order. */
export class FakeStorage implements DurableStorage {
  readonly #values = new Map<string, string>();
  alarm: number | null = null;
  /** Every alarm ever set, in order. */
  readonly alarmsSet: number[] = [];

  get<T>(key: string): Promise<T | undefined> {
    const text = this.#values.get(key);
    return Promise.resolve(text === undefined ? undefined : (JSON.parse(text) as T));
  }
  put(key: string, value: unknown): Promise<void> {
    this.#values.set(key, JSON.stringify(value));
    return Promise.resolve();
  }
  delete(keys: string[]): Promise<number> {
    if (keys.length > MAXIMUM_KEYS_PER_STORAGE_CALL) {
      return Promise.reject(
        new RangeError(
          `a storage call takes at most 128 keys, and was given ${String(keys.length)}`,
        ),
      );
    }
    return Promise.resolve(keys.filter((key) => this.#values.delete(key)).length);
  }
  list<T>(options: { readonly prefix: string }): Promise<Map<string, T>> {
    const keys = [...this.#values.keys()].filter((key) => key.startsWith(options.prefix)).sort();
    return Promise.resolve(
      new Map(keys.map((key) => [key, JSON.parse(this.#values.get(key) ?? 'null') as T])),
    );
  }
  keys(): string[] {
    return [...this.#values.keys()].sort();
  }
  getAlarm(): Promise<number | null> {
    return Promise.resolve(this.alarm);
  }
  setAlarm(scheduledTimeMs: number): Promise<void> {
    this.alarm = scheduledTimeMs;
    this.alarmsSet.push(scheduledTimeMs);
    return Promise.resolve();
  }
  deleteAlarm(): Promise<void> {
    this.alarm = null;
    return Promise.resolve();
  }
}

export class FakeContext implements DurableObjectContext {
  readonly storage = new FakeStorage();
  readonly #accepted: FakeSocket[] = [];

  acceptWebSocket(socket: HibernatableSocket): void {
    this.#accepted.push(socket as FakeSocket);
  }
  getWebSockets(): HibernatableSocket[] {
    return this.#accepted.filter((socket) => !socket.closedByObject && !socket.closedByClient);
  }
}

export type FakeReply =
  | { readonly status: 101; readonly socket: FakeSocket }
  | { readonly status: number; readonly text: string };

/** A pair whose "client" end is the server socket itself: a test reads what was sent to it. */
export const FAKE_PLATFORM: WorkersPlatform<FakeReply> = {
  socketPair() {
    const server = new FakeSocket();
    return { client: server, server };
  },
  upgraded(client) {
    return { status: 101, socket: client as FakeSocket };
  },
  status(code, text) {
    return { status: code, text };
  },
};

export const UPGRADE = {
  method: 'GET',
  url: 'https://room.test/room',
  headers: { get: (name: string) => (name.toLowerCase() === 'upgrade' ? 'websocket' : null) },
} as const;

export const START = {
  method: 'POST',
  url: 'https://room.test/room/start',
  headers: { get: () => null },
} as const;

/** Opens a socket on `room` and returns the server end the object accepted. */
export async function openSocket(room: DurableRoom<FakeReply>): Promise<FakeSocket> {
  const reply = await room.fetch(UPGRADE);
  if (reply.status !== 101 || !('socket' in reply)) {
    throw new Error(`the upgrade was answered ${String(reply.status)}`);
  }
  return reply.socket;
}

/** A client closing its socket, as the runtime reports it to the object. */
export async function hangUp(room: DurableRoom<FakeReply>, socket: FakeSocket): Promise<void> {
  socket.closedByClient = true;
  await room.webSocketClose(socket);
}

/** A Durable Object room over the fakes, on a clock the test sets. */
export class FakeRoomHarness {
  readonly ctx = new FakeContext();
  nowMs = 0;
  admissions = 0;
  room: DurableRoom<FakeReply>;
  readonly #settings: RoomSettings;
  readonly #admit: Admit;
  readonly #driven: boolean;

  /**
   * @param driven `true` when the test fires the ticks itself (the
   * conformance script); `false` to have the adapter set storage alarms.
   */
  constructor(settings: RoomSettings, admit: Admit, driven: boolean) {
    this.#settings = settings;
    this.#admit = admit;
    this.#driven = driven;
    this.room = this.#construct();
  }

  /** The platform evicts the object: a new one on the same state. */
  evict(): DurableRoom<FakeReply> {
    this.room = this.#construct();
    return this.room;
  }

  #construct(): DurableRoom<FakeReply> {
    return new DurableRoom(this.ctx, {
      settings: this.#settings,
      admit: (ticket) => {
        this.admissions += 1;
        return this.#admit(ticket);
      },
      now: () => this.nowMs,
      platform: FAKE_PLATFORM,
      ...(this.#driven ? { scheduleTick: () => Promise.resolve() } : {}),
    });
  }
}

/** The Durable Object adapter over the fakes, as the conformance script drives it. */
export function fakeDurableRoom(settings: RoomSettings, admit: Admit): RoomUnderTest {
  const harness = new FakeRoomHarness(settings, admit, true);
  const sockets = new Map<string, FakeSocket>();
  function socket(label: string): FakeSocket {
    const found = sockets.get(label);
    if (found === undefined) throw new Error(`no socket called ${label}`);
    return found;
  }
  return {
    name: 'the Durable Object adapter, under fakes',
    async connect(label) {
      sockets.set(label, await openSocket(harness.room));
    },
    async send(label, text, atMs) {
      harness.nowMs = atMs;
      await harness.room.webSocketMessage(socket(label), text);
    },
    async hangUp(label, atMs) {
      harness.nowMs = atMs;
      await hangUp(harness.room, socket(label));
    },
    async start(atMs) {
      harness.nowMs = atMs;
      await harness.room.fetch(START);
    },
    async tick(atMs) {
      harness.nowMs = atMs;
      await harness.room.alarm();
    },
    transcript(): Promise<Transcript> {
      return Promise.resolve(
        Object.fromEntries([...sockets].map(([label, s]) => [label, [...s.sent]])),
      );
    },
    dispose() {
      return Promise.resolve();
    },
  };
}
