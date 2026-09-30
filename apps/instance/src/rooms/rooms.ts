// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A room a rider makes, and the friends they share its code with** — #784's
 * private group ride and #785's private race, on the instance.
 *
 * ```text
 * POST /v1/rooms                 { kind, ridingPosition, loop, lengthMetres, grades, gpx }
 *                                  → { roomId, code, routeSha256 }      the creator is a member
 * POST /v1/rooms/join            { code } → { roomId, kind, ridingPosition, loop, routeSha256 }
 *                                  rate-limited; the joiner becomes a member
 * GET  /v1/rooms/{roomId}/route  → { sha256, gpx }                     members only, while open
 * POST /v1/rooms/{roomId}/ticket (auth/routes.ts)                      members only, for a rider's room
 * POST /v1/rooms/{roomId}/start  (routes.ts)                           any rider seated and connected
 * GET  /v1/rooms/{roomId}/results → publication.ts                     the race's riders only, once it is over
 * ```
 *
 * ## Private, and only private
 *
 * Every room made here is `visibility: 'private'`, and nothing a request can
 * say changes that: the body names no visibility, and a body carrying any
 * field this module does not read is refused whole (`rooms.test.ts`). Public
 * rooms wait for #907, #910 and #911 (ADR 0028 D-6.4); a private room needs
 * nothing but a code among people who know each other (D-6.3).
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
import type { BlobStore } from '../blob/blob-store.ts';
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
  /** The code, in three groups of five. Shown once, to its creator; never stored. */
  readonly code: string;
  readonly routeSha256: string;
}

/** A room as a rider who joined by its code is told of it. */
export interface JoinedRoom {
  readonly roomId: string;
  readonly kind: 'group' | 'race';
  readonly ridingPosition: RidingPosition;
  readonly loop: boolean;
  readonly routeSha256: string;
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
  results(caller: Caller, roomId: string): Promise<Outcome<PublishedResult>>;
  /** A room worker let `roomId` go at `phase` (`room/node/router.ts`). */
  roomLetGo(roomId: string, phase: RoomPhase): Promise<void>;
  /**
   * Ends every room nobody is riding that should be over — made more than
   * {@link UNRIDDEN_ROOM_LIFETIME_MS} ago, a race that started, or one whose
   * creator is gone — and deletes their routes. `holds` is whether a live
   * worker holds a room (`RoomRouter.holds`). Answers how many it ended.
   */
  sweep(holds: (roomId: string) => boolean): Promise<number>;
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
}

const refuse = (code: ErrorCode, fields?: readonly FieldProblem[]): Outcome<never> =>
  fields === undefined ? { ok: false, code } : { ok: false, code, fields };

const invalid = (field: string, problem: string): Outcome<never> =>
  refuse('validation_failed', [{ field, problem }]);

/** The fields a new room's body may carry, and no other. */
const CREATE_FIELDS = new Set(['kind', 'ridingPosition', 'loop', 'lengthMetres', 'grades', 'gpx']);

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

  /**
   * THE one way a room is over (#784): closed, never to open again, and its
   * route deleted unless another open room rides the same bytes. `true` the
   * first time, `false` for a room already over or not a rider's room.
   */
  async function over(roomId: string): Promise<boolean> {
    const room = await store.getRoom(roomId);
    if (room === undefined || !(await store.closePrivateRoom(roomId, seconds()))) return false;
    if ((await store.countOpenPrivateRoomsWithRoute(room.routeSha256, roomId)) === 0) {
      await routes.delete(room.routeSha256);
    }
    return true;
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
      if (kind !== 'group' && kind !== 'race') return invalid('kind', 'must be group or race');
      if (!POSITIONS.includes(ridingPosition as RidingPosition)) {
        return invalid('ridingPosition', 'must be upright, hoods or drops');
      }
      if (typeof loop !== 'boolean') return invalid('loop', 'must be true or false');
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
      if (!creates.allow(caller.athleteId)) return refuse('rate_limited');
      if (
        (await store.countOpenPrivateRoomsMadeBy(caller.athleteId)) >=
        MAXIMUM_OPEN_ROOMS_PER_ATHLETE
      ) {
        return refuse('rate_limited');
      }

      const routeSha256 = await routes.put(bytes);
      const roomId = randomHex(16);
      const createdAt = seconds();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const drawn = code();
        const written = await store.createPrivateRoom({
          room: {
            id: roomId,
            kind,
            visibility: 'private',
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
            raceStartedAt: null,
          },
          codeSha256: await roomCodeDigest(drawn),
          routeLoop: loop,
          creatorAthleteId: caller.athleteId,
          createdAt,
        });
        if (written === 'created')
          return { ok: true, value: { roomId, code: displayRoomCode(drawn), routeSha256 } };
      }
      // Three collisions in a 75-bit space is a broken random source, not bad luck.
      throw new Error('could not draw an unused room code');
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
      const room = await store.getRoom(found.roomId);
      const course = await store.getRoomCourse(found.roomId);
      if (room === undefined || course === undefined) return refuse('not_found');
      await store.addRoomMember(found.roomId, caller.athleteId, seconds());
      return {
        ok: true,
        value: {
          roomId: found.roomId,
          kind: room.kind,
          ridingPosition: course.ridingPosition,
          loop: found.routeLoop,
          routeSha256: room.routeSha256,
        },
      };
    },

    async route(caller, roomId) {
      const room = await openRoomOf(caller, roomId);
      if (room === undefined) return refuse('not_found');
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
      if (course?.raceFinishedAt === undefined) return refuse('not_found');
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
      return {
        ok: true,
        value: publishRace(
          results,
          { viewerAthleteId: caller.athleteId, nameFor: (athleteId) => names.get(athleteId) },
          course?.finishers ?? 0,
        ),
      };
    },

    async roomLetGo(roomId, phase) {
      // A lobby that emptied is not over: a later socket opens it again.
      if (phase !== 'finished' && phase !== 'closed') return;
      await over(roomId);
    },

    async sweep(holds) {
      const oldest = seconds() - UNRIDDEN_ROOM_LIFETIME_MS / 1000;
      let ended = 0;
      for (const room of await store.listOpenPrivateRooms()) {
        if (holds(room.roomId)) continue;
        if (room.raceStarted || !room.creatorPresent || room.createdAt <= oldest) {
          if (await over(room.roomId)) ended += 1;
        }
      }
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
