// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A game ride in a room** — #782, #783: what `GameView` does with a room
 * connection on each frame, as pure functions, and every sentence the rider
 * is told about the room.
 *
 * Kept out of `GameView.tsx` so that the rule is one function a test can call
 * with numbers: which riders are drawn (`net/interest.ts`), where
 * (`net/snapshots.ts`, through the connection), whether the rider is corrected
 * (`net/correction.ts`), and what the HUD says — a count and one chosen gap,
 * never a list (ADR 0021 D-6, ADR 0028 D-7.7, ruling Q8).
 */

import { pacerGap } from '@onyourleft/domain';

import type { AnnouncementEvent } from './hud/announce';
import type { RoomConnection } from '../net/room-port';
import type { RoomRace, RoomSessionStatus } from '../net/room-session';
import { InterestSet } from '../net/interest';
import { roomErrorMetres } from '../net/correction';
import type { RemoteRiderInput } from './scene';
import type { GameSimulation } from './simulation';
import type { ChosenRider, RoomHud } from './hud/fields';
import { gapAgainst } from './hud/fields';

/**
 * What the rider is told when the room's connection is lost and coming back —
 * #782's "the HUD says the room is lost in words". ⚠️ Draft wording awaiting
 * the owner's approval, like every new sentence in the room work.
 */
export const ROOM_LOST_TEXT =
  'The room’s connection was lost and is coming back by itself. The other riders are still ' +
  'until it does; your own ride carries on.';

/** The same, spoken by the HUD's one region (`announce.ts` rank 5a′). */
export const ROOM_LOST_SPOKEN = 'Room connection lost: the other riders stop until it is back.';

/** Said once the session stopped trying — past the room's rejoin window. */
export const ROOM_GONE_TEXT =
  'The room could not be reached again, so you are riding on your own. Your ride carries on.';

/** Why a room would not have this ride, in words. */
export const ROOM_REFUSED_TEXT: Readonly<
  Record<Extract<RoomSessionStatus, { kind: 'refused' }>['reason'], string>
> = {
  'room-full': 'The room is full, so you are riding on your own.',
  'room-closed': 'The room has closed, so you are riding on your own.',
  'protocol-mismatch':
    'This app and the room are different versions. Update the app to ride in it.',
  'physics-mismatch': 'This app and the room are different versions. Update the app to ride in it.',
  'ticket-refused': 'The room did not let this device in. Check you are connected to its instance.',
  'not-signed-in':
    'This device is not signed in to the room’s instance, so you are riding on your own.',
  replaced: 'You joined this room on another device, so this one left it.',
  // #782's review: each refusal the instance can give says what it is (N6),
  // and a rider with no declared weight is asked for one rather than raced at
  // a default (N5).
  'not-eligible':
    'Your account on the room’s instance cannot join this room, so you are riding on your own.',
  'no-such-room': 'The room’s instance has no such room, so you are riding on your own.',
  'instance-refused':
    'The room’s instance would not let this device in, so you are riding on your own.',
  'no-declared-mass':
    'Set your weight in Settings to ride in a room: a room rides you at the weight you declare. ' +
    'You are riding on your own.',
  'invalid-room': 'That is not a room this app can join, so you are riding on your own.',
  'not-the-rooms-route':
    'The room is not riding the route this device fetched for it, so you are riding on your own.',
};

/** The label the HUD gives the room: never anything but this word. */
export const ROOM_NOTICE_LABEL = 'Room';

/** What the HUD's notice slot says about a room right now, or nothing. */
export function roomNotice(status: RoomSessionStatus | undefined): string | undefined {
  switch (status?.kind) {
    case 'lost':
      return ROOM_LOST_TEXT;
    case 'gone':
      return ROOM_GONE_TEXT;
    case 'refused':
      return ROOM_REFUSED_TEXT[status.reason];
    default:
      return undefined;
  }
}

/**
 * What a seat is called on the HUD while no room publishes a name — #783.
 * ⚠️ A seat and not a person: names come from the room's public projection
 * only (#774), and no room message carries one yet (#784, #785).
 */
export function seatLabel(riderId: number): string {
  return `Rider ${String(riderId + 1)}`;
}

/**
 * How far ahead or behind another rider still counts as NEARBY on the HUD:
 * **200 m**, about as far up the road as a rider is drawn clearly before the
 * fog takes them. A count, never a list. Chosen.
 */
export const NEARBY_METRES = 200;

/** One frame of a room ride: who to draw, and what the HUD says. */
export interface RoomFrame {
  readonly remoteRiders: readonly RemoteRiderInput[];
  readonly hud: RoomHud;
}

/** A room ride's memory between frames. */
export interface RoomRideState {
  readonly interest: InterestSet;
  /** The local instant of the last own-rider entry corrected from, so a frame is acted on once. */
  correctedFrom: number | undefined;
  /** The rider followed on the HUD, by room rider id. */
  following: number | undefined;
}

export function roomRideState(k?: number): RoomRideState {
  return { interest: new InterestSet(k), correctedFrom: undefined, following: undefined };
}

/**
 * One frame: correct the rider toward the room when a new frame says to, pick
 * the riders to draw, and build the HUD's count and one gap.
 */
export function roomFrame(
  room: RoomConnection,
  memory: RoomRideState,
  simulation: GameSimulation,
  nowMs: number,
): RoomFrame {
  const own = room.own();
  const local = simulation.state.ride.distance as number;
  if (own !== undefined && own.atLocalMs !== memory.correctedFrom) {
    // The frame before, or — on the first — when the ride began: how long the
    // two could have been coming apart for (#922).
    const since = memory.correctedFrom ?? nowMs - (simulation.state.ridden as number) * 1000;
    memory.correctedFrom = own.atLocalMs;
    const error = roomErrorMetres(
      {
        distanceMetres: own.rider.distanceMetres,
        speedMetresPerSecond: own.rider.speedMetresPerSecond,
        atLocalMs: own.atLocalMs,
      },
      {
        distanceMetres: local,
        speedMetresPerSecond: simulation.state.ride.speed,
        sinceLocalMs: since,
      },
      nowMs,
    );
    if (error !== undefined) simulation.correctToward(error);
  }
  const others = room.others(nowMs);
  const drawn = new Set(
    memory.interest.update(
      others.map((rider) => ({ riderId: rider.riderId, distanceMetres: rider.distanceMetres })),
      local,
      nowMs,
    ),
  );
  const remoteRiders = others
    .filter((rider) => drawn.has(rider.riderId))
    .map((rider) => ({
      riderId: rider.riderId,
      distanceMetres: rider.distanceMetres,
      speedMetresPerSecond: rider.speedMetresPerSecond,
    }));
  if (memory.following !== undefined && !drawn.has(memory.following)) memory.following = undefined;
  const followed = remoteRiders.find((rider) => rider.riderId === memory.following);
  const chosen: ChosenRider | undefined =
    followed === undefined
      ? undefined
      : {
          label: seatLabel(followed.riderId),
          gap: pacerGap(gapAgainst(simulation.state, followed.distanceMetres)),
        };
  return {
    remoteRiders,
    hud: {
      nearby: remoteRiders.filter(
        (rider) => Math.abs(rider.distanceMetres - local) <= NEARBY_METRES,
      ).length,
      ...(chosen === undefined ? {} : { chosen }),
    },
  };
}

/**
 * The next rider to follow, by the room's own rider id — never by who is
 * ahead, so pressing *Follow* walks the seats and says nothing about a
 * standing. Wraps; `undefined` with nobody near.
 */
export function nextToFollow(
  current: number | undefined,
  near: readonly RemoteRiderInput[],
): number | undefined {
  const ids = near.map((rider) => rider.riderId).sort((a, b) => a - b);
  if (ids.length === 0) return undefined;
  if (current === undefined) return ids[0];
  return ids.find((id) => id > current) ?? ids[0];
}

/**
 * Whether a race's rider is held on the start line — #785: from joining until
 * the room's first frame, whatever they pedal. `GameView` holds the simulation
 * (`simulation.ts` §`holdAt`) for exactly as long as this says so. A group ride
 * is never held: it starts on its first rider (`apps/instance` §`room.ts`).
 */
export function heldOnTheLine(race: RoomRace | undefined): boolean {
  return race?.kind === 'waiting' || race?.kind === 'counting';
}

/** The label the HUD gives a race's notice. */
export const RACE_NOTICE_LABEL = 'Race';

/**
 * What the HUD says about a race while there is anything to say — ⚠️ draft
 * wording awaiting the owner's approval, like every sentence in the room work.
 * Nothing here ranks anybody: ADR 0028 D-7.7 and ruling Q8, no live standings.
 */
export const RACE_TEXT = {
  /**
   * For the rider who made the room: only they may start it (the owner's
   * ruling of 2026-09-30, `apps/instance` §`room-host.ts` `start`).
   */
  waiting:
    'You are on the start line. You made this room: start the race when your riders are here.',
  /** For a rider who joined by the code, who is offered no *Start the race*. */
  waitingForItsMaker:
    'You are on the start line. The race starts when the rider who made the room starts it.',
  counting: (seconds: number): string =>
    `The race starts in ${String(seconds)} second${seconds === 1 ? '' : 's'}.`,
  finished: 'The race is over. End the ride to see its result.',
  go: 'Go.',
} as const;

/** The whole seconds left of a countdown at `localMs`, never below nought. */
export function countdownSeconds(endsAtLocalMs: number, localMs: number): number {
  return Math.max(0, Math.ceil((endsAtLocalMs - localMs) / 1000));
}

/**
 * The race's notice now, or nothing while it runs. `madeIt` is whether this
 * rider made the room, and so is the one who starts it.
 */
export function raceNotice(
  race: RoomRace | undefined,
  localMs: number,
  madeIt: boolean,
): string | undefined {
  switch (race?.kind) {
    case 'waiting':
      return madeIt ? RACE_TEXT.waiting : RACE_TEXT.waitingForItsMaker;
    case 'counting':
      return RACE_TEXT.counting(countdownSeconds(race.endsAtLocalMs, localMs));
    case 'finished':
      return RACE_TEXT.finished;
    default:
      return undefined;
  }
}

/**
 * What the HUD's one region says when a race changes — #785, `announce.ts`
 * rank 5a″: the countdown as it begins, "Go" at the first frame, and its end.
 * `said` is the kind last announced; nothing is said twice for one kind.
 */
export function raceEvent(
  said: RoomRace['kind'] | undefined,
  race: RoomRace | undefined,
  localMs: number,
): { readonly said: RoomRace['kind'] | undefined; readonly event?: AnnouncementEvent } {
  const kind = race?.kind;
  if (kind === said || race === undefined) return { said: kind };
  switch (race.kind) {
    case 'counting':
      return {
        said: kind,
        event: {
          kind: 'room-race',
          text: RACE_TEXT.counting(countdownSeconds(race.endsAtLocalMs, localMs)),
        },
      };
    case 'running':
      return { said: kind, event: { kind: 'room-race', text: RACE_TEXT.go } };
    case 'finished':
      return { said: kind, event: { kind: 'room-race', text: RACE_TEXT.finished } };
    default:
      return { said: kind };
  }
}

/** A rider joining or leaving, as the HUD's region says it (#784). */
export const RIDER_TEXT = {
  joined: (count: number): string =>
    count === 1 ? 'A rider joined the room.' : `${String(count)} riders joined the room.`,
  left: (count: number): string =>
    count === 1 ? 'A rider left the room.' : `${String(count)} riders left the room.`,
} as const;

/**
 * Riders who came into the room's frames and went out of them since the last
 * look — #784, `announce.ts` rank 5a‴, said only with announcements on. The
 * first look is the room as it was found, and nobody "joined" it. Nobody is
 * named: a frame carries a seat and never a person.
 */
export function riderEvents(
  seen: ReadonlySet<number> | undefined,
  now: readonly number[],
): { readonly seen: ReadonlySet<number>; readonly events: readonly AnnouncementEvent[] } {
  const current = new Set(now);
  if (seen === undefined) return { seen: current, events: [] };
  const joined = [...current].filter((id) => !seen.has(id)).length;
  const left = [...seen].filter((id) => !current.has(id)).length;
  const events: AnnouncementEvent[] = [];
  if (joined > 0) events.push({ kind: 'room-rider', text: RIDER_TEXT.joined(joined) });
  if (left > 0) events.push({ kind: 'room-rider', text: RIDER_TEXT.left(left) });
  return { seen: current, events };
}
