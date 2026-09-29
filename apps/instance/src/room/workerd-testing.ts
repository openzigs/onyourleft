// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A real `workerd`, on this machine, for `test:workerd` (#781) — no Cloudflare
 * account, no token, no network. Test support, never mounted.
 *
 * `startWorkerd` bundles `durable-object/worker-under-test.ts` with the
 * workspace's own rolldown (the recipe spike 0007 §10 used), writes a
 * `config.capnp` beside it with both room classes, SQLite-backed storage on a
 * temporary directory and one socket on `127.0.0.1`, and runs the pinned
 * `workerd` binary against it. ⚠️ rolldown does not typecheck; the
 * durable-object `tsconfig` does, in `pnpm run typecheck`.
 *
 * The binary is the platform package's (`require('workerd').default`), so the
 * `workerd` package's install script is never needed — `pnpm-workspace.yaml`
 * says so where it refuses it.
 */

import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'rolldown';

import { CLOSED_BY_ROOM, type RoomUnderTest, type Transcript } from './conformance-testing.ts';

const ENTRY = fileURLToPath(new URL('./durable-object/worker-under-test.ts', import.meta.url));

/** `worker-under-test.ts`' socket barrier, restated: that module may export only what `workerd` runs. */
const SYNC = '__sync';
const SYNCED = '__synced';

/** A compatibility date the pinned runtime supports. */
const COMPATIBILITY_DATE = '2026-09-01';

export interface Workerd {
  /** `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** Everything the runtime wrote, for a failure message. */
  readonly output: string[];
  stop(): Promise<void>;
}

/** What `GET …/__state` answers. */
export interface ObservedState {
  readonly generation: number;
  readonly admissions: number;
  readonly closed: readonly number[];
  readonly view: {
    readonly phase: string;
    readonly tick: number;
    readonly seats: readonly {
      readonly riderId: number;
      readonly athleteId: string;
      readonly state: string;
    }[];
  };
  readonly nextTickAtMs: number | null;
  readonly alarm: number | null;
  readonly sockets: number;
}

function workerdBinary(): string {
  const require = createRequire(import.meta.url);
  return (require('workerd') as { readonly default: string }).default;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') reject(new Error('no port'));
        else resolve(address.port);
      });
    });
  });
}

function config(port: number): string {
  return `using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [
    (name = "main", worker = .worker),
    (name = "storage", disk = (path = "storage", writable = true)),
  ],
  sockets = [ (name = "http", address = "127.0.0.1:${String(port)}", http = (), service = "main") ],
);
const worker :Workerd.Worker = (
  modules = [ (name = "worker.mjs", esModule = embed "worker.mjs") ],
  compatibilityDate = "${COMPATIBILITY_DATE}",
  durableObjectNamespaces = [
    (className = "ConformanceRoom", uniqueKey = "conformance-room", enableSql = true),
    (className = "WallClockRoom", uniqueKey = "wall-clock-room", enableSql = true),
  ],
  durableObjectStorage = (localDisk = "storage"),
  bindings = [
    (name = "CONFORMANCE", durableObjectNamespace = "ConformanceRoom"),
    (name = "WALL_CLOCK", durableObjectNamespace = "WallClockRoom"),
  ],
);
`;
}

/** Bundles the Worker, starts `workerd`, and resolves once it answers. */
export async function startWorkerd(): Promise<Workerd> {
  const directory = await mkdtemp(join(tmpdir(), 'oyl-workerd-'));
  await build({
    input: ENTRY,
    platform: 'neutral',
    logLevel: 'warn',
    output: { file: join(directory, 'worker.mjs'), format: 'esm' },
  });
  await mkdir(join(directory, 'storage'));
  const port = await freePort();
  await writeFile(join(directory, 'config.capnp'), config(port));
  const child = spawn(workerdBinary(), ['serve', 'config.capnp'], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  let exited: number | null | undefined;
  child.on('exit', (code) => {
    exited = code;
  });
  const url = `http://127.0.0.1:${String(port)}`;
  const stop = async (): Promise<void> => {
    if (exited === undefined) {
      const gone = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await gone;
    }
    await rm(directory, { recursive: true, force: true });
  };
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (exited !== undefined) {
      await stop();
      throw new Error(`workerd exited (${String(exited)}):\n${output.join('')}`);
    }
    try {
      await fetch(`${url}/ready`);
      return { url, output, stop };
    } catch {
      if (Date.now() > deadline) {
        await stop();
        throw new Error(`workerd did not answer within 15 s:\n${output.join('')}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** A room's base URL: `/room/<CLASS>/<name>`. */
export function roomUrl(runtime: Workerd, roomClass: string, name: string): string {
  return `${runtime.url}/room/${roomClass}/${name}`;
}

export async function stateOf(base: string): Promise<ObservedState> {
  const response = await fetch(`${base}/__state`);
  if (!response.ok) throw new Error(`__state answered ${String(response.status)}`);
  return (await response.json()) as ObservedState;
}

/** A socket to a room, with every text it was sent and whether the room closed it. */
export class RoomSocket {
  readonly received: string[] = [];
  readonly #socket: WebSocket;
  #open = true;
  #hungUp = false;
  #waiting: (() => void)[] = [];
  #listeners: (() => void)[] = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const text = String(event.data);
      if (text === SYNCED) {
        this.#waiting.shift()?.();
      } else {
        this.received.push(text);
      }
      for (const listener of this.#listeners) listener();
    });
    socket.addEventListener('close', () => {
      this.#open = false;
      if (!this.#hungUp) this.received.push(CLOSED_BY_ROOM);
      for (const resolve of this.#waiting.splice(0)) resolve();
      for (const listener of this.#listeners) listener();
    });
  }

  static async open(base: string): Promise<RoomSocket> {
    const socket = new WebSocket(base.replace(/^http/, 'ws'));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error(`could not open ${base}`));
      });
    });
    return new RoomSocket(socket);
  }

  get open(): boolean {
    return this.#open;
  }

  send(text: string): void {
    this.#socket.send(text);
  }

  /** Resolves once the room has handled everything this socket sent, or closed it. */
  sync(): Promise<void> {
    if (!this.#open) return Promise.resolve();
    return new Promise((resolve) => {
      this.#waiting.push(resolve);
      this.#socket.send(SYNC);
    });
  }

  /** Resolves once `predicate` holds of what was received, or rejects after `withinMs`. */
  until(predicate: (received: readonly string[]) => boolean, withinMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        if (!predicate(this.received)) return false;
        this.#listeners = this.#listeners.filter((l) => l !== listener);
        clearTimeout(timer);
        resolve();
        return true;
      };
      const listener = (): void => {
        check();
      };
      const timer = setTimeout(() => {
        this.#listeners = this.#listeners.filter((l) => l !== listener);
        reject(
          new Error(`not received within ${String(withinMs)} ms: ${this.received.join(' | ')}`),
        );
      }, withinMs);
      this.#listeners.push(listener);
      check();
    });
  }

  hangUp(): void {
    this.#hungUp = true;
    this.#socket.close(1000, 'the client left');
  }
}

/** Polls `…/__state` until `predicate` holds, or throws after `withinMs`. */
export async function waitForState(
  base: string,
  predicate: (state: ObservedState) => boolean,
  withinMs: number,
): Promise<ObservedState> {
  const deadline = Date.now() + withinMs;
  for (;;) {
    const state = await stateOf(base);
    if (predicate(state)) return state;
    if (Date.now() > deadline) {
      throw new Error(`the room never reached that state: ${JSON.stringify(state)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** The Durable Object adapter under `workerd`, as the conformance script drives it. */
export function workerdRoom(runtime: Workerd, roomClass: string, name: string): RoomUnderTest {
  const base = roomUrl(runtime, roomClass, name);
  const sockets = new Map<string, RoomSocket>();
  const connections = new Map<string, number>();

  async function at(atMs: number): Promise<void> {
    const response = await fetch(`${base}/__clock?at=${String(atMs)}`);
    if (!response.ok) throw new Error(`__clock answered ${String(response.status)}`);
  }
  function socket(label: string): RoomSocket {
    const found = sockets.get(label);
    if (found === undefined) throw new Error(`no socket called ${label}`);
    return found;
  }

  return {
    name: 'the Durable Object adapter, under workerd',
    async connect(label) {
      sockets.set(label, await RoomSocket.open(base));
      connections.set(label, connections.size + 1);
    },
    async send(label, text, atMs) {
      await at(atMs);
      const s = socket(label);
      s.send(text);
      await s.sync();
    },
    async hangUp(label, atMs) {
      await at(atMs);
      socket(label).hangUp();
      const connection = connections.get(label);
      await waitForState(base, (state) => state.closed.includes(connection ?? -1), 5_000);
    },
    async start(atMs) {
      await at(atMs);
      const response = await fetch(`${base}/start`, { method: 'POST' });
      if (!response.ok) throw new Error(`start answered ${String(response.status)}`);
    },
    async tick(atMs) {
      await at(atMs);
      const response = await fetch(`${base}/__tick`);
      if (!response.ok) throw new Error(`__tick answered ${String(response.status)}`);
    },
    transcript(): Promise<Transcript> {
      return Promise.resolve(
        Object.fromEntries([...sockets].map(([label, s]) => [label, [...s.received]])),
      );
    },
    dispose() {
      for (const s of sockets.values()) if (s.open) s.hangUp();
      return Promise.resolve();
    },
  };
}
