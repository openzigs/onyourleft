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
 *
 * ## Readings, two to a row on a phone and one row on a tablet (#1012)
 *
 * The number is `design/Reading.tsx` at `size="metric"` — large tabular
 * numerals and a small unit beside them, the one component every number in
 * the app is drawn with — and the unit is part of the reading rather than a
 * note under it. A channel with no number keeps its em dash as the reading and
 * says why on the line under it, as before. The grid is `theme.css`
 * §`.oyl-metric-grid--live`: one column on the narrowest screens, two on a
 * phone, all four in a row once the Live group is wide enough, which on a
 * landscape tablet it is.
 *
 * ## Which readings, and the zoom (#1433)
 *
 * Which of the four are drawn, and in which order, is the rider's
 * (`reading-choice.ts`, ranked on Settings); this component draws what it is
 * handed, in that order. With the Ride screen's *Zoom* on it is handed the top
 * two and draws them at `--oyl-font-size-zoom`, held to
 * {@link ZOOMED_DIGIT_FLOOR_PIXELS} in the browser gate.
 */

import type { JSX } from 'react';

import type { MetresPerSecond } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { Reading } from '../design/Reading';
import { VisuallyHidden } from '../design/VisuallyHidden';
import { useUnits } from '../units/context';
import { formatSpeed, speedUnit } from '../units/format';

import type { RideMetric } from './controller';
import type { MetricState, RideMetricId } from './metrics';

/**
 * The smallest a primary metric may be rendered, in `rem`.
 *
 * 3.5 rem is 56 px at the default root size. At two metres that is roughly the
 * angular size of 16 px text at arm's length, which is the comparison that
 * makes the number a decision rather than a taste.
 *
 * @test-facing a floor `a11y/ride-legibility.a11y.test.ts` holds the rendered sizes
 * to; the sizes are design tokens and do not read it.
 */
export const MINIMUM_PRIMARY_METRIC_REM = 3.5;

/**
 * How tall a digit of a ZOOMED reading must be drawn, in CSS px — #1433.
 *
 * The target is ISO 15008's recommended character height for a display read
 * in a glance — 20 minutes of arc, cited through NHTSA's human-factors design
 * guidance (report 812 360), which also bounds a glance at two seconds — at
 * #49's two metres: 11.6 mm. A CSS pixel is turned into millimetres at 160 to
 * the inch, Android's baseline density and the largest count per inch of the
 * devices this screen is read on, so the physical digit is that size or
 * larger. At arm's length (about 0.75 m) the same digit subtends 2.7 times the
 * target.
 *
 * @test-facing the floor `rideview.browser.spec.ts` §"#1433" measures the
 * rendered digit against; the size is `--oyl-font-size-zoom` and does not read it.
 */
export const ZOOMED_DIGIT_FLOOR_PIXELS = digitPixels(20, 2000, 160);

/** A character `arcMinutes` tall at `distanceMm`, in CSS px at `pixelsPerInch`. */
function digitPixels(arcMinutes: number, distanceMm: number, pixelsPerInch: number): number {
  const radians = (arcMinutes / 60) * (Math.PI / 180);
  const millimetres = 2 * distanceMm * Math.tan(radians / 2);
  return (millimetres / 25.4) * pixelsPerInch;
}

interface MetricPresentation {
  readonly label: string;
  readonly unit: string;
  /** How the live value is turned into digits. */
  readonly format: (value: number) => string;
}

/**
 * How each of the four reads, in the units this rider has chosen.
 *
 * ⚠️ **A function of the preference rather than a module constant, and the
 * change is the point of #238.** A constant is precisely the mechanism that
 * cannot carry a setting: it is evaluated once, at import, before anything
 * knows whose screen this is. Three of the four are the same in both systems —
 * a watt, a revolution and a beat are not units a rider chooses — and the
 * fourth goes through `units/format.ts`, which produces the digits and the
 * label together so this file cannot pair one system's number with the other's
 * unit.
 *
 * The cast is the honest edge of the branded type rather than a hole in it:
 * `MetricState`'s `live` variant carries a plain `number` because all four
 * channels share it, and this is the single place a speed re-enters the typed
 * world. The value came off `metricStateFor`, which copies it from a reading
 * the transport already validated.
 */
export function presentationFor(
  units: UnitSystem,
): Readonly<Record<RideMetricId, MetricPresentation>> {
  return {
    power: { label: 'Power', unit: 'W', format: (value) => String(Math.round(value)) },
    cadence: { label: 'Cadence', unit: 'rpm', format: (value) => String(Math.round(value)) },
    heartRate: { label: 'Heart rate', unit: 'bpm', format: (value) => String(Math.round(value)) },
    speed: {
      label: 'Speed',
      unit: speedUnit(units),
      format: (value) => formatSpeed(value as MetresPerSecond, units).value,
    },
  };
}

/** The em dash a channel shows when there is no number it may show. */
const NO_VALUE = '—';

/**
 * The one sentence a screen reader announces for a cell.
 *
 * ⚠️ It is rendered as **visually hidden text**, not as an `aria-label` on the
 * value. `aria-label` is *prohibited* on an element with no role — a bare
 * `span` maps to `role=generic` — and browsers and screen readers are entitled
 * to ignore it, which several do. So the cell said "Heart rate: dash" in
 * exactly the case #49's third criterion is about. The visible spans are
 * `aria-hidden` so the sentence is heard once rather than beside the fragments
 * it is made of.
 */
export function metricSentence(label: string, text: { value: string; note: string }): string {
  return `${label}: ${text.value === NO_VALUE ? text.note : `${text.value} ${text.note}`}`;
}

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
  /**
   * #1433: the Ride screen's zoom is on — `metrics` is already the rider's top
   * two (`reading-choice.ts` §`shownReadings`), and they are drawn at
   * `--oyl-font-size-zoom` rather than the metric size.
   */
  readonly zoomed?: boolean;
}

export function MetricGrid({ metrics, zoomed = false }: MetricGridProps): JSX.Element {
  const presentations = presentationFor(useUnits());
  return (
    <ul
      className={`oyl-metric-grid oyl-metric-grid--live${zoomed ? ' oyl-metric-grid--zoomed' : ''}`}
      aria-label="Live metrics"
    >
      {metrics.map((metric) => {
        const presentation = presentations[metric.id];
        const text = metricText(metric.state, presentation);
        return (
          <li key={metric.id} className={`oyl-metric oyl-metric--${metric.state.kind}`}>
            {/*
              A `dt`/`dd` pair would be more semantic and is worse here: the
              audit requires a list's children to be list items, and a
              definition list inside a grid of four is markup a screen reader
              reads as a glossary.

              The spans below are what the eye reads and are hidden from
              assistive technology; `VisuallyHidden` carries the same content as
              one sentence for the ear. Split that way because the em dash is
              read as "dash" or as nothing at all, and because a `span` may not
              carry an `aria-label` — see `metricSentence`. None of the hidden
              spans is focusable, so no keyboard focus lands in an `aria-hidden`
              subtree; `audit.ts` fails the build if that ever changes.
            */}
            <span className="oyl-metric__label" aria-hidden="true">
              {presentation.label}
            </span>
            <span className="oyl-metric__reading" aria-hidden="true">
              <Reading
                value={text.value}
                unit={metric.state.kind === 'live' ? presentation.unit : undefined}
                size="metric"
              />
            </span>
            {metric.state.kind === 'live' ? null : (
              <span className="oyl-metric__note" aria-hidden="true">
                {text.note}
              </span>
            )}
            <VisuallyHidden>{metricSentence(presentation.label, text)}</VisuallyHidden>
          </li>
        );
      })}
    </ul>
  );
}
