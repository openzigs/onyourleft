// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Steering between lanes, for every game mode that has them — lifted out of
 * `delivery/steer.ts` by #1901 so that the lap race (epic #1894) steers with
 * Delivery's lanes, keys and move rather than a second set. Delivery's
 * `steer.ts` re-exports all of it and keeps its own two refusals; the lap race
 * takes it from here (`lap-race/race-input.ts`). The scheme is #1820's, resting
 * on the owner's rulings DL5 and DL12 of 2026-10-27 (epic #1803).
 *
 * ## A drawing, never physics
 *
 * What steering moves is where the rider is **drawn** across the road
 * (`scene.ts` §`lateralOf`, through `SceneInput.steeredLateral`), and which
 * lane a mode's own rules read: Delivery's obstacles (`obstacles.ts`
 * §`stepObstacles`) and the lap race's item hits (`@onyourleft/domain`
 * §`stepRace`, ADR 0060 D-6). It never moves how far the rider rode or what
 * the trainer is sent: nothing here is read by `simulation.ts`, whose state
 * carries no lateral field, and `delivery/steer.test.ts` and
 * `lap-race/race-input.test.ts` each ride one power trace with and without
 * presses and read every tick's distance and speed back equal.
 *
 * ## Three discrete lanes, and a steady move between them
 *
 * - {@link LANE_OFFSETS_METRES}: **three lanes**, the middle of the left-hand
 *   lane, the centre line and the middle of the right-hand lane — −1.75 m,
 *   0 and +1.75 m, positive to the rider's right (`racing-line.ts`
 *   §`ROAD_SIDE`). The right-hand one is the racing line's own home
 *   (`racing-line.ts` §`LINE_HOME_OFFSET_METRES`). The outer two are 1.15 m
 *   inside the line's own edge (`racing-line.ts` §`LINE_LIMIT_METRES`,
 *   2.9 m), and a steered rider only ever moves toward a lane, so nothing
 *   here passes it.
 * - **The lanes are discrete** (ADR 0060 D-6.3): a press moves one whole
 *   lane, never a continuous or drag-scaled amount, which is what spike 0030
 *   §6 reads US 11,071,911 as outside of. A continuous steer needs that
 *   reading re-run first.
 * - {@link LANE_CHANGE_SECONDS}: **0.4 s** from one lane to the next, at a
 *   steady sideways speed, so a rider pressing twice crosses two lanes in
 *   0.8 s and never jumps.
 * - {@link STEER_KEYS}: **A** for a lane to the left and **D** for one to the
 *   right. None is a throw key (`delivery/throw-input.ts` §`THROW_KEYS`: the
 *   arrows, Page Up and Page Down), none is the lap race's item key
 *   (`lap-race/item-input.ts` §`ITEM_KEYS`), and none is Enter or Space, for
 *   `throw-input.ts`' reason. ⚠️ **Which keys a given bar remote sends is
 *   unmeasured**: the tablet step for #733 is where it is written down.
 *
 * ## Keys, one discipline for every ride-time key
 *
 * {@link intentOfKeyIn} takes a key as `throw-input.ts` §`intentOfKey` does:
 * never from a form field, never with Ctrl, Alt or Meta held, never one a
 * handler already took, and never a held key's repeats — a held key moves one
 * lane, or uses one item. {@link steerIntentOfKey} is it over the lane keys,
 * and the lap race's item key reads through it too.
 *
 * ⚠️ **It imports nothing**: the HUD imports this module for its keys, and
 * both modes for their lanes, and none of them should bring anything else
 * onto the path the two cannot-reach-trainer walks check
 * (`delivery/delivery-cannot-reach-trainer.test.ts`,
 * `lap-race/lap-race-cannot-reach-trainer.test.ts`).
 *
 * ## Nothing here leaves the ride
 *
 * The steer state is held in memory for the ride only and never stored: the
 * stored ride has no lateral field. No error message here formats an offset
 * or a duration (CLAUDE.md §6, ADR 0004 D): each names the field and the
 * constraint.
 */

/** Every steer an input can ask for. @see SteerIntent */
export const STEER_INTENTS = ['lane-left', 'lane-right'] as const;

/** A lane change the rider asked for: one lane to their left, or one to their right. */
export type SteerIntent = (typeof STEER_INTENTS)[number];

/**
 * The default key map, by `KeyboardEvent.key`, both cases so Caps Lock and
 * Shift do not lose a press. No arrow, no Page key, no Enter and no Space:
 * the header says why.
 */
export const STEER_KEYS: Readonly<Record<string, SteerIntent>> = Object.freeze({
  a: 'lane-left',
  A: 'lane-left',
  d: 'lane-right',
  D: 'lane-right',
});

/**
 * The same two keys by `KeyboardEvent.code`, the physical key, for a layout
 * whose A and D keys type something else — AZERTY, Cyrillic or Greek — so
 * the keys in the place a QWERTY rider finds them still steer. Read only when
 * {@link STEER_KEYS} has no entry for the event's `key`.
 */
export const STEER_CODES: Readonly<Record<string, SteerIntent>> = Object.freeze({
  KeyA: 'lane-left',
  KeyD: 'lane-right',
});

/**
 * The lanes, left to right, in metres right of the centre line: the middle of
 * the left-hand lane, the centre line, and the middle of the right-hand lane,
 * which is the racing line's home. Proposed in #1820's pull request.
 */
export const LANE_OFFSETS_METRES: readonly number[] = Object.freeze([-1.75, 0, 1.75]);

/**
 * How long a move from one lane to the next takes, in seconds: **0.4**, at a
 * steady sideways speed. Proposed in #1820's pull request.
 */
export const LANE_CHANGE_SECONDS = 0.4;

/** How fast a steered rider moves across the road, in metres a second. */
const SIDEWAYS_METRES_PER_SECOND =
  ((LANE_OFFSETS_METRES[1] as number) - (LANE_OFFSETS_METRES[0] as number)) / LANE_CHANGE_SECONDS;

/** Where every key is the field's own: it types, or moves a value. As `throw-input.ts`'. */
const FIELD = 'input, select, textarea, [contenteditable]:not([contenteditable="false"])';

/** The parts of a key event {@link intentOfKeyIn} reads. */
export type SteerKeyEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'target' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey' | 'defaultPrevented'
>;

/**
 * What a key asks for under `keys` (by `KeyboardEvent.key`) or, when that has
 * no entry for it, `codes` (by the physical key), or `undefined` when it asks
 * for nothing — because neither map has it, or because it belongs to a
 * focused field, a shortcut, a handler that already took it, or a held key's
 * repeat.
 */
export function intentOfKeyIn<Intent>(
  event: SteerKeyEvent,
  keys: Readonly<Record<string, Intent>>,
  codes: Readonly<Record<string, Intent>>,
): Intent | undefined {
  if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
    return undefined;
  }
  const intent = Object.hasOwn(keys, event.key)
    ? keys[event.key]
    : Object.hasOwn(codes, event.code)
      ? codes[event.code]
      : undefined;
  if (intent === undefined) return undefined;
  const target = event.target;
  if (target instanceof Element && target.closest(FIELD) !== null) return undefined;
  return intent;
}

/** The lane change a key asks for, or `undefined`: {@link intentOfKeyIn} over the lane keys. */
export function steerIntentOfKey(event: SteerKeyEvent): SteerIntent | undefined {
  return intentOfKeyIn(event, STEER_KEYS, STEER_CODES);
}

/**
 * Where a steered rider is across the road, in memory for the ride only:
 * Delivery's `ride-round.ts` §`DeliveryRide.steer` holds one for a round
 * (#1853), and the lap race's `race-input.ts` §`RiderRaceInput.steer` one for
 * a race.
 */
export interface SteerState {
  /** The lane they are steering to, an index into {@link LANE_OFFSETS_METRES}. */
  readonly lane: number;
  /** Where they are drawn now, in metres right of the centre line. */
  readonly offset: number;
}

function refuse(constraint: string): never {
  throw new RangeError(`Lane steering: ${constraint}`);
}

/**
 * Steering from where the rider is drawn when the mode starts, `offset`
 * metres right of the centre line: in the nearest lane, and moving to it from
 * there, so the first frame does not jump the rider sideways.
 *
 * Pass the racing line's offset at the rider's distance (`racing-line.ts`
 * §`lineOffsetAt`), not the drawn `PlacedRider.lateral`: the drawn one has
 * already made room for a bot or a ghost level with the rider (#1853).
 */
export function startSteer(offset: number): SteerState {
  if (!Number.isFinite(offset)) refuse('the starting offset is a finite number of metres');
  let lane = 0;
  LANE_OFFSETS_METRES.forEach((each, index) => {
    if (Math.abs(each - offset) < Math.abs((LANE_OFFSETS_METRES[lane] as number) - offset)) {
      lane = index;
    }
  });
  return { lane, offset };
}

/**
 * The state after the rider asked for `intent`: one lane further that way,
 * and no further than the outermost lane. Where the rider is drawn moves only
 * as {@link stepSteer} runs.
 */
export function steerToward(state: SteerState, intent: SteerIntent): SteerState {
  const lane = Math.min(
    LANE_OFFSETS_METRES.length - 1,
    Math.max(0, state.lane + (intent === 'lane-left' ? -1 : 1)),
  );
  return lane === state.lane ? state : { ...state, lane };
}

/**
 * The state `seconds` later: the drawn offset moved toward the lane steered
 * to at the steady sideways speed {@link LANE_CHANGE_SECONDS} sets, and never
 * past it.
 */
export function stepSteer(state: SteerState, seconds: number): SteerState {
  if (!Number.isFinite(seconds) || seconds < 0) {
    refuse('a step is a finite number of seconds not below zero');
  }
  const target = LANE_OFFSETS_METRES[state.lane] as number;
  const most = SIDEWAYS_METRES_PER_SECOND * seconds;
  const gap = target - state.offset;
  const offset = Math.abs(gap) <= most ? target : state.offset + Math.sign(gap) * most;
  return offset === state.offset ? state : { ...state, offset };
}

/**
 * The offset the scene draws the rider at (`SceneInput.steeredLateral`), or
 * `undefined` when there is none to draw: nothing is steering, or the ride is
 * in a room, which ignores steering (DL9) so the rider rides the line.
 */
export function steeredLateralFor(
  state: SteerState | undefined,
  ride: { readonly inRoom: boolean },
): number | undefined {
  return state === undefined || ride.inRoom ? undefined : state.offset;
}
