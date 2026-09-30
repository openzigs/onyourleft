// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Node adapter (#780) as the conformance script drives it: a real
 * `node:http` server, real `ws` sockets on both ends over loopback, and the
 * adapter's {@link RoomHost} — on a clock the script sets and with ticks the
 * script fires. Test support, never mounted.
 *
 * What makes the transcript comparable byte for byte with the reference is
 * the same thing the Durable Object harness does: every call resolves only
 * once the host has handled it ({@link HostOptions.onHandled}), and the
 * transcript is read only once every socket has received every message the
 * host sent it.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { WebSocket, WebSocketServer } from 'ws';

import { CLOSED_BY_ROOM, type RoomUnderTest, type Transcript } from '../conformance-testing.ts';
import type { Admit, ConnectionId } from '../core/room.ts';
import type { RoomSettings } from '../core/settings.ts';
import type { RaceStarter } from '../room-plan.ts';
import { RoomHost, type HostOptions } from './room-host.ts';

const ROOM_ID = 'conformance';

interface Client {
  readonly socket: WebSocket;
  readonly connection: ConnectionId;
  readonly received: string[];
  hungUp: boolean;
  closed: Promise<void>;
  isClosed: boolean;
}

/** Waits until `check` holds, polling each turn of the event loop, or throws after `ms`. */
export async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 1));
  }
}

/** A `ws` server on an ephemeral loopback port, handing every socket to `host`. */
export async function serveHost(
  host: () => RoomHost,
  settings: RoomSettings,
  serverOptions: ConstructorParameters<typeof WebSocketServer>[0] = { noServer: true },
  /** Every server-side socket as it is accepted, in order: a test may reach into one. */
  onAccept?: (ws: WebSocket) => void,
  /** Who may start the race, as a plan would say: `room-plan.ts` §`RaceStarter`. */
  startedBy: RaceStarter = 'any-seated-rider',
): Promise<{ readonly url: string; readonly server: Server; close(): Promise<void> }> {
  const wss = new WebSocketServer({ ...serverOptions, noServer: true });
  const server = createServer();
  let socketId = 0;
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      socketId += 1;
      onAccept?.(ws);
      host().accept(ROOM_ID, settings, ws, `s${String(socketId)}`, startedBy);
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${String(port)}/v1/rooms/${ROOM_ID}/socket`,
    server,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/** The Node adapter over real sockets, as the conformance script drives it. */
export function nodeRoom(settings: RoomSettings, admit: Admit): RoomUnderTest {
  let nowMs = 0;
  const handled = new Map<ConnectionId, number>();
  const options: HostOptions = {
    now: () => nowMs,
    admit: (_roomId, ticket) => Promise.resolve(admit(ticket)),
    driven: true,
    pingIntervalMs: 0,
    onHandled: (_roomId, connection) => {
      handled.set(connection, (handled.get(connection) ?? 0) + 1);
    },
  };
  const host = new RoomHost(options);
  const clients = new Map<string, Client>();
  let served: Awaited<ReturnType<typeof serveHost>> | undefined;
  let connections = 0;

  function client(label: string): Client {
    const found = clients.get(label);
    if (found === undefined) throw new Error(`no socket called ${label}`);
    return found;
  }
  async function handledOnce(c: Client, action: () => void): Promise<void> {
    const before = handled.get(c.connection) ?? 0;
    action();
    await until(() => (handled.get(c.connection) ?? 0) > before, 'the host to handle it');
  }

  return {
    name: 'the Node adapter (ws, over loopback)',
    async connect(label) {
      served ??= await serveHost(() => host, settings);
      const socket = new WebSocket(served.url);
      const received: string[] = [];
      connections += 1;
      const entry: Client = {
        socket,
        connection: connections,
        received,
        hungUp: false,
        closed: Promise.resolve(),
        isClosed: false,
      };
      entry.closed = new Promise<void>((done) => {
        socket.on('close', () => {
          if (!entry.hungUp) received.push(CLOSED_BY_ROOM);
          entry.isClosed = true;
          done();
        });
      });
      socket.on('message', (data) => received.push((data as Buffer).toString('utf8')));
      await new Promise<void>((done, failed) => {
        socket.once('open', () => done());
        socket.once('error', failed);
      });
      // The host numbers connections in the order it accepts them.
      await until(() => host.sentCounts(ROOM_ID).has(entry.connection), 'the host to accept it');
      clients.set(label, entry);
    },
    async send(label, text, atMs) {
      nowMs = atMs;
      const c = client(label);
      await handledOnce(c, () => c.socket.send(text));
    },
    async hangUp(label, atMs) {
      nowMs = atMs;
      const c = client(label);
      c.hungUp = true;
      await handledOnce(c, () => c.socket.close(1000, 'bye'));
    },
    start(atMs) {
      nowMs = atMs;
      host.start(ROOM_ID);
      return Promise.resolve();
    },
    tick(atMs) {
      nowMs = atMs;
      host.tick(ROOM_ID);
      return Promise.resolve();
    },
    async transcript(): Promise<Transcript> {
      // A socket still held by the host has arrived when it has received as
      // many messages as the host sent it. One the host has let go was closed
      // — by the room or by its client — and is final once the client has
      // seen the close: its close event comes after every message before it.
      await until(() => {
        const counts = host.sentCounts(ROOM_ID);
        return [...clients.values()].every((c) => {
          const count = counts.get(c.connection);
          return count === undefined ? c.isClosed : c.received.length >= count;
        });
      }, 'every socket to receive what it was sent');
      return Object.fromEntries([...clients].map(([label, c]) => [label, [...c.received]]));
    },
    async dispose() {
      for (const c of clients.values()) c.socket.terminate();
      await host.stop({ code: 1001, reason: 'server-stopping' }, 100);
      await served?.close();
    },
  };
}
