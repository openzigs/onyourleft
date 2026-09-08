// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the ride HUD shows, as data — #94, minus its markup.
 *
 * ## The one rule this file exists to enforce
 *
 * #94's second acceptance criterion:
 *
 * > *"**A dropped sensor is visually distinct from a zero reading.** A test
 * > drives the HUD with (a) connected-and-zero-power and (b) disconnected, and
 * > asserts the two render differently. This names the failure being prevented:
 * > a rider who cannot distinguish these stops trusting the app."*
 *
 * A rider seeing `0 W` has to know whether they stopped pedalling or the trainer
 * dropped, because those are opposite situations. So a stale reading here
 * renders as {@link NO_READING} — a dash — and **never as a number**. The tint is
 * secondary and deliberately so: a rider with a colour-vision deficiency, or one
 * squinting at a bar-mounted phone in sunlight, gets the distinction from the
 * *glyph* rather than from the colour. `views/AnalysisView.tsx` makes the same
 * argument in the same words for the same reason.
 *
 * ⚠️ Suppressing the number is not a display nicety, it is the honest reading.
 * We do not know what the rider is doing while the link is down; a last-known
 * value shown as current is a claim we cannot support, and it is exactly what a
 * rider would pace off.
 *
 * ## And the rule after it
 *
 * #94's fourth criterion: *"The HUD reads from the simulation state, never
 * computes its own"*. Everything below is a **format** of a value produced
 * elsewhere — `simulation.ts` for speed, distance and gradient, `pacer/gap.ts`
 * for the gap, the sensors for cadence and heart rate. There is no arithmetic in
 * this file beyond unit conversion and rounding, and that is checked by
 * `fields.test.ts` asserting the displayed distance is the state's own number.
 */

import type { GapInput, PacerGap, RouteProfile } from '@onyourleft/domain';

import type { GameState } from '../simulation';

/** What a HUD shows where it has no trustworthy number. An em dash. */
export const NO_READING = '—';

/** One sensor's current reading. */
export interface SensorReading {
  readonly value: number | undefined;
  /** Whether the link is up and reporting. @see fields.ts header */
  readonly live: boolean;
  /**
   * Whether any paired sensor supplies this channel **at all**.
   *
   * ⚠️ **The third state, and leaving it out is a false alarm on every ride.**
   * `ride/metrics.ts` puts it plainly: *"a channel nobody is paired for is not
   * 'unavailable' — it was never available, and telling a rider with no heart
   * rate strap that their heart rate has been lost is a false alarm on every
   * ride."* This field was added when the HUD was wired to the real controller
   * and its `MetricState` turned out to carry three states where this carried
   * two: `unpaired` and `stale` both arrive as "not live", and rendering them
   * the same way says a strap the rider does not own has dropped.
   *
   * Defaults to `true` where a caller omits it, so the common case — a paired
   * sensor that went quiet — reads as the alarm it is.
   */
  readonly paired?: boolean | undefined;
}

/** A field on the HUD. */
export interface HudReading {
  /** Stable across renders, so a field is found by position rather than by reading. */
  readonly key: string;
  readonly label: string;
  /** Already formatted, or {@link NO_READING}. */
  readonly value: string;
  readonly unit: string;
  /** Whether the underlying sensor is down. Drives the tint *and* the value. */
  readonly stale: boolean;
}

/** Everything the HUD needs. */
export interface HudInput {
  readonly state: GameState;
  readonly profile: RouteProfile;
  readonly cadence: SensorReading;
  readonly heartRate: SensorReading;
  /** The gap to whichever of the bot or the ghost the rider is chasing. */
  readonly gap?: PacerGap | undefined;
  readonly gapTo?: 'bot' | 'ghost' | undefined;
}

/**
 * The eight fields #94 names, in a fixed order.
 *
 * ⚠️ The order is part of the contract, not a layout preference. #94:
 * *"Glanceable, not readable. The rider looks for one second. Numbers must be
 * positioned consistently so they are found by position, not by reading
 * labels."* A field that moved when another became unavailable would defeat
 * that, which is why an unavailable field is still returned — showing a dash —
 * rather than being filtered out.
 */
export function hudReadings(input: HudInput): readonly HudReading[] {
  const { state } = input;
  const remaining = Math.max(0, (input.profile.totalDistance as number) - state.ride.distance);
  return [
    reading('power', 'Power', state.input.power, 'W', state.input.live, 0, state.input.paired),
    reading(
      'cadence',
      'Cadence',
      input.cadence.value,
      'rpm',
      input.cadence.live,
      0,
      input.cadence.paired,
    ),
    reading(
      'heartRate',
      'Heart rate',
      input.heartRate.value,
      'bpm',
      input.heartRate.live,
      0,
      input.heartRate.paired,
    ),
    // Speed, gradient and distance come from the simulation, which cannot drop
    // out: it is computation, not a sensor. They are never stale.
    reading('speed', 'Speed', (state.ride.speed as number) * 3.6, 'km/h', true, 1),
    reading('gradient', 'Gradient', state.grade, '%', true, 1),
    reading('remaining', 'To go', remaining / 1000, 'km', true, 2),
    gapReading(input),
  ];
}

/** The gap field, which is absent rather than dashed when nothing is being chased. */
function gapReading(input: HudInput): HudReading {
  const label = input.gapTo === 'ghost' ? 'Your best' : 'Pacer';
  if (input.gap === undefined || input.gapTo === undefined) {
    return { key: 'gap', label: 'Pacer', value: NO_READING, unit: '', stale: false };
  }
  const seconds = input.gap.seconds;
  if (seconds === undefined) {
    // A stationary rider is closing no gap at all, and any number here would be
    // a lie about a division by zero — `pacer/gap.ts` says so where it returns
    // `undefined`, and rendering it as a nought is exactly what that guards
    // against.
    return { key: 'gap', label, value: NO_READING, unit: '', stale: false };
  }
  // Signed, and the sign is carried in the word rather than in a minus sign: a
  // minus sign is one glyph wide at arm's length and is the first thing lost.
  const magnitude = Math.abs(seconds);
  const direction = seconds > 0 ? 'behind' : 'ahead';
  return {
    key: 'gap',
    label,
    value: `${magnitude.toFixed(0)} s ${direction}`,
    unit: '',
    stale: false,
  };
}

function reading(
  key: string,
  label: string,
  value: number | undefined,
  unit: string,
  live: boolean,
  decimals: number,
  paired = true,
): HudReading {
  if (!live || value === undefined || !Number.isFinite(value)) {
    // ⚠️ `stale` requires BOTH: not live **and** something paired to have gone
    // quiet. A channel with nothing paired shows a dash and says nothing — see
    // `SensorReading.paired`.
    return { key, label, value: NO_READING, unit, stale: paired && !live };
  }
  return { key, label, value: value.toFixed(decimals), unit, stale: false };
}

/**
 * Where the rider is on the elevation profile, as a fraction from 0 to 1.
 *
 * #94's third criterion: *"a test asserts the marker tracks the physics position
 * rather than a separately-computed value that can drift"*. So this takes the
 * ride state and nothing else — there is no second odometer it could disagree
 * with, because there is no second odometer.
 */
export function profilePosition(state: GameState, profile: RouteProfile): number {
  const total = profile.totalDistance as number;
  if (!(total > 0)) {
    return 0;
  }
  return Math.min(1, Math.max(0, (state.ride.distance as number) / total));
}

/** The gap input for a chased rider, so a caller need not assemble it. @see pacerGap */
export function gapAgainst(state: GameState, theirDistance: number): GapInput {
  return {
    botDistance: theirDistance as GapInput['botDistance'],
    riderDistance: state.ride.distance,
    // The rider's own speed, which answers "at this pace, how long until I am
    // where they are" — `pacer/gap.ts` records why that is the natural choice.
    referenceSpeed: state.ride.speed,
  };
}
