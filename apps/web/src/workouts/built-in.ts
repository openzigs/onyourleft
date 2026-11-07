// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The built-in workouts as cards a rider browses — #2304, under the library
 * epic #2295.
 *
 * Pure, and separate from the view for `library.ts`'s reason: what a card says
 * and which cards a filter leaves are decisions worth testing on their own.
 *
 * ## Shipped in the app, never stored
 *
 * Every card comes from `BUILT_IN_WORKOUTS` in `@onyourleft/domain`, a
 * constant in the bundle, so the list needs no store, no instance and no
 * network (CLAUDE.md §1 invariant a). A built-in is **not** a row in the
 * workouts store and is never synced: nothing here writes anything, and a
 * rider makes one their own by saving a copy (#2305).
 *
 * A built-in's selection id is {@link BUILT_IN_ID_PREFIX} and its template's
 * id. No saved workout has one: a saved workout's id is `workout-` and a
 * random UUID (`WorkoutsView.tsx` §`newWorkoutId`), on every device.
 *
 * ## What a card says
 *
 * `library.ts`'s rule, unchanged: the length, the shape in words, and the
 * hardest target as a **percentage of threshold** — never watts, because a
 * card is the same for every rider. Each card is the template tailored with
 * no choices at all, which is the workout a rider gets by changing nothing.
 *
 * ## Built once
 *
 * {@link BUILT_IN_CARDS} is computed when the module loads: about thirty
 * templates, each tailored and expanded once, rather than once per render or
 * per filter. The catalogue gates (`packages/domain/src/workout/library/
 * catalogue.test.ts`) hold every template to tailoring with its defaults, so
 * this cannot throw for a template that shipped.
 */

import {
  BUILT_IN_WORKOUTS,
  expandWorkout,
  tailorWorkout,
  workoutDurationText,
  workoutPercent,
  workoutShapeText,
  type TemplateBlock,
  type Workout,
  type WorkoutCategory,
  type WorkoutTemplate,
} from '@onyourleft/domain';

import { hrefFor, hrefForSelection, routeById } from '../shell/routes';
import { blockChartPaths, type BlockChartPaths } from './block-chart';
import { hardestShare } from './library';

/** What a built-in's selection id starts with: `built-in:sweet-spot-2x20`. */
export const BUILT_IN_ID_PREFIX = 'built-in:';

/**
 * Each category's plain name, as a filter and a card say it. A `Record`, so a
 * category added to the domain's type is a compile error here until it has one.
 */
export const CATEGORY_NAMES: Readonly<Record<WorkoutCategory, string>> = {
  recovery: 'Recovery',
  endurance: 'Endurance',
  tempo: 'Tempo',
  'sweet-spot': 'Sweet spot',
  threshold: 'Threshold',
  'over-under': 'Over-unders',
  vo2: 'VO2 max',
  anaerobic: 'Anaerobic',
  sprint: 'Sprints',
  pyramid: 'Pyramids',
  cadence: 'Cadence drills',
  'race-simulation': 'Race simulation',
  test: 'Threshold tests',
};

/**
 * The lengths a rider filters by, in minutes: the domain's
 * `TEMPLATE_LENGTHS_MINUTES`, which every surveyed library is browsed by.
 * Written out so that the type can name them; `built-in.test.ts` holds the two
 * equal.
 */
export type LengthChoice = 30 | 45 | 60 | 75 | 90;

export const LENGTH_CHOICES: readonly LengthChoice[] = [30, 45, 60, 75, 90];

/** A length choice as the filter says it: the first and last are open-ended. */
export function lengthChoiceText(minutes: LengthChoice): string {
  if (minutes === LENGTH_CHOICES[0]) return `${String(minutes)} min or less`;
  if (minutes === LENGTH_CHOICES.at(-1)) return `${String(minutes)} min or more`;
  return `${String(minutes)} min`;
}

/**
 * The length choice a workout of this many seconds is listed under: the
 * nearest of {@link LENGTH_CHOICES}, the shorter on a tie. So "30 min or less"
 * holds everything under 37½ minutes and "90 min or more" everything from
 * 82½, and every workout is under exactly one choice.
 */
export function lengthChoiceOf(totalSeconds: number): LengthChoice {
  const minutes = totalSeconds / 60;
  let best: LengthChoice = LENGTH_CHOICES[0] ?? 30;
  for (const choice of LENGTH_CHOICES) {
    if (Math.abs(choice - minutes) < Math.abs(best - minutes)) best = choice;
  }
  return best;
}

/** A built-in as a card. */
export interface BuiltInCard {
  /** The selection id: {@link BUILT_IN_ID_PREFIX} and the template's id. */
  readonly id: string;
  readonly template: WorkoutTemplate;
  readonly name: string;
  readonly summary: string;
  readonly category: WorkoutCategory;
  readonly categoryName: string;
  /** The default workout: the template tailored with no choices. */
  readonly workout: Workout;
  readonly totalSeconds: number;
  /** `"1 h 5 min"`. */
  readonly duration: string;
  /** The length choice it is filtered under, from its default length. */
  readonly length: LengthChoice;
  /** The shape in words — `library.ts`'s `shape`. */
  readonly shape: string;
  /** The hardest target as a percentage of threshold, or `undefined` for none. */
  readonly hardestPercent: number | undefined;
  /** Whether any block holds a heart-rate range rather than a power target. */
  readonly heartRate: boolean;
  /** The card's drawing (#941), from the default workout's own expansion. */
  readonly chart: BlockChartPaths;
}

/** Every block a template is written with, whatever its main set's strategy. */
function templateBlocks(template: WorkoutTemplate): readonly TemplateBlock[] {
  const set = template.mainSet;
  const main =
    set.scaling === 'repeat'
      ? [...set.rep, ...(set.recovery === undefined ? [] : [set.recovery.block])]
      : set.blocks;
  return [...template.warmUp, ...main, ...template.coolDown];
}

/**
 * Whether a template holds a heart-rate range anywhere: a zone hold, which a
 * rider's threshold heart rate turns into beats per minute, or a hold written
 * in them. With no threshold heart rate a zone hold rides as its steady
 * fallback (`template.ts` §`HeartRateZoneHoldBlock`), so this is read from the
 * template and not from the default workout, which may hold no hold at all.
 */
export function hasHeartRateTarget(template: WorkoutTemplate): boolean {
  return templateBlocks(template).some(
    (block) => block.kind === 'heart-rate-zone-hold' || block.kind === 'heart-rate-hold',
  );
}

/** One template as its card. */
export function builtInCard(template: WorkoutTemplate): BuiltInCard {
  const workout = tailorWorkout(template, {});
  const timeline = expandWorkout(workout);
  const hardest = hardestShare(workout);
  return {
    id: `${BUILT_IN_ID_PREFIX}${template.id}`,
    template,
    name: template.name,
    summary: template.summary,
    category: template.category,
    categoryName: CATEGORY_NAMES[template.category],
    workout,
    totalSeconds: timeline.totalSeconds,
    duration: workoutDurationText(timeline.totalSeconds),
    length: lengthChoiceOf(timeline.totalSeconds),
    shape: workoutShapeText(workout),
    hardestPercent: hardest === undefined ? undefined : workoutPercent(hardest),
    heartRate: hasHeartRateTarget(template),
    chart: blockChartPaths(timeline.segments),
  };
}

/** Every built-in as a card, in the library's own order (easiest category first). */
export const BUILT_IN_CARDS: readonly BuiltInCard[] = BUILT_IN_WORKOUTS.map(builtInCard);

/** The categories the library holds, in its order: only those a filter can find. */
export const BUILT_IN_CATEGORIES: readonly WorkoutCategory[] = [
  ...new Set(BUILT_IN_CARDS.map((card) => card.category)),
];

/** Whether a selection id names a built-in rather than a saved workout. */
export function isBuiltInId(id: string | undefined): boolean {
  return id?.startsWith(BUILT_IN_ID_PREFIX) === true;
}

/** The built-in a selection id names, or `undefined` for none. */
export function builtInById(id: string): BuiltInCard | undefined {
  return BUILT_IN_CARDS.find((card) => card.id === id);
}

/** What a rider filters the built-ins by. Every field absent means no filter. */
export interface BuiltInFilter {
  readonly category?: WorkoutCategory | undefined;
  readonly length?: LengthChoice | undefined;
  /** Only workouts with a heart-rate target. */
  readonly heartRate?: boolean | undefined;
}

/** Whether any filter is set. */
export function isFiltered(filter: BuiltInFilter): boolean {
  return filter.category !== undefined || filter.length !== undefined || filter.heartRate === true;
}

/** The cards a filter leaves, in the library's order. */
export function filterBuiltIns(
  cards: readonly BuiltInCard[],
  filter: BuiltInFilter,
): readonly BuiltInCard[] {
  return cards.filter(
    (card) =>
      (filter.category === undefined || card.category === filter.category) &&
      (filter.length === undefined || card.length === filter.length) &&
      (filter.heartRate !== true || card.heartRate),
  );
}

/** The query keys a filter is written under, in the address. */
const KEYS = { category: 'category', length: 'length', heartRate: 'heart-rate' } as const;

/**
 * A filter from the hash's query — `category=sweet-spot&length=45&heart-rate=yes`.
 *
 * Total: a category the library holds no workout in, a length that is not a
 * choice, anything but `yes`, or no query at all is no filter on that key,
 * never an error — a hand-typed address or an old link lands on a list, not
 * on a failure.
 */
export function builtInFilterFromQuery(query: string | undefined): BuiltInFilter {
  if (query === undefined || query === '') return {};
  const params = new URLSearchParams(query);
  const category = params.get(KEYS.category);
  const length = Number(params.get(KEYS.length) ?? Number.NaN);
  return {
    ...(category !== null && BUILT_IN_CATEGORIES.some((known) => known === category)
      ? { category: category as WorkoutCategory }
      : {}),
    ...(LENGTH_CHOICES.includes(length as LengthChoice) ? { length: length as LengthChoice } : {}),
    ...(params.get(KEYS.heartRate) === 'yes' ? { heartRate: true } : {}),
  };
}

/** A filter as the hash's query, `''` for none. The inverse of {@link builtInFilterFromQuery}. */
export function builtInFilterQuery(filter: BuiltInFilter): string {
  const params = new URLSearchParams();
  if (filter.category !== undefined) params.set(KEYS.category, filter.category);
  if (filter.length !== undefined) params.set(KEYS.length, String(filter.length));
  if (filter.heartRate === true) params.set(KEYS.heartRate, 'yes');
  return params.toString();
}

/**
 * The Workouts address with a filter, and a selection when there is one —
 * `#/workouts?category=tempo` or `#/workouts/selected/built-in%3Atempo-2x20?category=tempo`.
 *
 * The filter rides in the query of EVERY workouts link that should keep it, so
 * choosing a card at two panes leaves the list as filtered beside it, and
 * Back steps to the list as it was.
 */
export function hrefForWorkouts(filter: BuiltInFilter, selection?: string): string {
  const route = routeById('workouts');
  const base = selection === undefined ? hrefFor(route) : hrefForSelection(route, selection);
  const query = builtInFilterQuery(filter);
  return query === '' ? base : `${base}?${query}`;
}
