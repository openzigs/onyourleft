// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lap race in a ROOM, from this rider's side — #1911 (epic #1894, ADR 0060).
 *
 * `GameView` holds one {@link RoomLapRaceRide} for a ride in a room whose
 * welcome says it is a lap race (`net/room-session.ts` §`lapRace`), from the
 * room's first frame. The room is authoritative (#1909, ADR 0028 D-2 rule 4):
 * it decides pick-ups, hits, offsets, laps and the finish, and sends them in
 * every frame. This module does three things with that.
 *
 * ## It sends inputs, never outcomes (ADR 0060 D-5.4)
 *
 * The rider steers and presses *Use item* as in a solo race
 * (`race-input.ts`, Delivery's lanes). On each simulation step that ran,
 * a lane the rider moved to is sent as a `lane` input and a press, with an
 * item shown held, as an `item-use` input (`room-port.ts` §`changeLane`,
 * §`useItem`). Nothing else leaves: which item, whether it hit, and where
 * anybody is drawn are the room's.
 *
 * ## It predicts, so the rider's screen is instant
 *
 * Between the press and the room's answer the rider is shown what the input
 * will most likely do: the new lane at once, the item gone from the HUD, and
 * a tailwind or a tow already moving their own drawn offset at its rate. A
 * prediction is kept until a frame **covers** the input — the room's
 * `ackSequence` is past the input's sequence, so the room had the input
 * before that tick — or, should no report be admitted, until a frame arrives
 * a whole frame interval after it was sent ({@link covers}). Either way it is
 * gone by the second frame after the press: within one frame interval after
 * the next. From then on the room's lane, item and offset are shown, whatever
 * was predicted; a use the room never made is rolled back to the item the
 * room says is still held.
 *
 * ## It reconciles the drawing only, never the trainer (ADR 0060 D-2, D-3)
 *
 * The rider's own race offset is DRAWN eased toward the room's
 * ({@link OFFSET_EASE_SECONDS}), so a correction of a few metres is a slide,
 * never a jump. Nothing here reads or writes the simulation: the rider's
 * effort distance is the simulation's odometer, which the room's own
 * `correction.ts` path corrects toward the frame's `decimetres` — the room's
 * EFFORT distance (#1909) — and the trainer is sent the grade at that
 * odometer by `gradient.ts`, which this module cannot reach
 * (`lap-race-cannot-reach-trainer.test.ts`). An offset the room corrects
 * moves where the rider is drawn and nothing the trainer feels.
 *
 * ## The HUD and the frame, from the room's word
 *
 * {@link roomLapRaceState} builds the race as `@onyourleft/domain` shapes it
 * from the room's newest frame — every rider's effort distance, offset, lane,
 * held item and laps — with this rider's lane and item as shown, so the solo
 * race's HUD (`hud/lap-race-hud.ts`) and its pick-up markers
 * (`in-view.ts`) read a room's race unchanged. No puddle is drawn or warned
 * of: the protocol carries no hazard's place (#1908), only that it hit.
 */

import {
  ITEM_RULES,
  pickUpsPassed,
  raceCourse,
  racePosition,
  raceRandom,
  RACE_OFFSET_BOUND_METRES,
  STARTING_LANE,
  type ItemKind,
  type ItemRaceState,
  type LapRacer,
} from '@onyourleft/domain';
import type { HeldItem } from '@onyourleft/protocol';

import type { RoomLapFrame, RoomLapRace } from '../../net/room-session';
import type { SteerIntent } from '../lanes';

import {
  askLane,
  askToUseItem,
  riderTick,
  startRiderInput,
  stepRiderInput,
  type RiderRaceInput,
} from './race-input';
import { LAP_RACE_TICK_SECONDS } from './ride-race';

/**
 * How long the rider's drawn offset takes to come most of the way (1 − 1/e)
 * to the room's: half a second, half a frame at the room's 1 Hz. Chosen: a
 * correction of 2 m — a gust the client did not predict — slides over about
 * a second rather than jumping.
 */
export const OFFSET_EASE_SECONDS = 0.5;

/** An input sent and not yet covered by a frame. */
interface SentInput<T> {
  readonly value: T;
  readonly sequence: number;
  readonly atLocalMs: number;
}

/** A lap race in a room, in memory for the ride only. */
export interface RoomLapRaceRide {
  readonly laps: number;
  readonly itemsOn: boolean;
  readonly lapLengthMetres: number;
  readonly frameIntervalMs: number;
  /** This rider's seat in the room. */
  readonly riderId: number;
  /** The rider's steering and item press since the last step (`race-input.ts`). */
  readonly input: RiderRaceInput;
  /** The rider steered since the last step that ran: their lane, not the room's, is to be sent. */
  readonly laneAsked: boolean;
  readonly laneSent: SentInput<number> | undefined;
  readonly useSent: SentInput<ItemKind> | undefined;
  /** The rider's own race offset as drawn, metres, eased toward the room's. */
  readonly drawnOffset: number;
  /** The local instant {@link drawnOffset} was last eased to. */
  readonly easedAtLocalMs: number;
}

/** What a ride in a room hands the race when the room's race begins. */
export interface RoomLapRaceStart {
  readonly race: RoomLapRace;
  /** One lap of the room's route, metres: its profile's length. */
  readonly lapLengthMetres: number;
  /** The racing line's offset where the rider stands: steering starts there. */
  readonly lineOffset: number;
  readonly nowLocalMs: number;
}

/** The race on the line, as the room's first frame finds it. */
export function startRoomLapRace(start: RoomLapRaceStart): RoomLapRaceRide {
  return {
    laps: start.race.config.laps,
    itemsOn: start.race.config.items === 'on',
    lapLengthMetres: start.lapLengthMetres,
    frameIntervalMs: start.race.frameIntervalMs,
    riderId: start.race.riderId,
    input: startRiderInput(start.lineOffset),
    laneAsked: false,
    laneSent: undefined,
    useSent: undefined,
    drawnOffset: 0,
    easedAtLocalMs: start.nowLocalMs,
  };
}

/** The race after the rider asked for a lane change: sent by the next step. */
export function askRoomLane(ride: RoomLapRaceRide, intent: SteerIntent): RoomLapRaceRide {
  const input = askLane(ride.input, intent);
  return input === ride.input ? ride : { ...ride, input, laneAsked: true };
}

/** The race after the rider asked to use their item: sent by the next step, if one is held. */
export function askRoomItem(ride: RoomLapRaceRide): RoomLapRaceRide {
  if (!ride.itemsOn) return ride;
  const input = askToUseItem(ride.input);
  return input === ride.input ? ride : { ...ride, input };
}

/**
 * Whether `frame` covers an input sent at `sent`: the room admitted a report
 * sent after the input before that tick, or, should it admit none, the frame
 * came a whole frame interval after the input. @see the module note
 */
export function covers(
  frame: RoomLapFrame | undefined,
  sent: { readonly sequence: number; readonly atLocalMs: number },
  frameIntervalMs: number,
): boolean {
  if (frame === undefined || frame.atLocalMs <= sent.atLocalMs) return false;
  return (
    (frame.ackSequence !== undefined && frame.ackSequence > sent.sequence) ||
    frame.atLocalMs >= sent.atLocalMs + frameIntervalMs
  );
}

/** This rider's lane and item as shown: a prediction while one stands, the room's word after. */
export interface RoomLapShown {
  readonly lane: number;
  readonly held: HeldItem;
}

/** What the rider is shown of their own lane and item now. */
export function roomLapShown(ride: RoomLapRaceRide, race: RoomLapRace | undefined): RoomLapShown {
  const own = race?.newest?.riders.get(ride.riderId);
  return {
    lane: ride.laneSent?.value ?? own?.lane ?? ride.input.steer.lane,
    held: ride.useSent === undefined ? (own?.held ?? 'none') : 'none',
  };
}

/** The offset a use the room has not yet answered is predicted to add by `nowLocalMs`, metres. */
function predictedOffset(useSent: SentInput<ItemKind> | undefined, nowLocalMs: number): number {
  if (useSent === undefined) return 0;
  // Only a use that moves its own holder: a gust or a puddle moves others, a cape nobody.
  if (useSent.value !== 'tailwind' && useSent.value !== 'tow') return 0;
  const rule = ITEM_RULES[useSent.value];
  const ran = Math.min(Math.max(0, nowLocalMs - useSent.atLocalMs), rule.durationMs);
  return (rule.rateMetresPerSecond * ran) / 1_000;
}

/** One frame's simulation steps, as the ride hands them over. */
export interface RoomLapRaceStep {
  /** How many simulation steps ran on this frame. Nought sends nothing. */
  readonly ticks: number;
  readonly nowLocalMs: number;
  /** The room's race now: `room-port.ts` §`lapRace`. */
  readonly race: RoomLapRace | undefined;
  /** Send a lane input; its sequence, or `undefined` when nothing went. */
  readonly sendLane: (lane: number) => number | undefined;
  /** Send an item-use input; its sequence, or `undefined` when nothing went. */
  readonly sendUse: () => number | undefined;
}

/**
 * The frame's steps: predictions the room's newest frame covers dropped, the
 * rider's lane kept to the room's while nothing is asked, each step's
 * steering eased and any change of lane or press of *Use item* sent, and the
 * drawn offset eased toward the room's.
 *
 * @throws {RangeError} for a count of ticks that is not a whole number of
 * nought or more, naming the constraint and never the value.
 */
export function stepRoomLapRace(ride: RoomLapRaceRide, step: RoomLapRaceStep): RoomLapRaceRide {
  const { ticks, nowLocalMs, race } = step;
  if (!Number.isInteger(ticks) || ticks < 0) {
    throw new RangeError('a room lap race step runs a whole number of ticks, 0 or more');
  }
  const frame = race?.newest;
  const own = frame?.riders.get(ride.riderId);
  let laneSent =
    ride.laneSent !== undefined && covers(frame, ride.laneSent, ride.frameIntervalMs)
      ? undefined
      : ride.laneSent;
  let useSent =
    ride.useSent !== undefined && covers(frame, ride.useSent, ride.frameIntervalMs)
      ? undefined
      : ride.useSent;
  let input = ride.input;
  let laneAsked = ride.laneAsked;
  // With nothing asked or awaited, the room's lane is the rider's: after a
  // rejoin, or a lane the room did not take. Drawn easing there, as any change.
  if (!laneAsked && laneSent === undefined && own !== undefined && own.lane !== input.steer.lane) {
    input = { ...input, steer: { ...input.steer, lane: own.lane } };
  }
  for (let tick = 0; tick < ticks; tick += 1) {
    input = stepRiderInput(input, LAP_RACE_TICK_SECONDS);
    const asked = riderTick(input, 'rider');
    input = asked.next;
    const lane = asked.lanes['rider'] as number;
    const shownLane = laneSent?.value ?? own?.lane ?? STARTING_LANE;
    if (lane !== shownLane) {
      const sequence = step.sendLane(lane);
      if (sequence !== undefined) laneSent = { value: lane, sequence, atLocalMs: nowLocalMs };
    }
    laneAsked = false;
    const held = useSent === undefined ? (own?.held ?? 'none') : 'none';
    if (asked.uses.length > 0 && ride.itemsOn && held !== 'none') {
      const sequence = step.sendUse();
      if (sequence !== undefined) useSent = { value: held, sequence, atLocalMs: nowLocalMs };
    }
  }
  const target = Math.max(
    -RACE_OFFSET_BOUND_METRES,
    Math.min(
      RACE_OFFSET_BOUND_METRES,
      (own?.raceOffsetMetres ?? 0) + predictedOffset(useSent, nowLocalMs),
    ),
  );
  const seconds = Math.max(0, (nowLocalMs - ride.easedAtLocalMs) / 1_000);
  const share = 1 - Math.exp(-seconds / OFFSET_EASE_SECONDS);
  return {
    ...ride,
    input,
    laneAsked,
    laneSent,
    useSent,
    drawnOffset: ride.drawnOffset + (target - ride.drawnOffset) * share,
    easedAtLocalMs: nowLocalMs,
  };
}

/** A racer, as the HUD's model holds one, from the room's slots. */
function racerFrom(
  id: string,
  effort: number,
  offset: number,
  lapsDone: number,
  laps: number,
  atMs: number,
): LapRacer['racer'] {
  const finished = lapsDone >= laps;
  return {
    id,
    effortDistance: effort,
    raceOffset: offset,
    lapsDone,
    finishedAtMs: finished ? atMs : null,
    lineMetres: finished ? effort + offset : null,
  };
}

/**
 * The race as `@onyourleft/domain` shapes it, from the room's newest frame —
 * what the solo race's HUD and pick-up markers read. This rider's lane and
 * item are as {@link roomLapShown} has them, and their offset as drawn;
 * every number else is the room's. `undefined` before the room's first frame.
 */
export function roomLapRaceState(
  ride: RoomLapRaceRide,
  race: RoomLapRace | undefined,
): ItemRaceState | undefined {
  const frame = race?.newest;
  if (frame === undefined || !frame.riders.has(ride.riderId)) return undefined;
  const course = raceCourse(ride.lapLengthMetres, ride.laps);
  const atMs = frame.tick * ride.frameIntervalMs;
  const shown = roomLapShown(ride, race);
  const racers: LapRacer[] = [...frame.riders]
    .map(([riderId, slots]): LapRacer => {
      const you = riderId === ride.riderId;
      const racer = racerFrom(
        String(riderId),
        slots.effortMetres,
        you ? ride.drawnOffset : slots.raceOffsetMetres,
        slots.lapsDone,
        ride.laps,
        atMs,
      );
      const held = you ? shown.held : slots.held;
      return {
        racer,
        lane: you ? shown.lane : slots.lane,
        held: held === 'none' ? null : held,
        effects: [],
        capeUntilMs: null,
        pickUpsPassed: pickUpsPassed(course, racePosition(racer)),
      };
    })
    .sort((a, b) => (a.racer.id < b.racer.id ? -1 : a.racer.id > b.racer.id ? 1 : 0));
  return {
    course,
    itemsOn: ride.itemsOn,
    // Never drawn from: the room draws every item, from a seed it never sends.
    random: raceRandom(0),
    atMs,
    racers,
    hazards: [],
    shielded: [],
  };
}

/** Where the race draws its racers on a frame: the rider moved by their drawn offset. */
export interface RoomLapRaceDrawing {
  /** The rider's drawn odometer moved by their race offset (ADR 0060 D-3.3). */
  readonly riderDistance: number;
  /** Where the rider has steered across the road: `SceneInput.steeredLateral`. */
  readonly steeredLateral: number;
  /** Another rider's race offset, metres, by seat: where to draw them along the road. */
  readonly offsetOf: (riderId: number) => number;
}

/** Where the race draws the rider and the others on a frame. */
export function roomLapRaceDrawing(
  ride: RoomLapRaceRide,
  race: RoomLapRace | undefined,
  riderDistance: number,
): RoomLapRaceDrawing {
  const riders = race?.newest?.riders;
  return {
    riderDistance: riderDistance + ride.drawnOffset,
    steeredLateral: ride.input.steer.offset,
    offsetOf: (riderId) => riders?.get(riderId)?.raceOffsetMetres ?? 0,
  };
}
