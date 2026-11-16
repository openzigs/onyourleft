// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1633's published counters: the runs of each urban class along a route,
 * read off the urban map a ride's plans were handed. Shared by the corridor
 * page (`corridor-harness.ts`, #1633) and, since #1638, the owner's realistic
 * page (`realistic-harness.ts`), whose `town=city` publishes the runs of the
 * city it rides.
 *
 * A run is an urban class and its metres, and nothing else: no coordinate and
 * no place is formatted here.
 */

import { URBAN_WINDOW_METRES, type UrbanClass, type UrbanClassMap } from '../src/game/urban-class';

/** One run of an urban class along a route — #1633. */
export interface UrbanRun {
  readonly urban: UrbanClass;
  readonly metres: number;
}

/** Every run of `map` along a route of `total` metres, window by window, read through `classAt`. */
export function urbanRunsOf(map: UrbanClassMap, total: number): readonly UrbanRun[] {
  const runs: { urban: UrbanClass; metres: number }[] = [];
  for (let start = 0; start < total; start += URBAN_WINDOW_METRES) {
    const urban = map.classAt(start + Math.min(URBAN_WINDOW_METRES, total - start) / 2);
    const metres = Math.min(URBAN_WINDOW_METRES, total - start);
    const last = runs[runs.length - 1];
    if (last?.urban === urban) last.metres += metres;
    else runs.push({ urban, metres });
  }
  return runs;
}

/**
 * The urban class of the run `runs` holds at `metres` along the route — #1638,
 * for a spec reading a hold's class off the published runs — or `undefined`
 * past their end.
 */
export function classAlong(runs: readonly UrbanRun[], metres: number): UrbanClass | undefined {
  let from = 0;
  for (const run of runs) {
    if (metres < from + run.metres) return run.urban;
    from += run.metres;
  }
  return undefined;
}
