// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo, type JSX } from 'react';

import { BAND_TOKENS, type ColourToken } from '../design/tokens';
import { ZoneKey, zonesPainted } from '../design/ZoneKey';
import {
  blockChartPaths,
  CHART_HEIGHT,
  CHART_WIDTH,
  type BlockChartPaths,
  type BlockChartSegment,
} from './block-chart';

/**
 * The class each part of the block chart is painted by, and the token that
 * class paints with — #1043. `theme.css` §"THE WORKOUT BLOCK CHART" is the
 * same table as rules; `BlockChart.test.tsx` holds the two together in both
 * directions, so no part of the chart names a colour of its own.
 */
export const BLOCK_CHART_PAINTS: readonly {
  readonly className: string;
  readonly token: ColourToken;
  readonly property: 'fill' | 'stroke';
}[] = [
  ...BAND_TOKENS.map((token) => ({
    className: bandClass(token),
    token,
    property: 'fill' as const,
  })),
  { className: 'oyl-block-chart__free-ride', token: 'inkMuted', property: 'stroke' },
  { className: 'oyl-block-chart__rule', token: 'ink', property: 'stroke' },
];

/** `bandVo2` → `oyl-block-chart__band-vo2`. */
function bandClass(token: string): string {
  return `oyl-block-chart__${token.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

/**
 * A workout drawn as blocks — #1043: time across, share of threshold up, each
 * block filled by its intensity band, a ramp as a slope, a free ride hatched,
 * and a dashed rule at threshold. `block-chart.ts` is the geometry and says
 * why each of those is drawn the way it is.
 *
 * ⚠️ **`aria-hidden`, and carries no text.** The workout is in words beside it
 * — every block's share in the builder's list, the shape sentence on a saved
 * workout — and the chart repeats them; it does not replace them
 * (`library.ts` §`WorkoutRow.shape`). An empty timeline draws nothing at all.
 *
 * ⚠️ **Every zone it paints is named beside it** (#2039): a {@link ZoneKey}
 * follows the drawing, listing each zone present by its number and name, so
 * no zone is told by its colour alone (SC 1.4.1).
 */
export function BlockChart({
  segments,
}: {
  readonly segments: readonly BlockChartSegment[];
}): JSX.Element | null {
  const paths = useMemo(() => blockChartPaths(segments), [segments]);
  if (paths.rule === '') {
    return null;
  }
  return (
    <>
      <BlockChartDrawing paths={paths} />
      <ZoneKey zones={zonesPainted(paths.bands)} />
    </>
  );
}

/**
 * The block chart's drawing alone, from paths already computed — the saved
 * workout cards on Workouts draw it at their own size (the owner's ruling of
 * 2026-11-04 on #2125: zone colours on the card, not one accent).
 *
 * ⚠️ **It names no zone, so whatever renders it must.** {@link BlockChart} puts
 * a {@link ZoneKey} after it; the Workouts list puts ONE key over its cards,
 * naming every zone any card paints (`views/WorkoutsView.tsx`), and
 * `views/shape-cards.test.tsx` holds that.
 */
export function BlockChartDrawing({
  paths,
  className,
}: {
  readonly paths: BlockChartPaths;
  /** A modifier beside `oyl-block-chart`, such as the card's size. */
  readonly className?: string;
}): JSX.Element | null {
  if (paths.rule === '') {
    return null;
  }
  return (
    <svg
      aria-hidden="true"
      className={className === undefined ? 'oyl-block-chart' : `oyl-block-chart ${className}`}
      data-oyl-block-chart=""
      focusable="false"
      preserveAspectRatio="none"
      viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`}
    >
      {paths.bands.map((d, band) =>
        d === '' ? null : (
          // A band's index is its identity: there are exactly seven.
          <path key={band} className={bandClass(BAND_TOKENS[band] ?? 'bandRecovery')} d={d} />
        ),
      )}
      {paths.freeRide === '' ? null : (
        <path className="oyl-block-chart__free-ride" d={paths.freeRide} />
      )}
      <path className="oyl-block-chart__rule" d={paths.rule} />
    </svg>
  );
}
