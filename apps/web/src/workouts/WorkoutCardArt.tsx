// SPDX-License-Identifier: AGPL-3.0-or-later

import { memo, type JSX } from 'react';

import type { BlockChartPaths } from './block-chart';
import { BlockChartDrawing } from './BlockChart';

/**
 * A card's drawing — #941: the workout as the builder's block chart draws it
 * (`workouts/BlockChart.tsx`), each block in its zone's colour, at the card's
 * size. Decoration: no number reaches it, and the card's words carry the
 * workout. Its zones are named once, by the list's key, not on each card.
 * Drawn on a saved workout's card and, since #2304, on a built-in's
 * (`views/BuiltInWorkouts.tsx`), which is why it is a module of its own.
 *
 * `memo`, because the paths are the ones the list read set into state, and
 * the builder beside the list re-renders the Workouts view on every keystroke:
 * without it every card's chart (up to `WORKOUT_LIST_LIMIT` of them) is drawn
 * again for a character typed into a name.
 */
export const WorkoutCardArt = memo(function WorkoutCardArt({
  chart,
}: {
  readonly chart: BlockChartPaths;
}): JSX.Element {
  return (
    <div className="oyl-shape-card__art tw:h-(--oyl-shape-card-art-height)">
      <BlockChartDrawing paths={chart} className="oyl-block-chart--card" />
    </div>
  );
});
