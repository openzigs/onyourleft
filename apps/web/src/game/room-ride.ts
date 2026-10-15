// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A game ride in a room** — #782, #783: what `GameView` does with a room
 * connection on each frame, as pure functions, and every sentence the rider
 * is told about the room.
 *
 * Kept out of `GameView.tsx` so that the rule is one function a test can call
 * with numbers: which riders are drawn (`net/interest.ts`), where
 * (`net/snapshots.ts`, through the connection), whether the rider is corrected
 * (`net/correction.ts`), and what the HUD says — a count and one chosen gap
 * (#783) and, in a race, the room's standings ({@link raceStandings}, #1347,
 * [ADR 0051](../../../../docs/adr/0051-live-race-standings.md), which
 * supersedes ADR 0028 D-7.7 on the owner's ruling of 2026-10-14). A group ride
 * still has no list: nobody leads one (ADR 0028 D-7.2).
 */

import { pacerGap } from '@onyourleft/domain';
import { FLAG_COASTING, FLAG_FINISHED, FLAG_PLAUSIBILITY } from '@onyourleft/protocol';
import type { RoomRaceFact } from '@onyourleft/store';

import type { AnnouncementEvent } from './hud/announce';
import type { RoomConnection } from '../net/room-port';
import type { RoomRace, RoomSessionStatus, RoomStandingsRow } from '../net/room-session';
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
 * Said while the recording under a ride in a room is PAUSED — #785, #1360's
 * review (N1). A ride in a room always records (the owner's ruling of
 * 2026-10-14), but a paused recording is left paused: only the rider's own
 * *Resume* resumes one (#516), and the game has no *Resume* of the recording —
 * the Ride screen does, and going there leaves the room. The likeliest way
 * here is a recovered ride, which comes back paused. ⚠️ Draft wording
 * awaiting the owner's approval.
 */
export const ROOM_RECORDING_PAUSED_TEXT =
  'Recording paused: this ride is not being recorded, and resuming it on the Ride screen leaves ' +
  'the room.';

/**
 * The room's notice with the recording's state beside it — #1360's review
 * (N1): the room's own word first (lost, gone, refused), and else, while the
 * recording under the ride is paused, {@link ROOM_RECORDING_PAUSED_TEXT}.
 */
export function roomRideNotice(
  status: RoomSessionStatus | undefined,
  recordingPaused: boolean,
): string | undefined {
  if (status === undefined) return undefined;
  return roomNotice(status) ?? (recordingPaused ? ROOM_RECORDING_PAUSED_TEXT : undefined);
}

/**
 * What a seat is called on the HUD where the room publishes no name — #783: a
 * group ride, and a race's rider before the room has named them. ⚠️ A seat and
 * not a person: names come from the room's public projection only (#774), and
 * only a race sends them (#1347, `raceStandings`).
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
  /** A race's standings, while the room is sending them (#1347). @see raceStandings */
  readonly standings: RaceStandingsView | undefined;
}

/**
 * The most lines of a race's standings the HUD shows at once — #1347: the
 * rider's own line and up to three either side of it, so the list is the
 * same height in a race of eight as in a race of a hundred, and it is the
 * part of the field the rider is racing. Chosen. Each line keeps its place
 * number, so a rider who is 31st reads that from the line itself.
 */
export const STANDINGS_LINES = 7;

/** One line of a race's standings, in words. ⚠️ Draft wording awaiting the owner's approval. */
export interface StandingsLine {
  /** The room's rider id: a stable key, never shown. */
  readonly riderId: number;
  /** 1 for the furthest up the road (or the first over the line). */
  readonly place: number;
  /** "You", the rider's public name, or "A rider" before the room names them. */
  readonly who: string;
  /** The room's time gap to this rider — "+12 s" behind, "−8 s" ahead — or `''` on the own line. */
  readonly gap: string;
  /** Live W/kg, "Finished" or "Coasting" — never watts (ruling Q17). */
  readonly figure: string;
  /** The room's plausibility rule has flagged them (ADR 0028 D-2 rule 3): "Flagged". */
  readonly flagged: boolean;
  readonly you: boolean;
}

/** A race's standings on the HUD. */
export interface RaceStandingsView {
  /** At most {@link STANDINGS_LINES}, around the rider's own. */
  readonly lines: readonly StandingsLine[];
  /** The rider's own place, and how many are in the race — "4th of 12". */
  readonly place: number | undefined;
  readonly of: number;
}

/** What the list says, ⚠️ draft wording for the owner. */
export const STANDINGS_TEXT = {
  you: 'You',
  unnamed: 'A rider',
  finished: 'Finished',
  coasting: 'Coasting',
  flagged: 'Flagged',
  /** The sentence above the lines, which a screen reader meets first. */
  summary: (place: number | undefined, of: number): string =>
    place === undefined
      ? `${String(of)} rider${of === 1 ? '' : 's'} racing.`
      : `You are ${String(place)} of ${String(of)}.`,
} as const;

/** A gap as the list says it: "+12 s", "−1:05", "0 s". */
export function gapText(seconds: number): string {
  const whole = Math.round(Math.abs(seconds));
  if (whole === 0) return '0 s';
  const sign = seconds > 0 ? '+' : '\u2212';
  if (whole < 60) return `${sign}${String(whole)} s`;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return hours > 0
    ? `${sign}${String(hours)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${sign}${String(minutes)}:${rest}`;
}

function standingsLine(row: RoomStandingsRow, place: number): StandingsLine {
  const finished = (row.flags & FLAG_FINISHED) !== 0;
  const coasting = (row.flags & FLAG_COASTING) !== 0;
  return {
    riderId: row.riderId,
    place,
    who: row.you ? STANDINGS_TEXT.you : (row.displayName ?? STANDINGS_TEXT.unnamed),
    gap: row.you ? '' : gapText(row.gapSeconds),
    figure: finished
      ? STANDINGS_TEXT.finished
      : coasting
        ? STANDINGS_TEXT.coasting
        : `${row.wattsPerKilogram.toFixed(1)} W/kg`,
    flagged: (row.flags & FLAG_PLAUSIBILITY) !== 0,
    you: row.you,
  };
}

/**
 * A race's standings for the HUD — #1347, ADR 0051: the ROOM's rows in the
 * room's order, put into words, and windowed around the rider's own line.
 * Nothing is computed here but the window: the order, the gaps and the W/kg
 * are the room's (`net/room-session.ts` §`RoomStandings`).
 *
 * `undefined` — no list on the HUD — in a group ride, before the room's first
 * standings, and while the room's connection is lost: a gap that has stopped
 * moving is a gap that is wrong, so the list goes with the room and the
 * notice says why (`ROOM_LOST_TEXT`).
 */
export function raceStandings(room: RoomConnection): RaceStandingsView | undefined {
  const status = room.status().kind;
  if (status !== 'joined') return undefined;
  const standings = room.standings();
  if (standings === undefined || standings.rows.length === 0) return undefined;
  const all = standings.rows.map((row, index) => standingsLine(row, index + 1));
  const own = all.findIndex((line) => line.you);
  const centre = own === -1 ? 0 : own;
  const half = Math.floor(STANDINGS_LINES / 2);
  const first = Math.max(0, Math.min(centre - half, all.length - STANDINGS_LINES));
  return {
    lines: all.slice(first, first + STANDINGS_LINES),
    place: own === -1 ? undefined : own + 1,
    of: all.length,
  };
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
  // #1347: in a race, the followed rider by the name the room sent.
  const named = room.standings()?.rows.find((row) => row.riderId === followed?.riderId);
  const chosen: ChosenRider | undefined =
    followed === undefined
      ? undefined
      : {
          label: named?.displayName ?? seatLabel(followed.riderId),
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
    standings: raceStandings(room),
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
 * Nothing here ranks anybody: the standings are {@link raceStandings}'.
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

/**
 * Whether the ROOM has this rider across the line — #1360's re-review (R1):
 * the room's own last word on their distance (`own().rider.distanceMetres`,
 * floored to decimetres by the room, so it never overstates), against the
 * line. ADR 0028 D-2: the room's position wins, so the device's odometer —
 * corrected toward the room's but able to lead it by a little — is never
 * asked. `false` with no word from the room on this rider.
 */
export function acrossTheRoomsLine(
  room: Pick<RoomConnection, 'own'> | undefined,
  lineMetres: number | undefined,
): boolean {
  const own = room?.own();
  if (own === undefined || lineMetres === undefined) return false;
  return own.rider.distanceMetres >= lineMetres;
}

/**
 * What the race this ride was in comes to on this device — #785, the owner's
 * ruling of 2026-10-14: the result is stored with the ride. The ROOM's word
 * where it has said it: its finish order and this rider's place in it. For a
 * race the rider left while it ran, that it was ridden and no order was heard
 * — and, when `crossedTheLine`, that the rider was across the line on this
 * room first (#1360's review, N2, and its re-review R1: the room's `finish` waits for every
 * rider, and a winner who ends their ride straight after the line did not
 * leave the race). No place then: nothing tells this device one before the
 * room's `finish`. `undefined` for a group ride, and for a race that never
 * left its start line: nothing was raced.
 */
export function raceFactOf(
  roomId: string | undefined,
  race: RoomRace | undefined,
  crossedTheLine: boolean,
): RoomRaceFact | undefined {
  if (roomId === undefined || race === undefined) return undefined;
  switch (race.kind) {
    case 'finished':
      // The room's order is the word on who finished, whatever this device saw.
      return { roomId, place: race.place, finishers: race.order.length };
    case 'running':
      return crossedTheLine
        ? { roomId, place: null, finishers: null, crossedTheLine: true }
        : { roomId, place: null, finishers: null };
    default:
      return undefined;
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
