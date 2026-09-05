// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The four big numbers, and what each says when it has nothing to say.
 *
 * ## Legibility is an acceptance criterion, not a preference
 *
 * #49: *"the primary metrics are legible at a stated minimum size — this screen
 * is read from two metres away."* The stated size is
 * {@link MINIMUM_PRIMARY_METRIC_REM} and it is enforced twice: the value here
 * carries `--oyl-font-size-metric`, and `ride-legibility.a11y.test.ts` parses
 * `theme.css` and fails if that custom property drops below it. A number in a
 * component file that nothing checks against the stylesheet is a number the
 * browser never paints.
 *
 * ## The unavailable states, and why none of them is a number
 *
 * A stale channel renders an em dash and how long it has been silent. It does
 * **not** render the last value greyed out, and `metrics.ts` makes that
 * impossible rather than merely discouraged — the `stale` variant carries no
 * value to render. From two metres a greyed number is a number.
 */

import type { JSX } from 'react';

import { metresPerSecondToKilometresPerHour, type MetresPerSecond } from '@onyourleft/domain';

import type { RideMetric } from './controller';
import type { MetricState, RideMetricId } from './metrics';

/**
 * The smallest a primary metric may be rendered, in `rem`.
 *
 * 3.5 rem is 56 px at the default root size. At two metres that is roughly the
 * angular size of 16 px text at arm's length, which is the comparison that
 * makes the number a decision rather than a taste.
 */
export const MINIMUM_PRIMARY_METRIC_REM = 3.5;

interface MetricPresentation {
  readonly label: string;
  readonly unit: string;
  /** How the live value is turned into digits. */
  readonly format: (value: number) => string;
}

const PRESENTATION: Readonly<Record<RideMetricId, MetricPresentation>> = {
  power: { label: 'Power', unit: 'W', format: (value) => String(Math.round(value)) },
  cadence: { label: 'Cadence', unit: 'rpm', format: (value) => String(Math.round(value)) },
  heartRate: { label: 'Heart rate', unit: 'bpm', format: (value) => String(Math.round(value)) },
  speed: {
    label: 'Speed',
    unit: 'km/h',
    // Through `@onyourleft/domain`, because every conversion in this program
    // does: the canonical unit is metres per second and a `* 3.6` here would be
    // a second place for the device and a Phase 3 instance to disagree.
    format: (value) => metresPerSecondToKilometresPerHour(value as MetresPerSecond).toFixed(1),
  },
};

/** The em dash a channel shows when there is no number it may show. */
const NO_VALUE = '—';

/** What the value line reads, and what is announced alongside it. */
export function metricText(
  state: MetricState,
  presentation: MetricPresentation,
): {
  readonly value: string;
  readonly note: string;
} {
  switch (state.kind) {
    case 'live':
      return { value: presentation.format(state.value), note: presentation.unit };
    case 'waiting':
      return { value: NO_VALUE, note: 'waiting for the first reading' };
    case 'stale':
      return {
        value: NO_VALUE,
        note: `unavailable — no reading for ${String(state.silentForSeconds)} s`,
      };
    case 'unpaired':
      return { value: NO_VALUE, note: 'no sensor paired' };
  }
}

export interface MetricGridProps {
  readonly metrics: readonly RideMetric[];
}

export function MetricGrid({ metrics }: MetricGridProps): JSX.Element {
  return (
    <ul className="oyl-metric-grid" aria-label="Live metrics">
      {metrics.map((metric) => {
        const presentation = PRESENTATION[metric.id];
        const text = metricText(metric.state, presentation);
        return (
          <li key={metric.id} className={`oyl-metric oyl-metric--${metric.state.kind}`}>
            {/*
              A `dt`/`dd` pair would be more semantic and is worse here: the
              audit requires a list's children to be list items, and a
              definition list inside a grid of four is markup a screen reader
              reads as a glossary. The label is a plain span, and the whole
              cell carries one accessible name through `aria-label` below.
            */}
            <span className="oyl-metric__label">{presentation.label}</span>
            <span
              className="oyl-metric__value"
              // The number and its state, as one string, because a reader
              // moving through the grid hears the cell and not the CSS class.
              // Without this a stale channel announces "dash".
              aria-label={`${presentation.label}: ${text.value === NO_VALUE ? text.note : `${text.value} ${text.note}`}`}
            >
              {text.value}
            </span>
            <span className="oyl-metric__note">{text.note}</span>
          </li>
        );
      })}
    </ul>
  );
}
