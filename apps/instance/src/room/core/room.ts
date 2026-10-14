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
 * ## Deferred, by name
 *
 * - **Drafting** is #787's: every rider is simulated at `k = 1` and every
 *   frame carries `draftPercent` 0, though the model is in `@onyourleft/physics`
 *   since #786.
 * - **What a flag does** is #69's, #785's and #789's (ADR 0028 D-2 rule 3).
 *
 * ## Live standings — #1347, ADR 0051
 *
 * Every frame row carries the **time gap** between that rider and the frame's
 * recipient and the rider's **live W/kg**, and the room sends a `roster` of
 * public names whenever a seat is taken or given up. Both are the room's: a gap
 * is read from each seat's own track of where the room put it, tick by tick
 * ({@link timeAt}), and W/kg is the power the room simulated over the mass it
 * was declared with, which never leaves this file. The client shows them and
 * computes neither.
 */

import { gradePercent, kilograms, seconds, type Kilograms, type Seconds } from '@onyourleft/domain';
import {
  advanceRider,
  declaredMassAdmissible,
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
  FLAG_PLAUSIBILITY,
  isPublicName,
  MAXIMUM_GAP_DECISECONDS,
  MAXIMUM_WATTS_PER_KILOGRAM_TENTHS,
  type FrameRider,
  type RefuseReason,
  type Report,
  type RoomMessage,
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
   * What other riders call them — #1347: the instance's ONE public projection
   * of the athlete (`auth/public-athlete.ts`, #774), and nothing else about
   * them. A name the wire would not carry is shown as {@link UNNAMED_RIDER}.
   */
  readonly displayName: string;
}

/**
 * The name a seat is given when the admission's name is not one the wire
 * carries (`@onyourleft/protocol` §`isPublicName`) — the same word
 * `auth/public-athlete.ts` shows for a name a moderator hid.
 */
export const UNNAMED_RIDER = 'Rider';

/**
 * How many ticks of each seat's track are kept for its gaps: an hour at 1 Hz,
 * the widest gap a frame carries (`MAXIMUM_GAP_DECISECONDS`). A gap that would
 * need an older entry is sent as the bound.
 */
export const TRACK_TICKS = MAXIMUM_GAP_DECISECONDS / 10;

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
  view(): RoomView;
}

/** A race's cut-off: how long after the first finisher the others have. */
export const FINISH_CUT_OFF_TICKS = 30 * 60;

/** The largest distance a frame can carry, in decimetres (`@onyourleft/protocol`'s bound). */
const MAXIMUM_FRAME_DECIMETRES = 1_000_000_000;
const MAXIMUM_FRAME_CENTIMETRES_PER_SECOND = 10_000;

interface Seat {
  readonly riderId: number;
  readonly athleteId: string;
  readonly displayName: string;
  readonly massKilograms: number;
  /**
   * Where the room put this seat, one entry a tick: `track[i]` is its distance,
   * in metres, after tick `trackStartTick + i` — never decreasing, since speed
   * is never below 0. What a gap is read from (#1347).
   */
  readonly track: number[];
  trackStartTick: number;
  /** The power the room simulated this seat at on the last tick, in watts. */
  lastPowerWatts: number;
  readonly conditions: RideConditions;
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
  const tickDuration: Seconds = seconds(settings.frameIntervalMs / 1000);

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

  /**
   * Seats whose rejoin window has run out: a race's rider did not finish; a
   * ride's seat is given up, and everybody still there is sent the roster.
   */
  function expireHeldSeats(nowMs: number): Outbound[] {
    let givenUp = false;
    for (const seat of seated()) {
      if (seat.state === 'held' && nowMs - seat.heldSinceMs > settings.rejoinWindowMs) {
        if (settings.kind === 'race') {
          seat.state = 'dnf';
        } else {
          seats.delete(seat.athleteId);
          givenUp = true;
        }
      }
    }
    return givenUp ? rosterToAll() : [];
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
          },
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
    byConnection.set(connection, seat);
    return [
      ...out,
      ...welcome(connection, seat),
      { kind: 'send', connection, message: roster() },
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
      displayName: isPublicName(admission.displayName) ? admission.displayName : UNNAMED_RIDER,
      massKilograms: admission.declaredMassKilograms,
      track: [START_OF_RIDE.distance],
      trackStartTick: tickNumber,
      lastPowerWatts: 0,
      conditions: ridingConditions(mass, settings.ridingPosition),
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
    };
    nextRiderId += 1;
    seats.set(seat.athleteId, seat);
    if (settings.kind === 'ride' && phase === 'lobby') {
      phase = 'countdown';
      startsAtMs = nowMs + settings.countdownMs;
    }
    // Everybody else hears the new name; the new rider hears all of them in attach.
    return [...attach(seat, connection, nowMs), ...rosterToAll(seat.connection)];
  }

  /** Who is seated, by public name (#1347): `roster`. */
  function roster(): RoomMessage {
    return {
      type: 'roster',
      riders: seated().map((seat) => ({ riderId: seat.riderId, name: seat.displayName })),
    };
  }

  /** The roster to every connected rider but `except` — after a seat is taken or given up. */
  function rosterToAll(except?: ConnectionId): Outbound[] {
    const message = roster();
    return seated().flatMap((seat) =>
      seat.connection === undefined || seat.connection === except
        ? []
        : [{ kind: 'send' as const, connection: seat.connection, message }],
    );
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
   * The tick, with its fractional part, at which `seat` first reached
   * `metres` — read from its track and interpolated within a tick.
   */
  function timeAt(seat: Seat, metres: number): number {
    const { track } = seat;
    const first = track[0] as number;
    if (first >= metres) {
      // An untrimmed track starts where the seat did, at 0 m, so this is when
      // it set off. A trimmed one has forgotten when it was there, and its
      // first entry is at least TRACK_TICKS old — an hour, the bound, either way.
      return seat.trackStartTick;
    }
    let low = 0;
    let high = track.length - 1;
    // The first index at or past `metres`; the caller asks only of a seat that is there.
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((track[middle] as number) >= metres) high = middle;
      else low = middle + 1;
    }
    const before = track[low - 1] as number;
    const after = track[low] as number;
    return seat.trackStartTick + low - 1 + (metres - before) / (after - before);
  }

  /**
   * The time gap from `recipient` to `rider`, in tenths of a second: positive
   * when `rider` is behind, and how long ago the one in front was where the one
   * behind is now (#1347, ADR 0051 D-3).
   */
  function gapDeciseconds(recipient: Seat, rider: Seat): number {
    const mine = recipient.ride.distance;
    const theirs = rider.ride.distance;
    if (rider === recipient || mine === theirs) return 0;
    const [front, back, sign] = theirs < mine ? [recipient, rider, 1] : [rider, recipient, -1];
    const ticks = tickNumber - timeAt(front, back.ride.distance);
    const deciseconds = Math.round(ticks * (settings.frameIntervalMs / 100));
    return sign * Math.min(MAXIMUM_GAP_DECISECONDS, deciseconds);
  }

  function wattsPerKilogramTenths(seat: Seat): number {
    const tenths = Math.round((seat.lastPowerWatts / seat.massKilograms) * 10);
    return Math.min(MAXIMUM_WATTS_PER_KILOGRAM_TENTHS, tenths);
  }

  function frameRider(seat: Seat, recipient: Seat): FrameRider {
    const decimetres = Math.floor(seat.ride.distance * 10);
    const centimetres = Math.round(seat.ride.speed * 100);
    return {
      riderId: seat.riderId,
      decimetres: decimetres > MAXIMUM_FRAME_DECIMETRES ? MAXIMUM_FRAME_DECIMETRES : decimetres,
      centimetresPerSecond:
        centimetres > MAXIMUM_FRAME_CENTIMETRES_PER_SECOND
          ? MAXIMUM_FRAME_CENTIMETRES_PER_SECOND
          : centimetres,
      draftPercent: 0,
      flags: flagsOf(seat),
      gapDeciseconds: gapDeciseconds(recipient, seat),
      wattsPerKilogramTenths: wattsPerKilogramTenths(seat),
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
        grade: gradePercent(settings.course.gradePercentAt(before)),
        duration: tickDuration,
      },
      seat.conditions,
    );
    const power = verdict?.admissible === true ? verdict.power : 0;
    seat.ceilings.record(power);
    seat.lastPowerWatts = power;
    seat.track.push(seat.ride.distance);
    if (seat.track.length > 2 * TRACK_TICKS) {
      const drop = seat.track.length - TRACK_TICKS - 1;
      seat.track.splice(0, drop);
      seat.trackStartTick += drop;
    }
    const line = settings.course.lengthMetres;
    if (settings.kind === 'race' && seat.ride.distance >= line) {
      seat.state = 'finished';
      // Where in this tick the line was crossed: the share of the tick's distance before it.
      seat.finishedAt = tickNumber - 1 + (line - before) / (seat.ride.distance - before);
      finishers.push(seat);
    }
  }

  function frames(): Outbound[] {
    const shown = seated().filter((seat) => seat.state !== 'dnf');
    const out: Outbound[] = [];
    for (const seat of seated()) {
      if (seat.connection === undefined) continue;
      // Per recipient since #1347: each row's gap is to the rider it is sent to.
      const riders = shown.map((rider) => frameRider(rider, seat));
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
        },
      });
    }
    return out;
  }

  /** Finishers by where in their tick they crossed the line, then by rider id. */
  function finishOrder(): number[] {
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

  function receive(connection: ConnectionId, text: string, nowMs: number): Outbound[] {
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
    if (seat.state === 'connected') {
      report(seat, message, nowMs);
    }
    return [];
  }

  function disconnect(connection: ConnectionId, nowMs: number): Outbound[] {
    const seat = byConnection.get(connection);
    byConnection.delete(connection);
    if (seat === undefined || seat.connection !== connection) {
      return [];
    }
    seat.connection = undefined;
    seat.latest = undefined;
    let gaveUp = false;
    if (seat.state === 'connected') {
      if (phase === 'lobby' || (phase === 'countdown' && settings.kind === 'race')) {
        // Nobody has ridden yet: a race's lobby gives the seat back at once.
        seats.delete(seat.athleteId);
        gaveUp = true;
      } else {
        seat.state = 'held';
        seat.heldSinceMs = nowMs;
      }
    }
    if (settings.kind === 'ride' && ![...seats.values()].some((s) => s.connection !== undefined)) {
      emptySinceMs ??= nowMs;
    }
    return gaveUp ? rosterToAll() : [];
  }

  function tick(nowMs: number): Outbound[] {
    if (phase === 'countdown' && nowMs >= startsAtMs) {
      phase = 'running';
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
    for (const seat of seated()) {
      if (onTheRoad(seat)) ride(seat);
    }
    const out = frames();
    if (settings.kind === 'race') {
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
  }

  return {
    receive: (connection, text, nowMs) => [
      ...expireHeldSeats(nowMs),
      ...receive(connection, text, nowMs),
    ],

    disconnect: (connection, nowMs) => [
      ...expireHeldSeats(nowMs),
      ...disconnect(connection, nowMs),
    ],

    start(nowMs) {
      if (settings.kind !== 'race' || phase !== 'lobby') return [];
      phase = 'countdown';
      startsAtMs = nowMs + settings.countdownMs;
      return seated().flatMap((seat) =>
        seat.connection === undefined ? [] : countdownTo(seat.connection, nowMs),
      );
    },

    tick: (nowMs) => [...expireHeldSeats(nowMs), ...tick(nowMs)],

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
