// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fitness and fatigue over a history, as two SVG lines (#77).
 *
 * Hand-drawn for `detail/TraceChart.tsx`'s reasons: a charting library brings a
 * licence to check against `apps/`'s AGPL-3.0 boundary, a bundle several times
 * this whole client, and a renderer that is one unlabelled blob to a screen
 * reader — so #48's sixth criterion would need the chart described in words
 * anyway, and the library would be paying for the half already done.
 *
 * ⚠️ **Colour is not the only carrier**, the rule `views/AnalysisView.tsx`
 * states for the zone table. The two lines differ by **dash pattern** as well
 * as tone, each is labelled at its right-hand end, and the numbers themselves
 * are in the readings above and the table beside. Nothing here is knowable only
 * by hue.
 *
 * The default export is for `React.lazy` — `design/ChartSlot.tsx` records why a
 * chart imported eagerly would take the page down before the render boundary
 * could catch it.
 */

import type { JSX } from 'react';

import type { FitnessPoint } from '@onyourleft/domain';

/** The drawing's own coordinate space. Stretched to the container by CSS. */
const WIDTH = 720;
const HEIGHT = 200;
const PADDING = 8;

export interface FitnessChartProps {
  readonly points: readonly FitnessPoint[];
}

export function FitnessChart({ points }: FitnessChartProps): JSX.Element {
  // The two lines share a scale, because their difference is the third number
  // a reader takes from this chart. Scaling them independently would make a
  // crossing point meaningless.
  const peak = Math.max(1, ...points.map((point) => Math.max(point.base, point.recent)));
  const step = points.length > 1 ? (WIDTH - PADDING * 2) / (points.length - 1) : 0;

  const path = (pick: (point: FitnessPoint) => number): string =>
    points
      .map((point, index) => {
        const x = PADDING + index * step;
        const y = HEIGHT - PADDING - (pick(point) / peak) * (HEIGHT - PADDING * 2);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');

  return (
    <svg
      className="oyl-fitness-chart"
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      preserveAspectRatio="none"
      role="presentation"
    >
      {/*
        `role="presentation"`, deliberately. The equivalent is not this drawing
        with a label bolted on — it is the readings and the table beside it,
        which #77's sixth criterion asks for by name. Announcing an unreadable
        path as an image would add noise, not access.
      */}
      <path className="oyl-fitness-chart__base" d={path((point) => point.base)} />
      <path className="oyl-fitness-chart__recent" d={path((point) => point.recent)} />
    </svg>
  );
}

export default FitnessChart;
