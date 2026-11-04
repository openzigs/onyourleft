// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The room core — [#779](https://github.com/openzigs/onyourleft/issues/779): one
 * room, as a deterministic state machine with no socket, no timer and no clock.
 *
 * ```text
 * Lobby ──start (race) / first rider (ride)──▶ Countdown ──t = 0──▶ Running ──▶ Finished (race)
 *                                                                     │
 *                                                                     └──last rider leaves + grace──▶ Closed (ride)
 * ```
 *
 * An adapter (#780 on Node and `ws`, #781 on a Durable Object) owns the
 * sockets and the timer and calls four methods, each with the room's own time
 * as a parameter: {@link Room.receive} for every text frame a socket delivers,
 * {@link Room.disconnect} when one closes, {@link Room.start} when a race is
 * started, and {@link Room.tick} once per `FRAME_INTERVAL_MS`. Each returns
 * what to send and which sockets to close. Nothing here reads a clock, so the
 * same calls with the same times give byte-identical frames (`room.test.ts`).
 *
 * ## ADR 0028 D-2, as code
 *
 * - **The room re-simulates every rider** through `@onyourleft/physics`'
 *   `advanceRider` — the client's own `advance` — with `ridingConditions`, the
 *   one coefficient set, bicycle and air (D-1). No coefficient is written here.
 * - **Rule 1, coast and never extrapolate.** A tick simulates each rider at the
 *   **latest** report admitted since the previous tick (spike 0007 §9). No
 *   admitted report — silence, a dropped connection, a refused or late report
 *   — is 0 W and the coasting flag; never the last power.
 * - **Rule 2** is judged incrementally over the power the room simulated
 *   (`ceilings.ts`) and **flags**; nothing here stops a flagged rider.
 * - **Rule 5**: the decoder refuses a hello from another protocol or physics
 *   version, and the room answers `refuse` and closes.
 *
 * ## Who can be in a room — ruling Q18
 *
 * A rider exists only because a hello's ticket was admitted, and a seat is only
 * ever created there. There is no method that adds a rider, so a room has no
 * way to hold a bot pacer or a ghost.
 *
 * ## A race's standings — #1347, ADR 0051
 *
 * A race names its riders (`name`, from the admission's public projection,
 * once a seat) and sends, after every frame, its **standings**: everybody
 * still in it, finishers first by their finish and then by distance along
 * the route, each with their **time gap to the recipient** and their live
 * W/kg. The gap is the room's, from its own positions ({@link timeGapTicks});
 * the W/kg is the power the room simulated on the tick over the mass it
 * holds. The mass itself is never sent, but a racer who knows the public
 * physics can work it out to within a few kilograms from a rider's frame speed
 * and W/kg (ADR 0051 D-1, an owner-requested cost; `standings.test.ts` pins it). A group ride sends neither (ADR 0028
 * D-7.2: nobody leads one; ADR 0051 D-3).
 *
 * ## Drafting — #787, ADR 0038
 *
 * Each tick, **before** anybody is re-simulated, the room takes every rider on
 * the road at the distance it holds for them and asks `@onyourleft/physics`'
 * `fieldDraftFactors` for each one's `k` — from distance along the route alone
 * (ADR 0038 D-3.4: no lateral offset is room state, and none is an input),
 * so a rider drawn behind another on any client is behind them here. Each is
 * then ridden at `ridingConditions(mass, position, k)`, and the frame carries
 * `(1 − k) × 100` as their `draftPercent`. A room made with drafting off
 * (the owner's ruling of 2026-09-30) is the same code with every `k` set to
 * 1. Nothing else on the road has a drag area: a room holds riders only
 * (ruling Q18), so no bot pacer or ghost gives or takes a draft (#327).
 *
 * ## Moderation in a room — #789
 *
 * - **Blocking.** An admission carries the athletes its rider has a block
 *   with, either way round ({@link Admission.blocks}). A race never sends one
 *   of them the other's `name`: each sees the other as a rider with no name,
 *   as a result does (`rooms/publication.ts`). Read at admission, so a block
 *   made during a ride holds from the rider's next hello.
 * - **Removal.** {@link Room.remove} takes a rider out — their socket refused
 *   `ticket-refused` and closed, a race's seat `dnf`, a ride's seat given up —
 *   and bars the athlete from this room for its life. The instance also
 *   refuses them a ticket from then on (`room_removal`, migration 0031).
 * - **What a flag does** is the adapter's to hand on: a flagged duration in
 *   the view becomes a report the room files (`node/room-host.ts`).
 *
 * ## A lap race with items — #1909, ADR 0060
 *
 * A race whose settings carry `lapRace` runs `@onyourleft/domain`'s lap race
 * (#1897, #1899) — the same `stepRace` the device predicts with — and its
 * answer is the one that counts (ADR 0028 D-2 rule 4):
 *
 * - **Effort distance is the re-simulation's**, unchanged: every rider is
 *   still ridden at reported power through the one physics, and the grade is
 *   read at their effort distance round the lap. Drafting reads it too (ADR
 *   0060 D-5.3). A frame's `decimetres` is the effort distance and never the
 *   drawn one, so a race offset can never reach a client's correction, and so
 *   never the grade it reads (D-5.4).
 * - **Items, lanes, offsets, laps and the finish are the race's**, stepped
 *   once a tick on the room's own instants (`tick × frameIntervalMs`), from
 *   the room's own seed. The field is fixed when the race starts.
 * - **Inputs, never outcomes.** A seated rider may send `lane` and
 *   `item-use`; each is admitted only past the last input sequence admitted
 *   on that connection, and spent by the next tick. **One use a tick** is the
 *   rate (ADR 0060 D-5.5: one item held at a time): the rest of a burst is
 *   dropped and never queued, since a queued use would fire on the next
 *   pick-up by itself. A use with nothing held changes nothing. The decoder has already refused any outcome
 *   a client claimed (`outcome-from-client`, #1908).
 * - **A dropped rider** is coasted at 0 W as any other (rule 1) and keeps
 *   their lane, held item and offset through the rejoin window.
 * - **Rules 2 and 3 are unchanged**: a rider is flagged, never stopped.
 * - A frame carries each rider's offset, lane, held item and laps, and the
 *   tick's item events: a rider id and an item key, never a place.
 */

import {
  createItemRace,
  gradePercent,
  ITEM_RULES,
  kilograms,
  raceCourse,
  racePosition,
  seconds,
  standings as lapStandings,
  stepRace,
  type ItemKind,
  type ItemRaceState,
  type Kilograms,
  type LapRacer,
  type RaceCourse,
  type Seconds,
} from '@onyourleft/domain';
import {
  advanceRider,
  declaredMassAdmissible,
  fieldDraftFactors,
  judgeReport,
  PHYSICS_VERSION,
  ridingConditions,
  START_OF_RIDE,
  type RideConditions,
  type RideState,
  type ReportVerdict,
} from '@onyourleft/physics';
import {
  decodeClientMessage,
  FLAG_COASTING,
  FLAG_FINISHED,
  FLAG_PLAUSIBILITY,
  MAXIMUM_GAP_DECISECONDS,
  MAXIMUM_ITEM_EVENTS,
  MAXIMUM_RACE_OFFSET_CENTIMETRES,
  MAXIMUM_WATTS_PER_KILOGRAM_TENTHS,
  type FrameRider,
  type ItemEvent,
  type ItemUse,
  type LaneChange,
  type RefuseReason,
  type Report,
  type RoomMessage,
  type StandingsRider,
  VOICE_INVITE_PATTERN,
} from '@onyourleft/protocol';

import { CeilingWatch } from './ceilings.ts';
import { afterAdmitting, reportWindow, UNSET_CLIENT_CLOCK, type ClientClock } from './clock.ts';
import type { RoomSettings } from './settings.ts';

/** An adapter's name for one socket. The room never sees the socket. */
export type ConnectionId = number;

/** What a ticket proves, once the room's admission has accepted it. */
export interface Admission {
  /** The athlete the ticket is for. Two tickets for one athlete are one rider. */
  readonly athleteId: string;
  /** The athlete's declared mass (ADR 0028 D-1: the one per-rider input), in kilograms. */
  readonly declaredMassKilograms: number;
  /**
   * What other riders call them — #1347: the athlete's PUBLIC projection
   * (`auth/public-athlete.ts`, #774), and so a name a moderator hid is
   * already `Rider` here. A race sends it to everybody in the room.
   */
  readonly displayName: string;
  /**
   * The athletes this one has a block with, EITHER way round (#789): a race
   * names neither to the other. Absent is none.
   */
  readonly blocks?: readonly string[];
}

/**
 * The room's admission: a ticket in, an athlete out, or `undefined` for a
 * ticket it does not accept. Injected, because what a ticket proves is
 * identity's business (#772–#774), not the room's.
 */
export type Admit = (ticket: string) => Admission | undefined;

/** What the adapter must do. */
export type Outbound =
  | { readonly kind: 'send'; readonly connection: ConnectionId; readonly message: RoomMessage }
  | { readonly kind: 'close'; readonly connection: ConnectionId };

export type RoomPhase = 'lobby' | 'countdown' | 'running' | 'finished' | 'closed';

/** A seat's state. `held` is a dropped rider inside the rejoin window. */
export type SeatState = 'connected' | 'held' | 'finished' | 'dnf';

/** One rider as an observer — a test, a log, #780's metrics — may see them. */
export interface SeatView {
  readonly riderId: number;
  readonly athleteId: string;
  readonly state: SeatState;
  readonly distanceMetres: number;
  readonly speedMetresPerSecond: number;
  readonly flags: number;
  /**
   * A finisher's crossing, in ticks from the start: the tick plus the share of
   * it before the line (what the finish order sorts by). `null` for anybody
   * who has not finished. The Node adapter persists it as the result (#780).
   */
  readonly finishedAtTicks: number | null;
  /**
   * The rider's mean power over every second the room simulated them, per
   * kilogram of their declared mass (`ceilings.ts`) — what a race's result
   * publishes beside them (#785, ruling Q17). `null` before the first tick.
   */
  readonly wattsPerKilogram: number | null;
  /** The durations of every plausibility ceiling this rider breached, shortest first (#785). */
  readonly flaggedDurationsSeconds: readonly number[];
}

export interface RoomView {
  readonly phase: RoomPhase;
  readonly tick: number;
  readonly seats: readonly SeatView[];
  /** A race's finishers, first first. */
  readonly finishOrder: readonly number[];
}

/** One room. Every method takes the room's own time, in milliseconds. */
export interface Room {
  receive(connection: ConnectionId, text: string, nowMs: number): Outbound[];
  disconnect(connection: ConnectionId, nowMs: number): Outbound[];
  /**
   * Starts a race's countdown, and tells every seated rider how long it is
   * (`countdown`, #785). A group ride starts itself on its first rider.
   */
  start(nowMs: number): Outbound[];
  tick(nowMs: number): Outbound[];
  /**
   * Takes `athleteId` out of the room for its life (#789): their socket is
   * refused `ticket-refused` and closed, a race's seat is `dnf` and a ride's
   * given up, and a later hello is refused. Nothing for an athlete with no seat
   * but the bar.
   */
  remove(athleteId: string, nowMs: number): Outbound[];
  /**
   * The room's Discord voice link (#875), said in every welcome from now on —
   * the first and every rejoin — and never in anything else, so a rider the
   * room refuses is never told it. `undefined` is none. A value that is not a
   * link on Discord's invite host (`@onyourleft/protocol` §`VOICE_INVITE_PATTERN`)
   * is taken as none, so a welcome is never one the encoder would refuse.
   *
   * #876: when the link CHANGES — the channel replaced after a removal or a
   * ban — every rider connected now is told the new one in a `voice`
   * message, except `withheldFrom`: the athlete the change was made about, if
   * they are still connected (a ban closes no socket). A link set again to
   * what it was sends nothing.
   */
  setVoiceInvite(invite: string | undefined, withheldFrom?: string): Outbound[];
  view(): RoomView;
}

/** Which item slows a racer at this rate, by `ITEM_RULES`: a hit's item (#1909). */
const SLOWING_ITEMS: ReadonlyMap<number, ItemKind> = new Map(
  Object.entries(ITEM_RULES)
    .filter(([, rule]) => rule.rateMetresPerSecond < 0)
    .map(([kind, rule]) => [rule.rateMetresPerSecond, kind as ItemKind]),
);

/** A race's cut-off: how long after the first finisher the others have. */
export const FINISH_CUT_OFF_TICKS = 30 * 60;

/** The largest distance a frame can carry, in decimetres (`@onyourleft/protocol`'s bound). */
const MAXIMUM_FRAME_DECIMETRES = 1_000_000_000;
const MAXIMUM_FRAME_CENTIMETRES_PER_SECOND = 10_000;

interface Seat {
  readonly riderId: number;
  readonly athleteId: string;
  readonly displayName: string;
  /** Who this rider has a block with, either way (#789). */
  readonly blocks: ReadonlySet<string>;
  /** Riding alone: `k = 1`, the conditions every undrafted tick is ridden at. */
  readonly conditions: RideConditions;
  readonly mass: Kilograms;
  /** The draft multiplier `k` this rider was ridden at on the last tick (#787). 1 alone. */
  draftFactor: number;
  readonly ceilings: CeilingWatch;
  state: SeatState;
  ride: RideState;
  connection: ConnectionId | undefined;
  heldSinceMs: number;
  clock: ClientClock;
  lastAdmittedSequence: number | undefined;
  /** The latest report admitted since the last tick; spent by the tick. */
  latest: ReportVerdict | undefined;
  coasting: boolean;
  /** For a finisher: the tick, plus the share of it, at which they crossed the line. */
  finishedAt: number;
  /** The power the room simulated them at on the last tick they rode, in watts (#1347). */
  lastPowerWatts: number;
  /**
   * A race's rider's distance after every tick they rode, index 0 the start
   * (#1347): what a time gap is read from. Distance never falls, so it is
   * searched rather than scanned. 8 bytes a tick: under 60 KiB for a
   * two-hour race, a rider.
   */
  readonly history: number[];
  /** A lap race's lane asked for since the last tick (#1909); spent by the tick. */
  pendingLane: number | undefined;
  /** Whether an `item-use` was admitted since the last tick: one a tick, spent by it. */
  pendingUse: boolean;
  /** The last lap-race input sequence admitted on this connection. */
  lastInputSequence: number | undefined;
}

/**
 * A room, from checked settings and an admission.
 *
 * @param settings from `roomSettings`, which has already refused what a room
 * cannot be built with.
 */
export function createRoom(settings: RoomSettings, admit: Admit): Room {
  const seats = new Map<string, Seat>();
  const byConnection = new Map<ConnectionId, Seat>();
  let phase: RoomPhase = 'lobby';
  let startsAtMs = 0;
  let tickNumber = 0;
  let nextRiderId = 0;
  let emptySinceMs: number | undefined;
  let firstFinishTick: number | undefined;
  const finishers: Seat[] = [];
  /** Athletes removed from this room (#789): never seated again. */
  const barred = new Set<string>();
  /** The room's Discord voice link, said in a welcome and nowhere else (#875). */
  let voiceInvite: string | undefined;
  const tickDuration: Seconds = seconds(settings.frameIntervalMs / 1000);
  const lap = settings.lapRace;
  const lapCourse: RaceCourse | undefined =
    lap === undefined ? undefined : raceCourse(settings.course.lengthMetres, lap.laps);
  /** A lap race's race, from its first tick (#1909). */
  let race: ItemRaceState | undefined;
  let racers = new Map<string, LapRacer>();
  /** The item events of the last tick, in the order they happened. */
  let itemEvents: readonly ItemEvent[] = [];

  function refuseAndClose(connection: ConnectionId, reason: RefuseReason): Outbound[] {
    return [
      { kind: 'send', connection, message: { type: 'refuse', reason } },
      { kind: 'close', connection },
    ];
  }

  function seated(): Seat[] {
    return [...seats.values()].sort((a, b) => a.riderId - b.riderId);
  }

  function onTheRoad(seat: Seat): boolean {
    return seat.state === 'connected' || seat.state === 'held';
  }

  /** Seats whose rejoin window has run out: a race's rider did not finish; a ride's seat is given up. */
  function expireHeldSeats(nowMs: number): void {
    for (const seat of seated()) {
      if (seat.state === 'held' && nowMs - seat.heldSinceMs > settings.rejoinWindowMs) {
        if (settings.kind === 'race') {
          seat.state = 'dnf';
        } else {
          seats.delete(seat.athleteId);
        }
      }
    }
  }

  function welcome(connection: ConnectionId, seat: Seat): Outbound[] {
    return [
      {
        kind: 'send',
        connection,
        message: {
          type: 'welcome',
          riderId: seat.riderId,
          routeRef: { sha256: settings.course.sha256 },
          roomConfig: {
            kind: settings.kind,
            ridingPosition: settings.ridingPosition,
            reportIntervalMs: settings.reportIntervalMs,
            frameIntervalMs: settings.frameIntervalMs,
            drafting: settings.drafting ? 'on' : 'off',
            ...(lap === undefined
              ? {}
              : { lapRace: { laps: lap.laps, items: lap.items ? 'on' : 'off' } }),
          },
          ...(voiceInvite === undefined ? {} : { voiceInvite }),
        },
      },
    ];
  }

  function attach(seat: Seat, connection: ConnectionId, nowMs: number): Outbound[] {
    const out: Outbound[] = [];
    if (seat.connection !== undefined && seat.connection !== connection) {
      // The same athlete on a second socket: the newer one is the rider.
      byConnection.delete(seat.connection);
      out.push({ kind: 'close', connection: seat.connection });
    }
    seat.connection = connection;
    if (seat.state === 'held') {
      seat.state = 'connected';
    }
    emptySinceMs = undefined;
    // A new connection is a new client timeline and a new sequence (`clock.ts`).
    seat.clock = UNSET_CLIENT_CLOCK;
    seat.lastAdmittedSequence = undefined;
    seat.latest = undefined;
    seat.lastInputSequence = undefined;
    seat.pendingLane = undefined;
    seat.pendingUse = false;
    byConnection.set(connection, seat);
    return [
      ...out,
      ...welcome(connection, seat),
      // #1347: the whole field's names, on a join and on every rejoin.
      ...seated().flatMap((each) => nameTo(connection, seat, each)),
      ...countdownTo(connection, nowMs),
    ];
  }

  /**
   * A race's countdown, to one connection, while there is one (#785): how long
   * until the first tick, from NOW on the room's clock. A duration and never
   * an instant, so a client's own clock never enters it.
   */
  function countdownTo(connection: ConnectionId, nowMs: number): Outbound[] {
    if (settings.kind !== 'race' || phase !== 'countdown') return [];
    return [
      {
        kind: 'send',
        connection,
        message: { type: 'countdown', startsInMs: Math.max(0, startsAtMs - nowMs) },
      },
    ];
  }

  function hello(connection: ConnectionId, ticket: string, nowMs: number): Outbound[] {
    if (phase === 'finished' || phase === 'closed') {
      return refuseAndClose(connection, 'room-closed');
    }
    const admission = admit(ticket);
    if (
      admission === undefined ||
      barred.has(admission.athleteId) ||
      !declaredMassAdmissible(admission.declaredMassKilograms, settings.limits)
    ) {
      return refuseAndClose(connection, 'ticket-refused');
    }
    const existing = seats.get(admission.athleteId);
    if (existing !== undefined) {
      // A rejoin: the same seat and the same place on the road. A finisher may
      // come back to watch; a rider who did not finish may not come back to ride.
      if (existing.state === 'dnf') {
        return refuseAndClose(connection, 'room-closed');
      }
      return attach(existing, connection, nowMs);
    }
    if (settings.kind === 'race' && phase === 'running') {
      return refuseAndClose(connection, 'room-closed');
    }
    if (seats.size >= settings.capacity) {
      return refuseAndClose(connection, 'room-full');
    }
    const mass: Kilograms = kilograms(admission.declaredMassKilograms);
    const seat: Seat = {
      riderId: nextRiderId,
      athleteId: admission.athleteId,
      displayName: admission.displayName,
      blocks: new Set(admission.blocks ?? []),
      conditions: ridingConditions(mass, settings.ridingPosition),
      mass,
      draftFactor: 1,
      ceilings: new CeilingWatch(mass, settings.limits),
      state: 'connected',
      ride: START_OF_RIDE,
      connection: undefined,
      heldSinceMs: 0,
      clock: UNSET_CLIENT_CLOCK,
      lastAdmittedSequence: undefined,
      latest: undefined,
      coasting: false,
      finishedAt: 0,
      lastPowerWatts: 0,
      history: [0],
      pendingLane: undefined,
      pendingUse: false,
      lastInputSequence: undefined,
    };
    nextRiderId += 1;
    // #1347: everybody already in a race is told the new rider's name.
    const told = seated().flatMap((other) =>
      other.connection === undefined ? [] : nameTo(other.connection, other, seat),
    );
    seats.set(seat.athleteId, seat);
    if (settings.kind === 'ride' && phase === 'lobby') {
      phase = 'countdown';
      startsAtMs = nowMs + settings.countdownMs;
    }
    return [...told, ...attach(seat, connection, nowMs)];
  }

  /**
   * A race's rider's name, to one connection (#1347). A group ride names
   * nobody, and two riders with a block between them, either way, are not
   * named to each other (#789).
   */
  function nameTo(connection: ConnectionId, recipient: Seat, seat: Seat): Outbound[] {
    if (settings.kind !== 'race') return [];
    if (recipient.blocks.has(seat.athleteId) || seat.blocks.has(recipient.athleteId)) return [];
    return [
      {
        kind: 'send',
        connection,
        message: { type: 'name', riderId: seat.riderId, displayName: seat.displayName },
      },
    ];
  }

  function report(seat: Seat, message: Report, nowMs: number): void {
    const verdict = judgeReport(
      { riderId: seat.riderId, ...message },
      reportWindow(
        seat.clock,
        seat.lastAdmittedSequence,
        nowMs,
        settings.reportSlack,
        message.atMs,
      ),
      settings.limits,
    );
    if (verdict.admissible) {
      seat.lastAdmittedSequence = message.sequence;
      seat.clock = afterAdmitting(seat.clock, message.atMs, nowMs);
      seat.latest = verdict;
    }
  }

  /**
   * A lap race's input (#1909): admitted past the last input sequence on this
   * connection, a lane and a use kept for the next tick, and one use a tick
   * at most. Nothing before the race runs, nothing
   * in a race that is not a lap race, and no use with items off.
   */
  function lapInput(seat: Seat, message: ItemUse | LaneChange): void {
    if (lap === undefined || race === undefined) return;
    if (seat.lastInputSequence !== undefined && message.sequence <= seat.lastInputSequence) return;
    if (message.type === 'item-use') {
      if (!lap.items || seat.pendingUse) return;
      seat.pendingUse = true;
    } else {
      seat.pendingLane = message.lane;
    }
    seat.lastInputSequence = message.sequence;
  }

  function racerId(seat: Seat): string {
    return String(seat.riderId);
  }

  /** This seat's racer in the lap race, if it is one and the race has begun. */
  function racerOf(seat: Seat): LapRacer | undefined {
    return racers.get(racerId(seat));
  }

  /** The race, and its racers by id for {@link racerOf}: every write to `race` goes through here. */
  function setRace(next: ItemRaceState): void {
    race = next;
    racers = new Map(next.racers.map((entry) => [entry.racer.id, entry]));
  }

  /**
   * Where a race ranks and times a rider: a lap race's drawn distance (ADR
   * 0060 D-3.3), and otherwise the distance the room rode them.
   */
  function position(seat: Seat): number {
    const entry = racerOf(seat);
    return entry === undefined ? seat.ride.distance : racePosition(entry.racer);
  }

  function frameRider(seat: Seat): FrameRider {
    const decimetres = Math.floor(seat.ride.distance * 10);
    const centimetres = Math.round(seat.ride.speed * 100);
    const entry = racerOf(seat);
    return {
      riderId: seat.riderId,
      decimetres: decimetres > MAXIMUM_FRAME_DECIMETRES ? MAXIMUM_FRAME_DECIMETRES : decimetres,
      centimetresPerSecond:
        centimetres > MAXIMUM_FRAME_CENTIMETRES_PER_SECOND
          ? MAXIMUM_FRAME_CENTIMETRES_PER_SECOND
          : centimetres,
      draftPercent: Math.round((1 - seat.draftFactor) * 100),
      flags: flagsOf(seat),
      ...(entry === undefined ? {} : lapSlots(entry)),
    };
  }

  /** A lap racer's four frame slots: the room's answer, each inside its wire bound. */
  function lapSlots(
    entry: LapRacer,
  ): Pick<FrameRider, 'raceOffsetCentimetres' | 'lane' | 'held' | 'lapsDone'> {
    const centimetres = Math.round(entry.racer.raceOffset * 100);
    return {
      raceOffsetCentimetres: Math.max(
        -MAXIMUM_RACE_OFFSET_CENTIMETRES,
        Math.min(MAXIMUM_RACE_OFFSET_CENTIMETRES, centimetres === 0 ? 0 : centimetres),
      ),
      lane: entry.lane,
      held: entry.held ?? 'none',
      lapsDone: entry.racer.lapsDone,
    };
  }

  function flagsOf(seat: Seat): number {
    return (seat.coasting ? FLAG_COASTING : 0) | (seat.ceilings.flagged ? FLAG_PLAUSIBILITY : 0);
  }

  function ride(seat: Seat): void {
    const before = seat.ride.distance;
    const verdict = seat.state === 'connected' ? seat.latest : undefined;
    seat.latest = undefined;
    seat.coasting = verdict === undefined;
    seat.ride = advanceRider(
      seat.ride,
      {
        verdict,
        // A lap race reads the grade round the lap, at the effort distance (ADR 0060 D-3.1).
        grade: gradePercent(
          settings.course.gradePercentAt(
            lapCourse === undefined ? before : before % lapCourse.lapLengthMetres,
          ),
        ),
        duration: tickDuration,
      },
      seat.draftFactor === 1
        ? seat.conditions
        : ridingConditions(seat.mass, settings.ridingPosition, seat.draftFactor),
    );
    const power = verdict?.admissible === true ? (verdict.power as number) : 0;
    seat.ceilings.record(power);
    seat.lastPowerWatts = power;
    const line = settings.course.lengthMetres;
    // A lap race's finish is the race's, at the drawn distance (`stepLapRace`).
    if (settings.kind === 'race' && lap === undefined) {
      seat.history.push(seat.ride.distance);
      if (seat.ride.distance >= line) {
        seat.state = 'finished';
        // Where in this tick the line was crossed: the share of the tick's distance before it.
        seat.finishedAt = tickNumber - 1 + (line - before) / (seat.ride.distance - before);
        finishers.push(seat);
      }
    }
  }

  /** A lap race's field on the line, fixed as the race starts (#1909). */
  function startLapRace(): void {
    if (lap === undefined || lapCourse === undefined || race !== undefined) return;
    const field = seated().filter(onTheRoad);
    if (field.length === 0) return;
    setRace(
      createItemRace({
        course: lapCourse,
        seed: lap.seed,
        itemsOn: lap.items,
        racerIds: field.map(racerId),
        startMs: 0,
      }),
    );
  }

  /**
   * One tick of the lap race, after every rider was ridden (#1909): each
   * racer's effort distance from the re-simulation, the lanes and uses the
   * riders asked for, on the room's instant. Then the riders the race
   * finished, and the tick's item events.
   */
  function stepLapRace(): void {
    if (race === undefined || lapCourse === undefined) return;
    const atMs = tickNumber * settings.frameIntervalMs;
    const effortDistances: Record<string, number> = {};
    const lanes: Record<string, number> = {};
    const uses: string[] = [];
    const bySeat = new Map(seated().map((seat) => [racerId(seat), seat]));
    for (const entry of race.racers) {
      const seat = bySeat.get(entry.racer.id);
      if (seat === undefined) continue;
      effortDistances[entry.racer.id] = seat.ride.distance;
      if (seat.state === 'connected') {
        if (seat.pendingLane !== undefined) lanes[entry.racer.id] = seat.pendingLane;
        if (seat.pendingUse) uses.push(entry.racer.id);
      }
      seat.pendingLane = undefined;
      seat.pendingUse = false;
    }
    const before = race;
    const after = stepRace(race, { atMs, effortDistances, lanes, uses });
    setRace(after);
    itemEvents = eventsOf(before, after, new Set(uses), atMs);
    const line = lapCourse.lapLengthMetres * lapCourse.laps;
    for (const entry of after.racers) {
      const seat = bySeat.get(entry.racer.id);
      if (seat === undefined || !onTheRoad(seat)) continue;
      const was = seat.history.at(-1) ?? 0;
      const now = racePosition(entry.racer);
      seat.history.push(now);
      if (entry.racer.finishedAtMs !== null) {
        seat.state = 'finished';
        // Where in this tick the drawn distance crossed the line, for the time gaps.
        const share = now > was ? Math.min(1, Math.max(0, (line - was) / (now - was))) : 1;
        seat.finishedAt = tickNumber - 1 + share;
        finishers.push(seat);
      }
    }
  }

  /**
   * What happened to items on a tick, read from the race before and after it:
   * each use, then each hit, then each pick-up, each in id order. A hit is a
   * slowing effect that starts on the tick; one a rain cape absorbed moves
   * nobody and is not an event. At most `MAXIMUM_ITEM_EVENTS`.
   */
  function eventsOf(
    before: ItemRaceState,
    after: ItemRaceState,
    uses: ReadonlySet<string>,
    atMs: number,
  ): readonly ItemEvent[] {
    const used: ItemEvent[] = [];
    const hits: ItemEvent[] = [];
    const pickUps: ItemEvent[] = [];
    after.racers.forEach((now, index) => {
      const was = before.racers[index] as LapRacer;
      const riderId = Number(now.racer.id);
      const held = was.held;
      const didUse = uses.has(now.racer.id) && held !== null && was.racer.finishedAtMs === null;
      if (didUse) used.push({ riderId, event: 'use', item: held });
      for (const effect of now.effects) {
        const kind = SLOWING_ITEMS.get(effect.rateMetresPerSecond);
        if (effect.fromMs === atMs && kind !== undefined) {
          hits.push({ riderId, event: 'hit', item: kind });
        }
      }
      if (now.held !== null && now.pickUpsPassed > was.pickUpsPassed && (held === null || didUse)) {
        pickUps.push({ riderId, event: 'pick-up', item: now.held });
      }
    });
    return [...used, ...hits, ...pickUps].slice(0, MAXIMUM_ITEM_EVENTS);
  }

  /**
   * Every rider's `k` for this tick, from where the room holds them now and
   * before any is moved (#787). Only riders on the road shelter or are
   * sheltered: a finisher has left it. With drafting off, every `k` is 1.
   */
  function draft(): void {
    const riding = seated().filter(onTheRoad);
    const factors = settings.drafting
      ? fieldDraftFactors(riding.map((seat) => seat.ride.distance as number))
      : riding.map(() => 1);
    for (const seat of seated()) seat.draftFactor = 1;
    riding.forEach((seat, index) => {
      seat.draftFactor = factors[index] as number;
    });
  }

  /**
   * When `seat` was at `metres`, in ticks from the start, from its history —
   * interpolated inside the tick it passed it. Only ever asked for a distance
   * the seat has reached.
   */
  function passedAt(seat: Seat, metres: number): number {
    const history = seat.history;
    if (metres <= (history[0] as number)) return 0;
    let low = 1;
    let high = history.length - 1;
    // The first tick whose distance is at least `metres`.
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((history[middle] as number) >= metres) high = middle;
      else low = middle + 1;
    }
    const after = history[low] as number;
    const before = history[low - 1] as number;
    if (after < metres) return history.length - 1;
    return low - 1 + (metres - before) / (after - before);
  }

  /**
   * The time gap from `to` back to `rider`, in ticks — positive when `rider`
   * is behind: how long ago the one in front was where the one behind is
   * now. Two finishers are apart by their crossings.
   */
  function timeGapTicks(rider: Seat, to: Seat): number {
    if (rider === to) return 0;
    if (rider.state === 'finished' && to.state === 'finished') {
      return rider.finishedAt - to.finishedAt;
    }
    const mine = position(to);
    const theirs = position(rider);
    if (theirs < mine) return tickNumber - passedAt(to, theirs);
    if (theirs > mine) return -(tickNumber - passedAt(rider, mine));
    return 0;
  }

  /**
   * A race's field in the room's order: finishers by their finish, then by
   * distance, furthest first — a lap race's drawn distance (#1909).
   */
  function standingsOrder(): Seat[] {
    const byRider = new Map(finishers.map((seat) => [seat.riderId, seat]));
    const finished = finishOrder().flatMap((riderId) => byRider.get(riderId) ?? []);
    const riding = seated()
      .filter(onTheRoad)
      .sort((a, b) => position(b) - position(a) || a.riderId - b.riderId);
    return [...finished, ...riding];
  }

  function standingsRider(rider: Seat, to: Seat): StandingsRider {
    const deciseconds = Math.round(timeGapTicks(rider, to) * (tickDuration as number) * 10);
    const finished = rider.state === 'finished';
    const tenths = finished ? 0 : Math.round((rider.lastPowerWatts / (rider.mass as number)) * 10);
    return {
      riderId: rider.riderId,
      gapDeciseconds: Math.max(
        -MAXIMUM_GAP_DECISECONDS,
        Math.min(MAXIMUM_GAP_DECISECONDS, deciseconds),
      ),
      wattsPerKilogramTenths: Math.min(MAXIMUM_WATTS_PER_KILOGRAM_TENTHS, tenths),
      flags: flagsOf(rider) | (finished ? FLAG_FINISHED : 0),
    };
  }

  /** A race's standings, to every connected rider, each with the gaps to them (#1347). */
  function standings(): Outbound[] {
    const order = standingsOrder();
    const out: Outbound[] = [];
    for (const seat of seated()) {
      if (seat.connection === undefined || seat.state === 'dnf') continue;
      out.push({
        kind: 'send',
        connection: seat.connection,
        message: {
          type: 'standings',
          tick: tickNumber,
          riders: order.map((rider) => standingsRider(rider, seat)),
        },
      });
    }
    return out;
  }

  function frames(): Outbound[] {
    const riders = seated()
      .filter((seat) => seat.state !== 'dnf')
      .map(frameRider);
    const out: Outbound[] = [];
    for (const seat of seated()) {
      if (seat.connection === undefined) continue;
      out.push({
        kind: 'send',
        connection: seat.connection,
        message: {
          type: 'frame',
          tick: tickNumber,
          ...(seat.lastAdmittedSequence === undefined
            ? {}
            : { ackSequence: seat.lastAdmittedSequence }),
          riders,
          ...(itemEvents.length === 0 ? {} : { itemEvents }),
        },
      });
    }
    return out;
  }

  /**
   * Finishers by where in their tick they crossed the line, then by rider id —
   * and in a lap race, by the race's own rule (`@onyourleft/domain`
   * §`standings`: the finish instant, then the drawn distance at it).
   */
  function finishOrder(): number[] {
    if (race !== undefined) {
      const finished = new Set(finishers.map(racerId));
      return lapStandings(race.racers.map((entry) => entry.racer))
        .filter((id) => finished.has(id))
        .map(Number);
    }
    return [...finishers]
      .sort((a, b) => a.finishedAt - b.finishedAt || a.riderId - b.riderId)
      .map((seat) => seat.riderId);
  }

  function finishRace(): Outbound[] {
    phase = 'finished';
    const order = finishOrder();
    const out: Outbound[] = [];
    for (const seat of seated()) {
      if (seat.connection !== undefined) {
        out.push({ kind: 'send', connection: seat.connection, message: { type: 'finish', order } });
      }
    }
    return out;
  }

  return {
    receive(connection, text, nowMs) {
      expireHeldSeats(nowMs);
      const seat = byConnection.get(connection);
      const decoded = decodeClientMessage(text, { physicsVersion: PHYSICS_VERSION });
      if (!decoded.ok) {
        const { reason } = decoded.refusal;
        if (seat === undefined) {
          // Before a hello, the only refusals a client is told are the two
          // that mean "a different build" (ADR 0028 D-2 rule 5).
          return reason === 'protocol-mismatch' || reason === 'physics-mismatch'
            ? refuseAndClose(connection, reason)
            : [{ kind: 'close', connection }];
        }
        // A malformed report from a seated rider is dropped: rule 1 coasts them.
        return [];
      }
      const { message } = decoded;
      if (message.type === 'hello') {
        return seat === undefined ? hello(connection, message.ticket, nowMs) : [];
      }
      if (seat === undefined) {
        return [{ kind: 'close', connection }];
      }
      if (message.type !== 'report') {
        // A lap race's inputs (#1909). In any other room they change nothing,
        // and close nobody: a client on this build may send them.
        if (seat.state === 'connected') lapInput(seat, message);
        return [];
      }
      if (seat.state === 'connected') {
        report(seat, message, nowMs);
      }
      return [];
    },

    disconnect(connection, nowMs) {
      expireHeldSeats(nowMs);
      const seat = byConnection.get(connection);
      byConnection.delete(connection);
      if (seat === undefined || seat.connection !== connection) {
        return [];
      }
      seat.connection = undefined;
      seat.latest = undefined;
      seat.pendingLane = undefined;
      seat.pendingUse = false;
      if (seat.state === 'connected') {
        if (phase === 'lobby' || (phase === 'countdown' && settings.kind === 'race')) {
          // Nobody has ridden yet: a race's lobby gives the seat back at once.
          seats.delete(seat.athleteId);
        } else {
          seat.state = 'held';
          seat.heldSinceMs = nowMs;
        }
      }
      if (
        settings.kind === 'ride' &&
        ![...seats.values()].some((s) => s.connection !== undefined)
      ) {
        emptySinceMs ??= nowMs;
      }
      return [];
    },

    start(nowMs) {
      if (settings.kind !== 'race' || phase !== 'lobby') return [];
      phase = 'countdown';
      startsAtMs = nowMs + settings.countdownMs;
      return seated().flatMap((seat) =>
        seat.connection === undefined ? [] : countdownTo(seat.connection, nowMs),
      );
    },

    tick(nowMs) {
      expireHeldSeats(nowMs);
      if (phase === 'countdown' && nowMs >= startsAtMs) {
        phase = 'running';
        startLapRace();
      }
      if (
        settings.kind === 'ride' &&
        phase !== 'closed' &&
        emptySinceMs !== undefined &&
        // Set only while nobody is connected, and cleared by any attach.
        nowMs - emptySinceMs >= settings.emptyGraceMs
      ) {
        phase = 'closed';
        return [];
      }
      if (phase !== 'running') {
        return [];
      }
      tickNumber += 1;
      draft();
      for (const seat of seated()) {
        if (onTheRoad(seat)) ride(seat);
      }
      stepLapRace();
      const out = frames();
      if (settings.kind === 'race') {
        out.push(...standings());
        if (finishers.length > 0) firstFinishTick ??= tickNumber;
        const cutOff =
          firstFinishTick !== undefined && tickNumber - firstFinishTick >= FINISH_CUT_OFF_TICKS;
        if (cutOff) {
          for (const seat of seated()) if (onTheRoad(seat)) seat.state = 'dnf';
        }
        if (seats.size > 0 && !seated().some(onTheRoad)) {
          out.push(...finishRace());
        }
      }
      return out;
    },

    remove(athleteId, nowMs) {
      expireHeldSeats(nowMs);
      barred.add(athleteId);
      const seat = seats.get(athleteId);
      if (seat === undefined) return [];
      const out: Outbound[] = [];
      if (seat.connection !== undefined) {
        byConnection.delete(seat.connection);
        out.push(...refuseAndClose(seat.connection, 'ticket-refused'));
        seat.connection = undefined;
      }
      seat.latest = undefined;
      if (settings.kind === 'race' && phase !== 'lobby' && seat.state !== 'finished') {
        seat.state = 'dnf';
      } else if (seat.state !== 'finished') {
        seats.delete(athleteId);
      }
      if (
        settings.kind === 'ride' &&
        ![...seats.values()].some((other) => other.connection !== undefined)
      ) {
        emptySinceMs ??= nowMs;
      }
      return out;
    },

    setVoiceInvite(invite, withheldFrom) {
      const next = invite !== undefined && VOICE_INVITE_PATTERN.test(invite) ? invite : undefined;
      if (next === voiceInvite) return [];
      voiceInvite = next;
      const out: Outbound[] = [];
      for (const seat of seated()) {
        if (seat.connection === undefined || seat.athleteId === withheldFrom) continue;
        out.push({
          kind: 'send',
          connection: seat.connection,
          message: { type: 'voice', ...(next === undefined ? {} : { voiceInvite: next }) },
        });
      }
      return out;
    },

    view() {
      return {
        phase,
        tick: tickNumber,
        seats: seated().map((seat) => ({
          riderId: seat.riderId,
          athleteId: seat.athleteId,
          state: seat.state,
          distanceMetres: seat.ride.distance,
          speedMetresPerSecond: seat.ride.speed,
          flags: flagsOf(seat),
          finishedAtTicks: seat.state === 'finished' ? seat.finishedAt : null,
          wattsPerKilogram: seat.ceilings.wattsPerKilogram,
          flaggedDurationsSeconds: seat.ceilings.flaggedDurationsSeconds,
        })),
        finishOrder: finishOrder(),
      };
    },
  };
}
