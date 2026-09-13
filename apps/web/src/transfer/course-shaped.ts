// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Does this GPX look like a **course to ride** rather than a **ride somebody
 * did**? — #232's fourth criterion.
 *
 * ## The problem, in one sentence
 *
 * A `.gpx` means two different things in this product and there are two
 * importers on two different screens: the Files screen (`transfer/`) turns a
 * file into an **activity**, and the Routes screen (`routes/save.ts`) turns one
 * into a **route** the Trainer game can ride. "Files" is the natural place to
 * look for "import a file" and it is the wrong one for a downloaded course, and
 * until #232 neither end said so.
 *
 * ## ⚠️ The rule is NOT "it has no speed channel", and that is the point
 *
 * #232 forbids that heuristic by name, and
 * [#231](https://github.com/openzigs/onyourleft/issues/231) is why: a real ride
 * exported from a mainstream planner carried 5 118 positions, elevation and a
 * time on every point, and **no speed channel at all**. "No speed" would file
 * that ride as a course. So the absence of sensors is treated here as
 * *necessary and not sufficient* — it is never on its own enough to call a file
 * a course.
 *
 * ## What this decides, and what it deliberately does not
 *
 * It decides **whether the screen says something**, never whether the rider is
 * allowed to act. #232 requires that a wrong guess in either direction be
 * recoverable in one action, and the cheapest way to guarantee that is to make
 * the action unconditional: `TransferView` offers *"make a route from this
 * file"* on **every** GPX it read, and this verdict only decides whether a
 * sentence appears beside it. A false negative therefore costs a rider one
 * click they were going to make anyway, and a false positive costs a sentence
 * they can ignore — the activity is imported either way and nothing is undone.
 *
 * ## The rules
 *
 * A file is called course-shaped when it carries a line — at least one
 * positioned point, because a course *is* a line and a file with none is an
 * indoor ride or an empty document — **and** either:
 *
 * 1. **{@link CourseSignal `no-times`}**: not one of its points carries an
 *    absolute time. Decisive on its own. Nothing records a ride without a
 *    clock, and GPX's `<rtept>` — the element a planner writes a planned line
 *    into — has no sensor data and usually no time either. This is also the
 *    case the Files importer **refuses** (`no-timestamped-samples`), so the
 *    prompt is the only useful thing this screen can say about such a file.
 * 2. **`no-sensors` *and* `steady-pace` together**: no power, heart rate,
 *    cadence or speed anywhere in the file, *and* the speed implied by its own
 *    positions and times never varies beyond {@link STEADY_PACE_TOLERANCE} of
 *    the mean. A planner that writes times at all writes them from an assumed
 *    speed, so the line it produces was "ridden" at exactly one pace from end to
 *    end. No rider holds one: a real ride has junctions, hills and a stop.
 *
 * ## Failure modes, written down because #232 asks for them
 *
 * - **A course whose times were quantised to whole seconds over uneven road
 *   vertices is missed.** A planner writing `round(distance / assumed speed)`
 *   against vertices 5–50 m apart produces implied speeds spread far wider than
 *   {@link STEADY_PACE_TOLERANCE}, and rule 2 does not fire. Deliberate: the
 *   tolerance is set where it is so that rule 2 is *precise* rather than
 *   sensitive, because a false positive is a sentence in front of every rider
 *   and a false negative is one click.
 * - **A course exported as a `<rte>` carrying per-point times is judged by rule
 *   2 rather than recognised outright.** `decodeGpx` does not report which
 *   element the points came from — `TrackActivity` has no such field — and
 *   adding one to `packages/fit` to serve a prompt on one screen is not a trade
 *   worth making. An `<rte>`-only document almost always reaches rule 1 anyway,
 *   because an `<rtept>` rarely carries a `<time>`.
 * - **A recorded ride with every sensor stripped and a metronomic pace is
 *   flagged.** A closed-circuit effort held to within ±10 % for its whole
 *   length, exported with no channels, would read as a course. It is imported
 *   as a ride regardless; the cost is one sentence.
 * - **A ride whose times were stripped is flagged by rule 1.** It also cannot
 *   be imported as a ride at all, so the prompt is strictly better than the
 *   nothing this screen used to say.
 * - **Only GPX is judged.** `routeFromGpx` reads GPX and nothing else, so a
 *   verdict on a FIT or TCX file would describe an offer this app cannot make.
 *   `read-activity-file.ts` is where that gate is applied.
 */

import { distanceBetween, type GeographicPosition, type UnixSeconds } from '@onyourleft/domain';
import type { TrackPoint } from '@onyourleft/fit';

import { POSITION_GAP_SECONDS } from './track-distance';

/** One reason a file looked like a course. Never a conclusion on its own. */
export type CourseSignal = 'no-times' | 'no-sensors' | 'steady-pace';

/** What was noticed about a file, and what it adds up to. */
export interface CourseVerdict {
  /** Whether the screen should ask "did you mean a route?". @see courseNote */
  readonly courseShaped: boolean;
  /** Every signal that fired, in the order this module lists them. */
  readonly signals: readonly CourseSignal[];
}

/**
 * How many judged steps a pace verdict needs before it means anything: **20**.
 *
 * A handful of points can be uniform by luck — three vertices on a straight
 * road at a steady speed say nothing about the file — and twenty consecutive
 * steps inside a ten-per-cent band is not luck. It is also well under the
 * length of any real course: twenty steps is under a minute of a 1 Hz track and
 * a few hundred metres of a vertex-per-turn one.
 */
export const PACE_SAMPLE_MINIMUM = 20;

/**
 * How far an implied speed may sit from the mean and still be "the same speed":
 * **ten per cent**.
 *
 * Set for precision rather than sensitivity, and the direction is deliberate —
 * see this module's failure modes. Ten per cent is comfortably wider than the
 * rounding a planner's own arithmetic introduces on an evenly sampled line, and
 * far narrower than any real ride: #231's file, a genuine 89-minute ride with
 * no speed channel, spans a range many times this and is the fixture that pins
 * it.
 */
export const STEADY_PACE_TOLERANCE = 0.1;

/** What each signal is, in the rider's words. @see courseNote */
export const COURSE_SIGNAL_TEXT: Readonly<Record<CourseSignal, string>> = {
  'no-times': 'nothing in it carries a time, so no device recorded it',
  'no-sensors': 'it has no power, heart rate, cadence or speed in it',
  'steady-pace': 'every part of it is at the same speed, which no rider holds',
};

/**
 * Judge a decoded GPX track.
 *
 * @param points every point of the document, in file order, across its laps.
 * Nothing is sorted: a file whose clock is broken is a broken file, and
 * reordering it here would hide that behind a tidier answer.
 */
export function courseVerdict(points: readonly TrackPoint[]): CourseVerdict {
  // A course is a line. A file with no coordinates anywhere is an indoor ride
  // or an empty document, and neither is something the Routes screen could
  // make a route out of — `decodeGpxRoute` refuses both.
  if (!points.some((point) => point.position !== undefined)) {
    return { courseShaped: false, signals: [] };
  }

  const signals: CourseSignal[] = [];
  if (!points.some((point) => point.timestamp !== undefined)) {
    signals.push('no-times');
  }
  if (!points.some(hasSensorReading)) {
    signals.push('no-sensors');
  }
  if (hasSteadyPace(points)) {
    signals.push('steady-pace');
  }

  const courseShaped =
    signals.includes('no-times') ||
    (signals.includes('no-sensors') && signals.includes('steady-pace'));
  return { courseShaped, signals };
}

/**
 * The sentence to show beside a course-shaped file, or `undefined`.
 *
 * `undefined` rather than an empty string so a caller cannot render a blank
 * notice by forgetting to check — the same reason every refusal in
 * `routes/save.ts` is an object rather than a message that might be empty.
 */
export function courseNote(verdict: CourseVerdict): string | undefined {
  if (!verdict.courseShaped) {
    return undefined;
  }
  const reasons = verdict.signals.map((signal) => COURSE_SIGNAL_TEXT[signal]);
  return `This looks like a course to ride rather than a ride you did: ${listOf(reasons)}.`;
}

/** `['a', 'b', 'c']` → `'a, b and c'`. */
function listOf(parts: readonly string[]): string {
  if (parts.length <= 1) {
    return parts[0] ?? '';
  }
  return `${parts.slice(0, -1).join(', ')} and ${String(parts[parts.length - 1])}`;
}

/** Whether one point carries anything a sensor produced. */
function hasSensorReading(point: TrackPoint): boolean {
  return (
    point.power !== undefined ||
    point.heartRate !== undefined ||
    point.cadence !== undefined ||
    point.speed !== undefined
  );
}

/**
 * Whether the speed implied by the file's own positions and times never leaves
 * a narrow band.
 *
 * Steps longer than {@link POSITION_GAP_SECONDS} are skipped for
 * `track-distance.ts`'s reason — a hole is not a step of a ride — and a
 * non-positive interval is skipped because no speed can be judged over one.
 * Both move the anchor on, unlike the distance walk: this is measuring what the
 * file *claims* about its own pace, and holding an anchor across a hole would
 * manufacture a slow step that never happened.
 *
 * ⚠️ **The band is centred on the mean, and nothing is kept in an array.** A
 * median would need one number per step held at once, and this runs *before*
 * `read-activity-file.ts`'s
 * `MAXIMUM_IMPORTED_SAMPLES` has refused an over-long file — so a hostile
 * document with a million trackpoints would have paid for a million-entry array
 * on its way to being rejected. The centre makes no difference to the answer:
 * the rule is that **every** step is inside the band, so one outlier fails it
 * whichever centre is used, and a robust centre buys nothing. Two passes over
 * an array the decoder has already materialised, and constant extra memory.
 */
function hasSteadyPace(points: readonly TrackPoint[]): boolean {
  let count = 0;
  let total = 0;
  let slowest = Number.POSITIVE_INFINITY;
  let fastest = Number.NEGATIVE_INFINITY;
  walkPace(points, (speed) => {
    count += 1;
    total += speed;
    slowest = Math.min(slowest, speed);
    fastest = Math.max(fastest, speed);
  });
  if (count < PACE_SAMPLE_MINIMUM) {
    return false;
  }
  const mean = total / count;
  // A file that never moves is a broken recording rather than a course, and a
  // band of ten per cent of zero would call every step "the same speed".
  if (mean <= 0) {
    return false;
  }
  const band = mean * STEADY_PACE_TOLERANCE;
  return fastest - mean <= band && mean - slowest <= band;
}

/** Every step of the track that a speed can be judged over, in file order. */
function walkPace(points: readonly TrackPoint[], see: (speed: number) => void): void {
  let previous: Fix | undefined;
  for (const point of points) {
    const at = point.timestamp;
    const position = point.position;
    if (at === undefined || position === undefined) {
      continue;
    }
    if (previous !== undefined) {
      const elapsed = at - previous.at;
      if (elapsed > 0 && elapsed <= POSITION_GAP_SECONDS) {
        see(distanceBetween(previous.position, position) / elapsed);
      }
    }
    previous = { at, position };
  }
}

/** One positioned, timed point of the walk. */
interface Fix {
  readonly at: UnixSeconds;
  readonly position: GeographicPosition;
}
