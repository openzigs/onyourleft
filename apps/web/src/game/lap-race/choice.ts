// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What lap race a rider chooses — #1907 (epic #1894, ADR 0060): its laps, its
 * field, its bots' tier and whether it has items. The stage chooser offers it
 * (`StageChooser.tsx` §`LapRaceControl`), `GameView` holds it per ride, and
 * `ride-race.ts` §`startLapRaceRide` starts the race from it at the press.
 *
 * ⚠️ **Its own module, importing nothing of the race**, because the chooser
 * imports it: `stage-chooser-imports.test.ts` holds the chooser to no
 * renderer, no map and no network, and the race's modules reach the physics
 * and the scene's types.
 */

import type { BotTier } from '@onyourleft/domain';

/** What race to run. */
export interface LapRaceChoice {
  /** How many laps of the loop. A whole number, 1 to {@link LAP_RACE_MOST_LAPS}. */
  readonly laps: number;
  /** How many bots, 1 to {@link LAP_RACE_MOST_BOTS}. */
  readonly bots: number;
  /** The bots' tier, before the assisted setting's gentler bots. */
  readonly tier: BotTier;
  /** Whether the race has items, before the assisted setting's items off. */
  readonly itemsOn: boolean;
}

/** The most bots a field holds: seven, the field #1903's draw-call ceiling was measured with. */
export const LAP_RACE_MOST_BOTS = 7;

/** The most laps the chooser offers: ten. A choice, not a measurement; the model takes any whole number. */
export const LAP_RACE_MOST_LAPS = 10;

/** The chooser's race before the rider changes anything: #733's tablet step, three laps against seven bots, with items. */
export const DEFAULT_LAP_RACE_CHOICE: LapRaceChoice = Object.freeze({
  laps: 3,
  bots: LAP_RACE_MOST_BOTS,
  tier: 'brisk',
  itemsOn: true,
});
