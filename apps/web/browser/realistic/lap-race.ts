// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A lap race's worst case on the owner's realistic page — #1972, for #1903's
 * tablet reading (`realistic-budget.ts` §`LAP_RACE_SCENE_DRAW_CALLS`).
 *
 * `?world=stylised&race=worst` hands every frame what #1902/#1961's worst
 * case is: the rider and seven bots, five of the eight hit, every pick-up
 * point of a three-lap race of 40 m laps and ten puddles across the three
 * lanes, drawn by the product's own `three-renderer.ts` §`LapRaceBelt`. It is
 * `game-harness.ts` §`withLapRace`'s frame, which that file keeps to itself,
 * placed by the same product modules (`scene.ts` §`SceneInput.raceBots`,
 * `lap-race/in-view.ts`).
 *
 * ⚠️ **Placements, not a race.** Nothing here runs a race, scores it, throws
 * an item or reaches a trainer: the pieces stand where a by-eye look can find
 * them and follow the rider, so a five-minute ride on the tablet carries the
 * race for all five. A call costs the same wherever its instances stand.
 */

import { createItemRace, raceCourse, type Hazard } from '@onyourleft/domain';

import { hitLook, lapRaceInView, laneLateral } from '../../src/game/lap-race/in-view';
import type { RaceHitLook, SceneFrame } from '../../src/game/port';
import type { RaceBotInput } from '../../src/game/scene';

/** The bots in the worst case: with the rider, #1902's eight racers. */
export const RACE_BOTS = 7;

/** How far ahead of the rider the first bot rides, and the gap between each, in metres. */
export const RACE_BOT_AHEAD_METRES = 6;
export const RACE_BOT_SPACING_METRES = 4;

/** The race's laps, and how long each is: every pick-up point lands on the frame's road. */
export const RACE_LAPS = 3;
export const RACE_LAP_METRES = 40;

/** The puddles on the road, the most `lap-race.browser.spec.ts` counts. */
export const RACE_PUDDLES = 10;

/**
 * A hit effect as `hitLook` draws one, with motion, half a second in. The
 * rider wears it, and so does every other bot, starting with the first.
 */
export const RACE_HIT = hitLook(
  [{ rateMetresPerSecond: -2, fromMs: 0, untilMs: 4_000 }],
  500,
  false,
) as RaceHitLook;

/** How many of the eight racers are hit: the rider and every other bot. */
export const RACE_HIT_RACERS = 1 + Math.ceil(RACE_BOTS / 2);

/** The seven bots ahead of a rider `riderAlong` metres along, a lane each in turn. */
export function raceBotsAhead(riderAlong: number): readonly RaceBotInput[] {
  return Array.from({ length: RACE_BOTS }, (_, index) => ({
    distanceMetres: riderAlong + RACE_BOT_AHEAD_METRES + RACE_BOT_SPACING_METRES * index,
    speedMetresPerSecond: 9,
    lateralMetres: laneLateral(index % 3),
    ...(index % 2 === 0 ? { hit: RACE_HIT } : {}),
  }));
}

/**
 * `frame` carrying the race's pieces: every pick-up point of a three-lap
 * course starting at `riderAlong` and {@link RACE_PUDDLES} puddles from 10 m
 * into it, one a metre, across the three lanes in turn.
 */
export function lapRaceAhead(frame: SceneFrame, riderAlong: number): SceneFrame {
  const race = createItemRace({
    course: raceCourse(RACE_LAP_METRES, RACE_LAPS),
    seed: 1,
    itemsOn: true,
    racerIds: ['rider', ...Array.from({ length: RACE_BOTS }, (_, index) => `bot-${index + 1}`)],
    startMs: 0,
  });
  const hazards: Hazard[] = Array.from({ length: RACE_PUDDLES }, (_, index) => ({
    position: 10 + index,
    lane: index % 3,
    ownerId: 'bot-1',
    untilMs: 30_000,
    hitIds: [],
  }));
  return {
    ...frame,
    lapRace: lapRaceInView({
      corridor: frame.corridor,
      race: { ...race, hazards },
      startAlong: riderAlong,
    }),
  };
}
