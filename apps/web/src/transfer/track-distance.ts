// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How far an imported track went, measured from the track itself.
 *
 * ## Why this exists, and why the recording rule is not reused
 *
 * `read-activity-file.ts` took a ride's distance from one of two numbers the
 * file states — a session or lap total, or the largest per-point cumulative
 * distance — and fell through to **zero** when a file states neither. A GPX
 * track states neither: GPX has no lap totals and no native distance element
 * (`packages/fit/src/xml/gpx.ts` says so itself), and a `<trkpt>` carries no
 * cumulative distance, so `gpx.ts` sets one to `undefined` unconditionally. A
 * file with five thousand positions and eighty-nine minutes of riding in it
 * therefore imported as **0.0 km**, which is #231.
 *
 * ⚠️ **This is deliberately not the rule `recording/finish.ts` uses.** That one
 * integrates a *recorded* ride's distance from the **speed** channel, which is
 * right for a live recording: speed is what a sensor reports and a position may
 * be absent indoors. An imported file is the opposite case — it has no live
 * sensor, its position channel is usually its richest, and a GPX track
 * routinely carries no speed at all. Applying the recording rule to an import
 * turns the best-populated channel in the file into a zero. The two paths
 * differ here on purpose.
 *
 * ## Nothing in `packages/domain` moved to make this work
 *
 * {@link distanceBetween} is used exactly as the privacy zones and the segment
 * matcher use it. CLAUDE.md warns that the segment matcher depends on what
 * "how far apart are these two points" answers, so **no tolerance, radius or
 * constant in `packages/domain` is touched by this module**; every threshold
 * below is this importer's own and is consumed nowhere else.
 *
 * ## The three rules, and what each one is for
 *
 * A pair of consecutive positioned points contributes its separation to the
 * total **only** when all three hold. Each rejects a different way of turning a
 * track into a number the rider never rode:
 *
 * 1. **The interval is not a gap.** {@link POSITION_GAP_SECONDS}. A dropout
 *    between two fixes ten minutes apart is not a six-kilometre sprint, and a
 *    straight line across a hole is fabricated ground — the same refusal
 *    `detail/series.ts` makes when it draws a break rather than a line.
 * 2. **The step is not stationary drift.**
 *    {@link STATIONARY_SPEED_METRES_PER_SECOND}. A receiver sitting on a table
 *    wanders a metre or two per fix, and summing every consecutive pair blindly
 *    files those metres as a ride.
 * 3. **The step is not a fix error.**
 *    {@link IMPLAUSIBLE_SPEED_METRES_PER_SECOND}. A single bad fix lands
 *    hundreds of metres away and back again, adding a kilometre to a ride in
 *    two samples.
 *
 * ## The anchor, and why a rejected step does not move it
 *
 * The walk keeps an **anchor**: the last position a step was measured *from*.
 * A rejected step leaves the anchor where it is, and that is what makes rules 2
 * and 3 work rather than merely fire:
 *
 * - **Rule 2 becomes a filter on displacement rather than on one step.** Ten
 *   seconds of table jitter is ten rejected steps and the anchor has not moved,
 *   so the drift is measured from where the receiver actually was and stays
 *   below the threshold instead of accumulating. Advancing the anchor on every
 *   point would let a bounded random walk add unbounded distance.
 * - **Rule 3 steps over a lone bad fix instead of losing the ground around
 *   it.** The step into the bad fix and the step back out are both rejected;
 *   the next good fix is then measured from the last good one, over the real
 *   elapsed time, which is the distance actually ridden.
 *
 * A **gap** is the one rejection that *does* move the anchor, and it has to:
 * the fix on the far side of a dropout is where the rider now is, and holding
 * the old anchor would reject the entire remainder of the ride. That also
 * bounds how long an anchor can survive — a receiver stationary for an hour
 * re-anchors every {@link POSITION_GAP_SECONDS} rather than comparing against a
 * position from an hour ago.
 */

import {
  distanceBetween,
  metres,
  type GeographicPosition,
  type Metres,
  type UnixSeconds,
} from '@onyourleft/domain';
import type { TrackPoint } from '@onyourleft/fit';

/**
 * The longest interval between two fixes that is still one step of a ride, in
 * seconds.
 *
 * **Sixty.** The number is a statement about recorders rather than about
 * riders: a head unit using variable or "smart" recording stretches its
 * interval on a steady straight and still emits a fix well inside a minute, so
 * a hole longer than that is the recording having stopped — a tunnel, a paused
 * device, a lost lock — and not a sparse sample of ground that was covered.
 *
 * ⚠️ **Deliberately not the three seconds `game/ghost-source.ts` and
 * `ride/metrics.ts` use.** Those judge a *live* 1 Hz sensor link, where one
 * second is jitter and five is stale. An imported file's sampling rate is
 * whatever somebody else's device chose, and a three-second rule would reject
 * every step of a perfectly ordinary ten-second-interval export — turning this
 * fix back into the zero it exists to remove.
 *
 * Both costs are real and neither is silent. A file sampled more sparsely than
 * once a minute contributes nothing and reports short, which is the
 * conservative direction. And a dropout *shorter* than a minute is bridged with
 * a straight line, which under-reads a curve and over-reads nothing.
 */
export const POSITION_GAP_SECONDS = 60;

/**
 * Below this implied speed a step is the receiver moving, not the rider, in
 * metres per second.
 *
 * **One metre per second — 3.6 km/h.** Chosen against what a bicycle does, not
 * against what a receiver does: a rider holding less than walking pace has
 * stopped, and a consumer GNSS fix wanders a metre or two between samples while
 * the bike is against a wall. Measured from the anchor rather than from the
 * previous point (see this module's header), so it is the *displacement* over
 * the elapsed time that has to clear the threshold, which is what stops an hour
 * of drift summing to a kilometre.
 *
 * ⚠️ **It cannot be raised to catch the last of the drift.** The next
 * defensible step up is around 2 m/s, which is 7.2 km/h — a speed real riders
 * hold on a steep climb, for long enough that discarding it would delete a
 * mountain from a ride and say nothing. Under-reading a few metres of jitter is
 * the cheaper error, so this threshold is set where genuine riding begins and
 * accepts that some drift survives it.
 */
export const STATIONARY_SPEED_METRES_PER_SECOND = 1;

/**
 * Above this implied speed a step is a fix error, in metres per second.
 *
 * **One hundred metres per second — 360 km/h.** The number is set by a record
 * rather than by taste: the fastest speed ever recorded on a bicycle is
 * Denise Mueller-Korenek's paced 296 km/h in 2018, so a step implying more than
 * 360 km/h is not something a rider did on any bicycle that has ever existed.
 *
 * ⚠️ **It is meant to be far above ordinary riding, and setting it near a
 * plausible descent would be a bug.** This rule's job is to reject a fix that
 * jumped, which implies hundreds or thousands of metres per second and is not a
 * near thing; policing a fast descent instead would silently delete the most
 * exciting part of a real ride, and the rider would see a distance that is
 * short with nothing on screen to explain it. The synthetic fixture corpus is
 * itself evidence for the choice: `nominal-ride.gpx` steps about 47 m apart at
 * 1 Hz, which no rider holds and which a threshold picked from descent speeds
 * would throw away.
 */
export const IMPLAUSIBLE_SPEED_METRES_PER_SECOND = 100;

/**
 * The distance a decoded track covers, derived from its own positions.
 *
 * Points are walked in **file order**, which is the order the track was
 * ridden — nothing is sorted, because a sort would silently reorder a file
 * whose timestamps are broken and present the result as a route. A point with
 * no timestamp or no position is passed over without disturbing the anchor, so
 * an indoor `<trkpt>` carrying a time and no coordinates costs nothing, and an
 * interval spanning such points is still measured against real clock time.
 *
 * An interval of zero or less is not one a speed can be judged over — two fixes
 * in the same second, or a file whose clock goes backwards — and it is rejected
 * by the same speed band as everything else rather than by a guard of its own.
 * The comment on that line says how, and why the `NaN` it has to survive is the
 * reason the band is written the way round it is.
 *
 * **Nothing escapes from here**, which `readActivityFile` promises on behalf of
 * the whole import path. {@link distanceBetween} refuses a non-finite
 * coordinate with a `UnitError`, and that is unreachable from a decoded track:
 * both decoders build a position through `geographicPosition` and **drop** one
 * they cannot validate, recording a fault against the file instead. A position
 * that is present here has already been through that gate.
 *
 * @returns the distance in metres. **Zero for a track with no positions at
 * all**, which is an indoor ride and not a failure.
 */
export function distanceAlongTrack(points: readonly TrackPoint[]): Metres {
  let total = 0;
  let anchor: Anchor | undefined;
  for (const point of points) {
    const at = point.timestamp;
    const position = point.position;
    if (at === undefined || position === undefined) {
      continue;
    }
    if (anchor === undefined) {
      anchor = { at, position };
      continue;
    }
    const elapsed = at - anchor.at;
    if (elapsed > POSITION_GAP_SECONDS) {
      // The one rejection that re-anchors: the rider is on the far side of the
      // hole, and measuring the rest of the ride from before it would reject
      // every remaining step.
      anchor = { at, position };
      continue;
    }
    const step = distanceBetween(anchor.position, position);
    const speed = step / elapsed;
    // ⚠️ Written as "inside the band", not as "outside either edge", and the
    // difference is `NaN`. An interval of zero or less is not one a speed can
    // be judged over — two fixes in the same second, or a clock that went
    // backwards — and the division then yields `Infinity`, `-Infinity` or
    // `NaN`. A `NaN` satisfies no comparison at all, so a pair of rejections
    // joined by `||` would both be false and let it through; requiring the
    // speed to satisfy both halves rejects it. That is why there is no separate
    // guard on `elapsed` above: one that rejected a non-positive interval would
    // duplicate this line for every case that can actually reach it, and
    // CLAUDE.md §5 calls a branch no test can distinguish a guard in appearance
    // only.
    if (!(
      speed >= STATIONARY_SPEED_METRES_PER_SECOND && speed <= IMPLAUSIBLE_SPEED_METRES_PER_SECOND
    )) {
      continue;
    }
    total += step;
    anchor = { at, position };
  }
  return metres(total);
}

/** The last position a step was measured from, and when the rider was there. */
interface Anchor {
  readonly at: UnixSeconds;
  readonly position: GeographicPosition;
}
