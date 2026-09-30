// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The WebSocket close codes a room's socket is closed with (#780), the same on
 * both adapters (#781): the documented half of #780's first criterion.
 *
 * The room core says only "close this connection" (`core/room.ts` §`Outbound`),
 * usually right after a `refuse` message naming why. A close frame carries a
 * code and a short reason as well, and a client that reads only the close —
 * a proxy's log, a browser's `CloseEvent` — should be able to tell a refused
 * ticket from a full room from a server going down. So the adapter reads the
 * reason out of the batch the core returned and closes with the code for it.
 *
 * | Code | Reason | When |
 * |--:|---|---|
 * | 1001 | `server-stopping` | the instance is shutting down (SIGTERM): the race is not resumed, reconnect later |
 * | 1008 | `hello-expected` | anything but a well-formed hello arrived before one — **a hello with no ticket is this** |
 * | 1011 | `room-lost` | the room worker holding this room died; the room is gone |
 * | 4001 | `protocol-mismatch` | the client speaks another wire protocol version |
 * | 4002 | `physics-mismatch` | the client simulates with another physics version |
 * | 4003 | `ticket-refused` | the ticket is unknown, expired, for another room, **or already spent** |
 * | 4004 | `room-full` | the room holds its capacity |
 * | 4005 | `room-closed` | the room has finished or closed, or the race is running and this rider was not in it |
 * | 4006 | `replaced` | the same athlete connected again; the newer socket is the rider |
 * | 4008 | `too-slow` | the client stopped reading: its unsent bytes passed the limit (backpressure, #780) |
 *
 * 4000–4999 is the range RFC 6455 §7.4.2 leaves to applications. A refusal
 * never says more than its reason: a refused ticket does not say whether it
 * was unknown, expired or spent (`auth/tickets.ts`).
 */

import type { RefuseReason } from '@onyourleft/protocol';

import type { ConnectionId, Outbound } from './core/room.ts';

export interface CloseFrame {
  readonly code: number;
  readonly reason: string;
}

export const REFUSAL_CLOSE: Readonly<Record<RefuseReason, CloseFrame>> = {
  'protocol-mismatch': { code: 4001, reason: 'protocol-mismatch' },
  'physics-mismatch': { code: 4002, reason: 'physics-mismatch' },
  'ticket-refused': { code: 4003, reason: 'ticket-refused' },
  'room-full': { code: 4004, reason: 'room-full' },
  'room-closed': { code: 4005, reason: 'room-closed' },
};

export const HELLO_EXPECTED: CloseFrame = { code: 1008, reason: 'hello-expected' };
export const REPLACED: CloseFrame = { code: 4006, reason: 'replaced' };
export const SERVER_STOPPING: CloseFrame = { code: 1001, reason: 'server-stopping' };
export const ROOM_LOST: CloseFrame = { code: 1011, reason: 'room-lost' };
export const TOO_SLOW: CloseFrame = { code: 4008, reason: 'too-slow' };

/**
 * The close frame for each connection the batch closes. A close after a
 * `refuse` to the same connection is that refusal's; a close in a batch that
 * welcomed another connection is the same athlete being `replaced`; any other
 * is a socket that sent something other than a hello first.
 */
export function closeFrames(out: readonly Outbound[]): Map<ConnectionId, CloseFrame> {
  const frames = new Map<ConnectionId, CloseFrame>();
  const refused = new Map<ConnectionId, RefuseReason>();
  const welcomed = new Set<ConnectionId>();
  for (const o of out) {
    if (o.kind === 'send') {
      if (o.message.type === 'refuse') refused.set(o.connection, o.message.reason);
      if (o.message.type === 'welcome') welcomed.add(o.connection);
    }
  }
  for (const o of out) {
    if (o.kind !== 'close') continue;
    const reason = refused.get(o.connection);
    if (reason !== undefined) frames.set(o.connection, REFUSAL_CLOSE[reason]);
    else if ([...welcomed].some((c) => c !== o.connection)) frames.set(o.connection, REPLACED);
    else frames.set(o.connection, HELLO_EXPECTED);
  }
  return frames;
}
