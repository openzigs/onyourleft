// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Socket } from 'node:net';

import { MAXIMUM_MESSAGE_BYTES } from '@onyourleft/protocol';
import { WebSocketServer } from 'ws';

import { SERVER_STOPPING } from '../close-codes.ts';
import type { Admission } from '../core/room.ts';
import { settingsFromPlan } from '../room-plan.ts';
import type { FromWorker, ToWorker, WorkerSettings } from './ipc.ts';
import { RoomHost } from './room-host.ts';

/**
 * One room worker: a process of its own, one per core (#780, spike 0013 §4.1 —
 * one event loop is one core, whatever the box has). Started by the router
 * (`router.ts`) through `worker-main.ts`, which registers the resolve hook
 * first.
 *
 * It holds sockets, not a database: the router hands it each socket already
 * accepted by the HTTP process's `node:http` server, as a handle over the IPC
 * channel, with the upgrade request copied beside it. `ws` completes the
 * WebSocket handshake HERE — so the compression it negotiates, and every byte
 * a room sends after, are this process's work and not the HTTP process's.
 * Tickets are asked of the HTTP process (the book is there), and results are
 * handed back to it (the one writer, ADR 0037 D-5).
 */

const settings = JSON.parse(process.argv[2] ?? '{}') as WorkerSettings;

function send(message: FromWorker): void {
  process.send?.(message);
}

const pending = new Map<number, (admission: Admission | undefined) => void>();
let nextRequest = 0;

const host = new RoomHost({
  now: () => Date.now(),
  admit: (roomId, ticket) =>
    new Promise((resolve) => {
      nextRequest += 1;
      pending.set(nextRequest, resolve);
      send({ type: 'admit', id: nextRequest, roomId, ticket });
    }),
  onResult: (roomId, result) => send({ type: 'result', roomId, result }),
  onRaceStarted: (roomId) => send({ type: 'race-started', roomId }),
  onRoomClosed: (roomId) => send({ type: 'room-closed', roomId }),
  onSocketClosed: (socketId) => send({ type: 'socket-closed', socketId }),
  maxBufferedBytes: settings.maxBufferedBytes,
  pingIntervalMs: settings.pingIntervalMs,
});

/**
 * `perMessageDeflate` is `false` unless the operator set it (ruling Q16,
 * ADR 0037 D-3): `ws`'s own server default, stated rather than inherited.
 * `maxPayload` is the protocol's own bound on a message, so a client cannot
 * make this process buffer more than that for one frame.
 */
const wss = new WebSocketServer({
  noServer: true,
  clientTracking: false,
  perMessageDeflate: settings.compression,
  maxPayload: MAXIMUM_MESSAGE_BYTES,
});

process.on('message', (message: ToWorker, handle?: Socket) => {
  switch (message.type) {
    case 'socket': {
      if (handle === undefined) return;
      const request = {
        method: message.request.method,
        url: message.request.url,
        headers: message.request.headers,
        socket: handle,
      };
      let roomSettings;
      try {
        roomSettings = settingsFromPlan(message.plan);
      } catch {
        handle.destroy();
        send({ type: 'socket-closed', socketId: message.socketId });
        return;
      }
      wss.handleUpgrade(
        request as unknown as Parameters<typeof wss.handleUpgrade>[0],
        handle,
        Buffer.from(message.head, 'base64'),
        (ws) => {
          host.accept(message.plan.roomId, roomSettings, ws, message.socketId);
        },
      );
      // A handshake `ws` refused (a bad key, a wrong version) destroys the
      // socket without calling back; the router still holds its copy.
      handle.once('close', () => {
        if (handle.destroyed) send({ type: 'socket-closed', socketId: message.socketId });
      });
      return;
    }
    case 'admitted': {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve?.(message.admission ?? undefined);
      return;
    }
    case 'start':
      send({ type: 'started', id: message.id, ok: host.start(message.roomId, message.athleteId) });
      return;
    case 'metrics':
      send({
        type: 'metrics',
        id: message.id,
        metrics: host.metrics(),
        rssBytes: process.memoryUsage().rss,
      });
      return;
    case 'shutdown':
      void host.stop(SERVER_STOPPING).then(() => {
        // Disconnect only once `stopped` has been written, so it is not lost.
        process.send?.({ type: 'stopped' } satisfies FromWorker, undefined, {}, () =>
          process.disconnect?.(),
        );
      });
      return;
  }
});

// The router going away is this worker going away: an orphan would hold sockets nobody routes.
process.on('disconnect', () => process.exit(0));

send({ type: 'ready', pid: process.pid });
