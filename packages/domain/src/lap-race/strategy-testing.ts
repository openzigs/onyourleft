// SPDX-License-Identifier: Apache-2.0

/**
 * Test support for #1959: whole races of bots on made-up speeds, one tick a
 * second, without the physics, so a thousand of them run in seconds. Races on
 * the one physics are `packages/physics/src/lap-race-bot.test.ts`'s.
 */

import { botDecision } from './bots';
import { createItemRace, stepRace } from './item-race';
import type { ItemKind, ItemRaceState, LapRacer } from './items';
import { nextUnit, raceRandom } from './random';
import { raceCourse, racePosition, type RaceCourse } from './race';
import {
  BOT_MEMORY_AT_START,
  strategicBotDecision,
  type BotMemory,
  type BotStrategy,
} from './strategy';

/** How a racer decides: the #1900 bot's reactive rules, or a strategy. */
export type Policy = 'reactive' | BotStrategy;

/** One item used. */
export interface Use {
  readonly id: string;
  readonly kind: ItemKind;
  /** The tick it was used in. */
  readonly atMs: number;
  /** How long it was held first. */
  readonly heldMs: number;
  /** For a gust: how many racers it slowed (shared out when two went in one tick). */
  readonly hits: number;
  readonly lastLap: boolean;
}

/** What one race saw. */
export interface RaceRun {
  readonly states: readonly ItemRaceState[];
  readonly uses: readonly Use[];
  /** Racers who crossed the line holding an item they had held since before that tick. */
  readonly finishedHolding: readonly string[];
  /** The largest offset, either way, any racer had at any tick. */
  readonly widestOffset: number;
  /** How many racers each racer's puddles slowed (or a cape absorbed), by the puddle's owner. */
  readonly puddleHits: Readonly<Record<string, number>>;
  /** How many hits each racer's cape absorbed, by the cape's wearer. */
  readonly capesAbsorbed: Readonly<Record<string, number>>;
}

/** What every simulated race rides unless told otherwise: 3 laps of 400 m. */
export const SIMULATED_COURSE: RaceCourse = raceCourse(400, 3);

/** The racer `id` in `state`. */
function entryOf(state: ItemRaceState, id: string): LapRacer | undefined {
  return state.racers.find((entry) => entry.racer.id === id);
}

/**
 * A race of bots `b0`, `b1`, … deciding by `policies`, each at its own speed:
 * a base near 8 m/s with a slow swing, drawn from `seed`, so the field bunches
 * and spreads. The bots' decisions take the race's seed, as the solo race's do.
 */
export function simulateRace(
  seed: number,
  policies: readonly Policy[],
  course: RaceCourse = SIMULATED_COURSE,
  shapeOf: (at: number) => number = (at) => at,
): RaceRun {
  const ids = policies.map((_, at) => `b${String(at)}`);
  let random = raceRandom(seed ^ 0x2545_f491);
  const draw = (): number => {
    const next = nextUnit(random);
    random = next.next;
    return next.value;
  };
  const shapes = ids.map(() => ({
    base: 7.6 + draw() * 0.8,
    swing: 0.5 + draw(),
    period: 15 + draw() * 25,
    phase: draw() * 2 * Math.PI,
  }));
  let state = createItemRace({ course, seed, itemsOn: true, racerIds: ids, startMs: 0 });
  const memories = new Map<string, BotMemory>(ids.map((id) => [id, BOT_MEMORY_AT_START]));
  const effort = new Map<string, number>(ids.map((id) => [id, 0]));
  const heldFrom = new Map<string, number>();
  const states = [state];
  const uses: Use[] = [];
  const finishedHolding: string[] = [];
  let widestOffset = 0;
  const puddleHits: Record<string, number> = {};
  const capesAbsorbed: Record<string, number> = {};
  const lastLapFrom = course.lapLengthMetres * (course.laps - 1);
  for (let tick = 0; tick < 2_000; tick += 1) {
    if (state.racers.every((entry) => entry.racer.finishedAtMs !== null)) break;
    const lanes: Record<string, number> = {};
    const asked: string[] = [];
    const effortDistances: Record<string, number> = {};
    ids.forEach((id, at) => {
      const shape = shapes[shapeOf(at)] as (typeof shapes)[number];
      const speed =
        shape.base + shape.swing * Math.sin((2 * Math.PI * tick) / shape.period + shape.phase);
      const policy = policies[at] as Policy;
      let decision: { readonly use: boolean; readonly lane: number };
      if (policy === 'reactive') {
        decision = botDecision(state, id, seed, speed);
      } else {
        const strategic = strategicBotDecision(
          state,
          id,
          seed,
          speed,
          policy,
          memories.get(id) as BotMemory,
        );
        memories.set(id, strategic.memory);
        decision = strategic;
      }
      lanes[id] = decision.lane;
      if (decision.use) asked.push(id);
      const distance = (effort.get(id) ?? 0) + speed;
      effort.set(id, distance);
      effortDistances[id] = distance;
    });
    const atMs = state.atMs + 1_000;
    const next = stepRace(state, { atMs, effortDistances, lanes, uses: asked });
    // A gust's effect is the only one at −2 m/s.
    const gusted = next.racers.reduce(
      (sum, entry) =>
        sum +
        entry.effects.filter(
          (effect) => effect.rateMetresPerSecond === -2 && effect.fromMs === atMs,
        ).length,
      0,
    );
    const gusters = asked.filter((id) => entryOf(state, id)?.held === 'crosswind-gust').length;
    for (const id of asked) {
      const before = entryOf(state, id);
      if (before === undefined || before.held === null || before.racer.finishedAtMs !== null) {
        continue;
      }
      uses.push({
        id,
        kind: before.held,
        atMs,
        heldMs: atMs - (heldFrom.get(id) ?? atMs),
        hits: before.held === 'crosswind-gust' ? gusted / gusters : 0,
        lastLap: racePosition(before.racer) >= lastLapFrom,
      });
    }
    next.racers.forEach((entry, at) => {
      const before = state.racers[at] as LapRacer;
      const used = asked.includes(entry.racer.id);
      if (entry.held !== null && (before.held === null || used)) {
        heldFrom.set(entry.racer.id, atMs);
      }
      if (
        before.racer.finishedAtMs === null &&
        entry.racer.finishedAtMs !== null &&
        entry.held !== null &&
        before.held !== null &&
        !used
      ) {
        finishedHolding.push(entry.racer.id);
      }
      widestOffset = Math.max(widestOffset, Math.abs(entry.racer.raceOffset));
      // A cape still good for this tick that is gone after it absorbed a hit.
      if (before.capeUntilMs !== null && before.capeUntilMs > atMs && entry.capeUntilMs === null) {
        capesAbsorbed[entry.racer.id] = (capesAbsorbed[entry.racer.id] ?? 0) + 1;
      }
    });
    for (const hazard of next.hazards) {
      const was = state.hazards.find(
        (old) =>
          old.ownerId === hazard.ownerId &&
          old.position === hazard.position &&
          old.lane === hazard.lane &&
          old.untilMs === hazard.untilMs,
      );
      const more = hazard.hitIds.length - (was?.hitIds.length ?? 0);
      if (more > 0) puddleHits[hazard.ownerId] = (puddleHits[hazard.ownerId] ?? 0) + more;
    }
    state = next;
    states.push(state);
  }
  return { states, uses, finishedHolding, widestOffset, puddleHits, capesAbsorbed };
}
