// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride HUD, for a phone clamped to a handlebar and read at arm's length.
 *
 * ## What the use context forces, and what it forbids
 *
 * #94 is explicit that this is not a shrunk desktop UI, and every decision below
 * follows from the context rather than from taste:
 *
 * - **Read at ~60 cm, in motion, out of breath, possibly sweating on the
 *   screen.** So: large type, high contrast, no hover state anywhere, and no
 *   information that has to be parsed rather than glanced at.
 * - **Found by position, not by reading.** `hudReadings` returns a fixed-length
 *   list in a fixed order, and a field with nothing to show is still rendered
 *   with a dash. A field that vanished would move every field after it, which is
 *   how a rider ends up reading labels at threshold.
 * - **Sweat and gloves break touch.** The two mid-ride controls are sized by
 *   {@link CONTROL_MINIMUM_PIXELS}, well above the WCAG 2.2 minimum, because the
 *   minimum assumes a dry fingertip and a stationary user.
 *
 * ⚠️ **It is DOM over the canvas, not drawn into it**, and that is load-bearing
 * three times over. The text stays vector-sharp when `quality.ts` reduces the
 * world's render scale — which is why reducing resolution is the *first* thing
 * that policy gives up. The a11y gate can audit it, so #94's contrast criterion
 * is checkable at all. And a screen reader can read it, which nothing drawn into
 * a canvas can offer.
 */

import type { JSX } from 'react';

import { useUnits } from '../../units/context';

import { NO_READING, hudReadings, profilePosition, type HudInput } from './fields';

/**
 * The smallest a mid-ride control may be, in CSS pixels.
 *
 * WCAG 2.2 SC 2.5.8 asks for 24×24 and SC 2.5.5 (AAA) for 44×44. This is larger
 * than both, because both are written for someone sitting still with a dry
 * finger — #94's context is a gloved, sweating rider at threshold on a moving
 * bike, and a target that is merely conformant is not a target they can hit.
 */
export const CONTROL_MINIMUM_PIXELS = 72;

/**
 * What the HUD needs beyond its readings.
 *
 * ⚠️ `units` is **omitted** from {@link HudInput} rather than inherited: the
 * component reads the preference from `units/context.tsx` and the pure
 * function takes it as a parameter, so there is exactly one way in on each
 * side of the seam. A prop as well would be a second source for the same
 * answer, and the two could disagree on the screen a rider stares at for an
 * hour — which is the failure #238 is about.
 */
export interface HudPanelProps extends Omit<HudInput, 'units'> {
  /** Pauses the ride. Large target — see {@link CONTROL_MINIMUM_PIXELS}. */
  readonly onPause: () => void;
  /** Ends it. Same. */
  readonly onEnd: () => void;
  /** Whether the ride is currently paused, so the control says which it does. */
  readonly paused: boolean;
}

export function HudPanel(props: HudPanelProps): JSX.Element {
  const units = useUnits();
  const readings = hudReadings({ ...props, units });
  const position = profilePosition(props.state, props.profile);

  return (
    <section className="oyl-hud" aria-label="Ride metrics">
      {/*
        A description list, because that is what these are: a label and its
        value, seven times. It was an `ol` of `span`s first, which needed
        `aria-labelledby` to associate the two — and the audit rejected it,
        correctly: ARIA prohibits naming an element with no role, so the
        association was decorative and a screen reader would have read seven
        orphaned numbers. `dt`/`dd` carries the same association in HTML, with
        no ARIA at all.
      */}
      <dl className="oyl-hud__fields">
        {readings.map((reading) => (
          <div
            key={reading.key}
            className={reading.stale ? 'oyl-hud__field oyl-hud__field--stale' : 'oyl-hud__field'}
          >
            <dt className="oyl-hud__label">{reading.label}</dt>
            <dd className="oyl-hud__value">
              {reading.value}
              {reading.unit === '' ? null : <span className="oyl-hud__unit"> {reading.unit}</span>}
              {reading.detail === undefined ? null : (
                // ⚠️ Inside the `dd`, not beside it. A screen reader announces
                // one definition per term, so a phrase in a sibling element
                // would be read as loose text after the reading rather than as
                // part of it — and #255's first defect is precisely that the
                // number and the words describing it were heard as one thing
                // while meaning another. `fields.ts` §`HudReading.detail` says
                // why the phrase is not folded into the value instead.
                <span className="oyl-hud__detail"> {reading.detail}</span>
              )}
              {reading.stale ? (
                // ⚠️ Words, not only a tint. #94's second criterion is that a
                // dropped sensor be distinguishable from a zero — and a rider
                // who cannot see the tint, or is looking at a screen washed out
                // by sunlight, gets the distinction from this line and from the
                // dash beside it. The colour is the third signal, not the only
                // one.
                <span className="oyl-hud__stale"> Sensor lost</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <ElevationStrip position={position} profile={props.profile} />

      <div className="oyl-hud__controls">
        <button
          type="button"
          className="oyl-hud__control"
          onClick={props.onPause}
          style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
        >
          {props.paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className="oyl-hud__control"
          onClick={props.onEnd}
          style={{ minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS }}
        >
          End ride
        </button>
      </div>
    </section>
  );
}

/**
 * The elevation profile with "you are here".
 *
 * #94 calls this *"the single most motivating element — it shows what is coming
 * and what is done"*. It is an SVG rather than a canvas for the same reason the
 * rest of the HUD is DOM, and it is drawn from the profile's own grid so the
 * shape a rider sees is the shape the trainer is about to make them ride.
 *
 * ⚠️ The marker's position comes from {@link profilePosition}, which reads the
 * ride state's distance and nothing else. #94's third criterion asks for exactly
 * that — *"a test asserts the marker tracks the physics position rather than a
 * separately-computed value that can drift"* — and the way to satisfy it is to
 * leave no second value in existence to drift from.
 */
function ElevationStrip(props: {
  readonly position: number;
  readonly profile: HudInput['profile'];
}): JSX.Element {
  const elevations = props.profile.elevations;
  const points = strip(elevations);
  const percent = props.position * 100;
  return (
    <div className="oyl-hud__profile">
      <svg
        className="oyl-hud__profile-svg"
        viewBox="0 0 100 24"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Route profile, ${String(Math.round(percent))} per cent complete`}
      >
        <polyline className="oyl-hud__profile-line" points={points} />
        <line
          className="oyl-hud__profile-here"
          x1={percent}
          y1={0}
          x2={percent}
          y2={24}
          data-testid="oyl-hud-position"
          data-position={String(props.position)}
        />
      </svg>
      {/*
        The non-visual equivalent, which the rest of this app provides for every
        chart (#77's, #50's). A profile is a picture of a number, and the number
        is available.
      */}
      <p className="oyl-hud__profile-text">{Math.round(percent)}% complete</p>
    </div>
  );
}

/** The profile as SVG polyline points, normalised into the 100×24 viewBox. */
function strip(elevations: readonly number[]): string {
  if (elevations.length === 0) {
    return '';
  }
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const elevation of elevations) {
    lowest = Math.min(lowest, elevation);
    highest = Math.max(highest, elevation);
  }
  // A flat route has no range to normalise against; drawing it down the middle
  // is honest and dividing by zero is not.
  const range = highest - lowest;
  const step = elevations.length > 1 ? 100 / (elevations.length - 1) : 0;
  const parts: string[] = [];
  for (let index = 0; index < elevations.length; index += 1) {
    const height = range > 0 ? ((elevations[index] as number) - lowest) / range : 0.5;
    parts.push(`${(index * step).toFixed(2)},${(24 - height * 24).toFixed(2)}`);
  }
  return parts.join(' ');
}

export { NO_READING };
