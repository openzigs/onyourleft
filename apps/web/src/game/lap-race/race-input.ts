// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's lane changes and item uses in a lap race, between one race tick
 * and the next — #1901, ADR 0060 D-5.4, D-6 and D-13.
 *
 * Since #1906 `GameView` implements the HUD's `SteerInputPort` and
 * `ItemInputPort` with this module, through `ride-race.ts`, which hands
 * {@link riderTick}'s lanes and uses to `stepRace` on every tick.
 *
 * ## Delivery's steering, not a second set
 *
 * The lanes, the keys, the steer state and its steady move between lanes are
 * `../lanes.ts`', the ones Delivery steers with (#1820): a press moves the
 * rider one whole lane (ADR 0060 D-6.3), and where the rider is **drawn**
 * eases there over `LANE_CHANGE_SECONDS`, through `scene.ts` §`lateralOf`.
 * The race reads the lane as an index, `0` the left-hand lane to `2` the
 * right-hand one, `lanes.ts` §`LANE_OFFSETS_METRES` in order: the domain's
 * `LANE_COUNT` lanes are those three, and the test holds the two counts
 * equal. A race starts every racer in the domain's `STARTING_LANE`, the
 * middle one, so the rider is drawn easing to the centre line from wherever
 * the racing line had them.
 *
 * ## Inputs, never outcomes (D-5.4)
 *
 * What this hands the race is what a room would be sent: the lane the rider
 * asked for and whether they asked to use their item. A use asked for between
 * two ticks is taken by the next one ({@link riderTick}) and then cleared, so
 * one press is one use however many frames pass before the tick; two presses
 * between the same two ticks are still one, because a rider holds one item
 * (D-5.5). Whether there was an item to use, and what it did, are
 * `@onyourleft/domain` §`stepRace`'s.
 *
 * ## A drawing and a race input, never physics
 *
 * Nothing here is read by `simulation.ts`, and nothing here reads it: the
 * rider's effort distance comes from the physics, and the trainer is sent the
 * grade at it (ADR 0060 D-2.1, D-3.4). `race-input.test.ts` rides one power
 * trace with and without steering and item presses and reads every tick's
 * effort distance and speed back equal. Nothing here is stored.
 */

import { STARTING_LANE } from '@onyourleft/domain';

import { startSteer, steerToward, stepSteer, type SteerIntent, type SteerState } from '../lanes';

/** The rider's race inputs since the last tick, in memory for the race only. */
export interface RiderRaceInput {
  /** The lane steered to and where the rider is drawn: `lanes.ts`' state. */
  readonly steer: SteerState;
  /** The rider asked to use their item since the last tick took a use. */
  readonly useAsked: boolean;
}

/** What one race tick takes from the rider, and the inputs after it. */
export interface RiderTick {
  /** The lane the rider is in, by id: `RaceTickInput.lanes`. */
  readonly lanes: Readonly<Record<string, number>>;
  /** The rider's id when they asked to use their item, else none: `RaceTickInput.uses`. */
  readonly uses: readonly string[];
  readonly next: RiderRaceInput;
}

/**
 * The inputs at the start of a race, the rider drawn `offset` metres right of
 * the centre line (the racing line's offset at their distance, as Delivery's
 * round starts from) and in the race's starting lane.
 *
 * @throws {RangeError} for an offset that is not a finite number, naming the
 * constraint and never the value.
 */
export function startRiderInput(offset: number): RiderRaceInput {
  return { steer: { ...startSteer(offset), lane: STARTING_LANE }, useAsked: false };
}

/** The inputs after the rider asked for a lane change: `lanes.ts` §`steerToward`. */
export function askLane(input: RiderRaceInput, intent: SteerIntent): RiderRaceInput {
  const steer = steerToward(input.steer, intent);
  return steer === input.steer ? input : { ...input, steer };
}

/** The inputs after the rider asked to use their item. */
export function askToUseItem(input: RiderRaceInput): RiderRaceInput {
  return input.useAsked ? input : { ...input, useAsked: true };
}

/**
 * The inputs `seconds` later: where the rider is drawn moved toward their
 * lane, `lanes.ts` §`stepSteer`.
 *
 * @throws {RangeError} for a step that is not a finite number of seconds not
 * below zero, naming the constraint and never the value.
 */
export function stepRiderInput(input: RiderRaceInput, seconds: number): RiderRaceInput {
  const steer = stepSteer(input.steer, seconds);
  return steer === input.steer ? input : { ...input, steer };
}

/** What the next race tick takes from the rider `riderId`, and the inputs with the use taken. */
export function riderTick(input: RiderRaceInput, riderId: string): RiderTick {
  return {
    lanes: { [riderId]: input.steer.lane },
    uses: input.useAsked ? [riderId] : [],
    next: input.useAsked ? { ...input, useAsked: false } : input,
  };
}
