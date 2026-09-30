// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the game may ask of a room** — #782 — and the one production
 * implementation of it.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method on
 * a port interface (WIRE003) and every export of this file (WIRE002). The
 * production implementation, {@link createRoomPort}, is exported from HERE so
 * that `main.tsx` is the only production code that names it — and deleting
 * that wiring is a red `check:wiring`, not a game that quietly never joins.
 *
 * ## Where the socket is — ADR 0036 D-3 (a)
 *
 * Not here. This client has ONE module for instance traffic,
 * `instance/instance-transport.ts`, and a room's socket is opened through it
 * ({@link instanceRoomSocket}); the ticket is minted through the same module's
 * HTTP call, with the session token `instance/instance-port.ts` keeps. So a
 * rider with no instance has no session, {@link RoomLink.ticket} answers
 * `refused` without sending a byte, and the game rides exactly as it did
 * before rooms existed.
 *
 * ## What leaves the device, and what does not
 *
 * - To mint a ticket, `POST /v1/rooms/{roomId}/ticket` with the rider's
 *   **declared mass** — ADR 0028 D-1's one per-rider input, which the room
 *   simulates with and never publishes (#774). It is handed to this port and
 *   to nothing the renderer reads: `GameView.test.tsx` §"#783" walks every
 *   frame the renderer was given for it.
 * - On the socket, the hello and the power reports `room-session.ts` lists.
 *
 * ## The screen off — #782, #524
 *
 * A joined room holds the ride controller's foreground service
 * ({@link RoomPortOptions.keepAlive}, `ride/controller.ts`
 * §`keepAliveForRoom`), so the socket lives while the screen is off exactly as
 * a recording's sensor links do. `room-port.test.ts` §"the screen off" drives
 * it down to a scripted keep-alive port; the device check is #733's.
 */

import { PHYSICS_VERSION } from '@onyourleft/physics';

import { heldInstanceSession, type InstanceStorage } from '../instance/instance-port';
import {
  instanceRoomSocket,
  type InstanceSend,
  type OpenInstanceSocket,
} from '../instance/instance-transport';
import {
  RoomSession,
  type RoomLink,
  type RoomSample,
  type RoomSessionStatus,
  type RoomTimers,
  type TicketAnswer,
} from './room-session';
import type { DrawnRemoteRider } from './snapshots';

/** What the game asks to join a room with. */
export interface RoomJoin {
  readonly roomId: string;
  /**
   * The rider's declared mass, in kilograms, for the ticket (ADR 0028 D-1).
   * ⚠️ Sent to the instance, and handed to nothing the renderer reads.
   */
  readonly declaredMassKilograms: number;
  /** Read at every report: the rider's power and cadence NOW. */
  readonly sample: () => RoomSample;
}

/** One room, joined: kept joined until {@link RoomConnection.leave}. */
export interface RoomConnection {
  /** Where the connection is — joined, lost and rejoining, refused … */
  status(): RoomSessionStatus;
  /** Every other rider, where to draw them at `localMs` (`snapshots.ts`). */
  others(localMs: number): readonly DrawnRemoteRider[];
  /** The room's newest word on THIS rider, for `correction.ts`. */
  own(): { readonly rider: DrawnRemoteRider; readonly atLocalMs: number } | undefined;
  /** Leave: close the socket, stop reconnecting, let the screen sleep. */
  leave(): void;
}

/** What the game may ask of a room. */
export interface RoomPort {
  join(request: RoomJoin): RoomConnection;
}

export interface RoomPortOptions {
  /** This device's `localStorage`: where `instance-port.ts` keeps the session. */
  readonly storage: InstanceStorage;
  /**
   * Hold the ride controller's foreground service while joined; returns its
   * release (`ride/controller.ts` §`keepAliveForRoom`). Absent in a browser.
   */
  readonly keepAlive?: (() => () => void) | undefined;
  /** Injected so a test needs no network. */
  readonly send?: InstanceSend | undefined;
  readonly openSocket?: OpenInstanceSocket | undefined;
  readonly timers?: RoomTimers | undefined;
  readonly now?: (() => number) | undefined;
  /** @see RoomSessionOptions.acceptFrame — the browser gate's control, never the product's. */
  readonly acceptFrame?: (() => boolean) | undefined;
}

const PLATFORM_TIMERS: RoomTimers = {
  setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
  },
};

/** The production link: tickets and the socket, both through the one instance module. */
function instanceRoomLink(options: RoomPortOptions, declaredMassKilograms: number): RoomLink {
  return {
    ticket: async (roomId): Promise<TicketAnswer> => {
      const session = heldInstanceSession(options.storage, options.send);
      if (session === undefined) return { kind: 'refused' };
      const answer = await session.http.call('POST', `/v1/rooms/${roomId}/ticket`, {
        token: session.token,
        body: { declaredMassKilograms },
      });
      const ticket = (answer.body as { ticket?: unknown } | null)?.ticket;
      if (answer.status === 200 && typeof ticket === 'string' && ticket !== '') {
        return { kind: 'ticket', ticket };
      }
      if (answer.status >= 400 && answer.status < 500 && answer.status !== 429) {
        return { kind: 'refused' };
      }
      return { kind: 'unreachable' };
    },
    open: (roomId, events) => {
      const session = heldInstanceSession(options.storage, options.send);
      if (session === undefined) throw new Error('not signed in to an instance');
      return instanceRoomSocket(session.http.origin, roomId, events, options.openSocket);
    },
  };
}

/** A port over a {@link RoomLink} — the production one, or a test's scripted room. */
export function roomPortOver(
  link: (declaredMassKilograms: number) => RoomLink,
  options: Omit<RoomPortOptions, 'storage' | 'send' | 'openSocket'>,
): RoomPort {
  return {
    join: (request) => {
      const release = options.keepAlive?.();
      let released = false;
      const session = new RoomSession({
        roomId: request.roomId,
        link: link(request.declaredMassKilograms),
        timers: options.timers ?? PLATFORM_TIMERS,
        now: options.now ?? (() => performance.now()),
        physicsVersion: PHYSICS_VERSION,
        sample: request.sample,
        acceptFrame: options.acceptFrame,
        onChange: () => {
          // A session that has stopped trying no longer needs the screen off.
          const kind = session.status.kind;
          if (!released && (kind === 'refused' || kind === 'gone' || kind === 'left')) {
            released = true;
            release?.();
          }
        },
      });
      return {
        status: () => session.status,
        others: (localMs) => session.others(localMs),
        own: () => session.own(),
        leave: () => {
          session.leave();
        },
      };
    },
  };
}

/** The production {@link RoomPort}: `main.tsx` builds it, and nothing else in the client. */
export function createRoomPort(options: RoomPortOptions): RoomPort {
  return roomPortOver((mass) => instanceRoomLink(options, mass), options);
}
