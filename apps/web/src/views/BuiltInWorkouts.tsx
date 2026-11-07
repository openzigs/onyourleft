// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo, useId, useMemo, type JSX } from 'react';

import type { Workout } from '@onyourleft/domain';

import type { OwnThresholds } from '../analysis/own-thresholds';
import { ZoneKey, zonesPainted } from '../design/ZoneKey';
import { SELECTED_HEADING_ID } from '../shell/ListDetail';
import {
  BUILT_IN_CARDS,
  builtInById,
  BUILT_IN_CATEGORIES,
  CATEGORY_NAMES,
  filterBuiltIns,
  hrefForWorkouts,
  isFiltered,
  LENGTH_CHOICES,
  lengthChoiceText,
  type BuiltInCard,
  type BuiltInFilter,
  type LengthChoice,
} from '../workouts/built-in';
import { WorkoutCardArt } from '../workouts/WorkoutCardArt';
import { TailorBuiltIn } from './TailorBuiltIn';

/**
 * The built-in workouts on the Workouts screen — #2304, under the library epic
 * #2295: every one the app ships, filtered by category, length and whether it
 * holds a heart-rate target.
 *
 * ## Nothing here reads or writes a store
 *
 * The cards are `workouts/built-in.ts` §`BUILT_IN_CARDS`, a constant in the
 * bundle, so this list is the same with no instance, no network and no saved
 * workout (CLAUDE.md §1 invariant a). It is drawn beside the rider's own
 * workouts under its own heading, so nobody wonders whether deleting one of
 * theirs could remove a built-in, and choosing a card saves nothing.
 *
 * ⚠️ **The other half of a two-way choice**, not a list under the rider's own
 * (`workouts/built-in.ts` §`WorkoutsList`): on a phone's one pane the builder
 * follows the list, and a list this long above it put *Save workout* 7,000 px
 * under the fold.
 *
 * ## The filter is the address
 *
 * Every filter is in the hash's query (`#/workouts?category=tempo&length=45`),
 * read by `shell/routes.ts` §`matchHash` into the `filter` this is handed. A
 * change of filter is a navigation, so Back undoes it, a reload keeps it and a
 * shared link shows the same list. A card's link keeps the filter, so choosing
 * one at two panes leaves the list beside it as it was.
 *
 * ## What a card says
 *
 * The length, the category, the shape in words and the hardest target as a
 * percentage of threshold (`workouts/library.ts` says why no watts), with the
 * drawing as decoration and the zones it paints named once over the list
 * (#2039: a zone by number and name, never by colour alone).
 */
export interface BuiltInWorkoutsProps {
  /** The filter in the address. A new object only when the address changes. */
  readonly filter: BuiltInFilter;
  /** The selected workout's id, kept on every link this list draws. */
  readonly selected: string | undefined;
}

/** A filter's change, as the address it navigates to. */
function navigate(filter: BuiltInFilter, selected: string | undefined): void {
  globalThis.location.hash = hrefForWorkouts(filter, selected);
}

/** The hardest target in words, or that there is none. */
function hardestText(card: BuiltInCard): string {
  return card.hardestPercent === undefined
    ? 'No target'
    : `${String(card.hardestPercent)}% of threshold`;
}

/**
 * `memo`, because the builder beside it re-renders the Workouts view on every
 * keystroke, and nothing a keystroke changes reaches this list.
 */
export const BuiltInWorkouts = memo(function BuiltInWorkouts({
  filter,
  selected,
}: BuiltInWorkoutsProps): JSX.Element {
  const captionId = useId();
  const categoryId = useId();
  const lengthId = useId();
  const shown = useMemo(() => filterBuiltIns(BUILT_IN_CARDS, filter), [filter]);
  const zones = useMemo(
    () =>
      [...new Set(shown.flatMap(({ chart }) => zonesPainted(chart.bands)))].sort((a, b) => a - b),
    [shown],
  );
  const filtered = isFiltered(filter);

  return (
    // Under the list pane's own heading, "Built-in workouts" (`WorkoutsView.tsx`).
    <div data-oyl-built-ins="">
      <p>
        Sessions that come with the app, so they work with no connection. Choosing one saves
        nothing.
      </p>
      <form
        aria-label="Filter the built-in workouts"
        className="oyl-filters"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <p>
          <label htmlFor={categoryId}>Category</label>
          <select
            id={categoryId}
            name="category"
            value={filter.category ?? ''}
            onChange={(event) => {
              const chosen = BUILT_IN_CATEGORIES.find(
                (category) => category === event.target.value,
              );
              navigate({ ...filter, category: chosen }, selected);
            }}
          >
            <option value="">All categories</option>
            {BUILT_IN_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_NAMES[category]}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label htmlFor={lengthId}>Length</label>
          <select
            id={lengthId}
            name="length"
            value={filter.length === undefined ? '' : String(filter.length)}
            onChange={(event) => {
              const chosen = LENGTH_CHOICES.find(
                (length: LengthChoice) => String(length) === event.target.value,
              );
              navigate({ ...filter, length: chosen }, selected);
            }}
          >
            <option value="">Any length</option>
            {LENGTH_CHOICES.map((length) => (
              <option key={length} value={String(length)}>
                {lengthChoiceText(length)}
              </option>
            ))}
          </select>
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              name="heart-rate"
              checked={filter.heartRate === true}
              onChange={(event) => {
                navigate({ ...filter, heartRate: event.target.checked }, selected);
              }}
            />
            Has a heart-rate target
          </label>
        </p>
      </form>
      <p className="oyl-muted" id={captionId}>
        {shown.length === BUILT_IN_CARDS.length
          ? `All ${String(BUILT_IN_CARDS.length)} built-in workouts.`
          : `${String(shown.length)} of ${String(BUILT_IN_CARDS.length)} built-in workouts.`}
      </p>
      {filtered ? (
        <p>
          <a href={hrefForWorkouts({}, selected)}>Clear filters</a>
        </p>
      ) : null}
      {shown.length === 0 ? (
        <p>No built-in workout matches these filters.</p>
      ) : (
        <>
          {/* The cards' zones, each by number and name, once for the list. */}
          <ZoneKey zones={zones} />
          <ul className="oyl-pane-list" aria-labelledby={captionId}>
            {shown.map((card) => (
              <li
                key={card.id}
                className="oyl-pane-list__item oyl-shape-card tw:grid tw:grid-cols-1"
                data-oyl-built-in={card.template.id}
              >
                <a
                  className="tw:justify-self-start"
                  href={hrefForWorkouts(filter, card.id)}
                  data-oyl-select={card.id}
                  aria-current={card.id === selected ? 'true' : undefined}
                >
                  {card.name}
                </a>
                <p className="oyl-muted tw:mb-0">
                  {card.duration} · {card.categoryName} · hardest: {hardestText(card)}
                  {card.heartRate ? ' · heart-rate target' : ''}
                </p>
                <p className="tw:mb-0">{card.shape}</p>
                <WorkoutCardArt chart={card.chart} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
});

/**
 * A chosen built-in in the detail pane — #2304, tailored since #2305
 * (`TailorBuiltIn.tsx`). Nothing here reads the store: a built-in is not in
 * it, and an id that names no built-in is "not found", as a saved workout's
 * would be.
 */
export function BuiltInDetail({
  id,
  thresholds,
  onSaveCopy,
}: {
  readonly id: string;
  readonly thresholds: OwnThresholds;
  readonly onSaveCopy: (name: string, workout: Workout) => Promise<string>;
}): JSX.Element {
  const card = builtInById(id);
  if (card === undefined) {
    return (
      <div className="oyl-selected">
        <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
          Workout not found
        </h2>
        <p>No built-in workout has that address. It may have been renamed in a newer version.</p>
      </div>
    );
  }
  // Keyed, so choosing another built-in starts from its own defaults.
  return (
    <TailorBuiltIn key={card.id} card={card} thresholds={thresholds} onSaveCopy={onSaveCopy} />
  );
}
