// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **One room, from this client's side** — #782: the hello and its ticket,
 * reporting the rider's power, the frames the room sends, and getting back in
 * when the connection goes.
 *
 * ```text
 * connecting ──welcome──▶ joined ──socket closes──▶ lost ──backoff, fresh ticket──▶ connecting
 *     │                                               │
 *     └──refuse / 4001–4006────────▶ refused          └──past the rejoin window──▶ gone
 * ```
 *
 * Nothing here names a socket, a timer or a clock: they arrive as a
 * {@link RoomLink}, a {@link RoomTimers} and a `now`, so the whole machine is
 * driven by a test with a scripted room (`net/testing.ts`). The production link
 * is `room-port.ts`'s, over `instance/instance-transport.ts` — the ONE module
 * this client may reach an instance through (ADR 0036 D-3 (a)).
 *
 * ## What is sent, exactly
 *
 * A `hello` with a single-use ticket and this build's two versions, then a
 * `report` every `reportIntervalMs` (500 ms, ADR 0037 D-4) until the socket
 * closes: an increasing sequence, this device's clock, the power in watts and
 * the cadence when there is one. **Never a position** — `@onyourleft/protocol`
 * has no field for one, the room re-simulates every rider from their power
 * (ADR 0028 D-2), and `room-session.test.ts` walks every message sent for a
 * coordinate-named field.
 *
 * ## The keepalive — ADR 0037 D-8.1, ruling Q3/Q6
 *
 * A Cloudflare Tunnel closes a WebSocket that idles, and ADR 0037 D-8.1 asks a
 * client to send something at least every 30 s. A browser cannot send a
 * WebSocket ping, so **the reports are the keepalive**: one every
 * `reportIntervalMs` from the welcome to the close, whether or not the ride is
 * moving, carrying 0 W when there is no live power reading. That is the same
 * physics the room applies to silence (rule 1: coast at 0 W), so the room
 * computes nothing different, and the socket never idles for more than
 * {@link KEEPALIVE_INTERVAL_MS}.
 *
 * ## Rejoin — ADR 0037 D-8.2
 *
 * Any close the room did not refuse — the tunnel's idle close, Cloudflare
 * restarting a server, a phone changing network — is `lost`, and the session
 * reconnects by itself: a FRESH ticket (a ticket is single use, #772), after
 * {@link backoffMs}. The room keeps a dropped rider's seat and place on the
 * road for its rejoin window (#779, 60 s by default) and coasts them at 0 W
 * meanwhile; past {@link REJOIN_GIVE_UP_MS} this stops trying, because the
 * room would seat a rider who came back later as somebody new at 0 m.
 */

import { fieldDraftFactors } from '@onyourleft/physics';
import {
  decodeRoomMessage,
  encodeMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type Finish,
  type RefuseReason,
  type RoomConfig,
  type Standings,
} from '@onyourleft/protocol';

import {
  isRoomId,
  type InstanceSocket,
  type InstanceSocketEvents,
} from '../instance/instance-transport';
import { SnapshotBuffer, type DrawnRemoteRider } from './snapshots';

/** The first reconnect waits this long; each after doubles it. */
export const BACKOFF_BASE_MS = 500;

/** The longest one reconnect waits. */
export const BACKOFF_CEILING_MS = 8_000;

/**
 * How long after losing the room this stops trying: **55 s**, inside the
 * room's own 60 s rejoin window (`room/core/settings.ts`
 * §`DEFAULT_REJOIN_WINDOW_MS`), so a rider who comes back comes back to their
 * own seat or not at all.
 */
export const REJOIN_GIVE_UP_MS = 55_000;

/**
 * The longest the socket goes without this client sending anything, once
 * joined: one report interval, 500 ms (ADR 0037 D-4) — against ADR 0037
 * D-8.1's "at least every 30 seconds" and a tunnel idle timeout reported at
 * 100 s.
 */
export const KEEPALIVE_INTERVAL_MS = 500;

/** How many refused tickets in a row are retried before the session gives up. */
const TICKET_REFUSALS_RETRIED = 2;

/** Close codes a room ends a connection with that mean "do not come back" (`close-codes.ts`). */
const FINAL_CLOSE_CODES: ReadonlySet<number> = new Set([4001, 4002, 4004, 4005, 4006]);

/**
 * Why no ticket will come, however often it is asked — each its own sentence
 * in `game/room-ride.ts` §`ROOM_REFUSED_TEXT` (#782's review, N6):
 *
 * - `not-signed-in` — this device holds no session on the instance, or the
 *   instance answered 401;
 * - `not-eligible` — 403: the account may not join this room;
 * - `no-such-room` — 404: the instance has no room by that id;
 * - `no-declared-mass` — the rider has declared no weight, so no ticket is
 *   asked for at all (ADR 0028 D-1: a default is not a declaration);
 * - `instance-refused` — any other 4xx but 429;
 * - `cannot-seal` — the ticket route is sealed-only (#1210, ADR 0047 D-7
 *   phase 2) and this device cannot seal to its instance now: no card, a copy
 *   a website served, or keys refused. Nothing was asked of the room.
 */
export type TicketRefusal =
  | 'not-signed-in'
  | 'not-eligible'
  | 'no-such-room'
  | 'no-declared-mass'
  | 'instance-refused'
  | 'cannot-seal';

/** A ticket, or why there is none. */
export type TicketAnswer =
  | { readonly kind: 'ticket'; readonly ticket: string }
  /** The instance refused, or would: final. */
  | { readonly kind: 'refused'; readonly reason: TicketRefusal }
  /** Nothing answered: try again later. */
  | { readonly kind: 'unreachable' };

/**
 * The short fixed list a rider reports another from inside a ride by — #789.
 * The instance's own list is `apps/instance` §`ROOM_REPORT_REASONS`, and
 * `room-port.test.ts` holds the two equal: a key the instance does not know
 * would be refused as `validation_failed` on every press.
 */
export const ROOM_REPORT_REASON_KEYS = ['display-name', 'cheating', 'other'] as const;
export type RoomReportReason = (typeof ROOM_REPORT_REASON_KEYS)[number];

/**
 * What became of an in-ride report — #789:
 *
 * - `reported` — 204: filed for the moderators;
 * - `rate-limited` — 429: this rider's hourly allowance of reports is spent;
 * - `gone` — 404: the rider is no longer in that seat, or this rider is no
 *   longer in the room, so there was nobody to file it about;
 * - `refused` — no session, a device that cannot seal, or any other refusal;
 * - `unreachable` — nothing answered.
 */
export type RoomReportAnswer =
  | { readonly kind: 'reported' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unreachable' };

/** How a session reaches a room. `room-port.ts` builds the production one. */
export interface RoomLink {
  ticket(roomId: string): Promise<TicketAnswer>;
  open(roomId: string, events: InstanceSocketEvents): InstanceSocket;
  /**
   * Report the rider in seat `riderId` of `roomId` — #789, the instance's
   * `POST /v1/rooms/{roomId}/reports`. By SEAT: the room says who sits there.
   */
  report(roomId: string, riderId: number, reason: RoomReportReason): Promise<RoomReportAnswer>;
}

/** The timers a session schedules on. The platform's own in production. */
export interface RoomTimers {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What the rider is putting out, read at each report. */
export interface RoomSample {
  /** `undefined` when there is no live power reading: 0 W is reported. */
  readonly powerWatts: number | undefined;
  readonly cadenceRpm?: number | undefined;
}

/**
 * Where a RACE is, as this client knows it — #785. A group ride is always
 * `not-a-race`.
 *
 * ⚠️ **The room's word, never this client's clock.** `counting` holds the local
 * instant the room's countdown should end, computed from when its `countdown`
 * arrived — a duration the room sent, so a client clock minutes out shows the
 * right number — but `running` begins only with the room's first FRAME: a
 * rider is held on the line until the room itself says the race is on.
 */
export type RoomRace =
  | { readonly kind: 'not-a-race' }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'counting'; readonly endsAtLocalMs: number }
  | { readonly kind: 'running' }
  | {
      readonly kind: 'finished';
      readonly order: readonly number[];
      /**
       * This rider's place in the room's order, 1 for the winner, or `null`
       * when they are not in it (#785) — read off the room's order, never
       * worked out here.
       */
      readonly place: number | null;
    };

/**
 * One row of a race's standings, as the room sent it — #1347, ADR 0051. Every
 * number is the ROOM's: the gap it took from its own positions, to this rider,
 * and the W/kg it simulated. Nothing here is computed on this device.
 */
export interface RoomStandingsRow {
  readonly riderId: number;
  /** The rider's public name, once the room has named them; `undefined` until then. */
  readonly displayName: string | undefined;
  /** Whether this row is this rider's own. */
  readonly you: boolean;
  /** Seconds behind this rider, positive; ahead, negative; 0 on the own row. */
  readonly gapSeconds: number;
  readonly wattsPerKilogram: number;
  /** `@onyourleft/protocol`'s `FLAG_*`, or'd. */
  readonly flags: number;
}

/** A race's standings, in the room's order, and the tick they are of. */
export interface RoomStandings {
  readonly tick: number;
  readonly rows: readonly RoomStandingsRow[];
}

/** Where a session is. */
export type RoomSessionStatus =
  | { readonly kind: 'connecting' }
  | { readonly kind: 'joined'; readonly riderId: number; readonly config: RoomConfig }
  /** Connection lost; reconnecting by itself. `since` is the local instant it went. */
  | { readonly kind: 'lost'; readonly since: number }
  /** The room said no, and will keep saying it. */
  | {
      readonly kind: 'refused';
      /**
       * `invalid-room`: an id no instance could route, refused before anything
       * is sent. `not-the-rooms-route`: the room's `routeRef` is not the route
       * this device rides (#784).
       */
      readonly reason:
        RefuseReason | TicketRefusal | 'replaced' | 'invalid-room' | 'not-the-rooms-route';
    }
  /** Lost for longer than the room keeps a seat. */
  | { readonly kind: 'gone' }
  /** The rider left. */
  | { readonly kind: 'left' };

export interface RoomSessionOptions {
  readonly roomId: string;
  readonly link: RoomLink;
  readonly timers: RoomTimers;
  /** This device's clock, in milliseconds. */
  readonly now: () => number;
  /** `@onyourleft/physics`' `PHYSICS_VERSION` of this build (ADR 0028 D-2 rule 5). */
  readonly physicsVersion: number;
  /** Read at every report. */
  readonly sample: () => RoomSample;
  /**
   * The SHA-256 of the route this device fetched and checked for the room
   * (#784, `rooms/share.ts`). A welcome whose `routeRef` names other bytes is
   * refused as `not-the-rooms-route`: the room would simulate a road this
   * device is not drawing. Absent, the welcome's `routeRef` is not compared.
   */
  readonly routeSha256?: string | undefined;
  /** Told after every change of {@link RoomSession.status}. */
  readonly onChange?: (() => void) | undefined;
  /** 0 ≤ x < 1, for the backoff's jitter. `Math.random` in production. */
  readonly random?: (() => number) | undefined;
  /**
   * Whether an arriving frame is kept. Always, in the product; the browser
   * gate's control turns fan-out off with it (`browser/room-harness.ts`).
   */
  readonly acceptFrame?: (() => boolean) | undefined;
}

/**
 * How long reconnect `attempt` (0 first) waits: {@link BACKOFF_BASE_MS} × 2ⁿ,
 * at most {@link BACKOFF_CEILING_MS}, less up to a quarter at random so that
 * fifty riders dropped by one edge restart do not all come back on one tick.
 */
export function backoffMs(attempt: number, random: number): number {
  const exact = Math.min(BACKOFF_CEILING_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt));
  return Math.round(exact * (1 - 0.25 * Math.min(Math.max(random, 0), 1)));
}

/** One room, joined and kept joined. */
export class RoomSession {
  readonly #options: RoomSessionOptions;
  #status: RoomSessionStatus = { kind: 'connecting' };
  #socket: InstanceSocket | undefined;
  #reporter: unknown;
  #retry: unknown;
  #attempt = 0;
  #ticketRefusals = 0;
  #sequence = 0;
  #lostSince: number | undefined;
  #snapshots: SnapshotBuffer | undefined;
  #finish: Finish | undefined;
  /** A race's riders' public names, by rider id (#1347). */
  readonly #names = new Map<number, string>();
  /** A race's newest standings (#1347). */
  #standings: Standings | undefined;
  /** The room's countdown, and the local instant it arrived (#785). */
  #countdown: { readonly startsInMs: number; readonly atLocalMs: number } | undefined;
  /** Whether the room has sent a frame: a race is on from its first (#785). */
  #framed = false;
  #kind: 'race' | 'ride' | undefined;
  /** How many times a welcome has arrived: 1 is the join, more are rejoins. */
  #welcomes = 0;
  #riderId: number | undefined;
  /** Bumped per connection, so a late event from a superseded socket is ignored. */
  #generation = 0;

  constructor(options: RoomSessionOptions) {
    this.#options = options;
    void this.#connect();
  }

  get status(): RoomSessionStatus {
    return this.#status;
  }

  /**
   * How many times the room has welcomed this rider — the join, then each
   * rejoin. ⚠️ Read by tests only, as the count a rejoin is asserted by; no
   * screen says it. `check:wiring` watches this directory since #782's review
   * but looks at exports and port methods, never a class member, so this
   * sentence is the record.
   */
  get welcomes(): number {
    return this.#welcomes;
  }

  /**
   * A race's finish order, once the room has sent it — read through
   * {@link race}, which `room-port.ts` hands the game (#785). Not a tag
   * `check:wiring` can hold, since it does not look at class members:
   * `room-port.test.ts` §"#785" reads it through the port.
   */
  get finish(): Finish | undefined {
    return this.#finish;
  }

  /** Where a race is, as the room has said — see {@link RoomRace}. */
  race(): RoomRace {
    if (this.#kind !== 'race') return { kind: 'not-a-race' };
    if (this.#finish !== undefined) {
      const order = this.#finish.order;
      const at = this.#riderId === undefined ? -1 : order.indexOf(this.#riderId);
      return { kind: 'finished', order, place: at === -1 ? null : at + 1 };
    }
    if (this.#framed) return { kind: 'running' };
    const countdown = this.#countdown;
    if (countdown !== undefined) {
      return { kind: 'counting', endsAtLocalMs: countdown.atLocalMs + countdown.startsInMs };
    }
    return { kind: 'waiting' };
  }

  /**
   * A race's newest standings, joined with the names the room sent — #1347.
   * `undefined` before the first, and in a group ride, which has none.
   */
  standings(): RoomStandings | undefined {
    const standings = this.#standings;
    if (standings === undefined) return undefined;
    const own = this.#riderId;
    return {
      tick: standings.tick,
      rows: standings.riders.map((rider) => ({
        riderId: rider.riderId,
        displayName: this.#names.get(rider.riderId),
        you: rider.riderId === own,
        gapSeconds: rider.gapDeciseconds / 10,
        wattsPerKilogram: rider.wattsPerKilogramTenths / 10,
        flags: rider.flags,
      })),
    };
  }

  /**
   * The draft multiplier `k` this client predicts for its own rider — #787,
   * ADR 0038 D-4: from the room's NEWEST frame, every rider where the room
   * held them on one tick, through the same `fieldDraftFactors` the room
   * runs, so it is the `k` the room will ride this rider at on its next tick.
   * The room corrects the rest (`correction.ts`). `1` — riding alone — in a
   * room with drafting off, before a frame, and while the room is not joined.
   * Only riders the room holds are counted: a bot pacer or a ghost is never
   * in a frame, so neither shelters nor is sheltered (#327).
   */
  draftFactor(): number {
    const status = this.#status;
    const own = this.#riderId;
    if (status.kind !== 'joined' || status.config.drafting !== 'on' || own === undefined) return 1;
    const riders = this.#snapshots?.newestRiders() ?? [];
    const index = riders.findIndex((rider) => rider.riderId === own);
    if (index === -1) return 1;
    return fieldDraftFactors(riders.map((rider) => rider.distanceMetres))[index] as number;
  }

  /** Every OTHER rider, drawn at `localMs` less the render delay. @see SnapshotBuffer.at */
  others(localMs: number): readonly DrawnRemoteRider[] {
    const own = this.#riderId;
    return (this.#snapshots?.at(localMs) ?? []).filter((rider) => rider.riderId !== own);
  }

  /**
   * The room's newest word on THIS rider, and the local instant it describes —
   * what `correction.ts` compares with the local simulation.
   */
  own(): { readonly rider: DrawnRemoteRider; readonly atLocalMs: number } | undefined {
    const riderId = this.#riderId;
    const snapshots = this.#snapshots;
    if (riderId === undefined || snapshots === undefined) return undefined;
    const newest = snapshots.newest(riderId);
    if (newest === undefined) return undefined;
    const atLocalMs = snapshots.localTimeOf(newest.roomMs);
    return atLocalMs === undefined ? undefined : { rider: newest.rider, atLocalMs };
  }

  /** Leave the room: close the socket and stop reconnecting. */
  leave(): void {
    if (this.#status.kind === 'left') return;
    this.#setStatus({ kind: 'left' });
    this.#stopReporting();
    this.#clearRetry();
    const socket = this.#socket;
    this.#socket = undefined;
    this.#generation += 1;
    socket?.close(1000, 'left');
  }

  #setStatus(status: RoomSessionStatus): void {
    this.#status = status;
    this.#options.onChange?.();
  }

  #finished(): boolean {
    const kind = this.#status.kind;
    return kind === 'left' || kind === 'refused' || kind === 'gone';
  }

  async #connect(): Promise<void> {
    // Never synchronously inside the constructor: a link that answered at once
    // would report a change before the caller holds the session it is about.
    await Promise.resolve();
    if (this.#finished()) return;
    const { link, roomId } = this.#options;
    // #782's review (B1): an id the instance could not route is refused for
    // good HERE, before a ticket is asked for — never lost and retried, since
    // every retry would be one more request built from it.
    if (!isRoomId(roomId)) {
      this.#setStatus({ kind: 'refused', reason: 'invalid-room' });
      return;
    }
    let answer: TicketAnswer;
    try {
      answer = await link.ticket(roomId);
    } catch {
      answer = { kind: 'unreachable' };
    }
    if (this.#finished()) return;
    if (answer.kind === 'refused') {
      this.#setStatus({ kind: 'refused', reason: answer.reason });
      return;
    }
    if (answer.kind === 'unreachable') {
      this.#lose();
      return;
    }
    const ticket = answer.ticket;
    const generation = ++this.#generation;
    const current = (): boolean => this.#generation === generation;
    let refusedWith: RefuseReason | undefined;
    const events: InstanceSocketEvents = {
      onOpen: () => {
        if (!current()) return;
        this.#send({
          type: 'hello',
          protocol: PROTOCOL_VERSION,
          physicsVersion: this.#options.physicsVersion,
          ticket,
        });
      },
      onText: (text) => {
        if (!current()) return;
        const decoded = decodeRoomMessage(text);
        if (!decoded.ok) return;
        const message = decoded.message;
        switch (message.type) {
          case 'welcome': {
            const expected = this.#options.routeSha256;
            if (expected !== undefined && message.routeRef.sha256 !== expected) {
              // Not a lost link to retry: the same room answers the same way.
              this.#setStatus({ kind: 'refused', reason: 'not-the-rooms-route' });
              this.#generation += 1;
              this.#stopReporting();
              const socket = this.#socket;
              this.#socket = undefined;
              socket?.close(1000, 'left');
              return;
            }
            this.#welcomes += 1;
            this.#attempt = 0;
            this.#ticketRefusals = 0;
            this.#lostSince = undefined;
            // A rejoin is the same seat and the same room clock; a first join
            // starts the buffer.
            this.#snapshots ??= new SnapshotBuffer(message.roomConfig.frameIntervalMs);
            this.#riderId = message.riderId;
            this.#kind = message.roomConfig.kind;
            // #1347: standings from before a loss are gaps that stopped
            // moving; the room's next ones replace them within a tick.
            this.#standings = undefined;
            this.#startReporting(message.roomConfig.reportIntervalMs);
            this.#setStatus({
              kind: 'joined',
              riderId: message.riderId,
              config: message.roomConfig,
            });
            return;
          }
          case 'refuse':
            refusedWith = message.reason;
            return;
          case 'frame':
            if (this.#options.acceptFrame?.() === false) return;
            this.#framed = true;
            this.#snapshots?.push(message, this.#options.now());
            return;
          case 'countdown':
            this.#countdown = { startsInMs: message.startsInMs, atLocalMs: this.#options.now() };
            this.#options.onChange?.();
            return;
          case 'name':
            this.#names.set(message.riderId, message.displayName);
            return;
          case 'standings':
            // The browser gate's control turns these off with the frames.
            if (this.#options.acceptFrame?.() === false) return;
            this.#standings = message;
            return;
          case 'finish':
            this.#finish = message;
            this.#options.onChange?.();
            return;
        }
      },
      onClose: (code) => {
        if (!current()) return;
        this.#generation += 1;
        this.#socket = undefined;
        this.#stopReporting();
        if (this.#finished()) return;
        if (refusedWith === 'ticket-refused' || code === 4003) {
          // A ticket spent or expired on the way: one more, fresh, a couple of times.
          this.#ticketRefusals += 1;
          if (this.#ticketRefusals > TICKET_REFUSALS_RETRIED) {
            this.#setStatus({ kind: 'refused', reason: 'ticket-refused' });
            return;
          }
          this.#lose();
          return;
        }
        if (refusedWith !== undefined) {
          this.#setStatus({ kind: 'refused', reason: refusedWith });
          return;
        }
        if (FINAL_CLOSE_CODES.has(code)) {
          this.#setStatus({ kind: 'refused', reason: code === 4006 ? 'replaced' : 'room-closed' });
          return;
        }
        this.#lose();
      },
    };
    try {
      this.#socket = link.open(roomId, events);
    } catch {
      this.#lose();
    }
  }

  /** The connection went, or never came: reconnect after a backoff, unless it has been too long. */
  #lose(): void {
    if (this.#finished()) return;
    const now = this.#options.now();
    this.#lostSince ??= now;
    if (now - this.#lostSince >= REJOIN_GIVE_UP_MS) {
      this.#setStatus({ kind: 'gone' });
      return;
    }
    if (this.#status.kind !== 'lost') {
      this.#setStatus({ kind: 'lost', since: this.#lostSince });
    }
    const wait = backoffMs(this.#attempt, (this.#options.random ?? Math.random)());
    this.#attempt += 1;
    this.#clearRetry();
    this.#retry = this.#options.timers.setTimeout(() => {
      this.#retry = undefined;
      void this.#connect();
    }, wait);
  }

  #clearRetry(): void {
    if (this.#retry !== undefined) this.#options.timers.clearTimeout(this.#retry);
    this.#retry = undefined;
  }

  #startReporting(intervalMs: number): void {
    this.#stopReporting();
    const every = Math.min(intervalMs, KEEPALIVE_INTERVAL_MS);
    const tick = (): void => {
      this.#report();
      this.#reporter = this.#options.timers.setTimeout(tick, every);
    };
    this.#reporter = this.#options.timers.setTimeout(tick, every);
  }

  #stopReporting(): void {
    if (this.#reporter !== undefined) this.#options.timers.clearTimeout(this.#reporter);
    this.#reporter = undefined;
  }

  #report(): void {
    const sample = this.#options.sample();
    const power = sample.powerWatts;
    const cadence = sample.cadenceRpm;
    this.#sequence += 1;
    this.#send({
      type: 'report',
      sequence: this.#sequence,
      atMs: Math.max(0, Math.round(this.#options.now())),
      powerWatts: power !== undefined && Number.isFinite(power) && power > 0 ? power : 0,
      ...(cadence !== undefined && Number.isFinite(cadence) && cadence >= 0
        ? { cadenceRpm: Math.min(cadence, 255) }
        : {}),
    });
  }

  #send(message: ClientMessage): void {
    try {
      this.#socket?.send(encodeMessage(message));
    } catch {
      // A value the encoder refuses (a power past the protocol's bound): the
      // room coasts the rider for that report, which is rule 1 anyway.
    }
  }
}
