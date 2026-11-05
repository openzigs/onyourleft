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
 * room → client   welcome { riderId, routeRef: { sha256 }, roomConfig, voiceInvite? } | refuse { reason }
 * client → room   report  { sequence, atMs, powerWatts, cadenceRpm? }        every 500 ms
 * client → room   item-use { sequence, atMs }                               a lap race only
 * client → room   lane    { sequence, atMs, lane }                           a lap race only
 * room → client   frame   { tick, ackSequence?, riders: [[id, dm, cm/s, draft %, flags, …lap]], itemEvents? }   every 1 s
 * room → client   countdown { startsInMs }                                  a race only
 * room → client   name    { riderId, displayName }                           a race only
 * room → client   standings { tick, riders: [[id, gap ds, W/kg ×10, flags]] }  a race only, every 1 s
 * room → client   finish  { order: [riderId, …] }                            a race only
 * room → client   voice   { voiceInvite? }                                    the room's voice link changed
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
 * - **A lap race's client sends inputs, never outcomes** (#1908, ADR 0060
 *   D-5.4). It may ask to use its held item ({@link ItemUse}) and to change
 *   lane ({@link LaneChange}); which item it holds, whether a use hit anyone,
 *   its race offset, its laps and its place are the room's, and arrive in the
 *   frame. A client message that names an outcome is refused
 *   `outcome-from-client` (`schema.ts` §`CLIENT_OUTCOME_FIELDS`).
 * - ⚠️ **No field anywhere carries a latitude or a longitude.** A rider is
 *   placed by distance along the route (ADR 0028 D-7.3), and the route is
 *   named by the SHA-256 of its content, never inlined: its geometry travels
 *   once, over HTTP, through the route-share path (#784), which refuses a
 *   route that starts in a privacy zone. `coordinates.test.ts` walks every
 *   schema for a coordinate-named field.
 */

/**
 * The version of this wire format. A room refuses a client on any other.
 *
 * **2** since #1347 ([ADR 0051](../../../docs/adr/0051-live-race-standings.md)):
 * a race's room names its riders ({@link RiderName}) and sends its standings
 * ({@link Standings}) every tick — and, from #787 in the same unreleased
 * version, a welcome says whether the room drafts ({@link RoomConfig.drafting})
 * and a frame's `draftPercent` is the room's draft, no longer always 0. A version-1 build is refused
 * `protocol-mismatch` at its hello, and told to update
 * (`apps/web` §`room-ride.ts` `ROOM_REFUSED_TEXT`), rather than seated in a
 * race whose list it cannot show.
 *
 * **3** since #1908 (epic #1894, [ADR 0060](../../../docs/adr/0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md)):
 * a lap race with items. A welcome may carry the race's laps and items
 * setting ({@link RoomConfig.lapRace}), a client may send an {@link ItemUse}
 * and a {@link LaneChange}, and a frame may carry each rider's race offset,
 * lane, held item and laps ({@link FrameRider}) and the tick's
 * {@link ItemEvent}s. A version-2 build is refused `protocol-mismatch` at its
 * hello, as a version-1 build was by version 2.
 *
 * **4** since #875 (spike 0017 option A, #794): a welcome may carry the
 * room's Discord voice link ({@link Welcome.voiceInvite}). The decoder refuses
 * a key it does not know (`codec.ts`, `unknown-key`), so a version-3 build
 * would refuse every welcome from a room with voice; it is refused
 * `protocol-mismatch` at its hello instead, and told to update. In the same
 * unreleased version, #876 added {@link VoiceLink}: the room's link changed
 * under riders it had already welcomed.
 */
export const PROTOCOL_VERSION = 4;

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

/**
 * A lap race's input: use the item the room says this rider holds — #1908.
 *
 * ⚠️ **It names no item.** The item used is the one the room holds for the
 * rider, so a client cannot use an item it was never given (#1909 refuses a
 * use with nothing held by changing nothing).
 */
export interface ItemUse {
  readonly type: 'item-use';
  /** Increasing per rider, as a {@link Report}'s; the room admits one only past the last it admitted. */
  readonly sequence: number;
  /** The client's own clock when the rider pressed, in milliseconds. */
  readonly atMs: number;
}

/** A lap race's input: ride in this lane from now — #1908, ADR 0060 D-6.3. */
export interface LaneChange {
  readonly type: 'lane';
  /** Increasing per rider, as a {@link Report}'s. */
  readonly sequence: number;
  /** The client's own clock when the rider steered, in milliseconds. */
  readonly atMs: number;
  /** `0` to `schema.ts` §`LANE_COUNT` − 1; the middle lane is where a race starts. */
  readonly lane: number;
}

/**
 * An item, by key — `@onyourleft/domain` §`ItemKind`, restated because this
 * package has no production dependency (`lap-race-agreement.test.ts` holds the
 * two equal). A key, never a rider-facing word.
 */
export type ItemKey = 'tailwind' | 'tow' | 'puddle' | 'crosswind-gust' | 'rain-cape';

/** What a lap racer holds: an item, or `none`. */
export type HeldItem = ItemKey | 'none';

/** A lap race's items setting, chosen when the room is made and fixed for it — the {@link Drafting} precedent. */
export type Items = 'on' | 'off';

/** A lap race's settings, said in the welcome so every rider knows them before the start (#1908). */
export interface LapRaceConfig {
  /** How many laps of the route the race is: 1 to `schema.ts` §`MAXIMUM_LAPS`. */
  readonly laps: number;
  readonly items: Items;
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
  /**
   * Whether this room drafts its riders — #787, the owner's ruling of
   * 2026-09-30: on by default, chosen by whoever made the room and fixed for
   * it, and said in the welcome so every rider knows before the start. `off`
   * is every rider at `k = 1`, through the same code (ADR 0038).
   */
  readonly drafting: Drafting;
  /**
   * Present in a lap race, and only there (#1908): a lap race is a `race` on
   * a loop route whose welcome carries this. One field holding both settings,
   * so a welcome cannot carry laps without an items setting or the reverse.
   */
  readonly lapRace?: LapRaceConfig;
}

/** A room's drafting setting (#787). */
export type Drafting = 'on' | 'off';

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
  /**
   * The room's Discord voice channel, as an invite link — #875, spike 0017
   * option A. Present only where the instance's operator turned voice on and
   * the room has a channel (a rider's private room, `apps/instance`
   * §`voice/room-voice.ts`), and absent everywhere else: a room works exactly
   * as it does without it.
   *
   * ⚠️ **In the welcome, and so only after admission**: a hello that is
   * refused is answered by a {@link Refuse}, which carries no link, so a
   * rider the room does not admit never receives one. Held to
   * `schema.ts` §`VOICE_INVITE_PATTERN`, so a client can put it in an `href`
   * knowing it opens Discord's invite host and nothing else.
   */
  readonly voiceInvite?: string;
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

/**
 * In a race's {@link Standings} only: this rider has crossed the line (#1347).
 * A frame's flags never carry it — a frame says where a rider is, and a
 * finisher stays where they crossed.
 */
export const FLAG_FINISHED = 4;

/**
 * One rider in a frame. On the wire, a five-slot array in this order — or, in
 * a lap race, nine: the five, then {@link raceOffsetCentimetres},
 * {@link lane}, {@link held} and {@link lapsDone}, all four or none
 * (`schema.ts` §`Shape` `tail`). Every one of the four is the ROOM's answer
 * (ADR 0028 D-2 rule 4, ADR 0060 D-5.4); a client never sends one.
 */
export interface FrameRider {
  readonly riderId: number;
  /** Distance along the route, in whole decimetres. */
  readonly decimetres: number;
  readonly centimetresPerSecond: number;
  /**
   * The share of this rider's aerodynamic drag the room's draft model removed
   * on this tick, `(1 − k) × 100` rounded (#787, ADR 0038 D-5): 0 riding
   * alone and in a room with drafting off.
   */
  readonly draftPercent: number;
  /** {@link FLAG_PLAUSIBILITY} and {@link FLAG_COASTING}, or'd. */
  readonly flags: number;
  /**
   * A lap race only: how far items have moved this rider from their effort
   * distance, in whole centimetres, within ± `schema.ts`
   * §`MAXIMUM_RACE_OFFSET_CENTIMETRES` (ADR 0060 D-3.3's B). Never sent to a
   * trainer (ADR 0060 D-3).
   */
  readonly raceOffsetCentimetres?: number;
  /** A lap race only: the lane the room has this rider in. */
  readonly lane?: number;
  /** A lap race only: the item the room holds for this rider. */
  readonly held?: HeldItem;
  /** A lap race only: laps completed at the drawn distance. */
  readonly lapsDone?: number;
}

/** What happened to an item on a tick (#1908). */
export type ItemEventKind = 'pick-up' | 'use' | 'hit';

/**
 * One item event of a tick, for a client to announce — #1908. On the wire, a
 * three-slot array in this order.
 *
 * ⚠️ **A rider id and an item key, never a place.** A hit names who was hit
 * and by what kind of item, not where; a client that wants to draw it reads
 * the rider's distance and lane from the same frame.
 */
export interface ItemEvent {
  readonly riderId: number;
  /** `pick-up`: the rider now holds the item; `use`: the rider used it; `hit`: an item of this key hit the rider. */
  readonly event: ItemEventKind;
  readonly item: ItemKey;
}

/** The room's tick: the whole field, once a second. */
export interface Frame {
  readonly type: 'frame';
  readonly tick: number;
  /** The last report sequence the room admitted from the recipient; absent before the first. */
  readonly ackSequence?: number;
  readonly riders: readonly FrameRider[];
  /**
   * A lap race only: the item events of this tick, at most `schema.ts`
   * §`MAXIMUM_ITEM_EVENTS`. Absent or empty on a tick with none. An
   * announcement, never state: every outcome is also in {@link riders}.
   */
  readonly itemEvents?: readonly ItemEvent[];
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

/**
 * A race's rider, by name — #1347, ADR 0051. The name is the athlete's PUBLIC
 * projection (`apps/instance` §`auth/public-athlete.ts`, #774) and nothing
 * else about them: a room has no field for a mass, a power or a place.
 *
 * Sent once per seat: to every connected rider when a seat is taken, and the
 * whole field to a rider as they are welcomed or welcomed back. One message a
 * rider rather than a roster, so a hundred 32-character names never meet
 * {@link MAXIMUM_MESSAGE_BYTES} in one message.
 */
export interface RiderName {
  readonly type: 'name';
  readonly riderId: number;
  readonly displayName: string;
}

/**
 * One rider in a race's standings — #1347, ADR 0051. On the wire, a four-slot
 * array in this order.
 *
 * ⚠️ **Power-to-weight and never power** (ADR 0028's 2026-09-22 rule: power OR
 * W/kg for a rider, never both; ruling Q17). The room divides by the declared
 * mass it holds, and the mass never leaves it.
 */
export interface StandingsRider {
  readonly riderId: number;
  /**
   * The time gap, computed BY THE ROOM from its own positions, between this
   * rider and the recipient, in whole tenths of a second: **positive when this
   * rider is behind the recipient**, negative when ahead, 0 for the
   * recipient's own row. "Behind by 12 s" means the recipient passed where
   * this rider is now 12 s ago. A client never computes a gap of its own.
   */
  readonly gapDeciseconds: number;
  /**
   * The power the room simulated this rider at on this tick, per kilogram, in
   * tenths. 0 for a rider it coasted, and for a finisher, whom it no longer
   * simulates.
   */
  readonly wattsPerKilogramTenths: number;
  /** The frame's {@link FLAG_PLAUSIBILITY} and {@link FLAG_COASTING}, and {@link FLAG_FINISHED}, or'd. */
  readonly flags: number;
}

/**
 * A race's standings — #1347, ADR 0051, superseding ADR 0028 D-7.7: every
 * rider still in the race, **in the room's order** — finishers first, by their
 * finish, then everybody on the road by distance along the route, furthest
 * first. Sent after each frame of a running race, to each rider with gaps to
 * THEM, so two riders are sent different numbers about the same field.
 *
 * Never in a group ride: ADR 0028 D-7.2, nobody leads one (ADR 0051 D-3).
 */
export interface Standings {
  readonly type: 'standings';
  /** The frame's tick these are the standings of. */
  readonly tick: number;
  readonly riders: readonly StandingsRider[];
}

/** The result of a race: rider ids in finishing order. */
export interface Finish {
  readonly type: 'finish';
  readonly order: readonly number[];
}

/**
 * The room's Discord voice link changed — #876: a rider was removed from the
 * room or banned, so its channel was replaced (spike 0017 §3.3) and the riders
 * still in the room are given the new link. Absent `voiceInvite` is no voice
 * any more. Sent only to riders the room has already welcomed, and never to
 * the rider who was removed or banned; held to `schema.ts`
 * §`VOICE_INVITE_PATTERN` as a welcome's link is.
 */
export interface VoiceLink {
  readonly type: 'voice';
  readonly voiceInvite?: string;
}

/** What a client may send. */
export type ClientMessage = Hello | Report | ItemUse | LaneChange;

/** What a room may send. */
export type RoomMessage =
  Welcome | Refuse | Frame | Countdown | RiderName | Standings | Finish | VoiceLink;

/** Every message. */
export type ProtocolMessage = ClientMessage | RoomMessage;
