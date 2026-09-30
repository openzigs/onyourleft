// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every word the realistic world's start and finish gantries carry — #679.
 *
 * ## The rules the words are under
 *
 * - **Our own words, and no one else's** (ADR 0009): no partner, sponsor,
 *   team, brand or product name, and no text taken from another product. The
 *   one name here is this app's own.
 * - **One list** (the `camera/side-report-wording.ts` pattern): the banner
 *   atlas is rasterised from {@link bannerTexts} and nothing else, and
 *   `banner-atlas.test.ts` holds the set of strings the atlas carries EQUAL to
 *   it, in both directions.
 * - **A distance is the rider's own units** (ADR 0020): the one number on a
 *   banner is built by `units/format.ts`, which returns the value and its label
 *   together, so no unit label is written here by hand
 *   (`units/no-inline-units.test.ts`).
 * - **Nothing about a body** (ADR 0030 D-8, `camera/no-absolute-angles.test.ts`
 *   scans this file with the rest of `src/`): a banner has no reason to.
 *
 * ⚠️ **The owner confirms or replaces this list in the pull request** (#679
 * §"The words"). A rider's own route name is not here: it is arbitrary text,
 * which needs glyphs laid out at runtime from any range — a follow-up.
 */

import type { UnitSystem } from '@onyourleft/store';

import { distanceIn, formatDistance, measurementText } from '../units/format';
import { metres } from '@onyourleft/domain';

/** Over the start of a point-to-point route. */
export const START_WORD = 'START';

/** Over its end. */
export const FINISH_WORD = 'FINISH';

/** Over a loop's one line, which a rider crosses once a lap. */
export const LAP_WORD = 'LAP';

/** Under each of those, smaller: the app's own name, and nobody else's. */
export const BANNER_SUBLINE = 'ON YOUR LEFT';

/** What follows the distance on the board before the line. */
export const TO_GO_WORDS = 'TO GO';

/** The words over a line, by what the line is. */
export const LINE_WORDS = {
  start: START_WORD,
  finish: FINISH_WORD,
  lap: LAP_WORD,
} as const;

/** What kind of line a gantry stands over. */
export type LineKind = keyof typeof LINE_WORDS;

/**
 * One unit of ride-scale distance in the rider's own system, in metres — a
 * kilometre or a mile — read off `units/format.ts` rather than written down,
 * so no conversion factor is typed here either.
 */
export function oneDistanceUnitMetres(units: UnitSystem): number {
  return 1 / distanceIn(1, units);
}

/**
 * The board one distance unit before the line: `1 km TO GO`, or the same in
 * miles — the number and its label from `units/format.ts`.
 */
export function toGoText(units: UnitSystem): string {
  return `${measurementText(formatDistance(metres(oneDistanceUnitMetres(units)), units, 0))} ${TO_GO_WORDS}`;
}

/**
 * The banners, as the atlas lays them out: each line's word over the app's
 * name, and the board before a line in either system. `banner-atlas.ts` draws
 * these cells and nothing else.
 */
export function bannerCells(): readonly { readonly main: string; readonly subline?: string }[] {
  return [
    { main: START_WORD, subline: BANNER_SUBLINE },
    { main: FINISH_WORD, subline: BANNER_SUBLINE },
    { main: LAP_WORD, subline: BANNER_SUBLINE },
    { main: toGoText('metric') },
    { main: toGoText('imperial') },
  ];
}

/**
 * Every string the banner atlas rasterises, for a rider in either system —
 * the atlas carries both, so a rider who changes their units mid-visit needs
 * no second atlas.
 *
 * @test-facing the list `banner-atlas.test.ts` holds the atlas's rasterised
 * strings EQUAL to; the atlas itself is built from {@link bannerCells}, and a
 * string in one and not the other is that test going red.
 */
export function bannerTexts(): readonly string[] {
  return [
    START_WORD,
    FINISH_WORD,
    LAP_WORD,
    BANNER_SUBLINE,
    toGoText('metric'),
    toGoText('imperial'),
  ];
}
