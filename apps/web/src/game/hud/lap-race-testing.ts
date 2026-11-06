// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lap race for the HUD's tests — #1904: built and stepped through
 * `@onyourleft/domain`'s own `createItemRace` and `stepRace`, so every state a
 * test hands the HUD is one the model produced. The one thing set by hand is
 * an item a racer holds ({@link holding}), so a test can have a bot use a gust
 * on the rider without riding a seed until the draw gives one.
 */

import {
  createItemRace,
  raceCourse,
  stepRace,
  type ItemKind,
  type ItemRaceState,
  type RaceTickInput,
} from '@onyourleft/domain';

import type { LapRaceEntrant, LapRaceHud } from './lap-race-hud';

/** The rider's id in every test race. */
export const RIDER = 'rider';

/** Three bots, named as the standings name them. */
export const BOTS = ['bot-1', 'bot-2', 'bot-3'] as const;

export const ENTRANTS: Readonly<Record<string, LapRaceEntrant>> = {
  'bot-1': { name: 'Brisk bot 1', wattsPerKilogram: 3 },
  'bot-2': { name: 'Steady bot 2', wattsPerKilogram: 2.25 },
  'bot-3': { name: 'Fierce bot 3', wattsPerKilogram: 4.5 },
};

/** A race of `laps` laps of `lap` metres, the rider and three bots on the line at 0 ms. */
export function startRace(options: {
  readonly laps?: number;
  readonly lap?: number;
  readonly itemsOn?: boolean;
  readonly seed?: number;
}): ItemRaceState {
  return createItemRace({
    course: raceCourse(options.lap ?? 1_000, options.laps ?? 3),
    seed: options.seed ?? 1_904,
    itemsOn: options.itemsOn ?? true,
    racerIds: [RIDER, ...BOTS],
    startMs: 0,
  });
}

/** The race with `id` holding `kind`, everything else as the model left it. */
export function holding(race: ItemRaceState, id: string, kind: ItemKind | null): ItemRaceState {
  return {
    ...race,
    racers: race.racers.map((entry) => (entry.racer.id === id ? { ...entry, held: kind } : entry)),
  };
}

/** One tick of the race, through the model. */
export function tick(race: ItemRaceState, input: RaceTickInput): ItemRaceState {
  return stepRace(race, input);
}

/** The race as the HUD is handed it. */
export function hudOf(race: ItemRaceState, speedMetresPerSecond = 10): LapRaceHud {
  return {
    race,
    riderId: RIDER,
    entrants: ENTRANTS,
    riderWattsPerKilogram: 3.2,
    speedMetresPerSecond,
  };
}
