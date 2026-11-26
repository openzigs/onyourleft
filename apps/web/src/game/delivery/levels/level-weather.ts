// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's choice of a level's weather and light — #2578. The owner on
 * the tablet (2026-11-13): *"How do we control weather."* Each level file
 * fixes its round's `weather` and `light` (ADR 0065 D-10.4, #2366); since
 * #2578 the setup offers the level's own or one of three others, and the
 * round is started with the chosen pair in place of the file's
 * (`GameView` §`begin`).
 *
 * Everything downstream reads the round's pair as before, so the choice
 * reaches all of it: `ride-round.ts` §`startDeliveryRide` makes the round's
 * rain and dusk from it, and with either the house markers' 40 m reveal
 * (`in-view.ts` §`LOW_LIGHT_REVEAL_METRES`); the renderer draws the rain and
 * dims the light from the frame's weather. ⚠️ **A drawing and a reveal
 * only**: nothing here reaches the simulation, the grade or the trainer
 * (ADR 0059 D-2.1, `delivery-cannot-reach-trainer.test.ts`).
 *
 * Kept for the setup screen only, never on the device: a new setup offers
 * the level's own again.
 */

import type { LevelRound } from './level-file';

/** What a setup offers, in the order it lists them: the level's own first, the default. */
export const LEVEL_WEATHER_CHOICES = ['level', 'clear', 'rain', 'dusk'] as const;

export type LevelWeatherChoice = (typeof LEVEL_WEATHER_CHOICES)[number];

/** A round's weather and light: the pair a level file states. */
export type LevelSky = Pick<LevelRound, 'weather' | 'light'>;

/** Each choice but the level's own, as the pair it rides in. */
const SKIES: Readonly<Record<Exclude<LevelWeatherChoice, 'level'>, LevelSky>> = {
  clear: { weather: 'clear', light: 'day' },
  rain: { weather: 'rain', light: 'day' },
  dusk: { weather: 'clear', light: 'dusk' },
};

/** The pair a round rides in: the level's `own` for `'level'`, else the chosen one. */
export function chosenSky(choice: LevelWeatherChoice, own: LevelSky): LevelSky {
  return choice === 'level' ? { weather: own.weather, light: own.light } : SKIES[choice];
}
