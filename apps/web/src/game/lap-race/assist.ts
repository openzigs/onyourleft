// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The lap race's assisted setting, applied — #1905. The setting is read with
 * `assist-preference.ts` §`readLapRaceAssist`, the one reader the Settings
 * screen writes for, and each part is handed to the race here:
 *
 * - **items off** and **no knock-back on me** when the race is started
 *   ({@link assistedRaceSetup}): `@onyourleft/domain` §`createItemRace`'s
 *   `itemsOn` and `shieldedIds`, so the model itself holds them and a hit on
 *   the rider moves nothing (`items.ts` §"A shielded racer");
 * - **auto-use** on every tick ({@link assistedTick}): the rider's held item
 *   is put in the tick's `uses`, so a race needs no item input at all;
 * - **gentler bots** when the field is chosen ({@link assistedBotTier}).
 *
 * Nothing here reaches the trainer or the physics: a lap race's items and
 * bots never do (ADR 0060 D-2), and `lap-race-cannot-reach-trainer.test.ts`
 * walks this directory.
 *
 * @unwired #1906 starts a lap race inside a game ride with these; until then only tests reach this module.
 */

import {
  BOT_TIERS,
  type BotTier,
  type ItemRaceSetup,
  type ItemRaceState,
  type RaceTickInput,
} from '@onyourleft/domain';

import type { LapRaceAssist } from './assist-preference';

/** The race's setup with the assist applied: items off if asked, and the rider shielded if asked. */
export function assistedRaceSetup(
  assist: LapRaceAssist,
  setup: ItemRaceSetup,
  riderId: string,
): ItemRaceSetup {
  const shielded = setup.shieldedIds ?? [];
  return {
    ...setup,
    itemsOn: setup.itemsOn && !assist.itemsOff,
    shieldedIds: assist.noKnockBack ? [...shielded, riderId] : shielded,
  };
}

/**
 * The tick's input with auto-use applied: with it on, a rider holding an item
 * uses it on this tick, pressed or not. With it off, the input as it came.
 */
export function assistedTick(
  assist: LapRaceAssist,
  race: ItemRaceState,
  riderId: string,
  input: RaceTickInput,
): RaceTickInput {
  if (!assist.autoUse) return input;
  const rider = race.racers.find((entry) => entry.racer.id === riderId);
  const uses = input.uses ?? [];
  if (rider === undefined || rider.held === null || uses.includes(riderId)) return input;
  return { ...input, uses: [...uses, riderId] };
}

/** The tier a bot rides: one easier than chosen with gentler bots on, and the easiest stays the easiest. */
export function assistedBotTier(assist: LapRaceAssist, tier: BotTier): BotTier {
  if (!assist.gentlerBots) return tier;
  return BOT_TIERS[Math.max(0, BOT_TIERS.indexOf(tier) - 1)] ?? tier;
}
