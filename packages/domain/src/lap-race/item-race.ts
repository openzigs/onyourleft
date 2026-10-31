// SPDX-License-Identifier: Apache-2.0

/**
 * A lap race with its items, one tick at a time — #1899.
 *
 * The shared step the device and the room both run (ADR 0060 D-5.4: clients
 * send inputs, never outcomes). A tick takes each racer's effort distance from
 * the physics, any lane changes and item uses, and the instant. It returns the
 * whole race, which is plain data, so two runs can be compared by serialising
 * them.
 *
 * **Items off is a first-class setting** (#1899 item 6). With it off,
 * {@link stepRace} never calls `items.ts` §`resolveItems`: there are no
 * pick-ups and no effects, and the race is `race.ts`'s pure model. A test
 * holds that with a spy on the entry point.
 *
 * A lane is changed here whether items are on or off, because it is where the
 * racer is drawn. Only a hit ever reads it, never the physics or the draft
 * model (ADR 0060 D-6.1, D-6.2).
 */

import { LapRaceError } from './errors';
import {
  checkedLane,
  resolveItems,
  STARTING_LANE,
  type ItemRaceState,
  type LapRacer,
} from './items';
import { raceRandom } from './random';
import { racePosition, settle, startingRacer, withEffortDistance, type RaceCourse } from './race';

/** How a race begins. */
export interface ItemRaceSetup {
  readonly course: RaceCourse;
  /** The race's one seed: every draw comes from it. */
  readonly seed: number;
  readonly itemsOn: boolean;
  /** Each racer's id, unique. The race visits them in id order whatever order this is in. */
  readonly racerIds: readonly string[];
  /** The instant the race starts. */
  readonly startMs: number;
  /**
   * The racers no hit moves: the assisted setting's "no knock-back on me"
   * (#1905), for a solo race. Each must be in {@link racerIds}. None when absent.
   */
  readonly shieldedIds?: readonly string[];
}

/** What one tick brings in. Every field is an input; no outcome is ever handed in (D-5.4). */
export interface RaceTickInput {
  readonly atMs: number;
  /** Each racer's effort distance from the physics, by id. A racer left out keeps its last one. */
  readonly effortDistances: Readonly<Record<string, number>>;
  /** The lane each racer asked for this tick, by id. */
  readonly lanes?: Readonly<Record<string, number>>;
  /** The ids that asked to use their held item this tick. */
  readonly uses?: readonly string[];
}

/** A record's own value for `id`, never one inherited from `Object.prototype`. */
function own(record: Readonly<Record<string, number>>, id: string): number | undefined {
  return Object.hasOwn(record, id) ? record[id] : undefined;
}

/**
 * A race on the line. @throws {LapRaceError} for an empty field, a repeated
 * id, a shielded id not in the field, or a seed or instant that cannot start one.
 */
export function createItemRace(setup: ItemRaceSetup): ItemRaceState {
  const ids = [...setup.racerIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new LapRaceError('field-invalid', 'racerIds must name at least one racer, each once');
  }
  const shielded = [...new Set(setup.shieldedIds ?? [])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (shielded.some((id) => !ids.includes(id))) {
    throw new LapRaceError('field-invalid', 'shieldedIds must name racers in the field');
  }
  if (!Number.isFinite(setup.startMs)) {
    throw new LapRaceError('instant-not-finite', 'startMs must be a finite number of milliseconds');
  }
  return {
    course: setup.course,
    itemsOn: setup.itemsOn,
    random: raceRandom(setup.seed),
    atMs: setup.startMs,
    racers: ids.map((id): LapRacer => ({
      racer: startingRacer(id),
      lane: STARTING_LANE,
      held: null,
      effects: [],
      capeUntilMs: null,
      pickUpsPassed: 0,
    })),
    hazards: [],
    shielded,
  };
}

/**
 * The race one tick on.
 *
 * @throws {LapRaceError} for an instant that is not finite or is before the
 * last tick's, a lane that is not one of the race's, or an effort distance
 * that is not finite.
 */
export function stepRace(state: ItemRaceState, input: RaceTickInput): ItemRaceState {
  if (!Number.isFinite(input.atMs)) {
    throw new LapRaceError('instant-not-finite', 'atMs must be a finite number of milliseconds');
  }
  if (input.atMs < state.atMs) {
    throw new LapRaceError('instant-out-of-order', 'atMs must not be before the last tick');
  }
  const before = new Map(state.racers.map((entry) => [entry.racer.id, racePosition(entry.racer)]));
  const moved: ItemRaceState = {
    ...state,
    racers: state.racers.map((entry) => {
      const effort = own(input.effortDistances, entry.racer.id);
      const lane = input.lanes === undefined ? undefined : own(input.lanes, entry.racer.id);
      return {
        ...entry,
        racer: effort === undefined ? entry.racer : withEffortDistance(entry.racer, effort),
        lane: lane === undefined ? entry.lane : checkedLane(lane),
      };
    }),
  };
  const itemed = state.itemsOn
    ? resolveItems(moved, before, new Set(input.uses ?? []), input.atMs)
    : moved;
  return {
    ...itemed,
    atMs: input.atMs,
    racers: itemed.racers.map((entry) => ({
      ...entry,
      racer: settle(entry.racer, state.course, input.atMs),
    })),
  };
}
