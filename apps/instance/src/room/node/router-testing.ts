// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A router with real room-worker processes behind a real `node:http` server,
 * and clients that speak the protocol over real sockets (#780). Test support,
 * never mounted.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { WebSocket } from 'ws';

import { decodeRoomMessage, type RoomMessage } from '@onyourleft/protocol';

import { admitByTable, COURSE_SHA256, helloText, reportText } from '../core/room-testing.ts';
import type { RoomPlan } from '../room-plan.ts';
import { RoomRouter, type RoomLookup, type RouterOptions } from './router.ts';

/** A plan for any room id: a flat 10 km group ride that starts on its first rider. */
export function ridePlan(roomId: string, overrides: Partial<RoomPlan> = {}): RoomPlan {
  return {
    roomId,
    kind: 'ride',
    ridingPosition: 'hoods',
    routeSha256: COURSE_SHA256,
    lengthMetres: 10_000,
    grades: [[0, 0]],
    capacity: null,
    countdownMs: 0,
    rejoinWindowMs: null,
    startedBy: 'any-seated-rider',
    ...overrides,
  };
}

export interface RouterHarness {
  readonly router: RoomRouter;
  readonly url: string;
  readonly server: Server;
  close(): Promise<void>;
}

export async function startRouter(
  options: Partial<RouterOptions> & { readonly lookup?: (roomId: string) => Promise<RoomLookup> },
): Promise<RouterHarness> {
  const admit = admitByTable();
  const router = new RoomRouter({
    workers: 2,
    worker: { compression: false, maxBufferedBytes: 256 * 1024, pingIntervalMs: 0 },
    lookup: (roomId) => Promise.resolve({ kind: 'open', plan: ridePlan(roomId) }),
    admit: (_roomId, ticket) => admit(ticket),
    ...options,
  });
  await router.start();
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  server.on('upgrade', (request, socket, head) => {
    if (!router.upgrade(request, socket, head)) socket.destroy();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    router,
    url: `ws://127.0.0.1:${String(port)}`,
    server,
    close: async () => {
      await router.stop(2_000);
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/** A client of one room: what it was sent, and how it was closed. */
export interface RoomClient {
  readonly socket: WebSocket;
  readonly messages: RoomMessage[];
  readonly closed: Promise<{ code: number; reason: string }>;
  /** The handshake's `Sec-WebSocket-Extensions` answer, or `undefined`. */
  readonly extensions: string | undefined;
  report(sequence: number, powerWatts: number): void;
}

export async function joinRoom(
  url: string,
  roomId: string,
  ticket: string | undefined,
  options: { readonly perMessageDeflate?: boolean } = {},
): Promise<RoomClient> {
  const socket = new WebSocket(`${url}/v1/rooms/${roomId}/socket`, {
    perMessageDeflate: options.perMessageDeflate ?? true,
  });
  const messages: RoomMessage[] = [];
  let extensions: string | undefined;
  socket.on('upgrade', (response) => {
    const header = response.headers['sec-websocket-extensions'];
    extensions = Array.isArray(header) ? header.join(', ') : header;
  });
  socket.on('message', (data) => {
    const decoded = decodeRoomMessage((data as Buffer).toString('utf8'));
    if (decoded.ok) messages.push(decoded.message);
  });
  const closed = new Promise<{ code: number; reason: string }>((done) => {
    socket.on('close', (code, reason) => done({ code, reason: reason.toString('utf8') }));
  });
  socket.on('error', () => undefined);
  await new Promise<void>((done, failed) => {
    socket.once('open', () => done());
    socket.once('unexpected-response', (_request, response) =>
      failed(new Error(`upgrade answered ${String(response.statusCode)}`)),
    );
    socket.once('error', failed);
  });
  if (ticket !== undefined) socket.send(helloText(ticket));
  return {
    socket,
    messages,
    closed,
    get extensions() {
      return extensions;
    },
    report(sequence, powerWatts) {
      socket.send(reportText(sequence, Date.now(), powerWatts));
    },
  };
}
