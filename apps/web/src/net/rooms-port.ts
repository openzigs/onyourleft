// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the game may ask about a rider's rooms** — #784's private group ride
 * and #785's private race: make one on your own route, join one by its code,
 * start a race, and read a race's result.
 *
 * A `*-port.ts` on purpose, as `room-port.ts` is: `check:wiring` watches every
 * method here, and `main.tsx` is the only production code that names
 * {@link createRoomsPort}.
 *
 * ## Through the one instance module — ADR 0036 D-3 (a)
 *
 * Every request goes through `instance/instance-transport.ts`'s one `fetch`,
 * with the session `instance/instance-port.ts` keeps. A rider with no
 * instance has no session, and every method answers `not-signed-in` without
 * sending a byte.
 *
 * ## What leaves the device, and what does not
 *
 * - **Making a room** sends the ROUTE the rider chose — its GPX, with no name
 *   and no times — and the course the room re-simulates it on (a length and
 *   grade steps), plus the kind of room and the riding position. A route
 *   anywhere inside one of the rider's privacy zones is refused
 *   (`rooms/share.ts`) BEFORE any request is made: `rooms-port.test.ts`
 *   counts the requests.
 * - **Joining** sends the code the rider typed, in a POST body — never in a
 *   path — and the code is kept nowhere on this device but the screen that
 *   shows it (`rooms/RoomPanel.tsx`), and never written to the console.
 * - **Starting** and **a result** send nothing but the room's id.
 * - **Never** the rider's weight here: that goes once, with a room's ticket
 *   (`room-port.ts`), and only when the rider has declared one.
 */

import type { RouteProfile } from '@onyourleft/domain';
import type { PrivacyZoneRecord } from '@onyourleft/store';

import { heldInstanceSession, type InstanceStorage } from '../instance/instance-port';
import {
  isRoomId,
  roomPath,
  MAXIMUM_ROOM_ROUTE_ANSWER_BYTES,
  type InstanceSend,
} from '../instance/instance-transport';
import {
  roomRouteFrom,
  sharedRoomRoute,
  type RoomRouteRefusal,
  type RoomRouteSource,
} from '../rooms/share';

/** Where a rider's hands are, fixed by the room for everybody in it (ADR 0028 D-1). */
export type RoomRidingPosition = 'upright' | 'hoods' | 'drops';

/** A room this device is in: made here, or joined by its code. */
export interface EnteredRoom {
  readonly roomId: string;
  readonly kind: 'group' | 'race';
  readonly ridingPosition: RoomRidingPosition;
  /** The code, for the rider who made the room to share. Absent for one who joined. */
  readonly code?: string | undefined;
  /** The road everybody in the room rides — read back from the room's own route. */
  readonly profile: RouteProfile;
}

/** Why a request about a room will not be answered as asked, however often it is asked. */
export type RoomsRefusal =
  'not-signed-in' | 'no-such-room' | 'rate-limited' | 'not-the-rooms-route' | 'instance-refused';

export type CreateRoomAnswer =
  | { readonly kind: 'created'; readonly room: EnteredRoom }
  | { readonly kind: 'refused'; readonly reason: RoomsRefusal | RoomRouteRefusal }
  | { readonly kind: 'unreachable' };

export type JoinRoomAnswer =
  | { readonly kind: 'joined'; readonly room: EnteredRoom }
  | { readonly kind: 'refused'; readonly reason: RoomsRefusal }
  | { readonly kind: 'unreachable' };

export type StartRaceAnswer =
  | { readonly kind: 'started' }
  | { readonly kind: 'refused'; readonly reason: RoomsRefusal }
  | { readonly kind: 'unreachable' };

/** A plausibility flag as every rider in a race sees it (`apps/instance` §`publication.ts`). */
export interface RaceFlag {
  readonly durationSeconds: number;
  readonly overWattsPerKilogram: number;
}

/** One row of a race's result, as the instance publishes it: W/kg, never watts. */
export interface RaceResultRow {
  readonly place: number | null;
  /** `null` for "a rider": one who erased their account, or one this rider may not see. */
  readonly displayName: string | null;
  readonly you: boolean;
  readonly finishMs: number | null;
  readonly wattsPerKilogram: number | null;
  readonly flags: readonly RaceFlag[];
}

export type RaceResultAnswer =
  | { readonly kind: 'result'; readonly rows: readonly RaceResultRow[] }
  | { readonly kind: 'refused'; readonly reason: RoomsRefusal }
  | { readonly kind: 'unreachable' };

/** What the game may ask about rooms. */
export interface RoomsPort {
  /** Make a room on one of the rider's own routes. */
  create(request: {
    readonly kind: 'group' | 'race';
    readonly ridingPosition: RoomRidingPosition;
    readonly route: RoomRouteSource;
  }): Promise<CreateRoomAnswer>;
  /** Join a room by the code a friend shared, and fetch and check its route. */
  join(code: string): Promise<JoinRoomAnswer>;
  /** Start a race's countdown — any rider seated and connected in it may (#785's rule). */
  start(roomId: string): Promise<StartRaceAnswer>;
  /** A race's result, for its riders only. */
  results(roomId: string): Promise<RaceResultAnswer>;
}

export interface RoomsPortOptions {
  /** This device's `localStorage`: where `instance-port.ts` keeps the session. */
  readonly storage: InstanceStorage;
  /** The rider's privacy zones, read from this device's store. */
  readonly zones: () => Promise<readonly PrivacyZoneRecord[]>;
  /** Injected so a test needs no network. */
  readonly send?: InstanceSend | undefined;
}

/** What a status says, when it says "never". 429 is a refusal here: a limit on tries. */
function refusalOf(status: number): RoomsRefusal | undefined {
  if (status === 401) return 'not-signed-in';
  if (status === 404) return 'no-such-room';
  if (status === 429) return 'rate-limited';
  if (status >= 400 && status < 500) return 'instance-refused';
  return undefined;
}

const POSITIONS: readonly RoomRidingPosition[] = ['upright', 'hoods', 'drops'];

function isFlag(value: unknown): value is RaceFlag {
  const flag = value as Partial<RaceFlag> | null;
  return (
    typeof flag === 'object' &&
    flag !== null &&
    typeof flag.durationSeconds === 'number' &&
    typeof flag.overWattsPerKilogram === 'number'
  );
}

const numberOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));

function isRow(value: unknown): value is RaceResultRow {
  const row = value as Partial<RaceResultRow> | null;
  return (
    typeof row === 'object' &&
    row !== null &&
    numberOrNull(row.place) &&
    (row.displayName === null || typeof row.displayName === 'string') &&
    typeof row.you === 'boolean' &&
    numberOrNull(row.finishMs) &&
    numberOrNull(row.wattsPerKilogram) &&
    Array.isArray(row.flags) &&
    row.flags.every(isFlag)
  );
}

/** The production {@link RoomsPort}: `main.tsx` builds it, and nothing else in the client. */
export function createRoomsPort(options: RoomsPortOptions): RoomsPort {
  const held = () => heldInstanceSession(options.storage, options.send);

  /** A room's route, fetched and checked against the room's own `routeRef`. */
  async function routeOf(
    roomId: string,
    routeSha256: string,
    loop: boolean,
  ): Promise<RouteProfile | RoomsRefusal | 'unreachable'> {
    const session = held();
    if (session === undefined) return 'not-signed-in';
    const answer = await session.http.call('GET', roomPath(roomId, 'route'), {
      token: session.token,
      maximumAnswerBytes: MAXIMUM_ROOM_ROUTE_ANSWER_BYTES,
    });
    if (answer.status !== 200) return refusalOf(answer.status) ?? 'unreachable';
    const gpx = (answer.body as { gpx?: unknown } | null)?.gpx;
    if (typeof gpx !== 'string') return 'not-the-rooms-route';
    return (await roomRouteFrom(gpx, routeSha256, loop)) ?? 'not-the-rooms-route';
  }

  return {
    async create(request) {
      // First, before anything is sent: a route in a privacy zone never leaves.
      const shared = sharedRoomRoute(request.route, await options.zones());
      if (shared.kind === 'refused') return shared;
      const session = held();
      if (session === undefined) return { kind: 'refused', reason: 'not-signed-in' };
      try {
        const answer = await session.http.call('POST', '/v1/rooms', {
          token: session.token,
          body: {
            kind: request.kind,
            ridingPosition: request.ridingPosition,
            loop: shared.loop,
            lengthMetres: shared.course.lengthMetres,
            grades: shared.course.grades,
            gpx: shared.gpx,
          },
        });
        const made = answer.body as { roomId?: unknown; code?: unknown } | null;
        if (
          answer.status !== 200 ||
          typeof made?.roomId !== 'string' ||
          !isRoomId(made.roomId) ||
          typeof made.code !== 'string'
        ) {
          const reason = refusalOf(answer.status);
          return reason === undefined ? { kind: 'unreachable' } : { kind: 'refused', reason };
        }
        return {
          kind: 'created',
          room: {
            roomId: made.roomId,
            kind: request.kind,
            ridingPosition: request.ridingPosition,
            code: made.code,
            profile: shared.profile,
          },
        };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    async join(code) {
      const session = held();
      if (session === undefined) return { kind: 'refused', reason: 'not-signed-in' };
      try {
        const answer = await session.http.call('POST', '/v1/rooms/join', {
          token: session.token,
          body: { code },
        });
        const room = answer.body as {
          roomId?: unknown;
          kind?: unknown;
          ridingPosition?: unknown;
          loop?: unknown;
          routeSha256?: unknown;
        } | null;
        if (answer.status !== 200) {
          const reason = refusalOf(answer.status);
          return reason === undefined ? { kind: 'unreachable' } : { kind: 'refused', reason };
        }
        if (
          typeof room?.roomId !== 'string' ||
          !isRoomId(room.roomId) ||
          (room.kind !== 'group' && room.kind !== 'race') ||
          !POSITIONS.includes(room.ridingPosition as RoomRidingPosition) ||
          typeof room.loop !== 'boolean' ||
          typeof room.routeSha256 !== 'string'
        ) {
          return { kind: 'refused', reason: 'instance-refused' };
        }
        const profile = await routeOf(room.roomId, room.routeSha256, room.loop);
        if (typeof profile === 'string') {
          return profile === 'unreachable'
            ? { kind: 'unreachable' }
            : { kind: 'refused', reason: profile };
        }
        return {
          kind: 'joined',
          room: {
            roomId: room.roomId,
            kind: room.kind,
            ridingPosition: room.ridingPosition as RoomRidingPosition,
            profile,
          },
        };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    async start(roomId) {
      const session = held();
      if (session === undefined) return { kind: 'refused', reason: 'not-signed-in' };
      try {
        const answer = await session.http.call('POST', roomPath(roomId, 'start'), {
          token: session.token,
        });
        if (answer.status === 200) return { kind: 'started' };
        const reason = refusalOf(answer.status);
        return reason === undefined ? { kind: 'unreachable' } : { kind: 'refused', reason };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    async results(roomId) {
      const session = held();
      if (session === undefined) return { kind: 'refused', reason: 'not-signed-in' };
      try {
        const answer = await session.http.call('GET', roomPath(roomId, 'results'), {
          token: session.token,
        });
        if (answer.status !== 200) {
          const reason = refusalOf(answer.status);
          return reason === undefined ? { kind: 'unreachable' } : { kind: 'refused', reason };
        }
        const rows = (answer.body as { rows?: unknown } | null)?.rows;
        if (!Array.isArray(rows) || !rows.every(isRow)) {
          return { kind: 'refused', reason: 'instance-refused' };
        }
        return { kind: 'result', rows };
      } catch {
        return { kind: 'unreachable' };
      }
    },
  };
}
