// SPDX-License-Identifier: Apache-2.0

/**
 * The lap race's item rules — #1899, ADR 0060 D-4.3 and D-5.
 *
 * Pure and deterministic, so the device and the room resolve the same race
 * from the same seed and the same inputs. {@link resolveItems} is the one
 * entry point: `item-race.ts` calls it once a tick when items are on, and not
 * at all when they are off.
 *
 * ## What an item may change, and what it may not
 *
 * D-5.1: an item changes only **`raceOffset`**, **the drawn lane** (by making a
 * lane matter for a hit) and **the item a racer holds**. It never changes
 * `effortDistance`, power, mass, a physics coefficient or drafting (D-4.3,
 * D-5.2): nothing in this file can, because nothing here holds any of them.
 * Every offset change goes through `race.ts` §`applyOffset`, so it is clamped
 * to `[−B, +B]` after every change (D-3.2).
 *
 * An effect is a **rate in metres per second over a duration**, integrated
 * tick by tick: a racer is never teleported, and no rate exceeds
 * {@link MAXIMUM_EFFECT_RATE_METRES_PER_SECOND}.
 *
 * ## One item at a time, and no combining (D-5.5)
 *
 * A racer holds at most one item. Riding through a pick-up while holding one
 * draws nothing, and the held item is unchanged. There is no rule anywhere
 * here by which two matching items make a stronger effect: spike 0030 §3.3
 * reads that as what keeps US 11,103,784's claims out of reach. A second slot
 * needs that reading re-run first.
 *
 * ## Hits are resolved from race positions and lanes only (D-5.4)
 *
 * A hit is decided by drawn distance (`effortDistance + raceOffset`) and lane,
 * nothing else. Lanes are discrete, {@link LANE_COUNT} of them (D-6.3).
 *
 * ## The catalogue: a proposal for the owner (D-1, D-14 Q7)
 *
 * The names are keys, not words: no rider-facing string is added here, and
 * the wording lands with #1904. Each is cycling-native and non-violent, and
 * none is a kart series' item or a trainer app's power-up in name or
 * behaviour (D-1.3, D-1.4):
 *
 * | Key | Behaviour | Strength (m) |
 * |---|---|---|
 * | `tailwind` | the holder gains +1.5 m/s of offset for 4 s | 6 |
 * | `slipstream` | a tow toward the racer ahead: +2 m/s for 4 s, only when a racer is within {@link SLIPSTREAM_REACH_METRES} ahead; otherwise used up for nothing | 8 |
 * | `puddle` | dropped at the holder's drawn distance in the holder's lane; the first other racer to ride through it in that lane loses 1.5 m/s for 4 s. It dries after {@link PUDDLE_LIFETIME_MS} | 6 |
 * | `crosswind-gust` | sent up the road in the holder's lane at the nearest racer ahead: −2 m/s for 4 s if that racer is in the lane, a miss if not | 8 |
 * | `rain-cape` | absorbs the next hit within {@link RAIN_CAPE_DURATION_MS}; moves nothing | 0 |
 *
 * A strength is the most offset the item can move, in metres: its rate times
 * its duration. The rain cape's is 0 because it moves no one.
 *
 * ## The distribution: position-weighted, and this project's own numbers
 *
 * {@link ITEM_TABLE} is keyed by the racer's position band when they ride
 * through a pick-up. The front gets small or defensive items, and the back
 * gets the strongest forward and attacking ones. That is how catch-up comes
 * from items and never from effort (D-4.3). Rank-linked selection is
 * decades-old genre practice; spike 0030 §4.2 found no claim reading on it.
 * The numbers are this project's, chosen for a field of a handful of racers:
 *
 * - **Front**: no `slipstream` and no `crosswind-gust`, because both aim at a
 *   racer ahead and the leader has none. Mostly the small `tailwind` and the
 *   `puddle`, which defends from behind.
 * - **Middle**: everything, evenly.
 * - **Back**: mostly the two 8 m items, almost no defensive ones.
 *
 * The mean strength rises from 4.5 m at the front to 5.9 m in the middle and
 * 7.1 m at the back: a margin of {@link BACK_OVER_FRONT_STRENGTH_METRES} =
 * 2.6 m. That is small next to 2B = 20 m, which keeps D-4's promise readable:
 * items make a close race closer and cannot reverse one won on the pedals.
 *
 * ## Pick-up points: by fraction of the lap, never by geometry
 *
 * {@link PICK_UP_FRACTIONS}: a quarter, a half and three quarters of the way
 * round, so a course is described by its length alone, as `RoomCourse` is.
 * A pick-up counts when the racer's drawn distance first passes it. Being
 * knocked back over one and riding through again does not draw twice.
 */

import { LapRaceError } from './errors';
import { nextUnit, type RaceRandom } from './random';
import { applyOffset, racePosition, standings, type RaceCourse, type RacerState } from './race';

/** The items, by key. Names are keys, never rider-facing words (#1904 brings those). */
export type ItemKind = 'tailwind' | 'slipstream' | 'puddle' | 'crosswind-gust' | 'rain-cape';

/** Every item, in a fixed order: the order {@link drawItem} reads the table in. */
export const ITEM_KINDS: readonly ItemKind[] = [
  'tailwind',
  'slipstream',
  'puddle',
  'crosswind-gust',
  'rain-cape',
];

/** How many discrete lanes a race has (ADR 0060 D-6.3), as Delivery's three. */
export const LANE_COUNT = 3;

/** The lane every racer starts in: the middle one. */
export const STARTING_LANE = 1;

/** No item moves an offset faster than this. */
export const MAXIMUM_EFFECT_RATE_METRES_PER_SECOND = 2;

/** How far ahead, by drawn distance, a racer must be for a `slipstream` to tow. */
export const SLIPSTREAM_REACH_METRES = 20;

/** How long a dropped `puddle` lies on the road before it dries. */
export const PUDDLE_LIFETIME_MS = 30_000;

/** How long a `rain-cape` waits for a hit to absorb. */
export const RAIN_CAPE_DURATION_MS = 15_000;

/** Where round each lap a pick-up is, as a fraction of the lap length. */
export const PICK_UP_FRACTIONS: readonly number[] = [0.25, 0.5, 0.75];

/** An item's effect on an offset: a rate over a duration. A `rain-cape` has neither. */
export interface ItemRule {
  readonly rateMetresPerSecond: number;
  readonly durationMs: number;
}

/** The catalogue's rules. See the table in the header. */
export const ITEM_RULES: Readonly<Record<ItemKind, ItemRule>> = {
  tailwind: { rateMetresPerSecond: 1.5, durationMs: 4_000 },
  slipstream: { rateMetresPerSecond: 2, durationMs: 4_000 },
  puddle: { rateMetresPerSecond: -1.5, durationMs: 4_000 },
  'crosswind-gust': { rateMetresPerSecond: -2, durationMs: 4_000 },
  'rain-cape': { rateMetresPerSecond: 0, durationMs: 0 },
};

/** The most offset an item can move, in metres: its rate times its duration. */
export function itemStrength(kind: ItemKind): number {
  const rule = ITEM_RULES[kind];
  return (Math.abs(rule.rateMetresPerSecond) * rule.durationMs) / 1_000;
}

/** Where a racer sits in the field when it rides through a pick-up. */
export type PositionBand = 'front' | 'middle' | 'back';

/** The draw's weights, out of 100, by band. See the header for the reasoning. */
export const ITEM_TABLE: Readonly<Record<PositionBand, Readonly<Record<ItemKind, number>>>> = {
  front: { tailwind: 40, slipstream: 0, puddle: 35, 'crosswind-gust': 0, 'rain-cape': 25 },
  middle: { tailwind: 25, slipstream: 20, puddle: 20, 'crosswind-gust': 20, 'rain-cape': 15 },
  back: { tailwind: 20, slipstream: 35, puddle: 5, 'crosswind-gust': 35, 'rain-cape': 5 },
};

/** The mean strength drawn in a band, in metres, from {@link ITEM_TABLE}. */
export function meanStrength(band: PositionBand): number {
  const weights = ITEM_TABLE[band];
  const total = ITEM_KINDS.reduce((sum, kind) => sum + weights[kind], 0);
  return ITEM_KINDS.reduce((sum, kind) => sum + weights[kind] * itemStrength(kind), 0) / total;
}

/** What the table states the back's mean strength exceeds the front's by, in metres. */
export const BACK_OVER_FRONT_STRENGTH_METRES = 2.6;

/**
 * The band of the racer at `rank` (0 is the leader) in a field of
 * `fieldSize`: the field's span cut into three, rounded. A lone racer is at
 * the front; in a field of two, one is at the front and one at the back.
 */
export function positionBand(rank: number, fieldSize: number): PositionBand {
  if (fieldSize <= 1) return 'front';
  const third = Math.round((rank / (fieldSize - 1)) * 2);
  return third <= 0 ? 'front' : third === 1 ? 'middle' : 'back';
}

/** An item drawn from a band's weights, and the generator after the draw. */
export function drawItem(
  band: PositionBand,
  random: RaceRandom,
): { readonly kind: ItemKind; readonly next: RaceRandom } {
  const weights = ITEM_TABLE[band];
  const total = ITEM_KINDS.reduce((sum, kind) => sum + weights[kind], 0);
  const { value, next } = nextUnit(random);
  let left = value * total;
  for (const kind of ITEM_KINDS) {
    left -= weights[kind];
    if (left < 0) return { kind, next };
  }
  // Unreachable: `value` is below 1, so `left` goes below 0 at the last
  // non-zero weight, and every band's last item, `rain-cape`, has one.
  return { kind: 'rain-cape', next };
}

/**
 * How many pick-up points a racer at drawn distance `distance` has passed,
 * over the whole race. A point exactly at the distance counts as passed.
 */
export function pickUpsPassed(course: RaceCourse, distance: number): number {
  if (!(distance > 0)) return 0;
  const length = course.lapLengthMetres;
  const fullLaps = Math.floor(distance / length);
  if (fullLaps >= course.laps) return course.laps * PICK_UP_FRACTIONS.length;
  const into = distance - fullLaps * length;
  return (
    fullLaps * PICK_UP_FRACTIONS.length +
    PICK_UP_FRACTIONS.filter((fraction) => fraction * length <= into).length
  );
}

/** An offset effect a racer is under: a rate, from one instant until another. */
export interface OffsetEffect {
  readonly rateMetresPerSecond: number;
  readonly fromMs: number;
  readonly untilMs: number;
}

/** A racer in an item race: the model's state, and what items hold about them. */
export interface LapRacer {
  readonly racer: RacerState;
  /** The drawn lane, `0` to `LANE_COUNT − 1`. Read by hits only, never by physics or drafting (D-6). */
  readonly lane: number;
  /** The one item held, or `null`. */
  readonly held: ItemKind | null;
  readonly effects: readonly OffsetEffect[];
  /** Until when a `rain-cape` waits for a hit, or `null` for none. */
  readonly capeUntilMs: number | null;
  /** Pick-up points passed so far ({@link pickUpsPassed}), so none is drawn from twice. */
  readonly pickUpsPassed: number;
}

/** A `puddle` on the road. */
export interface Hazard {
  readonly position: number;
  readonly lane: number;
  readonly ownerId: string;
  readonly untilMs: number;
}

/** A whole race's state: plain data, so the device and the room can compare it byte for byte. */
export interface ItemRaceState {
  readonly course: RaceCourse;
  readonly itemsOn: boolean;
  readonly random: RaceRandom;
  /** The instant of the last tick. */
  readonly atMs: number;
  /** The field, in id order: the order every rule visits it in. */
  readonly racers: readonly LapRacer[];
  readonly hazards: readonly Hazard[];
}

/** Whether a lane is one of the race's. */
export function isLane(lane: number): boolean {
  return Number.isInteger(lane) && lane >= 0 && lane < LANE_COUNT;
}

/** @throws {LapRaceError} for a lane that is not one of the race's. */
export function checkedLane(lane: number): number {
  if (!isLane(lane)) {
    throw new LapRaceError('lane-out-of-range', 'lane must be a whole number below LANE_COUNT');
  }
  return lane;
}

/** How much offset `effects` add between two instants, in metres. */
function offsetBetween(effects: readonly OffsetEffect[], fromMs: number, toMs: number): number {
  let metres = 0;
  for (const effect of effects) {
    const overlap = Math.min(toMs, effect.untilMs) - Math.max(fromMs, effect.fromMs);
    if (overlap > 0) metres += (effect.rateMetresPerSecond * overlap) / 1_000;
  }
  return metres;
}

/** A hit on `target` by an item of `kind` at `atMs`: absorbed by a cape, or an effect. */
function hit(target: LapRacer, kind: ItemKind, atMs: number): LapRacer {
  if (target.capeUntilMs !== null && target.capeUntilMs > atMs) {
    return { ...target, capeUntilMs: null };
  }
  return { ...target, effects: [...target.effects, effectOf(kind, atMs)] };
}

function effectOf(kind: ItemKind, atMs: number): OffsetEffect {
  const rule = ITEM_RULES[kind];
  return {
    rateMetresPerSecond: rule.rateMetresPerSecond,
    fromMs: atMs,
    untilMs: atMs + rule.durationMs,
  };
}

/** The unfinished racer nearest ahead of `index` by drawn distance, or `undefined`. */
function nearestAhead(racers: readonly LapRacer[], index: number): number | undefined {
  const own = racePosition((racers[index] as LapRacer).racer);
  let found: number | undefined;
  let gap = Number.POSITIVE_INFINITY;
  racers.forEach((other, at) => {
    const ahead = racePosition(other.racer) - own;
    if (at !== index && other.racer.finishedAtMs === null && ahead > 0 && ahead < gap) {
      gap = ahead;
      found = at;
    }
  });
  return found;
}

/**
 * One tick of the item rules, in a fixed order: the effects already running,
 * then puddles ridden through, then items used, then pick-ups.
 *
 * @param state - the race with this tick's effort distances and lanes applied,
 *   and `atMs` still the last tick's instant.
 * @param before - each racer's drawn distance at the last tick, by id: what a
 *   puddle or a pick-up was crossed from.
 * @param uses - the ids that asked to use their held item this tick.
 * @param atMs - this tick's instant.
 * @returns the race after the items, with its racers not yet settled.
 */
export function resolveItems(
  state: ItemRaceState,
  before: ReadonlyMap<string, number>,
  uses: ReadonlySet<string>,
  atMs: number,
): ItemRaceState {
  const fromMs = state.atMs;
  let random = state.random;

  // 1. The effects already running, integrated through the clamp.
  let racers: LapRacer[] = state.racers.map((entry) => {
    if (entry.racer.finishedAtMs !== null) return entry;
    const metres = offsetBetween(entry.effects, fromMs, atMs);
    return {
      ...entry,
      racer: metres === 0 ? entry.racer : applyOffset(entry.racer, metres),
      effects: entry.effects.filter((effect) => effect.untilMs > atMs),
    };
  });

  // 2. Puddles: the first other racer, in id order, to ride through one in its lane.
  const hazards: Hazard[] = [];
  for (const hazard of state.hazards) {
    const victim = racers.findIndex(
      (entry) =>
        entry.racer.id !== hazard.ownerId &&
        entry.racer.finishedAtMs === null &&
        entry.lane === hazard.lane &&
        (before.get(entry.racer.id) ?? 0) < hazard.position &&
        racePosition(entry.racer) >= hazard.position,
    );
    if (victim >= 0) {
      racers[victim] = hit(racers[victim] as LapRacer, 'puddle', atMs);
    } else if (hazard.untilMs > atMs) {
      hazards.push(hazard);
    }
  }

  // 3. Items used, in id order.
  racers.forEach((_, index) => {
    const entry = racers[index] as LapRacer;
    const kind = entry.held;
    if (kind === null || !uses.has(entry.racer.id) || entry.racer.finishedAtMs !== null) return;
    let user: LapRacer = { ...entry, held: null };
    if (kind === 'tailwind') {
      user = { ...user, effects: [...user.effects, effectOf(kind, atMs)] };
    } else if (kind === 'slipstream') {
      const ahead = nearestAhead(racers, index);
      const gap =
        ahead === undefined
          ? Number.POSITIVE_INFINITY
          : racePosition((racers[ahead] as LapRacer).racer) - racePosition(entry.racer);
      if (gap <= SLIPSTREAM_REACH_METRES) {
        user = { ...user, effects: [...user.effects, effectOf(kind, atMs)] };
      }
    } else if (kind === 'puddle') {
      hazards.push({
        position: racePosition(entry.racer),
        lane: entry.lane,
        ownerId: entry.racer.id,
        untilMs: atMs + PUDDLE_LIFETIME_MS,
      });
    } else if (kind === 'crosswind-gust') {
      const ahead = nearestAhead(racers, index);
      if (ahead !== undefined && (racers[ahead] as LapRacer).lane === entry.lane) {
        racers[ahead] = hit(racers[ahead] as LapRacer, kind, atMs);
      }
    } else {
      user = { ...user, capeUntilMs: atMs + RAIN_CAPE_DURATION_MS };
    }
    racers[index] = user;
  });

  // 4. Pick-ups, drawn by the band each racer is in now.
  const order = standings(racers.map((entry) => entry.racer));
  racers = racers.map((entry) => {
    if (entry.racer.finishedAtMs !== null) return entry;
    const passed = pickUpsPassed(state.course, racePosition(entry.racer));
    if (passed <= entry.pickUpsPassed) return entry;
    if (entry.held !== null) return { ...entry, pickUpsPassed: passed };
    const band = positionBand(order.indexOf(entry.racer.id), racers.length);
    const drawn = drawItem(band, random);
    random = drawn.next;
    return { ...entry, held: drawn.kind, pickUpsPassed: passed };
  });

  return { ...state, random, racers, hazards };
}
