// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { downsample, traceExtent, traceSegments } from '../../detail/series';
import { paint } from './paint';
import { coordinate, IllustrationSvg, type IllustrationProps } from './svg';

/**
 * How many columns a profile is reduced to before it is drawn — #938.
 *
 * A card is a few hundred pixels wide, so 120 columns is one every two or three
 * pixels, and the climb a rider recognises is still there. It is the bound
 * `detail/series.ts` §`CHART_POINTS` and `game/hud/plan.ts` §`PLAN_MAX_POINTS`
 * set for the same reason: a 200 km route on a 10 m grid is 20 000 samples,
 * and every one of them reaching the DOM costs a list of cards a frame.
 */
export const PROFILE_SHAPE_COLUMNS = 120;

/**
 * The most points the drawing can hold, whatever it is handed: each column's
 * point, plus four corners for each unbroken run — two at the ground and two
 * at its ends. Two runs are always parted by at least one empty column, so
 * there are never more than half as many runs as columns, rounded up: 120
 * points and 60 runs' corners. A test feeds it 100 000 samples with a gap in
 * every other column and counts.
 */
export const PROFILE_SHAPE_MAX_POINTS =
  PROFILE_SHAPE_COLUMNS + 4 * Math.ceil(PROFILE_SHAPE_COLUMNS / 2);

/** The drawing's height, in its own units; the width is its column count. */
const HEIGHT = 100;
/** How much of the height the lowest point keeps, so a valley is still ground. */
const FLOOR_SHARE = 0.15;
/** How much is left above the highest point. */
const HEADROOM_SHARE = 0.1;

/**
 * Anything with an elevation per sample. A `RouteProfile` is one as it is
 * (#89's grid, no gaps), and so is a ride's altitude stream, which can have
 * them — `undefined` is a gap, as it is everywhere in `detail/series.ts`.
 */
export interface ProfileInput {
  readonly elevations: readonly (number | undefined)[];
}

/**
 * The silhouette's paths: one closed outline per unbroken run.
 *
 * ⚠️ **A gap is a gap.** `traceSegments` ends a run at a missing sample, and
 * each run is closed down to the ground on its own, so a stretch with no
 * elevation is drawn as no ground at all rather than as a straight slope
 * between the two sides — `detail/series.ts` §`traceSegments`' rule, for the
 * same reason: a line across a gap reads as a real, steady hill. Each column
 * is one unit wide and a run covers its columns edge to edge, so a reading
 * alone between two gaps is still a sliver rather than nothing.
 */
function profileOutlines(input: ProfileInput): readonly string[] {
  const columns = downsample(input.elevations, PROFILE_SHAPE_COLUMNS);
  const extent = traceExtent(columns);
  if (extent === undefined) {
    return [];
  }
  const span = extent.high - extent.low;
  const height = (value: number): number => {
    // A level route is level, drawn at half height rather than divided by nought.
    const share = span === 0 ? 0.5 : (value - extent.low) / span;
    return HEIGHT - HEIGHT * (FLOOR_SHARE + share * (1 - FLOOR_SHARE - HEADROOM_SHARE));
  };
  return traceSegments(columns).map(({ from, values }) => {
    const ground = coordinate(HEIGHT);
    const first = values[0] ?? 0;
    const last = values[values.length - 1] ?? 0;
    const points = [
      `${coordinate(from)} ${ground}`,
      `${coordinate(from)} ${coordinate(height(first))}`,
      ...values.map(
        (value, index) => `${coordinate(from + index + 0.5)} ${coordinate(height(value))}`,
      ),
      `${coordinate(from + values.length)} ${coordinate(height(last))}`,
      `${coordinate(from + values.length)} ${ground}`,
    ];
    return `M${points.join(' L')} Z`;
  });
}

/**
 * A route's elevation, as a filled hill — #938.
 *
 * Relative: the highest point is near the top and the lowest near the bottom
 * whatever the metres, so it says nothing a number would. The route's climb is
 * written beside it in words (epic #935, principle 1). An input with no
 * elevation at all draws nothing — no flat line, which would claim a level
 * road nobody measured.
 */
export function ProfileShape({
  className,
  profile,
}: IllustrationProps & { readonly profile: ProfileInput }): JSX.Element {
  const outlines = profileOutlines(profile);
  const width = Math.min(PROFILE_SHAPE_COLUMNS, Math.max(1, profile.elevations.length));
  return (
    <IllustrationSvg
      aspect="none"
      className={className}
      viewBox={`0 0 ${String(width)} ${String(HEIGHT)}`}
    >
      {outlines.map((outline, index) => (
        // A run's position in the list is its identity: the list is rebuilt whole.
        <path key={index} className={paint('hillNear')} d={outline} />
      ))}
    </IllustrationSvg>
  );
}
