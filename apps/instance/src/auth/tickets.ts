// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Room tickets (#772): what a WebSocket hello carries instead of a session.
 *
 * A session token is a bearer credential for every route an athlete may call
 * for thirty days. A WebSocket's first message is logged by proxies,
 * replayed by reconnect logic and kept by browser devtools, so it never
 * carries one. It carries a **ticket**: minted over HTTPS against a live
 * session, good for ONE room, ONE hello and {@link TICKET_LIFETIME_MS}.
 *
 * ## In memory, and why that is enough
 *
 * A ticket lives thirty seconds and names one room, and a room is one object
 * in one process — the Node box (#780) or one Durable Object (#781). The book
 * that minted it is the book the room asks, so a table in memory is the whole
 * store, and a restart forgets every ticket, which only means a rider asks
 * for another. Nothing here is written to disk, and so nothing here can leak
 * from a copy of the database.
 *
 * ## The room's admission
 *
 * {@link TicketBook.admitterFor} returns the room core's `Admit` for one room
 * (`room/core/room.ts`): synchronous, as the core requires, and SPENDING — the
 * ticket is deleted as it is admitted, so a second hello with it is refused
 * whether the first was accepted or not. A ticket for another room, an expired
 * ticket and anything that is not a ticket (a session token included) are all
 * `undefined`, which the room answers `ticket-refused` without saying which.
 *
 * ## Mounted by both adapters (#780, #781)
 *
 * The book names no platform: the ticket's random text comes from the
 * `token` its maker is handed (`crypto.ts`'s `randomToken(32)` on the box),
 * so the Durable Object adapter compiles and loads it under `workerd` with no
 * `types` at all. On the box the HTTP process holds the one book and a room
 * worker asks it once per hello (`room/node/`); a Durable Object holds its
 * own and mints through `POST …/tickets` from the Worker in front
 * (`room/durable-object/room-object.ts`).
 */

import type { Admission, Admit } from '../room/core/room.ts';

/** How long a ticket is good for: #772's "≤ 30 s". */
export const TICKET_LIFETIME_MS = 30_000;

interface Held extends Admission {
  readonly roomId: string;
  readonly expiresAtMs: number;
}

export interface MintedTicket {
  readonly ticket: string;
  /** Unix milliseconds. */
  readonly expiresAtMs: number;
}

export interface TicketBook {
  mint(roomId: string, admission: Admission): MintedTicket;
  admitterFor(roomId: string): Admit;
}

/**
 * @param token a new unguessable ticket's text each call — at least 256 bits
 * of randomness (`randomToken(32)`).
 */
export function createTicketBook(now: () => number, token: () => string): TicketBook {
  const held = new Map<string, Held>();

  function sweep(at: number): void {
    for (const [ticket, entry] of held) if (entry.expiresAtMs <= at) held.delete(ticket);
  }

  return {
    mint(roomId, admission) {
      const at = now();
      sweep(at);
      const ticket = token();
      const expiresAtMs = at + TICKET_LIFETIME_MS;
      held.set(ticket, { ...admission, roomId, expiresAtMs });
      return { ticket, expiresAtMs };
    },
    admitterFor(roomId) {
      return (ticket) => {
        const entry = held.get(ticket);
        if (entry === undefined) return undefined;
        held.delete(ticket);
        if (entry.roomId !== roomId || entry.expiresAtMs <= now()) return undefined;
        return { athleteId: entry.athleteId, declaredMassKilograms: entry.declaredMassKilograms };
      };
    },
  };
}
