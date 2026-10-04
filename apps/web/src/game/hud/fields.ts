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
 * elsewhere — `simulation.ts` for speed, distance, gradient and the headwind
 * (#335, resolved by `route/wind.ts` on the same step the physics used it),
 * `pacer/gap.ts` for the gap, the sensors for cadence and heart rate. There is
 * no arithmetic in this file beyond unit conversion, rounding and taking a
 * magnitude, and that is checked by `fields.test.ts` asserting the displayed
 * distance is the state's own number.
 */

import {
  metresPerSecond,
  type GapInput,
  type Metres,
  type PacerGap,
  type RouteProfile,
} from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatDuration } from '../../format';
import { formatDistance, formatSpeed, type Measurement } from '../../units/format';
import type { GhostOutcome } from '../ghost-outcome';
import type { GameState } from '../simulation';

import { planLap, planProgress } from './plan';

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

/**
 * How large a reading is drawn — the HUD's hierarchy, and **only** that (#423).
 *
 * ## The decision, recorded because #423 asks for it to be
 *
 * Until #423 every field was the same 2.5 rem in one grid of equals. Full-bleed
 * puts the instruments on top of the road, so every square centimetre a panel
 * takes is road a rider cannot see, and a grid of nine equal fields is the most
 * expensive way to spend it. So there are two tiers:
 *
 * | tier | fields | why |
 * |---|---|---|
 * | `primary` | power, cadence, heart rate | the three a rider **steers the effort by**, read every few seconds — each is a live sensor, and each is what an interval is ridden to |
 * | `secondary` | speed, gradient, to go, moving time, every gap, wind | **consequences and context**, read every few minutes. Speed on a trainer is what the simulation made of the power; the gradient is felt through the pedals before it is read; to-go, the moving time, the gaps and the wind change slowly |
 *
 * ⚠️ **Moving time is secondary, decided for #1111.** It is not a sensor and
 * nothing is ridden TO it second by second: it climbs at one second a second,
 * and a rider reads it the way they read the distance to go — now and then,
 * to know how far into the ride they are. A primary slot would also cost the
 * road the most: the primary tier is three 2.5 rem readings across the top,
 * and a fourth there would widen the corner a rider's eye goes to first for
 * the one number on the HUD that tells them nothing about the effort.
 *
 * ⚠️ **The order {@link hudReadings} returns is untouched**, and the primary
 * three were already its first three — so a field is still found by position
 * (#94), within a tier and across the pair. The tier decides a size and which
 * corner; it moves no field relative to its neighbours.
 *
 * ⚠️ **This is NOT a statement about which readings are SPOKEN.**
 * [#395](https://github.com/openzigs/onyourleft/issues/395) asks that question
 * for speech and it has a different answer space: a reading worth a large
 * glyph is not thereby worth interrupting a rider's audio for, and a gap that
 * is glanced at once a minute may be exactly the thing worth *announcing* when
 * it changes sign. Nothing here should be read as a default for it, and
 * nothing in `HudPanel.tsx` keys any `aria-live` behaviour off this value.
 */
export type ReadingTier = 'primary' | 'secondary';

/**
 * The keys of the primary tier. @see ReadingTier
 *
 * A set of keys rather than a field on {@link HudReading}, so the whole of the
 * decision is in one place a reviewer can read — and so a field added to
 * {@link hudReadings} lands in the *secondary* tier until somebody decides
 * otherwise, which is the cheap direction to be wrong in: a secondary reading
 * costs the road less.
 */
const PRIMARY_READING_KEYS: ReadonlySet<string> = new Set(['power', 'cadence', 'heartRate']);

/** Which tier a reading is drawn in. @see ReadingTier */
export function readingTier(reading: HudReading): ReadingTier {
  return PRIMARY_READING_KEYS.has(reading.key) ? 'primary' : 'secondary';
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

/**
 * The room, on the HUD — #783: how many other riders are near, and the gap to
 * ONE rider the rider chose. **Never a list, and never an order**: ADR 0021
 * D-6 and ADR 0028 D-7.7 forbid a ranked list during a ride, and ruling Q8
 * (2026-09-28) is "only the gap to one chosen rider". A count says nothing
 * about who is ahead of whom.
 */
export interface RoomHud {
  /** How many other riders are drawn near this one — the interest set's size. */
  readonly nearby: number;
  /** The one rider the rider chose to follow, or `undefined` until they choose. */
  readonly chosen?: ChosenRider | undefined;
}

/** The one rider followed. @see RoomHud */
export interface ChosenRider {
  /**
   * What they are called on the HUD. ⚠️ Only ever the room's public projection
   * of the athlete (#774, ADR 0028 D-6.5) — and until a room publishes one
   * (#784, #785), `Rider N`, which names a seat and no person.
   */
  readonly label: string;
  /** Signed as `pacer/gap.ts` signs it: positive when they are ahead. */
  readonly gap: PacerGap;
  /**
   * Their power-to-weight, when the room publishes one — ruling Q17
   * (2026-09-28): **W/kg only, never watts**, beside another rider's name.
   * There is deliberately no field here that could carry watts: a frame
   * carries neither power nor mass (`@onyourleft/protocol`), and this type is
   * the whole of what the HUD may say about another rider.
   */
  readonly wattsPerKilogram?: number | undefined;
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
   * The room, on a ride in one — #783. Absent on every other ride, so a ride
   * with no room reads exactly as it did. Chosen at the start of the ride and
   * held for it, so its fields never appear or vanish mid-ride.
   */
  readonly room?: RoomHud | undefined;
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
  /**
   * The ride's moving time, in seconds — #1111. **The recorder's own figure**,
   * `RideSnapshot.movingSeconds`, read through `trainer-port.ts`
   * §`GameTrainerPort.rideMovingSeconds`: the number the saved activity's
   * `movingTime` is written from, on the ride's own clock
   * (`ride/controller.ts` §`rideSeconds`).
   *
   * ⚠️ **There is no second clock, and this file must never grow one.** Not
   * the simulation's `state.elapsed`, not a frame count, not a timer: each of
   * those would go on counting through a pause or an auto-pause the recorder
   * does not count, and an hour in the HUD and the saved ride would disagree
   * about how long the rider rode.
   *
   * `undefined` where nothing is being recorded — no ride controller, or no
   * ride started on the Ride screen — and then the field shows
   * {@link NO_READING}: there is no moving time to quote, and a zero would say
   * the rider has not moved.
   */
  readonly movingSeconds?: number | undefined;
}

/**
 * The eight fields #94 names, in a fixed order — and, since #335, a ninth for
 * the wind on the rides that have one.
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
 *
 * ⚠️ **The wind field is the same shape of exception and is deliberately
 * last** — #335. It is present only on a ride the rider set a wind for, and
 * that choice is made on the picker and held for the ride
 * (`simulation.ts` §`SimulationSetup.wind`), so the two rides differ from each
 * other and neither changes under anybody. Putting it after the gaps is what
 * leaves every other field at the index it has always had. @see windReading
 */
export function hudReadings(input: HudInput): readonly HudReading[] {
  const { state } = input;
  const units = input.units ?? 'metric';
  // ⚠️ **To the end of THIS lap, not to a total a rider on a loop never
  // reaches — #296.** This was `max(0, totalDistance - odometer)`, which is
  // exactly the clamp #287 removed from the elevation strip one field over, and
  // it survived for the same reason: no route the product could produce was
  // ever a loop, so `distance` never exceeded `totalDistance` outside a unit
  // test. On a circuit that made this field read `0.00` from the first crossing
  // of the line for the rest of the ride.
  //
  // `planProgress` wraps for a loop and clamps for anything else, so one
  // expression serves both shapes and there is no second rule to drift from the
  // strip beside it — #94's third criterion, which asks that no separately
  // computed value exist to drift at all.
  const remaining =
    (input.profile.totalDistance as number) *
    (1 - planProgress(input.profile, state.ride.distance));
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
  // ⚠️ **Last, and the position is the decision rather than an afterthought.**
  // The order above is a contract — #94 asks a rider to find a field by
  // position rather than by reading its label — and this is the one field
  // whose *presence* depends on a choice the rider made on the picker. Putting
  // it last means a windless ride and a windy one agree about where every
  // other field is, including the gaps, which already vary in number. It never
  // appears or disappears mid-ride: `simulation.ts` §`SimulationSetup.wind`
  // records that the wind cannot be changed once the ride has started.
  const wind = windReading(state, units);
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
    // #1111: beside the distance to go, the other "how far into it am I". It
    // is always present, so its index is the same on every ride; it moved
    // every gap, room and wind field one place along, once, for every ride.
    movingTimeReading(input.movingSeconds),
    ...gapReadings(input),
    ...roomReadings(input.room),
    ...wind,
  ];
}

/** The key of the moving-time field — #1111. @see movingTimeReading */
export const MOVING_TIME_KEY = 'movingTime';

/**
 * The moving-time field — #1111.
 *
 * `h:mm:ss` from the first second (`format.ts` §`DurationHours`), so the
 * field keeps one shape for the whole ride. No unit: the colons are the unit,
 * as they are on the Ride screen's clock.
 *
 * ⚠️ **Labelled `Moving`, as the Ride screen's clock labels the same figure
 * (`views/RideView.tsx` §`RideClock`), and not `Moving time`**: a secondary
 * track is 5.5 rem at its narrowest, and a two-word label is the one that
 * wraps there on the CI runner's wider fonts (`theme.css` §"COLUMN") — a
 * second label line is a taller row on a HUD with no height to spare.
 *
 * ⚠️ **Never stale.** A dash here means "nothing is being recorded", which is
 * not a sensor that dropped: no *Sensor lost* is said, because nothing was
 * lost.
 *
 * ⚠️ **Past ten hours it is set at the word size** ({@link HudReading.word}),
 * for #259's reason exactly: `10:00:00` is one token with no break
 * opportunity (`theme.css` never breaks it) and a digit wider than
 * `9:59:59`, which is the widest figure the layout was measured at. At
 * 1.5 rem on the CI runner's fonts it would be wider than a 93 px track.
 */
function movingTimeReading(movingSeconds: number | undefined): HudReading {
  const value =
    movingSeconds === undefined || !Number.isFinite(movingSeconds)
      ? NO_READING
      : formatDuration(movingSeconds, 'always');
  return {
    key: MOVING_TIME_KEY,
    label: 'Moving',
    value,
    unit: '',
    stale: false,
    ...(value.length > WIDEST_MEASURED_MOVING_TIME.length ? { word: true } : {}),
  };
}

/** The widest moving time the HUD's layout is measured at — #1111. @see movingTimeReading */
const WIDEST_MEASURED_MOVING_TIME = '9:59:59';

/**
 * The room's two fields — #783: the one chosen rider's gap, and how many are
 * near. After the gaps and before the wind, so every other field keeps its
 * index on a room ride. @see RoomHud
 */
function roomReadings(room: RoomHud | undefined): readonly HudReading[] {
  if (room === undefined) return [];
  const chosen = room.chosen;
  const followed: HudReading =
    chosen === undefined
      ? { key: 'room-rider', label: 'Following', value: NO_READING, unit: '', stale: false }
      : withPowerToWeight(timeGap('room-rider', chosen.label, chosen.gap), chosen.wattsPerKilogram);
  return [
    followed,
    {
      key: 'room-nearby',
      label: 'Nearby',
      value: String(Math.max(0, Math.floor(room.nearby))),
      unit: room.nearby === 1 ? 'rider' : 'riders',
      stale: false,
    },
  ];
}

/**
 * Ruling Q17: beside another rider's name, W/kg and never watts — added to the
 * phrase under the gap, one decimal, and only when the room published one.
 */
function withPowerToWeight(reading: HudReading, wattsPerKilogram: number | undefined): HudReading {
  if (wattsPerKilogram === undefined || !Number.isFinite(wattsPerKilogram)) return reading;
  const ratio = `${wattsPerKilogram.toFixed(1)} W/kg`;
  return {
    ...reading,
    detail: reading.detail === undefined ? ratio : `${reading.detail}, ${ratio}`,
  };
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
  // ⚠️ The outcome before every other branch, including the stationary one. A
  // rider who has stopped pedalling still gets a settled result, where the
  // live gap would be a dash — the result does not depend on anybody's current
  // speed and pretending it is unknown would hide something that is known.
  return chase.outcome === undefined
    ? timeGap(key, label, chase.gap)
    : settledGap(key, label, chase.outcome);
}

/** A settled race's word where the number was — #259. @see SETTLED */
function settledGap(key: string, label: string, outcome: GhostOutcome): HudReading {
  // `word` because all three of these are — see {@link HudReading.word} for
  // what a word does to a 7 rem grid track at 2.5 rem.
  const { value, detail } = SETTLED[outcome];
  return { key, label, value, unit: '', detail, stale: false, word: true };
}

/**
 * A live gap in seconds under `label`, the direction in words about the
 * thing the label names — #255, and since #783 the room's chosen rider too.
 */
function timeGap(key: string, label: string, gap: PacerGap): HudReading {
  const chase = { gap };
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
 * How many decimals the wind is shown to: **none**.
 *
 * A precision argument rather than a unit one, in `units/format.ts`'s own
 * words. Two reasons, and neither is about width:
 *
 * - The number a rider typed was a round one, and what this field shows is
 *   that number with a cosine applied. A tenth of a km/h of headwind is a
 *   digit nobody chose and nobody can feel.
 * - It moves continuously as the road bends, which no other field on this
 *   panel does except the gradient. A last digit that flickers on a
 *   bar-mounted phone is the opposite of #94's *"glanceable, not readable"*,
 *   and the gradient's own single decimal is the same judgement one step less
 *   far along.
 */
const WIND_DECIMALS = 0;

/**
 * What the wind is doing to the rider, or nothing at all — #335.
 *
 * ## Why this reads the state rather than resolving the wind itself
 *
 * `simulation.ts` §`GameState.headwindMetresPerSecond` is the **same number
 * the physics was advanced with**, resolved once per step against the heading
 * at the rider's own distance. This file could import `headwindOnRoute` and
 * the profile is right there in {@link HudInput} — which is exactly the
 * separately-computed value #94's third criterion forbids, and it would drift
 * the moment the two disagreed about which distance to ask at.
 *
 * ## Why still air shows nothing rather than a nought
 *
 * #335's third criterion, and it is the {@link NO_READING} argument one step
 * further on. This panel already distinguishes *a real zero* from *a sensor
 * that dropped*; **"no wind was set" is neither of those**. A rider who chose
 * still air and is shown `0 km/h` under a `Wind` label has been told something
 * about the air rather than about their own choice, and a rider who chose a
 * wind and sees the same thing cannot tell the two apart. So the field is
 * absent, which is a state the panel already has a precedent for in
 * `GameState.bot`: a choice made on the picker that the HUD can see.
 *
 * ⚠️ **And that is safe only because the choice cannot change mid-ride.** A
 * field that appeared and disappeared while a rider was riding would move
 * every field after it, which is the failure the fixed order exists to
 * prevent. `simulation.ts` §`SimulationSetup.wind` is where the decision is
 * recorded, and it is the declaration that would have to change for this to
 * stop holding.
 *
 * ## Why the tangential component and not the wind the rider typed
 *
 * The rider typed a vector; what they *feel* is its component along the road,
 * and that is the number that explains why the same power is worth five fewer
 * km/h than it was a mile ago. `route/wind.ts` computes it every step for the
 * physics; showing anything else here would be a second, easier number that
 * did not answer the question the field exists for.
 */
function windReading(state: GameState, units: UnitSystem): readonly HudReading[] {
  const headwind = state.headwindMetresPerSecond;
  if (headwind === undefined) {
    return [];
  }
  // The magnitude, with the direction carried in the word below it — the shape
  // `gapReading` settled on, and for its reason: a minus sign is one glyph wide
  // at arm's length and is the first thing lost.
  const measurement = formatSpeed(metresPerSecond(Math.abs(headwind)), units, WIND_DECIMALS);
  return [
    {
      key: 'wind',
      label: 'Wind',
      value: measurement.value,
      unit: measurement.unit,
      // ⚠️ Judged on the **rounded** magnitude, exactly as `gapReading`'s
      // `LEVEL` branch is. A headwind of two tenths of a km/h displays as `0`,
      // and `0 km/h headwind` claims a direction the digits do not support
      // while the true direction could be either. At that magnitude the wind
      // is across the rider, which is a thing worth saying and is why this is
      // a third word rather than a dash.
      detail: windWord(headwind, measurement.value),
      // Never stale: the wind is a choice and a computation, not a sensor, so
      // it cannot drop out — the same argument the speed and gradient fields
      // carry at their call site.
      stale: false,
    },
  ];
}

/**
 * What the wind is called: the words a rider already has for it.
 *
 * A forecast and a club run both use these three, so nothing has to be learned
 * from the screen. They go in {@link HudReading.detail} rather than in the
 * value so that the big number stays a number (#255).
 *
 * @param headwind - the signed tangential component, in metres per second.
 * @param shown - the magnitude as it will actually be **displayed**, which is
 * what the crosswind branch is judged on. @see windReading
 */
function windWord(headwind: number, shown: string): string {
  if (Number(shown) === 0) {
    return 'crosswind';
  }
  return headwind > 0 ? 'headwind' : 'tailwind';
}

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
 * Everything the elevation strip shows, from one number — #287.
 *
 * ⚠️ **One value, formatted three times.** #94's third criterion is *"a test
 * asserts the marker tracks the physics position rather than a
 * separately-computed value that can drift"*, and the marker is no longer the
 * only thing on that strip: the sentence beside it and the picture's accessible
 * name say the same thing in words. Three call sites computing their own
 * percentage is the drift that criterion forbids, arrived at from the side, so
 * all three come out of {@link profileReading} together.
 */
export interface ProfileReading {
  /**
   * Where the rider is along the profile, as a fraction from 0 to 1.
   *
   * ⚠️ **Wrapped on a loop and clamped otherwise**, which is
   * `plan.ts` §`planProgress` — the same function the plan view's mark is placed
   * by, rather than a second one with the same job. This used to be clamped
   * unconditionally, and #287 is what that cost: a rider's odometer keeps
   * counting past `totalDistance` while a loop's geometry wraps, so from the
   * first crossing of the line the strip read 1 and stayed there for lap two,
   * lap three and lap ten.
   */
  readonly position: number;
  /** The sentence under the strip. A rider reads this one. */
  readonly text: string;
  /** The picture's accessible name. A screen reader reads this one. */
  readonly label: string;
}

/**
 * The elevation strip's reading for a ride state.
 *
 * ⚠️ **The lap is what makes the wrapped fraction readable, and it is only
 * offered for a loop.** `25% complete` on lap two would be a worse lie than the
 * one it replaces — the rider has ridden further than the route is long. So a
 * loop reads `25% of lap 2`, and a point-to-point route reads `100% complete`
 * past its end exactly as it did before, because there the rider really has
 * finished. `plan.ts` §`planLap` is where "which lap" is decided, and it returns
 * nothing at all for a route that is not a loop.
 */
export function profileReading(state: GameState, profile: RouteProfile): ProfileReading {
  const distance = state.ride.distance as number;
  const position = planProgress(profile, distance);
  const lap = planLap(profile, distance);
  const percent = String(Math.round(position * 100));
  // One phrase, so the sentence and the accessible name cannot describe
  // different rides. `per cent` is spelled out in the label because a screen
  // reader announcing `%` is the one place the two audiences differ.
  const where = lap === undefined ? 'complete' : `of lap ${String(lap)}`;
  return {
    position,
    text: `${percent}% ${where}`,
    label: `Route profile, ${percent} per cent ${where}`,
  };
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

/**
 * What the trainer is being asked to do — the line #373 moved into the HUD.
 *
 * ## Why this is a sentence and not a tenth field
 *
 * It was `GameView`'s own `<p>` **below** the panel until #373, where it was
 * the only rider-visible evidence that a gradient is reaching the trainer —
 * `docs/validation/0002-android-shell-and-game.md` Part L is built around
 * reading it — and in **landscape on a tablet it was off the bottom of the
 * viewport with no indication it existed**. A rider running that procedure on a
 * handlebar-mounted phone could not perform the step.
 *
 * #373 asks for the placement to be decided deliberately, so: it belongs **in**
 * the HUD, and **not** in {@link hudReadings}. The grid is a glance table where
 * a field is found by POSITION rather than by reading, and three things follow
 * from that:
 *
 * - A conditional tenth field would move the wind field (#335) depending on
 *   whether a trainer happened to be connected, which is exactly what the
 *   fixed-length list exists to prevent.
 * - This is a verb and two quantities, not a magnitude. `2.5 rem` in a track
 *   whose `7rem` is a floor rather than an `auto` is #259's overflow defect
 *   with a longer string in it.
 * - A rider does not glance at it. They read it once, while checking that the
 *   hills are real.
 *
 * So it is a row of the panel the controls are in, immediately above them —
 * which ties its reachability to a control that must already be reachable
 * rather than to a rule of its own.
 *
 * ## ⚠️ #373 did NOT make this line visible in landscape, and said it had
 *
 * A reviewer who remembers this note ending at the paragraph above is reading
 * the old file, and would reasonably conclude landscape was solved. It was
 * not. #373 was right about where the line BELONGS and did nothing about why
 * it could not be seen: the panel it moved into was itself 572 px tall under a
 * canvas, in a 390 px viewport (#419), so the line went from lost below the
 * panel to lost at the bottom of it. The owner's tablet, in landscape on
 * 2026-09-20, showed exactly that (#422): *Pause*, *End ride* and this line all
 * below the fold.
 *
 * The premise above — *"a control that must already be reachable"* — was the
 * part that was false. It became true in #423: while a ride runs the world is
 * full-bleed, the HUD is laid over it, and this line shares a panel with
 * *Pause* and *End ride* that is pinned to a corner of the stage.
 * `browser/ride.browser.spec.ts` measures all three on screen with no
 * scrolling, at a phone in both orientations and at a landscape tablet, with a
 * control that takes the stage away and requires them to fall below the fold
 * again.
 *
 * ⚠️ **`simulating`, not `holding`.** `game/gradient.ts`
 * §`GradientSessionState.asked` is explicit that the two are different claims:
 * `setSimulationParameters` resolves on the machine's indication, so the value
 * here did land, but the screen would be about a second ahead of the trainer if
 * it said so.
 *
 * ⚠️ **The count is the half that catches #362**, where a gradient was computed
 * and never sent. A percentage with `(0 sent)` beside it is the defect.
 */
export interface TrainerLine {
  /** The gradient last asked for, as a signed percentage. */
  readonly gradePercent: number;
  /** How many writes have been attempted. */
  readonly writes: number;
}

/** {@link TrainerLine} as the one sentence the HUD renders. */
export function trainerLine(line: TrainerLine): string {
  return `Trainer: simulating ${line.gradePercent.toFixed(1)}% (${String(line.writes)} sent)`;
}
