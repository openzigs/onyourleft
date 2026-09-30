// SPDX-License-Identifier: Apache-2.0

/**
 * Every message a client and a race room exchange, as types.
 *
 * The shape is [spike 0007](../../../docs/spikes/0007-race-room-under-workerd.md)
 * §1's and [ADR 0028](../../../docs/adr/0028-racing-fairness.md) D-2's, on the
 * transport [ADR 0037](../../../docs/adr/0037-instance-runtime-hosting-and-transport.md)
 * D-3 and D-4 chose: JSON over a WebSocket, a client reporting twice a second,
 * the room answering once a second.
 *
 * ```text
 * client → room   hello   { protocol, physicsVersion, ticket }
 * room → client   welcome { riderId, routeRef: { sha256 }, roomConfig } | refuse { reason }
 * client → room   report  { sequence, atMs, powerWatts, cadenceRpm? }        every 500 ms
 * room → client   frame   { tick, ackSequence?, riders: [[id, dm, cm/s, draft %, flags]] }   every 1 s
 * room → client   countdown { startsInMs }                                  a race only
 * room → client   finish  { order: [riderId, …] }                            a race only
 * ```
 *
 * ## Three things that are decisions
 *
 * - **A report carries power, never a position.** The room re-simulates every
 *   rider (ADR 0028 D-2); a client that could report where it is could report
 *   where it would like to be.
 * - **A report carries no `riderId`.** ADR 0028 D-2's report names one, and
 *   the room attaches it — from the connection the report arrived on, never
 *   from the wire. A rider id a client could write is one it could forge.
 * - ⚠️ **No field anywhere carries a latitude or a longitude.** A rider is
 *   placed by distance along the route (ADR 0028 D-7.3), and the route is
 *   named by the SHA-256 of its content, never inlined: its geometry travels
 *   once, over HTTP, through the route-share path (#784), which refuses a
 *   route that starts in a privacy zone. `coordinates.test.ts` walks every
 *   schema for a coordinate-named field.
 */

/** The version of this wire format. A room refuses a client on any other. */
export const PROTOCOL_VERSION = 1;

/** Where a rider's hands are, fixed by the race — `@onyourleft/physics`' `RidingPosition`. */
export type RidingPosition = 'upright' | 'hoods' | 'drops';

/** The first thing a client says. */
export interface Hello {
  readonly type: 'hello';
  /** {@link PROTOCOL_VERSION} of the client's build. */
  readonly protocol: number;
  /** `@onyourleft/physics`' `PHYSICS_VERSION` of the client's build (ADR 0028 D-2 rule 5). */
  readonly physicsVersion: number;
  /** An opaque admission ticket. What it proves is the room's business (#779). */
  readonly ticket: string;
}

/** One power sample — ADR 0028 D-2's report, less the `riderId` the room attaches. */
export interface Report {
  readonly type: 'report';
  /** Increasing per rider; a room admits a report only past the last one it admitted. */
  readonly sequence: number;
  /** The client's own clock when it sampled, in milliseconds. */
  readonly atMs: number;
  readonly powerWatts: number;
  readonly cadenceRpm?: number;
}

/** What kind of room this is: a race has a finish order, a group ride does not. */
export type RoomKind = 'race' | 'ride';

/** The room's settings a client needs to simulate the same ride the room does. */
export interface RoomConfig {
  readonly kind: RoomKind;
  /** The race's position, for everybody, never the rider's (ADR 0028 D-1). */
  readonly ridingPosition: RidingPosition;
  /** How often the client reports — {@link REPORT_INTERVAL_MS} by default. */
  readonly reportIntervalMs: number;
  /** How often the room sends a frame — {@link FRAME_INTERVAL_MS} by default. */
  readonly frameIntervalMs: number;
}

/** ADR 0037 D-4: ingest at 2 Hz. */
export const REPORT_INTERVAL_MS = 500;

/** ADR 0037 D-4: fan-out at 1 Hz. */
export const FRAME_INTERVAL_MS = 1000;

/** The room's answer to a hello it accepts. */
export interface Welcome {
  readonly type: 'welcome';
  readonly riderId: number;
  /** The route, by the SHA-256 of its content, lower-case hex. Never its geometry. */
  readonly routeRef: { readonly sha256: string };
  readonly roomConfig: RoomConfig;
}

/**
 * Why a room refused a hello. Settled by #779, where the room that sends them
 * was built (they were placeholders in #768):
 *
 * - `protocol-mismatch`, `physics-mismatch` — ADR 0028 D-2 rule 5.
 * - `ticket-refused` — the room's admission does not accept the ticket: not
 *   one it issued, expired, or for another room. It says nothing about why, so
 *   a refusal cannot be used to probe which tickets exist.
 * - `room-full` — every seat is taken (ADR 0037 D-7: 50 by default, 100 at most).
 * - `room-closed` — the room admits nobody new: a race that has started, to an
 *   athlete who holds no seat; a race to an athlete whose seat was given up
 *   when their rejoin window ran out (they did not finish); a room that has
 *   finished. Added by #779 while version 1 is unshipped — without it the only
 *   honest answers to a late hello were two that name something else.
 */
export type RefuseReason =
  'protocol-mismatch' | 'physics-mismatch' | 'ticket-refused' | 'room-full' | 'room-closed';

/** The room's answer to a hello it does not accept. */
export interface Refuse {
  readonly type: 'refuse';
  readonly reason: RefuseReason;
}

/** The room's plausibility rule has flagged this rider (ADR 0028 D-2 rule 3). */
export const FLAG_PLAUSIBILITY = 1;

/** The room is coasting this rider: its last report was inadmissible or never came (rule 1). */
export const FLAG_COASTING = 2;

/** One rider in a frame. On the wire, a five-slot array in this order. */
export interface FrameRider {
  readonly riderId: number;
  /** Distance along the route, in whole decimetres. */
  readonly decimetres: number;
  readonly centimetresPerSecond: number;
  /** 0 when riding alone; the share of drag a draft removes, when there is drafting (#764). */
  readonly draftPercent: number;
  /** {@link FLAG_PLAUSIBILITY} and {@link FLAG_COASTING}, or'd. */
  readonly flags: number;
}

/** The room's tick: the whole field, once a second. */
export interface Frame {
  readonly type: 'frame';
  readonly tick: number;
  /** The last report sequence the room admitted from the recipient; absent before the first. */
  readonly ackSequence?: number;
  readonly riders: readonly FrameRider[];
}

/**
 * A race's countdown has begun — #785. Sent to every seated rider when the
 * race is started, and to a rider who joins or rejoins during it.
 *
 * ⚠️ **A duration, never an instant.** `startsInMs` is how long after the room
 * SENT it the first tick is, on the room's own clock. A client counts it down
 * from when it arrived on its own clock, so a client whose clock is minutes
 * off still shows the right number, and it is the room's first frame — never
 * the client's countdown — that lets the ride go (ADR 0028 D-2: the room's
 * position is the one that counts).
 *
 * Added while version 1 has no rider on it (#784 is the first way into a
 * room): a client of an earlier build drops a message whose type it does not
 * know (`net/room-session.ts`), and a room never sends it to one that asked
 * for nothing else, so {@link PROTOCOL_VERSION} is unchanged.
 */
export interface Countdown {
  readonly type: 'countdown';
  readonly startsInMs: number;
}

/** The result of a race: rider ids in finishing order. */
export interface Finish {
  readonly type: 'finish';
  readonly order: readonly number[];
}

/** What a client may send. */
export type ClientMessage = Hello | Report;

/** What a room may send. */
export type RoomMessage = Welcome | Refuse | Frame | Countdown | Finish;

/** Every message. */
export type ProtocolMessage = ClientMessage | RoomMessage;
