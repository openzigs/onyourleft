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

import type { GapInput, Metres, PacerGap, RouteProfile } from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatDistance, formatSpeed, type Measurement } from '../../units/format';
import type { GhostOutcome } from '../ghost-outcome';
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
  /**
   * A short phrase the number on its own does not carry, rendered small and
   * under it (#255).
   *
   * ⚠️ **It exists so that the big number stays a number.** The gap field used
   * to put its direction inside {@link value} — `12 s behind` — which set a
   * three-word sentence in the 2.5 rem type `theme.css` gives a HUD value, in a
   * 7 rem grid cell. Every other field on this screen is a magnitude and a
   * unit, and the one a rider most needs at a glance was the one that was not.
   *
   * Rendered inside the same `dd` as the value, so a screen reader announces
   * the label, the number, its unit and this phrase as one reading rather than
   * as two.
   */
  readonly detail?: string | undefined;
  /**
   * That {@link value} is a **word** rather than a magnitude, so it is set
   * smaller — #259.
   *
   * ⚠️ **A layout flag in a pure function, and it is here rather than in the
   * stylesheet because CSS cannot ask the question.** `theme.css` gives a HUD
   * value 2.5 rem inside a `repeat(auto-fit, minmax(7rem, 1fr))` grid track. A
   * track never grows past its content the way a flex item does — the `7rem`
   * is a floor, not an `auto` — and a **single word has no break opportunity**,
   * so a word wider than the track spills across the field beside it and sits
   * on top of that field's number. Measured in the repository's pinned
   * Chromium: `Matched` is 151 px, against a track that is 118 px wherever the
   * grid resolves to five columns — which is a phone in landscape and every
   * window from 686 px up. (This used to name a 114 px track at 390 px; #266
   * re-measured it through the product's own ancestor chain and 390 px portrait
   * is the one width at which the words fit. `browser/hud.browser.spec.ts`.)
   *
   * {@link detail} exists for the other half of this: #255 moved the gap's
   * *phrase* out of the value for exactly this reason, and #259 walked back
   * into it with one word instead of three. Breaking the word instead would be
   * worse than either — `Finish`, `Beat` and `Match` on a line of their own are
   * different words, on a panel #94 requires to be glanceable.
   *
   * Absent means a number, which is every other field. `LEVEL` is left a number
   * deliberately: it measures 89 px and fits, and changing what an untouched
   * field renders at is not this issue's to do.
   */
  readonly word?: boolean | undefined;
}

/** One rider being raced, and how far ahead of the rider they are. */
export interface ChasedGap {
  /** Which of the two this is. Decides the label, and nothing else. */
  readonly to: 'bot' | 'ghost';
  /** Signed the way `pacer/gap.ts` signs it: positive when they are ahead. */
  readonly gap: PacerGap;
  /**
   * That the race against them is over, and how it went — #259.
   *
   * ⚠️ **Absent while it is still on, and it is the presence of this field
   * rather than the sign of {@link gap} that decides what is shown.** Once the
   * attempt has stopped, the gap to it goes on growing for as long as the rider
   * keeps pedalling, and quoting it says *"it is 40 s up the road"* about a
   * rider who crossed the line 40 s ago. It also, eventually, changes sign —
   * which is why the result is decided in `game/ghost-outcome.ts` and carried
   * here rather than re-derived from `gap` in this file. That header is the one
   * to read before anything here is simplified.
   *
   * Only ever produced for a ghost. A bot pacer has no finish: it is generated
   * from an intensity and a route and rides for as long as the rider does.
   */
  readonly outcome?: GhostOutcome | undefined;
}

/** Everything the HUD needs. */
export interface HudInput {
  readonly state: GameState;
  readonly profile: RouteProfile;
  readonly cadence: SensorReading;
  readonly heartRate: SensorReading;
  /**
   * Everyone the rider is racing, and the gap to each.
   *
   * ⚠️ **A list, and #253's second half is what one slot cost.** `withGhost`
   * and `withPacer` are independent choices on the route picker and a rider may
   * make both — at which point the single slot resolved to the bot and the
   * ghost's own gap was computed nowhere and shown nowhere. A rider racing
   * their previous best *and* a pacer was told about the pacer twice over.
   *
   * Empty, or absent, means nothing is being chased and the field shows a dash
   * under the pacer's label — see {@link gapReadings}.
   */
  readonly chases?: readonly ChasedGap[] | undefined;
  /**
   * Which units the rider reads in (#238).
   *
   * ⚠️ **An ordinary parameter, not a React context.** This file is pure —
   * `HudPanel.tsx` is the component — and a pure function that reached for a
   * context would stop being testable as one. `units/context.tsx` records the
   * split.
   *
   * Optional, defaulting to metric, for the reason every other optional field
   * here has one: a caller that has not been given a preference renders the
   * same thing a rider who has never chosen sees, rather than a different
   * thing.
   */
  readonly units?: UnitSystem | undefined;
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
 *
 * ⚠️ **The gap is the one slot whose count varies, and it varies only between
 * rides.** A rider who chose both a pacer and their own ghost gets two gap
 * fields; one who chose neither gets one dashed one. Both choices are made on
 * the route picker before the ride starts and neither can change while it runs,
 * so nothing moves under a rider mid-ride — which is the property the fixed
 * order exists to protect, rather than the count itself. @see gapReadings
 */
export function hudReadings(input: HudInput): readonly HudReading[] {
  const { state } = input;
  const units = input.units ?? 'metric';
  const remaining = Math.max(0, (input.profile.totalDistance as number) - state.ride.distance);
  // ⚠️ **Both go through `units/format.ts`, and that is the whole of #238's
  // second criterion.** This file used to convert and label inline —
  // `(state.ride.speed as number) * 3.6, 'km/h'` and `remaining / 1000, 'km'`
  // — which is why a preference wired only into `format.ts`'s constants would
  // have changed most of the product and left the one screen a rider stares at
  // for an hour unchanged.
  const speed = formatSpeed(state.ride.speed, units);
  // Two decimals rather than the default one, and it is a *precision*
  // argument rather than a unit one: this is a countdown, and a rider watching
  // the last kilometre go past wants the ten-metre digit. `units/format.ts`
  // §Rounding says why the two are kept apart.
  const togo = formatDistance(remaining as Metres, units, REMAINING_DECIMALS);
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
    measured('speed', 'Speed', speed),
    reading('gradient', 'Gradient', state.grade, '%', true, 1),
    measured('remaining', 'To go', togo),
    ...gapReadings(input),
  ];
}

/**
 * The gap fields: one per rider being chased, or a single dashed one.
 *
 * ⚠️ The placeholder carries the **pacer's** label rather than no label,
 * because a `dt` with nothing in it is a field a rider cannot find by position
 * — which is the whole reason an unavailable field is rendered at all.
 */
function gapReadings(input: HudInput): readonly HudReading[] {
  const chases = input.chases ?? [];
  if (chases.length === 0) {
    return [{ key: 'gap', label: LABELS.bot, value: NO_READING, unit: '', stale: false }];
  }
  return chases.map((chase) => gapReading(chase));
}

/** What each chased rider is called on the HUD. */
const LABELS: Readonly<Record<ChasedGap['to'], string>> = {
  bot: 'Pacer',
  ghost: 'Your best',
};

/**
 * One gap field.
 *
 * ## Whose direction the word describes — #255's first defect
 *
 * ⚠️ **The subject of this phrase is the thing the label names, not the
 * rider.** `pacer/gap.ts` signs its seconds *positive when the bot is ahead*,
 * and this function used to turn that into the word `behind` — which is true
 * of the **rider** and is read under a label that says `Pacer`. A screen reader
 * announced *"Pacer, 12 s behind"*, and the natural reading of that is *the
 * pacer is 12 s behind you*: the exact opposite of what it means. #94's own
 * criterion for this panel is *"glanceable, not readable — the rider looks for
 * one second"*, so a value that has to be reasoned about fails the criterion
 * rather than merely reading awkwardly.
 *
 * So the phrase now names the rider explicitly — `ahead of you` / `behind you`
 * — and the sign is carried the way the label already implies: a positive gap
 * means the chased rider is **ahead of you**. There is no reading of *"Pacer,
 * 12 s ahead of you"* in which the pacer is the one losing.
 */
function gapReading(chase: ChasedGap): HudReading {
  // Keyed by who it is about, so two of them can sit beside each other and a
  // test can name the one it means. `HudPanel` uses the key as its React key.
  const key = `gap-${chase.to}`;
  const label = LABELS[chase.to];
  if (chase.outcome !== undefined) {
    // ⚠️ Before every other branch, including the stationary one. A rider who
    // has stopped pedalling still gets a settled result, where the live gap
    // would be a dash — the result does not depend on anybody's current speed
    // and pretending it is unknown would hide something that is known.
    const { value, detail } = SETTLED[chase.outcome];
    // `word` because all three of these are — see {@link HudReading.word} for
    // what a word does to a 7 rem grid track at 2.5 rem.
    return { key, label, value, unit: '', detail, stale: false, word: true };
  }
  const seconds = chase.gap.seconds;
  if (seconds === undefined) {
    // A stationary rider is closing no gap at all, and any number here would be
    // a lie about a division by zero — `pacer/gap.ts` says so where it returns
    // `undefined`, and rendering it as a nought is exactly what that guards
    // against.
    return { key, label, value: NO_READING, unit: '', stale: false };
  }
  // Signed, and the sign is carried in the word rather than in a minus sign: a
  // minus sign is one glyph wide at arm's length and is the first thing lost.
  const magnitude = Math.abs(seconds).toFixed(0);
  if (Number(magnitude) === 0) {
    // ⚠️ Judged on the **rounded** magnitude rather than on the raw one. A gap
    // of four tenths of a second rounds to `0`, and `0 s ahead of you` claims a
    // direction the displayed number does not support — while the true
    // direction could be either. `pacer/gap.ts` §`botIsAhead` makes the same
    // argument for the exactly-level case and says a HUD should render it as
    // level; this is that, widened to everything that displays as nought.
    return { key, label, value: LEVEL, unit: '', stale: false };
  }
  return {
    key,
    label,
    value: magnitude,
    unit: 's',
    // Positive is the chased rider ahead — see this function's header, which is
    // the whole of #255's first defect.
    detail: seconds > 0 ? 'ahead of you' : 'behind you',
    stale: false,
  };
}

/** What the gap field reads when the rounded gap is nought in either direction. */
const LEVEL = 'Level';

/**
 * What the field says once the race against the attempt is settled — #259.
 *
 * ⚠️ **A word where the number was, and that is the point rather than a
 * consequence.** #94 asks for a screen that is glanceable rather than readable,
 * and a rider glancing at a number cannot tell a live gap from a dead one. The
 * outcome is the only thing left to say, so it takes the slot the number had.
 *
 * ⚠️ **The subject is still the thing the label names**, exactly as
 * {@link gapReading}'s header requires of the live phrasings: `Your best,
 * Beaten by you` and `Your best, Finished ahead of you` are both statements
 * about the attempt, not about the rider, so there is no reading of either in
 * which the wrong person won. `by you` is redundant on the eye and is not
 * redundant in the ear — a screen reader announcing *"Your best, Beaten"* alone
 * leaves who did the beating to inference, and #255 is what inference costs on
 * this panel.
 *
 * The three read nothing like each other, which is #259's second acceptance
 * criterion: a rider who beat their best and one who did not must not see the
 * same field.
 */
const SETTLED: Readonly<Record<GhostOutcome, { value: string; detail: string }>> = {
  beaten: { value: 'Beaten', detail: 'by you' },
  level: { value: 'Matched', detail: 'by you' },
  'not-beaten': { value: 'Finished', detail: 'ahead of you' },
};

/** How many decimals the distance still to ride is counted down to. */
const REMAINING_DECIMALS = 2;

/**
 * A field whose value and unit were produced together by `units/format.ts`.
 *
 * Never stale, because everything that goes through it comes from the
 * simulation rather than from a sensor — see the comment at the call site.
 */
function measured(key: string, label: string, measurement: Measurement): HudReading {
  return { key, label, value: measurement.value, unit: measurement.unit, stale: false };
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
