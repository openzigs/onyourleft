// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A room a rider makes, and the friends they share its code with** — #784's
 * private group ride and #785's private race, on the instance.
 *
 * ```text
 * POST /v1/rooms                 { kind, ridingPosition, drafting?, loop, lengthMetres, grades, gpx,
 *                                    visibility?, startsAt? }
 *                                  → { roomId, code?, routeSha256 }     the creator is a member
 * POST /v1/rooms/join            { code } → { roomId, kind, ridingPosition, drafting, loop, routeSha256,
 *                                             creator }
 *                                  rate-limited; the joiner becomes a member
 * GET  /v1/rooms/public          → { rooms: [...] }                    #788: eligible athletes only
 * POST /v1/rooms/{roomId}/join   → as /v1/rooms/join                   #788: a public room, eligible only
 * GET  /v1/rooms/{roomId}/route  → { sha256, gpx }                     members only, while open
 * POST /v1/rooms/{roomId}/ticket (auth/routes.ts)                      members only, for a rider's room
 * POST /v1/rooms/{roomId}/start  (routes.ts)                           its creator, seated and connected
 * GET  /v1/rooms/{roomId}/results → publication.ts                     the race's riders only, once it is over
 * ```
 *
 * ## Private by default; public only where the operator turned it on — #788
 *
 * A room is `visibility: 'private'` unless its body says `public`, and a body
 * carrying any field this module does not read is refused whole
 * (`rooms.test.ts`). A private room needs nothing but a code among people who
 * know each other (ADR 0028 D-6.3). A PUBLIC room is listed for anybody
 * eligible to find, and so owes D-6.4's prerequisites, every one of them
 * checked here, on making, listing and joining alike:
 *
 * - **the operator turned public rooms on** (`OYL_INSTANCE_PUBLIC_ROOMS`,
 *   `legal.ts`) — OFF unless they did, so a self-hosted instance offers none
 *   by default. Off, the listing and joining are `not_found`, as though the
 *   routes were not there, and making one names the field;
 * - **the athlete is eligible** (#775's ONE predicate, `moderation/eligibility.ts`):
 *   approved, not suspended, confirmed 18 or over (ruling Q5), old enough and
 *   with rides synced — `not_eligible` otherwise;
 * - **no block either way** between the athlete and anybody in the room: a
 *   room holding a rider who blocks them, or whom they block, is left out of
 *   their listing, and joining it is `not_found` (the ticket asks again,
 *   `auth/identity.ts`), so a block is never placed in one public room;
 * - **at most {@link PUBLIC_ROOMS_PER_ATHLETE_PER_DAY} made a day** — the
 *   owner's ruling of 2026-10-15 — counted by the store in the transaction
 *   that writes, from the rooms themselves rather than a counter a restart
 *   forgets.
 *
 * A public room has a code too — the column is one per room — but it is
 * drawn, digested and thrown away: never shown, and joining by a code is
 * refused for a public room whatever the code.
 *
 * ## The listing is not editorial — ADR 0028 D-7.1
 *
 * {@link Rooms.listPublic} is ordered by the start its creator gave a room,
 * then when it was made, then its id, and by nothing else: no slot is
 * featured, recommended or pinned, and the instance never makes, picks or
 * schedules a room of its own. It shows a course's length and climb, never
 * its route: the GPX, and with it every coordinate, goes only to a rider who
 * joined (`route`).
 *
 * ## No course content served from an instance — ADR 0028 D-7.1, D-7.2
 *
 * The route is the CREATOR'S own, relayed to the people they invited for the
 * room's lifetime: this module stores what the creator's app sent, by the
 * SHA-256 of its bytes, and hands it back to members. It never curates,
 * features, schedules or suggests a route, and a room has **no leader**: its
 * creator's only power here is having made it. Nobody can move, pause or pace
 * another rider — the room core has no call that would (`room/core/room.ts`).
 *
 * ⚠️ **The course is the creator's app's arithmetic.** The room re-simulates
 * every rider on the length and grade steps the creator's app derived from the
 * route (ADR 0028 D-2); this instance does not parse the route to check them.
 * A creator whose app sent other grades than its route has only made their own
 * room ride differently from its road — every rider's trainer is still driven
 * by the rider's OWN reading of the route (`apps/web` §`game/gradient.ts`).
 *
 * ## The route's lifetime — #784
 *
 * The route is kept in a blob store of its own (`instance.ts`: the blob
 * directory's `rooms/`, outside the synced files), and deleted once the room
 * is over, unless another open room rides the same bytes. A closed room is
 * never opened again. A room is over — {@link Rooms.roomLetGo}, {@link
 * Rooms.sweep} and {@link Rooms.closeRoomsMadeBy}, all through ONE close — when:
 *
 * 1. **a race finished**, or **a group ride was empty past its grace** — the
 *    worker that held it lets it go;
 * 2. **nobody is riding it {@link UNRIDDEN_ROOM_LIFETIME_MS} after it was
 *    made** — whether or not anybody ever joined it (the sweep, every
 *    {@link ROOM_SWEEP_PERIOD_MS} and once as the instance opens);
 * 3. **a race that had started is held by no worker** — the instance restarted
 *    in the middle of it, and a started race is never opened again (#807's
 *    ruling): the same sweep, the first time it runs;
 * 4. **its creator erased their account** — before their rows go
 *    (`sync/routes.ts` §`eraseAccount`), and by the sweep for a room whose
 *    creator is gone however that happened. A rider still connected to it
 *    rides on — the route is on their device already — but nobody joins it,
 *    by its code or by a socket, and the instance holds no copy.
 *
 * {@link MAXIMUM_OPEN_ROOMS_PER_ATHLETE} still bounds what one athlete holds
 * at once, whatever the rate of making rooms.
 *
 * ### Letting a route go, and the races around it — #948
 *
 * - **One route, one step at a time.** Ending a room counts the other open
 *   rooms on its route and deletes the file; making a room writes the file and
 *   then its row. Both run under a lock on the route's digest, so a room made
 *   on the same bytes in the same moment either is counted, or writes the file
 *   again after the delete — never loses it (N-a). ⚠️ The lock is this
 *   process's: an operator command run beside a live instance
 *   (`operator/commands.ts`) is not inside it.
 * - **The route goes first, and the close commits.** A delete that throws
 *   leaves the room open, so the next sweep that finds it due ends it again
 *   and the file is not orphaned behind a closed row (N-b). A race the worker
 *   let go is due at once; a group ride within its day.
 * - **The sweep and a socket agree.** The sweep ends a room only once the
 *   router has said no worker holds it AND that it will place none until the
 *   sweep is done with it (`RoomRouter.claimForEnding`): a socket whose lookup
 *   read the room as open before it closed is refused `room-closed`, not
 *   seated in a room whose route is being deleted.
 */

import { PHYSICS_VERSION, type RidingPosition } from '@onyourleft/physics';

import { randomHex } from '../auth/crypto.ts';
import type { Caller, Outcome } from '../auth/identity.ts';
import {
  addressKey,
  createRateLimiter,
  sweepPeriodMs,
  type RateLimit,
} from '../auth/rate-limit.ts';
import { sha256Hex, type BlobStore } from '../blob/blob-store.ts';
import type { ErrorCode, FieldProblem } from '../errors.ts';
import type { ClientInfo } from '../route-kit.ts';
import type { RoomPhase } from '../room/core/room.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { displayRoomCode, newRoomCode, normaliseRoomCode, roomCodeDigest } from './code.ts';
import { publishRace, type PublishedResult } from './publication.ts';

/** The most UTF-8 bytes a room's route may be: inside the instance's 1 MiB body with room to spare. */
export const MAXIMUM_ROUTE_BYTES = 900 * 1024;

/** The most grade steps a course may carry. */
export const MAXIMUM_GRADE_STEPS = 50_000;

/** The longest course, in metres: 1 000 km. */
export const MAXIMUM_COURSE_METRES = 1_000_000;

/** The steepest grade a course may carry, either way, in percent. */
export const MAXIMUM_GRADE_PERCENT = 40;

/**
 * How many rooms one athlete may have made that are not over — #784. A room
 * nobody ever rides is never over (the header says so), and each holds up to
 * {@link MAXIMUM_ROUTE_BYTES} of route on the instance's disk, so this is what
 * bounds that per athlete rather than the create rate alone. ⚠️ The author's
 * number: enough for a rider to make a group ride and a race for two groups of
 * friends at once.
 */
export const MAXIMUM_OPEN_ROOMS_PER_ATHLETE = 5;

/**
 * How long a room nobody is riding stays open after it was made — #784: a
 * day, and then it is over and its route deleted. ⚠️ The author's number: long
 * enough to make a room in the morning for friends to ride that evening. A room
 * somebody is riding at that moment is not ended by it; it ends as rule 1 says.
 */
export const UNRIDDEN_ROOM_LIFETIME_MS = 24 * 60 * 60_000;

/** At most this many PUBLIC rooms made by one athlete in a day — the owner's ruling of 2026-10-15 (#788). */
export const PUBLIC_ROOMS_PER_ATHLETE_PER_DAY = 3;

/**
 * How far ahead a public room's start may be (#788): twelve hours. ⚠️ The
 * author's number, under {@link UNRIDDEN_ROOM_LIFETIME_MS}, so a room is never
 * swept away before the start it was listed for.
 */
export const PUBLIC_ROOM_START_AHEAD_MS = 12 * 60 * 60_000;

/** How far behind now a public room's start may be: a clock a few minutes slow (#788). */
export const PUBLIC_ROOM_START_BEHIND_MS = 5 * 60_000;

/** The most public rooms one listing answers (#788): the first in the listing's order. */
export const MAXIMUM_LISTED_PUBLIC_ROOMS = 100;

/** How often the instance looks for rooms that are over and nobody closed: ten minutes. */
export const ROOM_SWEEP_PERIOD_MS = 10 * 60_000;

/** How often a rider may make a room, try a code, and from one address. */
export interface RoomLimits {
  /** Rooms one athlete may make. */
  readonly createsPerAthlete: RateLimit;
  /** Codes one athlete may try, right or wrong: #784's "rate-limited per session", per athlete. */
  readonly joinsPerAthlete: RateLimit;
  /** Codes one address may try, whoever is signed in there. */
  readonly joinsPerAddress: RateLimit;
}

/**
 * ⚠️ **The author's numbers.** Ten tries a quarter of an hour is more than a
 * rider mistyping a code needs, and at 75 bits (`code.ts`) it is about 10¹⁶
 * years of guessing for an even chance at one room.
 */
export const DEFAULT_ROOM_LIMITS: RoomLimits = {
  createsPerAthlete: { limit: 10, windowMs: 60 * 60_000 },
  joinsPerAthlete: { limit: 10, windowMs: 15 * 60_000 },
  joinsPerAddress: { limit: 30, windowMs: 15 * 60_000 },
};

/** A room as its creator is told of it. */
export interface CreatedRoom {
  readonly roomId: string;
  /**
   * The code, in three groups of five. Shown once, to its creator; never
   * stored. Absent for a public room, which is joined from the listing.
   */
  readonly code?: string;
  readonly routeSha256: string;
}

/** A public room as the listing tells an eligible athlete of it (#788): never its route. */
export interface ListedRoom {
  readonly roomId: string;
  readonly kind: 'group' | 'race';
  readonly ridingPosition: RidingPosition;
  readonly drafting: boolean;
  readonly loop: boolean;
  /** Unix seconds: the start its creator gave it. */
  readonly startsAt: number;
  readonly lengthMetres: number;
  /** Metres climbed over the course once, from its grade steps. */
  readonly climbMetres: number;
}

/** A room as a rider who joined by its code is told of it. */
export interface JoinedRoom {
  readonly roomId: string;
  readonly kind: 'group' | 'race';
  readonly ridingPosition: RidingPosition;
  /** Whether the room drafts — #787: a joiner is told before the start. */
  readonly drafting: boolean;
  readonly loop: boolean;
  readonly routeSha256: string;
  /**
   * Whether the joiner made the room (#948, #929's N1): the rider who made it
   * may join it again by its code — after a reload, or on another device —
   * and is still the one offered *Start the race*.
   */
  readonly creator: boolean;
}

/**
 * What {@link Rooms.sweep} asks of the room router (`RoomRouter`): `claim`
 * answers whether no live worker holds the room and, when none does, promises
 * the router places it on none until `release` — so a socket and the sweep
 * cannot both win the same room (#948).
 */
export interface SweepGuard {
  claim(roomId: string): boolean;
  release(roomId: string): void;
}

/** A room's route, as its members fetch it. */
export interface RoomRoute {
  readonly sha256: string;
  /** The route's GPX, exactly as the creator's app sent it. */
  readonly gpx: string;
}

export interface Rooms {
  create(caller: Caller, body: Readonly<Record<string, unknown>>): Promise<Outcome<CreatedRoom>>;
  join(
    caller: Caller,
    body: Readonly<Record<string, unknown>>,
    client: ClientInfo,
  ): Promise<Outcome<JoinedRoom>>;
  route(caller: Caller, roomId: string): Promise<Outcome<RoomRoute>>;
  /** #788: the open public rooms an eligible athlete may join, in the listing's one order. */
  listPublic(caller: Caller): Promise<Outcome<{ rooms: readonly ListedRoom[] }>>;
  /** #788: join a public room from the listing; the joiner becomes a member. */
  joinPublic(caller: Caller, roomId: string): Promise<Outcome<JoinedRoom>>;
  /**
   * Who the caller is to a room that is not over (#789): its `host` (the
   * rider who made it), a `member` (who joined it by its code — or anybody,
   * in a room an operator opened, which has no members list), or `undefined`.
   */
  standing(caller: Caller, roomId: string): Promise<'host' | 'member' | undefined>;
  results(caller: Caller, roomId: string): Promise<Outcome<PublishedResult>>;
  /** A room worker let `roomId` go at `phase` (`room/node/router.ts`). */
  roomLetGo(roomId: string, phase: RoomPhase): Promise<void>;
  /**
   * Ends every room nobody is riding that should be over — made more than
   * {@link UNRIDDEN_ROOM_LIFETIME_MS} ago, a race that started, or one whose
   * creator is gone — and deletes their routes. A room is ended only once
   * `guard` has claimed it from the router ({@link SweepGuard}). Answers how
   * many it ended; a room it could not end is left open for the next sweep,
   * and the first such failure is thrown once every other room was tried.
   */
  sweep(guard: SweepGuard): Promise<number>;
  /**
   * Ends every room `athleteId` made that is not over, and deletes their
   * routes — for an account being erased (#784), before its rows go.
   */
  closeRoomsMadeBy(athleteId: string): Promise<void>;
  sweepRateLimits(): void;
  readonly rateLimitSweepPeriodMs: number;
  heldRateLimitKeys(): number;
}

export interface RoomsOptions {
  readonly store: SqlStore;
  /** Where rooms' routes are kept — their own store, never the synced files'. */
  readonly routes: BlobStore;
  /** What the viewer may see of an athlete: a display name, or `undefined` (#83's choke point). */
  readonly nameFor: (viewerId: string, subjectId: string) => Promise<string | undefined>;
  /** Unix milliseconds. */
  readonly now: () => number;
  readonly limits?: RoomLimits;
  /** A new code — `code.ts`'s, from the CSPRNG, unless a test's. */
  readonly code?: () => string;
  /**
   * Whether the operator turned public rooms on (#788, `legal.ts`'s
   * `OYL_INSTANCE_PUBLIC_ROOMS`). Absent is OFF: the default an instance starts with.
   */
  readonly publicRooms?: boolean;
  /**
   * Whether the athlete may enter a public room — #775's predicate, through
   * the identity's own account read. Absent is nobody.
   */
  readonly eligible?: (caller: Caller) => Promise<boolean>;
}

const refuse = (code: ErrorCode, fields?: readonly FieldProblem[]): Outcome<never> =>
  fields === undefined ? { ok: false, code } : { ok: false, code, fields };

const invalid = (field: string, problem: string): Outcome<never> =>
  refuse('validation_failed', [{ field, problem }]);

/** The fields a new room's body may carry, and no other. */
const CREATE_FIELDS = new Set([
  'kind',
  'ridingPosition',
  'drafting',
  'loop',
  'lengthMetres',
  'grades',
  'gpx',
  'visibility',
  'startsAt',
]);

/** Metres climbed over a course once: each rising step's grade over its length. */
export function climbOf(
  lengthMetres: number,
  grades: readonly (readonly [number, number])[],
): number {
  let climb = 0;
  grades.forEach(([from, percent], index) => {
    const to = Math.min(grades[index + 1]?.[0] ?? lengthMetres, lengthMetres);
    if (percent > 0 && to > from) climb += ((to - from) * percent) / 100;
  });
  return Math.round(climb);
}

const POSITIONS: readonly RidingPosition[] = ['upright', 'hoods', 'drops'];

/** A course's grade steps, checked whole, or the problem with them. */
function checkedGrades(value: unknown): [number, number][] | string {
  if (!Array.isArray(value) || value.length === 0)
    return 'must be a list of [metres, percent] steps';
  if (value.length > MAXIMUM_GRADE_STEPS) {
    return `must hold at most ${String(MAXIMUM_GRADE_STEPS)} steps`;
  }
  const steps: [number, number][] = [];
  let previous = -Infinity;
  for (const step of value as unknown[]) {
    if (!Array.isArray(step) || step.length !== 2) return 'each step is [metres, percent]';
    const [from, percent] = step as unknown[];
    if (
      typeof from !== 'number' ||
      typeof percent !== 'number' ||
      !Number.isFinite(from) ||
      !Number.isFinite(percent) ||
      from <= previous ||
      Math.abs(percent) > MAXIMUM_GRADE_PERCENT
    ) {
      return `each step is finite, ascending, and within ±${String(MAXIMUM_GRADE_PERCENT)} %`;
    }
    if (steps.length === 0 && from !== 0) return 'the first step starts at 0 m';
    steps.push([from, percent]);
    previous = from;
  }
  return steps;
}

export function createRooms(options: RoomsOptions): Rooms {
  const { store, routes, now } = options;
  const limits = options.limits ?? DEFAULT_ROOM_LIMITS;
  const creates = createRateLimiter(limits.createsPerAthlete, now);
  const joinsPerAthlete = createRateLimiter(limits.joinsPerAthlete, now);
  const joinsPerAddress = createRateLimiter(limits.joinsPerAddress, now);
  const code = options.code ?? (() => newRoomCode());
  const seconds = (): number => Math.floor(now() / 1000);
  const publicRooms = options.publicRooms === true;
  const eligible = options.eligible ?? (() => Promise.resolve(false));

  /**
   * #788: why `caller` may not reach public rooms, or `undefined` when they
   * may — off on this instance is `not_found`, as though no route were there.
   */
  async function publicRefusal(caller: Caller): Promise<Outcome<never> | undefined> {
    if (!publicRooms) return refuse('not_found');
    if (!(await eligible(caller))) return refuse('not_eligible');
    return undefined;
  }

  /** #788: whether a moderator hid `roomId`'s listing (#913). */
  async function hiddenRoom(roomId: string): Promise<boolean> {
    return (await store.listHiddenItemsOfRoom(roomId)).some(
      (each) => each.item === `room:${roomId}`,
    );
  }

  /** Whose turn it is on each route digest (#948 N-a): the tail of its queue. */
  const routeTurns = new Map<string, Promise<void>>();

  /** `work`, once every earlier holder of `routeSha256`'s turn is done. */
  async function onRoute<T>(routeSha256: string, work: () => Promise<T>): Promise<T> {
    const before = routeTurns.get(routeSha256) ?? Promise.resolve();
    let done = (): void => undefined;
    const tail = before.then(() => new Promise<void>((resolve) => (done = resolve)));
    routeTurns.set(routeSha256, tail);
    await before;
    try {
      return await work();
    } finally {
      done();
      if (routeTurns.get(routeSha256) === tail) routeTurns.delete(routeSha256);
    }
  }

  /**
   * THE one way a room is over (#784): its route deleted unless another open
   * room rides the same bytes, and then closed, never to open again. `true`
   * the first time, `false` for a room already over or not a rider's room.
   * The delete comes first (#948 N-b): one that throws leaves the room open,
   * for the next sweep to end.
   */
  async function over(roomId: string): Promise<boolean> {
    const room = await store.getRoom(roomId);
    const made = await store.getPrivateRoom(roomId);
    if (room === undefined || made === undefined || made.closedAt !== null) return false;
    return onRoute(room.routeSha256, async () => {
      if ((await store.countOpenPrivateRoomsWithRoute(room.routeSha256, roomId)) === 0) {
        await routes.delete(room.routeSha256);
      }
      return store.closePrivateRoom(roomId, seconds());
    });
  }

  /** `caller` joins `roomId` — by its code, or from the listing — and is told what it is. */
  async function joined(
    caller: Caller,
    roomId: string,
    loop: boolean,
  ): Promise<Outcome<JoinedRoom>> {
    const room = await store.getRoom(roomId);
    const course = await store.getRoomCourse(roomId);
    if (room === undefined || course === undefined) return refuse('not_found');
    await store.addRoomMember(roomId, caller.athleteId, seconds());
    return {
      ok: true,
      value: {
        roomId,
        kind: room.kind,
        ridingPosition: course.ridingPosition,
        drafting: course.drafting !== false,
        loop,
        routeSha256: room.routeSha256,
        creator: (await store.getRoomCreator(roomId)) === caller.athleteId,
      },
    };
  }

  /** A private room this athlete may see into: a member of it, and the room not over. */
  async function openRoomOf(caller: Caller, roomId: string) {
    const room = await store.getPrivateRoom(roomId);
    if (room === undefined || room.closedAt !== null) return undefined;
    return (await store.isRoomMember(roomId, caller.athleteId)) ? room : undefined;
  }

  return {
    async create(caller, body) {
      for (const key of Object.keys(body)) {
        // Refused whole, rather than ignored: a `visibility` would otherwise be
        // a field somebody believes they set. A room made here is private.
        if (!CREATE_FIELDS.has(key)) return invalid(key, 'is not part of a room');
      }
      const { kind, ridingPosition, loop, lengthMetres, gpx } = body;
      const visibility = body.visibility ?? 'private';
      if (visibility !== 'private' && visibility !== 'public') {
        return invalid('visibility', 'must be private or public');
      }
      if (kind !== 'group' && kind !== 'race') return invalid('kind', 'must be group or race');
      if (!POSITIONS.includes(ridingPosition as RidingPosition)) {
        return invalid('ridingPosition', 'must be upright, hoods or drops');
      }
      if (typeof loop !== 'boolean') return invalid('loop', 'must be true or false');
      // #787, the owner's ruling of 2026-09-30: on unless the maker says off.
      const drafting = body.drafting ?? true;
      if (typeof drafting !== 'boolean') return invalid('drafting', 'must be true or false');
      if (
        typeof lengthMetres !== 'number' ||
        !Number.isFinite(lengthMetres) ||
        lengthMetres <= 0 ||
        lengthMetres > MAXIMUM_COURSE_METRES
      ) {
        return invalid('lengthMetres', 'must be a distance above 0 m and at most 1 000 km');
      }
      const grades = checkedGrades(body.grades);
      if (typeof grades === 'string') return invalid('grades', grades);
      if (typeof gpx !== 'string' || gpx.length === 0) return invalid('gpx', 'must be the route');
      const bytes = new TextEncoder().encode(gpx);
      if (bytes.byteLength > MAXIMUM_ROUTE_BYTES) {
        return invalid('gpx', `must be at most ${String(MAXIMUM_ROUTE_BYTES)} bytes`);
      }
      let startsAt: number | null = null;
      if (visibility === 'private') {
        if (body.startsAt !== undefined) return invalid('startsAt', 'is for a public room only');
      } else {
        if (!publicRooms) return invalid('visibility', 'this instance offers no public rooms');
        if (!(await eligible(caller))) return refuse('not_eligible');
        const at = body.startsAt;
        if (
          typeof at !== 'number' ||
          !Number.isSafeInteger(at) ||
          at * 1000 < now() - PUBLIC_ROOM_START_BEHIND_MS ||
          at * 1000 > now() + PUBLIC_ROOM_START_AHEAD_MS
        ) {
          return invalid('startsAt', 'must be a time in Unix seconds within the next 12 hours');
        }
        startsAt = at;
      }
      if (!creates.allow(caller.athleteId)) return refuse('rate_limited');
      if (
        (await store.countOpenPrivateRoomsMadeBy(caller.athleteId)) >=
        MAXIMUM_OPEN_ROOMS_PER_ATHLETE
      ) {
        return refuse('rate_limited');
      }

      const routeSha256 = await sha256Hex(bytes);
      // #948 N-a: the file and the row are written in the route's turn, so an
      // ending room on the same bytes cannot delete the file between them.
      return onRoute(routeSha256, async (): Promise<Outcome<CreatedRoom>> => {
        await routes.put(bytes, routeSha256);
        const roomId = randomHex(16);
        const createdAt = seconds();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const drawn = code();
          const written = await store.createPrivateRoom({
            room: {
              id: roomId,
              kind,
              visibility,
              routeSha256,
              physicsVersion: PHYSICS_VERSION,
            },
            course: {
              roomId,
              lengthMetres,
              grades,
              ridingPosition: ridingPosition as RidingPosition,
              capacity: null,
              // A race counts down from its start (`room/core/settings.ts`'s
              // default); a group ride starts on its first rider, at once.
              countdownMs: kind === 'race' ? null : 0,
              rejoinWindowMs: null,
              drafting,
              raceStartedAt: null,
            },
            codeSha256: await roomCodeDigest(drawn),
            routeLoop: loop,
            creatorAthleteId: caller.athleteId,
            createdAt,
            startsAt,
            ...(visibility === 'public'
              ? {
                  publicCap: {
                    limit: PUBLIC_ROOMS_PER_ATHLETE_PER_DAY,
                    sinceSeconds: createdAt - 24 * 60 * 60,
                  },
                }
              : {}),
          });
          if (written === 'rate-limited') {
            // Nothing was written: the route goes unless another open room rides it.
            if ((await store.countOpenPrivateRoomsWithRoute(routeSha256, roomId)) === 0) {
              await routes.delete(routeSha256);
            }
            return refuse('rate_limited');
          }
          if (written === 'created') {
            // A public room's code is never shown: it is joined from the listing.
            return visibility === 'public'
              ? { ok: true, value: { roomId, routeSha256 } }
              : { ok: true, value: { roomId, code: displayRoomCode(drawn), routeSha256 } };
          }
        }
        // Three collisions in a 75-bit space is a broken random source, not bad luck.
        throw new Error('could not draw an unused room code');
      });
    },

    async join(caller, body, client) {
      // Counted BEFORE the code is looked at, right or wrong, so a guesser
      // pays for every guess. Both limits are counted whatever the other says.
      const byAthlete = joinsPerAthlete.allow(caller.athleteId);
      const byAddress =
        client.address === null ? true : joinsPerAddress.allow(addressKey(client.address));
      if (!byAthlete || !byAddress) return refuse('rate_limited');
      const typed = normaliseRoomCode(body.code);
      // A code that cannot be one, one nobody made, and one whose room is
      // over are one answer: nothing tells a guesser which.
      if (typed === undefined) return refuse('not_found');
      const found = await store.findPrivateRoomByCode(await roomCodeDigest(typed));
      if (found === undefined || found.closedAt !== null) return refuse('not_found');
      // #913: a room whose listing a moderator hid takes nobody new — the
      // same answer as a room that is over, so the code tells a guesser nothing.
      if (await hiddenRoom(found.roomId)) return refuse('not_found');
      const room = await store.getRoom(found.roomId);
      // #788: a public room is joined from the listing, by an eligible
      // athlete, and never by a code — its code was never shown to anybody.
      if (room?.visibility !== 'private') return refuse('not_found');
      return joined(caller, found.roomId, found.routeLoop);
    },

    async listPublic(caller) {
      const refused = await publicRefusal(caller);
      if (refused !== undefined) return refused;
      const listed: ListedRoom[] = [];
      for (const room of await store.listOpenPublicRooms()) {
        if (listed.length >= MAXIMUM_LISTED_PUBLIC_ROOMS) break;
        // A race that left its lobby takes nobody new; a hidden room is
        // listed for nobody; a block either way keeps the two apart.
        if (room.raceStarted || (await hiddenRoom(room.roomId))) continue;
        // #789: a rider the host or a moderator removed is not shown a room
        // they cannot enter.
        if (await store.isRemovedFromRoom(room.roomId, caller.athleteId)) continue;
        if (await store.hasBlockWithRoomMember(room.roomId, caller.athleteId)) continue;
        listed.push({
          roomId: room.roomId,
          kind: room.kind,
          ridingPosition: room.ridingPosition,
          drafting: room.drafting,
          loop: room.loop,
          startsAt: room.startsAt,
          lengthMetres: room.lengthMetres,
          climbMetres: climbOf(room.lengthMetres, room.grades),
        });
      }
      return { ok: true, value: { rooms: listed } };
    },

    async joinPublic(caller, roomId) {
      const refused = await publicRefusal(caller);
      if (refused !== undefined) return refused;
      const made = await store.getPrivateRoom(roomId);
      const room = await store.getRoom(roomId);
      const course = await store.getRoomCourse(roomId);
      // Whatever is not an open public room the listing would show is one
      // answer: a private room's id tells a guesser nothing either.
      if (
        made === undefined ||
        made.closedAt !== null ||
        room?.visibility !== 'public' ||
        course === undefined ||
        course.raceStartedAt !== null ||
        (await hiddenRoom(roomId)) ||
        (await store.isRemovedFromRoom(roomId, caller.athleteId)) ||
        (await store.hasBlockWithRoomMember(roomId, caller.athleteId))
      ) {
        return refuse('not_found');
      }
      return joined(caller, roomId, made.routeLoop);
    },

    async standing(caller, roomId) {
      const made = await store.getPrivateRoom(roomId);
      if (made === undefined) {
        return (await store.getRoom(roomId)) === undefined ? undefined : 'member';
      }
      if ((await openRoomOf(caller, roomId)) === undefined) return undefined;
      return (await store.getRoomCreator(roomId)) === caller.athleteId ? 'host' : 'member';
    },

    async route(caller, roomId) {
      const room = await openRoomOf(caller, roomId);
      if (room === undefined) return refuse('not_found');
      // #913: a hidden route — or a hidden room — is shown to nobody but the
      // rider whose it is; nothing is deleted.
      const hidden = await store.listHiddenItemsOfRoom(roomId);
      if (
        hidden.some(
          (each) =>
            (each.item === `route:${roomId}` || each.item === `room:${roomId}`) &&
            each.ownerAthleteId !== caller.athleteId,
        )
      ) {
        return refuse('not_found');
      }
      const sha256 = (await store.getRoom(roomId))?.routeSha256;
      const bytes = sha256 === undefined ? undefined : await routes.get(sha256);
      if (sha256 === undefined || bytes === undefined) return refuse('not_found');
      return { ok: true, value: { sha256, gpx: new TextDecoder().decode(bytes) } };
    },

    async results(caller, roomId) {
      // Not while the race runs (ADR 0028 D-7.7): a rider over the line
      // could otherwise read the order of the riders behind them as they
      // cross it. Over is the room saying so — everybody across the line or
      // out of it. A race a restart interrupted was never decided, and has no
      // result to publish.
      const course = await store.getRoomCourse(roomId);
      if (course?.raceFinishedAt === undefined) {
        // #948 N-d: a room that is over and never said its race was decided
        // — a restart interrupted it, or it was never ridden to the line —
        // has no result, and never will; its members are told so apart from
        // "not over yet". Anybody else learns nothing about it.
        const made = await store.getPrivateRoom(roomId);
        return course !== undefined &&
          made !== undefined &&
          made.closedAt !== null &&
          (await store.isRoomMember(roomId, caller.athleteId))
          ? refuse('race_without_result')
          : refuse('not_found');
      }
      const results = await store.listRoomResults(roomId);
      // A race's riders only (ruling Q2): an athlete with a result in it. Not
      // a member who never rode, and not a stranger — both are `not_found`.
      if (!results.some((result) => result.athleteId === caller.athleteId)) {
        return refuse('not_found');
      }
      const names = new Map<string, string | undefined>();
      for (const result of results) {
        names.set(result.athleteId, await options.nameFor(caller.athleteId, result.athleteId));
      }
      // #913: rows a moderator hid, by the row number a notice names them by.
      // Kept by owner, not row number: an erased rider moves later rows up.
      const hiddenOwners = new Set(
        (await store.listHiddenItemsOfRoom(roomId))
          .filter((each) => each.item.startsWith(`result:${roomId}:`))
          .map((each) => each.ownerAthleteId),
      );
      return {
        ok: true,
        value: publishRace(
          results,
          { viewerAthleteId: caller.athleteId, nameFor: (athleteId) => names.get(athleteId) },
          course?.finishers ?? 0,
          hiddenOwners,
        ),
      };
    },

    async roomLetGo(roomId, phase) {
      // A lobby that emptied is not over: a later socket opens it again.
      if (phase !== 'finished' && phase !== 'closed') return;
      await over(roomId);
    },

    async sweep(guard) {
      const oldest = seconds() - UNRIDDEN_ROOM_LIFETIME_MS / 1000;
      let ended = 0;
      let failed: { readonly error: unknown } | undefined;
      for (const room of await store.listOpenPrivateRooms()) {
        if (!(room.raceStarted || !room.creatorPresent || room.createdAt <= oldest)) continue;
        // Held by a live worker — or placed on one from now until released.
        if (!guard.claim(room.roomId)) continue;
        try {
          if (await over(room.roomId)) ended += 1;
        } catch (error) {
          // #948 N-b: left open for the next sweep; the others are still tried.
          failed ??= { error };
        } finally {
          guard.release(room.roomId);
        }
      }
      if (failed !== undefined) throw failed.error;
      return ended;
    },

    async closeRoomsMadeBy(athleteId) {
      for (const roomId of await store.listOpenPrivateRoomsMadeBy(athleteId)) await over(roomId);
    },

    sweepRateLimits() {
      creates.sweep();
      joinsPerAthlete.sweep();
      joinsPerAddress.sweep();
    },
    rateLimitSweepPeriodMs: sweepPeriodMs([
      limits.createsPerAthlete,
      limits.joinsPerAthlete,
      limits.joinsPerAddress,
    ]),
    heldRateLimitKeys: () => creates.size + joinsPerAthlete.size + joinsPerAddress.size,
  };
}
