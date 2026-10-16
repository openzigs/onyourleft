// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the game may ask about a rider's rooms** — #784's private group ride
 * and #785's private race: make one on your own route, join one by its code,
 * start a race, and read a race's result — and #788's public rooms: make one
 * listed, read the listing, and join one from it.
 *
 * A `*-port.ts` on purpose, as `room-port.ts` is: `check:wiring` watches every
 * method here, and `main.tsx` is the only production code that names
 * {@link createRoomsPort}.
 *
 * ## Through the one instance module — ADR 0036 D-3 (a)
 *
 * Every request goes through `instance/instance-transport.ts`'s one `fetch`,
 * with the session `instance/instance-port.ts` keeps — SEALED since #1210
 * (ADR 0047 D-7 phase 2), or in plaintext from a device with no card, which
 * an instance holding keys refuses (`cannot-seal`). A rider with no instance
 * has no session, and every method answers `not-signed-in` without sending a
 * byte.
 *
 * ## What leaves the device, and what does not
 *
 * - **Making a room** sends the ROUTE the rider chose — its GPX, with no name
 *   and no times — and the course the room re-simulates it on (a length and
 *   grade steps), plus the kind of room and the riding position. A route
 *   anywhere inside one of the rider's privacy zones is refused
 *   (`rooms/share.ts`) BEFORE any request is made: `rooms-port.test.ts`
 *   counts the requests.
 * - **Making a PUBLIC room** (#788) sends the same, and the start the rider
 *   chose; the route goes through the same privacy-zone refusal first.
 * - **Joining** sends the code the rider typed, in a POST body — never in a
 *   path — and the code is kept nowhere on this device but the screen that
 *   shows it (`rooms/RoomPanel.tsx`), and never written to the console.
 * - **The listing** sends nothing but the session; joining from it sends the
 *   room's id. The listing answers each room's length and climb, never its
 *   route: the route is fetched, as for a code, only once the rider joined.
 * - **Starting** and **a result** send nothing but the room's id.
 * - **Never** the rider's weight here: that goes once, with a room's ticket
 *   (`room-port.ts`), and only when the rider has declared one.
 */

import type { RouteProfile, SigningKey } from '@onyourleft/domain';
import type { PrivacyZoneRecord } from '@onyourleft/store';

import {
  heldAccountSession,
  isSealedRequired,
  type HeldAccountSession,
  type InstanceStorage,
} from '../instance/instance-port';
import type { LoadedFrom } from '../instance/instance-pin';
import {
  isRoomId,
  roomPath,
  MAXIMUM_ROOM_ROUTE_ANSWER_BYTES,
  type InstanceSend,
} from '../instance/instance-transport';
import {
  roomRouteFrom,
  routeDigest,
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
  /**
   * Whether the room drafts its riders — #787, the owner's ruling of
   * 2026-09-30: its maker's choice, fixed for the room, and said to every
   * rider before the start.
   */
  readonly drafting: boolean;
  /** The code, for the rider who made the room to share. Absent for one who joined, and for a public room. */
  readonly code?: string | undefined;
  /**
   * #788: a PUBLIC room — listed on the instance for eligible riders, with no
   * code — its start, and whether this device made it. Absent for a room
   * shared by its code.
   */
  readonly listed?: { readonly startsAt: number; readonly madeHere: boolean } | undefined;
  /** The road everybody in the room rides — read back from the room's own route. */
  readonly profile: RouteProfile;
  /**
   * The SHA-256 of that route's bytes — what the room's `welcome.routeRef`
   * must name when this device joins it (`net/room-session.ts`).
   */
  readonly routeSha256: string;
}

/** Why a request about a room will not be answered as asked, however often it is asked. */
export type RoomsRefusal =
  | 'not-signed-in'
  | 'no-such-room'
  | 'rate-limited'
  | 'not-the-rooms-route'
  | 'instance-refused'
  /**
   * #788: the account may not make, see or join a public room yet — not
   * confirmed 18 or over, or another of #775's requirements. The instance's
   * account page says which.
   */
  | 'not-eligible'
  /** #788: this instance offers no public rooms: its operator has not turned them on. */
  | 'no-public-rooms'
  /**
   * #1210: the room routes are sealed-only (ADR 0047 D-7 phase 2) and this
   * device cannot seal to its instance now — no card, a copy a website
   * served, or keys refused. Nothing was sent about the room.
   */
  | 'cannot-seal';

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

/**
 * A public room as the listing tells of it (#788): never its route, and in
 * the instance's one order — the start its maker gave, then when it was made.
 */
export interface ListedRoom {
  readonly roomId: string;
  readonly kind: 'group' | 'race';
  readonly ridingPosition: RoomRidingPosition;
  readonly drafting: boolean;
  readonly loop: boolean;
  /** Unix seconds. */
  readonly startsAt: number;
  readonly lengthMetres: number;
  readonly climbMetres: number;
}

export type PublicRoomsAnswer =
  | { readonly kind: 'listed'; readonly rooms: readonly ListedRoom[] }
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
    /** On unless the rider making the room turns it off (#787). */
    readonly drafting: boolean;
    readonly route: RoomRouteSource;
    /** #788: list it as a PUBLIC room starting then, in Unix seconds. Absent: a private room, by its code. */
    readonly startsAt?: number | undefined;
  }): Promise<CreateRoomAnswer>;
  /** Join a room by the code a friend shared, and fetch and check its route. */
  join(code: string): Promise<JoinRoomAnswer>;
  /** #788: the public rooms this rider may join, in the instance's one order. */
  listPublic(): Promise<PublicRoomsAnswer>;
  /** #788: join a public room from the listing, and fetch and check its route. */
  joinPublic(room: ListedRoom): Promise<JoinRoomAnswer>;
  /** Start a race's countdown — only the rider who made the room may (the owner's ruling of 2026-09-30). */
  start(roomId: string): Promise<StartRaceAnswer>;
  /** A race's result, for its riders only. */
  results(roomId: string): Promise<RaceResultAnswer>;
}

export interface RoomsPortOptions {
  /** This device's `localStorage`: where `instance-port.ts` keeps the session. */
  readonly storage: InstanceStorage;
  /** Where this copy of the app was loaded from: a website's copy seals nothing (ADR 0047 D-11). */
  readonly loadedFrom: LoadedFrom;
  /** `ensureDeviceSigningKey`, bound: the session's key, which signs every sealed request. */
  readonly signingKey: () => Promise<SigningKey>;
  /** The rider's privacy zones, read from this device's store. */
  readonly zones: () => Promise<readonly PrivacyZoneRecord[]>;
  /** Injected so a test needs no network. */
  readonly send?: InstanceSend | undefined;
}

/** What an answer says, when it says "never". 429 is a refusal here: a limit on tries. */
function refusalOf(answer: {
  readonly status: number;
  readonly body: unknown;
}): RoomsRefusal | undefined {
  if (isSealedRequired(answer)) return 'cannot-seal';
  if ((answer.body as { error?: { code?: unknown } } | null)?.error?.code === 'not_eligible') {
    return 'not-eligible';
  }
  return refusalOfStatus(answer.status);
}

function refusalOfStatus(status: number): RoomsRefusal | undefined {
  if (status === 401) return 'not-signed-in';
  if (status === 404) return 'no-such-room';
  if (status === 429) return 'rate-limited';
  if (status >= 400 && status < 500) return 'instance-refused';
  return undefined;
}

const POSITIONS: readonly RoomRidingPosition[] = ['upright', 'hoods', 'drops'];

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function isListedRoom(value: unknown): value is ListedRoom {
  const room = value as Partial<ListedRoom> | null;
  return (
    typeof room === 'object' &&
    room !== null &&
    typeof room.roomId === 'string' &&
    isRoomId(room.roomId) &&
    (room.kind === 'group' || room.kind === 'race') &&
    POSITIONS.includes(room.ridingPosition as RoomRidingPosition) &&
    typeof room.drafting === 'boolean' &&
    typeof room.loop === 'boolean' &&
    finite(room.startsAt) &&
    finite(room.lengthMetres) &&
    finite(room.climbMetres)
  );
}

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
  const accountSession = heldAccountSession({
    storage: options.storage,
    loadedFrom: options.loadedFrom,
    signingKey: options.signingKey,
    send: options.send,
  });

  /** The session, or the refusal for one this device holds none of, or cannot seal (#1210). */
  async function held(): Promise<
    Extract<HeldAccountSession, { kind: 'open' }> | { readonly refused: RoomsRefusal }
  > {
    const session = await accountSession();
    if (session.kind === 'open') return session;
    return { refused: session.why === 'signed-out' ? 'not-signed-in' : 'cannot-seal' };
  }

  /** A room's route, fetched and checked against the room's own `routeRef`. */
  async function routeOf(
    roomId: string,
    routeSha256: string,
    loop: boolean,
  ): Promise<RouteProfile | RoomsRefusal | 'unreachable'> {
    const session = await held();
    if ('refused' in session) return session.refused;
    const answer = await session.sealedOrKeyless.call('GET', roomPath(roomId, 'route'), {
      token: session.token,
      maximumAnswerBytes: MAXIMUM_ROOM_ROUTE_ANSWER_BYTES,
    });
    if (answer.status !== 200) return refusalOf(answer) ?? 'unreachable';
    const gpx = (answer.body as { gpx?: unknown } | null)?.gpx;
    if (typeof gpx !== 'string') return 'not-the-rooms-route';
    return (await roomRouteFrom(gpx, routeSha256, loop)) ?? 'not-the-rooms-route';
  }

  /**
   * Join a room — by a code (`/v1/rooms/join`) or from the listing (#788,
   * `/v1/rooms/{roomId}/join`) — then fetch its route and check it against
   * the room's own digest. One path, so a room joined either way is entered
   * the same.
   */
  async function entered(
    path: string,
    body: { readonly code: string } | undefined,
    listed: EnteredRoom['listed'],
  ): Promise<JoinRoomAnswer> {
    try {
      const session = await held();
      if ('refused' in session) return { kind: 'refused', reason: session.refused };
      const answer = await session.sealedOrKeyless.call('POST', path, {
        token: session.token,
        ...(body === undefined ? {} : { body }),
      });
      const room = answer.body as {
        roomId?: unknown;
        kind?: unknown;
        ridingPosition?: unknown;
        drafting?: unknown;
        loop?: unknown;
        routeSha256?: unknown;
      } | null;
      if (answer.status !== 200) {
        const reason = refusalOf(answer);
        return reason === undefined ? { kind: 'unreachable' } : { kind: 'refused', reason };
      }
      if (
        typeof room?.roomId !== 'string' ||
        !isRoomId(room.roomId) ||
        (room.kind !== 'group' && room.kind !== 'race') ||
        !POSITIONS.includes(room.ridingPosition as RoomRidingPosition) ||
        typeof room.drafting !== 'boolean' ||
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
          drafting: room.drafting,
          profile,
          // The route's bytes were just checked against this digest (`routeOf`).
          routeSha256: room.routeSha256,
          ...(listed === undefined ? {} : { listed }),
        },
      };
    } catch {
      return { kind: 'unreachable' };
    }
  }

  return {
    async create(request) {
      // First, before anything is sent: a route in a privacy zone never leaves.
      const shared = sharedRoomRoute(request.route, await options.zones());
      if (shared.kind === 'refused') return shared;
      try {
        const session = await held();
        if ('refused' in session) return { kind: 'refused', reason: session.refused };
        const answer = await session.sealedOrKeyless.call('POST', '/v1/rooms', {
          token: session.token,
          body: {
            kind: request.kind,
            ridingPosition: request.ridingPosition,
            drafting: request.drafting,
            loop: shared.loop,
            lengthMetres: shared.course.lengthMetres,
            grades: shared.course.grades,
            gpx: shared.gpx,
            ...(request.startsAt === undefined
              ? {}
              : { visibility: 'public', startsAt: request.startsAt }),
          },
        });
        const made = answer.body as { roomId?: unknown; code?: unknown } | null;
        const listed = request.startsAt !== undefined;
        if (
          answer.status !== 200 ||
          typeof made?.roomId !== 'string' ||
          !isRoomId(made.roomId) ||
          // A private room answers its code; a public one has none to share.
          (listed ? made.code !== undefined : typeof made.code !== 'string')
        ) {
          const reason = refusalOf(answer);
          return reason === undefined ? { kind: 'unreachable' } : { kind: 'refused', reason };
        }
        return {
          kind: 'created',
          room: {
            roomId: made.roomId,
            kind: request.kind,
            ridingPosition: request.ridingPosition,
            drafting: request.drafting,
            ...(request.startsAt === undefined
              ? { code: made.code as string }
              : { listed: { startsAt: request.startsAt, madeHere: true } }),
            profile: shared.profile,
            // The bytes this device sent, digested here rather than taken from the answer.
            routeSha256: await routeDigest(shared.gpx),
          },
        };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    join: (code) => entered('/v1/rooms/join', { code }, undefined),

    async listPublic() {
      try {
        const session = await held();
        if ('refused' in session) return { kind: 'refused', reason: session.refused };
        const answer = await session.sealedOrKeyless.call('GET', '/v1/rooms/public', {
          token: session.token,
        });
        if (answer.status !== 200) {
          // Not found is the instance saying it lists none: its operator has
          // not turned public rooms on.
          const reason = answer.status === 404 ? 'no-public-rooms' : refusalOf(answer);
          return reason === undefined ? { kind: 'unreachable' } : { kind: 'refused', reason };
        }
        const rooms = (answer.body as { rooms?: unknown } | null)?.rooms;
        if (!Array.isArray(rooms) || !rooms.every(isListedRoom)) {
          return { kind: 'refused', reason: 'instance-refused' };
        }
        return { kind: 'listed', rooms };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    joinPublic: (room) =>
      isRoomId(room.roomId)
        ? entered(roomPath(room.roomId, 'join'), undefined, {
            startsAt: room.startsAt,
            madeHere: false,
          })
        : Promise.resolve({ kind: 'refused', reason: 'instance-refused' }),

    async start(roomId) {
      try {
        const session = await held();
        if ('refused' in session) return { kind: 'refused', reason: session.refused };
        const answer = await session.sealedOrKeyless.call('POST', roomPath(roomId, 'start'), {
          token: session.token,
        });
        if (answer.status === 200) return { kind: 'started' };
        const reason = refusalOf(answer);
        return reason === undefined ? { kind: 'unreachable' } : { kind: 'refused', reason };
      } catch {
        return { kind: 'unreachable' };
      }
    },

    async results(roomId) {
      try {
        const session = await held();
        if ('refused' in session) return { kind: 'refused', reason: session.refused };
        const answer = await session.sealedOrKeyless.call('GET', roomPath(roomId, 'results'), {
          token: session.token,
        });
        if (answer.status !== 200) {
          const reason = refusalOf(answer);
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
