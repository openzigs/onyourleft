// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a planned route reads — [#72](https://github.com/openzigs/onyourleft/issues/72).
 *
 * Two of #72's criteria are about presentation and both are the same rule from
 * #48's baseline, applied twice:
 *
 * - *"Gradient shading uses a stated scale with a legend, and colour is not the
 *   only channel carrying it."*
 * - *"The profile has a non-visual equivalent — an accessible summary of
 *   distance, ascent, and the climbs."*
 *
 * ⚠️ **So the band a gradient falls in has a NAME, and the name is what the
 * table prints.** The chart may shade by band as well; what it may not do is
 * shade *only*. `AnalysisView.tsx` reached the same conclusion for zones and
 * this follows it rather than inventing a second convention.
 */

import { metres } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatDistance, formatSmallDistance, measurementText } from '../units/format';
import type { DraftLeg, RouteDraft } from './draft';
import type { PlannedElevation } from './elevation';

/**
 * The gradient scale, stated rather than implied.
 *
 * ⚠️ **These are this project's bands and nothing else's.** They are not
 * anybody's climb categories — those are somebody's editorial scheme applied to
 * a whole climb, where this is the grade at a point — and they carry no colour
 * in this file at all, because the name is the channel that has to work.
 * `from` is inclusive and the last band is open-ended.
 */
export const GRADE_BANDS: readonly { readonly from: number; readonly name: string }[] = [
  { from: Number.NEGATIVE_INFINITY, name: 'Descending' },
  { from: -1, name: 'Flat' },
  { from: 1, name: 'Gentle climb' },
  { from: 4, name: 'Climb' },
  { from: 8, name: 'Steep climb' },
  { from: 12, name: 'Very steep climb' },
];

export function bandFor(grade: number): string {
  let name: string | undefined;
  for (const band of GRADE_BANDS) {
    if (grade >= band.from) name = band.name;
  }
  // ⚠️ **Not a default, and the distinction was found by mutation.** The first
  // band opens at negative infinity, so every *finite* grade matches at least
  // one and a seeded starting value would be unreachable code — a line no test
  // can turn red. What does not match any band is `NaN`, which is a bug
  // upstream rather than a gradient, and the honest label for it is neither
  // "Flat" nor "Descending".
  return name ?? UNKNOWN_BAND;
}

/** What a gradient that is not a number is called. See {@link bandFor}. */
export const UNKNOWN_BAND = 'Gradient unknown';

export interface SurfaceSummary {
  readonly pavedMetres: number;
  readonly unpavedMetres: number;
  /** Includes every freehand leg — nobody asked an engine about those. */
  readonly unknownMetres: number;
  /** How many legs are freehand, so the sentence can say why some is unknown. */
  readonly freehandLegs: number;
}

/**
 * How much of the route is on what.
 *
 * ⚠️ **Unknown is its own number and is never folded into paved.** #72: *"a leg
 * with unknown surface is labelled unknown rather than assumed paved. Assuming
 * paved is how a road bike ends up on a gravel track."*
 */
export function surfaceSummary(draft: RouteDraft): SurfaceSummary {
  const summary = { pavedMetres: 0, unpavedMetres: 0, unknownMetres: 0, freehandLegs: 0 };
  for (const leg of draft.legs) {
    if (leg.mode === 'freehand') summary.freehandLegs += 1;
    if (leg.state !== 'routed') continue;
    if (leg.surface === 'paved') summary.pavedMetres += leg.distance;
    else if (leg.surface === 'unpaved') summary.unpavedMetres += leg.distance;
    else summary.unknownMetres += leg.distance;
  }
  return summary;
}

/** One row of the profile's non-visual equivalent. */
export interface ProfileRow {
  /** Where along the route this stretch starts, formatted. */
  readonly from: string;
  readonly to: string;
  readonly band: string;
  /** The steepest grade inside it, as a signed whole percent. */
  readonly steepest: number;
  /** `false` where the dataset had no height for any of it. */
  readonly measured: boolean;
}

/**
 * How many rows the profile table has: **at most 24**.
 *
 * A read budget in the shape `CHART_POINTS` uses. A 200 km route at the 10 m
 * profile grid is 20 000 samples, and a table with 20 000 rows is not a
 * non-visual equivalent of anything — it is the same data with the summarising
 * removed. Twenty-four segments is a screenful a person can actually read
 * through, and each names its steepest grade so a wall inside one is not
 * averaged away.
 */
export const PROFILE_ROWS = 24;

export function profileRows(planned: PlannedElevation, units: UnitSystem): readonly ProfileRow[] {
  const grades = planned.profile.grades;
  if (grades.length === 0) return [];
  const rows: ProfileRow[] = [];
  const perRow = Math.max(1, Math.ceil(grades.length / PROFILE_ROWS));
  const step = planned.profile.resolution;
  for (let start = 0; start < grades.length; start += perRow) {
    const slice = grades.slice(start, start + perRow);
    const steepest = slice.reduce(
      (worst, grade) => (Math.abs(grade) > Math.abs(worst) ? grade : worst),
      slice[0] ?? 0,
    );
    const from = start * step;
    const to = Math.min((start + slice.length) * step, planned.profile.totalDistance);
    rows.push({
      from: formatDistance(metres(from), units).value,
      to: formatDistance(metres(to), units).value,
      band: bandFor(steepest),
      steepest: Math.round(steepest),
      measured: !overlapsGap(planned, from, to),
    });
  }
  return rows;
}

/**
 * The sentence a screen reader hears instead of looking at the chart.
 *
 * ⚠️ **It names the dataset**, which is not decoration: ADR 0010 D-5's
 * Copernicus terms require the notice to travel with adapted data, and #72
 * requires the source with the route. A summary that said "1,240 m of climbing"
 * and nothing else would be the number without the thing that makes it
 * comparable.
 */
export function elevationSentence(planned: PlannedElevation, units: UnitSystem): string {
  // Every quantity in this sentence goes through `units/format.ts`, the
  // dataset's own grid resolution included: a rider reading in feet reading
  // "at 30 m resolution" is the half-converted screen #238 is about, in a
  // sentence rather than on a tile.
  const distance = measurementText(formatDistance(planned.profile.totalDistance, units));
  const ascent = measurementText(formatSmallDistance(planned.profile.totalAscent, units));
  const descent = measurementText(formatSmallDistance(planned.profile.totalDescent, units));
  const resolution = measurementText(formatSmallDistance(planned.dataset.resolution, units));
  const interval = measurementText(formatSmallDistance(planned.interval, units));
  const base = `${distance}, climbing ${ascent} and descending ${descent}, from ${planned.dataset.name} at ${resolution} resolution, sampled every ${interval}.`;
  if (planned.coverage.complete) return base;
  const missing = measurementText(formatDistance(planned.coverage.missing, units));
  // ⚠️ "at least" rather than a figure presented as final. The total was
  // computed across ground the dataset had no height for, and #72 requires the
  // profile to report incomplete rather than to sum silently.
  return `${base} The elevation dataset has no height for ${missing} of this route, so the climbing figure is at least ${ascent} rather than a measurement.`;
}

/** What a rider is told about a leg with no geometry. Plural-aware, because one is common. */
export function unresolvedSentence(legs: readonly DraftLeg[]): string | undefined {
  const failed = legs.filter((leg) => leg.state === 'failed').length;
  const pending = legs.filter((leg) => leg.state === 'pending').length;
  if (failed === 0 && pending === 0) return undefined;
  const parts: string[] = [];
  if (failed > 0)
    parts.push(`${String(failed)} ${failed === 1 ? 'leg has' : 'legs have'} no route`);
  if (pending > 0)
    parts.push(`${String(pending)} ${pending === 1 ? 'is' : 'are'} still being routed`);
  return `${parts.join(' and ')}. Distance and climbing cover the rest of the route only.`;
}

function overlapsGap(planned: PlannedElevation, from: number, to: number): boolean {
  return planned.coverage.gaps.some((gap) => gap.from < to && gap.to > from);
}
