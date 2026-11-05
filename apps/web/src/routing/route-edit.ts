// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Editing a saved route, keeping its line — [#2007](https://github.com/openzigs/onyourleft/issues/2007).
 *
 * The planner's phase (b), on Ride with GPS's model (its support article
 * 4415456909339): **everything outside the stretch you change stays the same.**
 * So a saved route is never turned back into waypoints and re-snapped. Its line
 * is its stored profile, and an edit replaces one stretch of that profile and
 * leaves every other sample exactly as it was: the same position, the same
 * height and the same gradient, read back byte for byte.
 *
 * ## Why the profile and not a draft
 *
 * A `RouteDraft` (`draft.ts`) is waypoints and the legs between them, and its
 * save builds a new profile with `routeProfile`, which resamples the whole line
 * onto a fresh grid. That is right for a route being drawn, and it would move
 * every point of a route being edited: a stretch 3 m longer shifts each grid
 * sample after it. So an edit works on the saved `RouteProfile` directly.
 * {@link replaceStretch} keeps the samples on either side of the stretch,
 * splices in a profile of the new stretch alone (`routeProfile` over just that
 * stretch, at the route's own spacing), and sums the climb again over the
 * result. Distance and heights are therefore worked out for the changed
 * stretch only, as #2007 asks.
 *
 * ⚠️ **The spacing is the route's mean after an edit, not exactly 10 m.** A
 * new stretch is sampled at the route's spacing, stretched to land on its own
 * end, as `routeProfile` lands a whole route on its end. The spliced profile's
 * `resolution` is its total length over its sample count, so `totalDistance`
 * is the real length. On a 100 m stretch that differs from the route's old
 * spacing by under 0.05 m per sample.
 *
 * ## Heights with no instance
 *
 * With a routing service (#2008), the new stretch follows roads and its
 * heights are asked for, as the planner asks. With none, which is every rider
 * today, the stretch is a straight line. Its heights are then **an even slope
 * between the heights where it meets the route**, which is the ramp
 * `routeProfile` already assumes across a point with no height. The samples
 * worked out that way are marked ({@link EditedLine.ramped}), so a save can say
 * how much of the route has no measured height (`routeFromEdit`).
 *
 * ⚠️ **No coordinate appears in anything this module says** (ADR 0004
 * decision D). Its refusals name distances and counts only.
 */

import {
  distanceBetween,
  gradePercent,
  LOOP_CLOSURE_METRES,
  metres,
  recordedAscent,
  routeProfile,
  RouteError,
  unixSeconds,
  type AltitudeMetres,
  type GeographicPosition,
  type Metres,
  type RidingPreferences,
  type RoutePoint,
  type RouteProfile,
  type RoutingProvider,
  type UnixSeconds,
} from '@onyourleft/domain';
import type { PrivacyZoneRecord, RouteId, RouteRecord } from '@onyourleft/store';

import { checkName, type SaveOutcome } from '../routes/save';
import { routeShare, ROUTE_SHARE_FAULT_TEXT } from '../routes/share';
import { ELEVATION_INTERVAL_METRES, resampleShape } from './elevation';

/**
 * A saved route's line as it is being edited: its profile, and which of its
 * samples have no measured height.
 *
 * A value, like a planner's draft, so `history.ts` undoes it the same way:
 * whole values, and an edit that changed nothing returns the line it was given.
 */
export interface EditedLine {
  readonly profile: RouteProfile;
  /**
   * One flag per sample of {@link profile}, `true` where its height is an even
   * slope between a redrawn stretch's ends rather than something measured. All
   * `false` for the line as it was saved.
   */
  readonly ramped: readonly boolean[];
}

/** The line of a saved route, before any edit. */
export function lineOf(route: RouteRecord): EditedLine {
  return { profile: route.profile, ramped: route.profile.positions.map(() => false) };
}

/** The last sample's index. */
export function lastSample(line: EditedLine): number {
  return line.profile.positions.length - 1;
}

/** How far along the line sample `index` is. */
export function distanceAt(line: EditedLine, index: number): Metres {
  return metres(index * line.profile.resolution);
}

/**
 * The sample nearest `distance` along the line, clamped to the line: where a
 * rider who typed a distance meant.
 */
export function sampleAt(line: EditedLine, distance: number): number {
  const index = Math.round(distance / line.profile.resolution);
  return Math.max(0, Math.min(lastSample(line), Number.isFinite(index) ? index : 0));
}

/**
 * The sample nearest `position`: where a tap near the line meant. The same flat
 * projection `map-edit.ts` §`nearestLeg` uses, which tells one sample from the
 * next.
 */
export function nearestSample(line: EditedLine, position: GeographicPosition): number {
  const scale = Math.cos((position.latitude * Math.PI) / 180);
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  line.profile.positions.forEach((sample, index) => {
    const distance = Math.hypot(
      (sample.longitude - position.longitude) * scale,
      sample.latitude - position.latitude,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

/** A new stretch of line, from one end to the other, with whatever heights are known. */
export interface Stretch {
  /** In order. The first and last are the stretch's two ends. */
  readonly points: readonly RoutePoint[];
  /** Whether its heights were measured, or are a slope between its ends. */
  readonly measured: boolean;
}

/**
 * A straight stretch, its height an even slope between its two ends: a
 * freehand stretch, which is every stretch with no routing service.
 *
 * An end with no known height (a new start or end, which is off the route) is
 * held level with the other, which is `routeProfile`'s rule past its last
 * known height.
 */
export function straightStretch(
  from: GeographicPosition,
  to: GeographicPosition,
  heights: { readonly from?: AltitudeMetres | undefined; readonly to?: AltitudeMetres | undefined },
): Stretch {
  return {
    points: [
      { position: from, elevation: heights.from },
      { position: to, elevation: heights.to },
    ],
    measured: false,
  };
}

/**
 * The stretch between two places: along the roads, with measured heights,
 * when there is a routing service, and {@link straightStretch} when there is
 * none.
 *
 * ⚠️ **The stretch's two ends keep the route's heights there** even when the
 * rest is measured, so the line has no step where the new stretch meets the
 * kept one: the kept heights were smoothed by the route's own profile, and a
 * fresh lookup at the same place can differ by a metre or two.
 *
 * @throws {RoutingError} when the service refuses the stretch. Nothing is
 * changed then, and the screen says why. A height lookup that fails is not a
 * refusal: the stretch keeps its line and takes the slope instead.
 */
export async function drawStretch(
  from: GeographicPosition,
  to: GeographicPosition,
  heights: { readonly from?: AltitudeMetres | undefined; readonly to?: AltitudeMetres | undefined },
  provider: RoutingProvider | undefined,
  preferences: RidingPreferences,
): Promise<Stretch> {
  if (provider === undefined) return straightStretch(from, to, heights);
  const legs = await provider.route({
    waypoints: [{ position: from }, { position: to }],
    preferences,
  });
  const shape: GeographicPosition[] = [from];
  for (const leg of legs) shape.push(...leg.shape);
  shape.push(to);
  const interval = metres(ELEVATION_INTERVAL_METRES);
  const grid = resampleShape(shape, interval);
  if (grid.length < 2) return straightStretch(from, to, heights);
  let measured: (AltitudeMetres | undefined)[];
  try {
    const answer = await provider.heights({ shape: grid, interval });
    const byIndex = new Map<number, AltitudeMetres | undefined>();
    for (const sample of answer.samples) {
      const index = sample.along / interval;
      if (Number.isInteger(index)) byIndex.set(index, sample.elevation);
    }
    measured = grid.map((_, index) => byIndex.get(index));
  } catch {
    return { ...straightStretch(from, to, heights), points: slopeOver(grid, heights) };
  }
  if (measured.every((height) => height === undefined)) {
    return { ...straightStretch(from, to, heights), points: slopeOver(grid, heights) };
  }
  const last = grid.length - 1;
  return {
    points: grid.map((position, index) => ({
      position: index === 0 ? from : index === last ? to : position,
      elevation:
        index === 0 && heights.from !== undefined
          ? heights.from
          : index === last && heights.to !== undefined
            ? heights.to
            : measured[index],
    })),
    measured: true,
  };
}

/** A routed shape whose heights are the slope between its ends. */
function slopeOver(
  grid: readonly GeographicPosition[],
  heights: { readonly from?: AltitudeMetres | undefined; readonly to?: AltitudeMetres | undefined },
): readonly RoutePoint[] {
  const last = grid.length - 1;
  return grid.map((position, index) => ({
    position,
    elevation: index === 0 ? heights.from : index === last ? heights.to : undefined,
  }));
}

/**
 * Where a stretch starts: a sample of the line, or a new start before it.
 * Where it ends: a sample, or a new end after it.
 */
export type StretchStart = number | 'new-start';
export type StretchEnd = number | 'new-end';

/**
 * Replace the line between `from` and `to` with `stretch`, and keep the rest.
 *
 * `from` and `to` are samples of the line; the samples before `from` and after
 * `to`, **and those two samples themselves**, are kept exactly. `stretch` runs
 * from sample `from` to sample `to`, so its first and last points are those
 * two places. `'new-start'` drops everything before `to`, and the stretch runs
 * from a new start to `to`; `'new-end'` is the same at the other end.
 *
 * ⚠️ **Only the stretch is profiled.** `routeProfile` runs over the stretch's
 * own points at the route's spacing, its first and last samples are dropped
 * because they are the kept samples at either end, and its heights and
 * gradients go in between. The climb is then summed again over the whole line
 * (`recordedAscent`, the same run rule a route's profile uses), because a
 * climb that runs across a seam is one climb.
 *
 * @param loop whether the result is a loop. Kept from the line by default
 * when both ends are kept, and `false` when either end is new.
 * @throws {RouteError} `no-distance` when the result would have no length.
 */
export function replaceStretch(
  line: EditedLine,
  from: StretchStart,
  to: StretchEnd,
  stretch: Stretch,
  loop?: boolean,
): EditedLine {
  const { profile } = line;
  const last = lastSample(line);
  const outside = (index: number): boolean => !Number.isInteger(index) || index < 0 || index > last;
  if (
    (from !== 'new-start' && outside(from)) ||
    (to !== 'new-end' && outside(to)) ||
    (from !== 'new-start' && to !== 'new-end' && from >= to)
  ) {
    throw new RouteError('invalid-option', 'a stretch must start before it ends, on the route');
  }
  // Kept: samples [0, keepBefore) and [keepAfter, last].
  const keepBefore = from === 'new-start' ? 0 : from + 1;
  const keepAfter = to === 'new-end' ? last + 1 : to;

  const drawn = routeProfile(stretch.points, { resolutionMetres: profile.resolution });
  // The stretch's own first and last samples are the kept ones at either end.
  const inner = {
    start: from === 'new-start' ? 0 : 1,
    end: drawn.positions.length - (to === 'new-end' ? 0 : 1),
  };
  const splice = <T>(kept: readonly T[], made: readonly T[]): T[] => [
    ...kept.slice(0, keepBefore),
    ...made.slice(inner.start, inner.end),
    ...kept.slice(keepAfter),
  ];

  const positions = splice(profile.positions, drawn.positions);
  const elevations = splice(profile.elevations, drawn.elevations);
  const grades = splice(profile.grades, drawn.grades);
  const ramped = splice(
    line.ramped,
    drawn.positions.map(() => !stretch.measured),
  );

  const keptLength =
    (keepBefore === 0 ? 0 : (keepBefore - 1) * profile.resolution) +
    (keepAfter > last ? 0 : (last - keepAfter) * profile.resolution);
  const total = keptLength + drawn.totalDistance;
  if (positions.length < 2 || total <= 0) {
    throw new RouteError('no-distance', 'the edited route would have no length');
  }
  return {
    profile: climbed({
      loop: loop ?? (from !== 'new-start' && to !== 'new-end' && profile.loop),
      resolution: metres(total / (positions.length - 1)),
      totalDistance: metres(total),
      elevations,
      grades,
      positions,
    }),
    ramped,
  };
}

/** A profile's climb and descent, summed over its heights by `routeProfile`'s run rule. */
function climbed(profile: Omit<RouteProfile, 'totalAscent' | 'totalDescent'>): RouteProfile {
  // ⚠️ The descent is the ascent of the heights turned upside down: the run
  // rule is symmetric, and the domain exports the ascent alone.
  const heights = profile.elevations.map(Number);
  return {
    ...profile,
    totalAscent: recordedAscent(heights) ?? metres(0),
    totalDescent: recordedAscent(heights.map((height) => 0 - height)) ?? metres(0),
  };
}

/**
 * The same line ridden the other way: every sample kept, in reverse order, each
 * gradient's sign turned and the climb and descent swapped.
 *
 * ⚠️ Nothing is asked again, for `draft.ts` §`reverse`'s reason: a rider who
 * pressed Reverse asked for the line they have, backwards.
 */
export function reverseLine(line: EditedLine): EditedLine {
  const { profile } = line;
  return {
    profile: {
      ...profile,
      positions: [...profile.positions].reverse(),
      elevations: [...profile.elevations].reverse(),
      // `0 - grade` rather than `-grade`, so a level sample stays +0.
      grades: [...profile.grades].reverse().map((grade) => gradePercent(0 - grade)),
      totalAscent: profile.totalDescent,
      totalDescent: profile.totalAscent,
    },
    ramped: [...line.ramped].reverse(),
  };
}

/**
 * Ride to the end and back the same way: the line, then the line reversed,
 * meeting at the end's one sample.
 *
 * ⚠️ **Not a loop**, though it ends where it starts. A lap race on it would
 * turn round on the spot at each end, which is `loop.ts`'s reason for asking
 * three waypoints of a drawn loop.
 */
export function outAndBack(line: EditedLine): EditedLine {
  const back = reverseLine(line);
  const { profile } = line;
  return {
    profile: climbed({
      loop: false,
      resolution: profile.resolution,
      totalDistance: metres(profile.totalDistance * 2),
      positions: [...profile.positions, ...back.profile.positions.slice(1)],
      elevations: [...profile.elevations, ...back.profile.elevations.slice(1)],
      grades: [...profile.grades, ...back.profile.grades.slice(1)],
    }),
    ramped: [...line.ramped, ...back.ramped.slice(1)],
  };
}

/** Whether the line's end is away from its start, so *Return to start* can act. */
export function canReturnToStart(line: EditedLine): boolean {
  const first = line.profile.positions[0];
  const end = line.profile.positions.at(-1);
  if (first === undefined || end === undefined) return false;
  return distanceBetween(first, end) > LOOP_CLOSURE_METRES;
}

/**
 * Join the end back to the start with `stretch`, which runs from the end to the
 * start, and save it as a loop: the line's own `Close the loop`.
 */
export function returnToStart(line: EditedLine, stretch: Stretch): EditedLine {
  if (!canReturnToStart(line)) return line;
  return replaceStretch(line, lastSample(line), 'new-end', stretch, true);
}

/** How much of the line has no measured height: the ramped samples' share of its length. */
export function rampedLength(line: EditedLine): Metres {
  const count = line.ramped.filter(Boolean).length;
  return metres(Math.min(line.profile.totalDistance, count * line.profile.resolution));
}

export interface EditSaveOptions {
  readonly id: RouteId;
  /** What the rider typed. Checked by `checkName`. */
  readonly name: string;
  /** Passed in rather than read: this module may not consult a clock. */
  readonly now: UnixSeconds;
}

/**
 * The record a route's elevation note becomes after an edit: the original
 * dataset, with the ramped stretches added to what it did not measure.
 *
 * ⚠️ **An imported route keeps no note**, as before the edit: its heights came
 * from the file (`RouteRecord.elevation`), and naming a dataset now would claim
 * one that nobody asked.
 */
function elevationAfter(
  original: RouteRecord,
  line: EditedLine,
): RouteRecord['elevation'] | undefined {
  if (original.elevation === undefined) return undefined;
  return {
    ...original.elevation,
    missing: metres(original.elevation.missing + rampedLength(line)),
  };
}

/**
 * Save an edited line as a new route beside the original, which is left as it
 * was. Private, for `routes/save.ts` §`routeFromGpx`'s reason: there is no
 * option here to make it anything else.
 */
export function routeFromEdit(
  original: RouteRecord,
  line: EditedLine,
  options: EditSaveOptions,
): SaveOutcome {
  const nameFault = checkName(options.name);
  if (nameFault !== undefined) return { status: 'refused', refusal: nameFault };
  const elevation = elevationAfter(original, line);
  return {
    status: 'saved',
    record: {
      id: options.id,
      createdBy: original.createdBy,
      name: options.name.trim(),
      profile: line.profile,
      ...(elevation === undefined ? {} : { elevation }),
      visibility: 'private',
      createdAt: options.now,
      updatedAt: options.now,
    },
  };
}

/**
 * Save an edited line over the route it came from — or say why not.
 *
 * ⚠️ **The same "edited elsewhere" guard a rename has** (`routes/save.ts`
 * §`editRoute`): `stored` is a fresh read, `readAt` is the `updatedAt` the
 * editor opened, and a difference refuses.
 *
 * ⚠️ **A shared route's new line is checked against the rider's privacy zones
 * before it is written.** A rename keeps the line, so `editRoute` asks only
 * when a route is widened. A redrawn line can now start or end inside a zone,
 * and writing it over a shared route would publish that. So a route that is
 * not private is refused when its new line could not be shared, with the share
 * screen's own words.
 */
export function replaceRouteLine(
  stored: RouteRecord,
  line: EditedLine,
  readAt: UnixSeconds,
  now: UnixSeconds,
  zones: readonly PrivacyZoneRecord[] = [],
): SaveOutcome {
  if (stored.updatedAt !== readAt) {
    return {
      status: 'refused',
      refusal: {
        code: 'edited-elsewhere',
        message:
          'This route was changed somewhere else since you opened it — another tab, or another ' +
          'device. Reopen it to see the current version; nothing here has been saved.',
      },
    };
  }
  const elevation = elevationAfter(stored, line);
  const record: RouteRecord = {
    ...stored,
    profile: line.profile,
    ...(elevation === undefined ? {} : { elevation }),
    updatedAt: now === stored.updatedAt ? unixSeconds(now + 1) : now,
  };
  if (stored.visibility !== 'private') {
    const fault = routeShare(record, zones).faults[0];
    if (fault !== undefined) {
      return {
        status: 'refused',
        refusal: { code: 'cannot-be-shared', message: ROUTE_SHARE_FAULT_TEXT[fault] },
      };
    }
  }
  return { status: 'saved', record };
}

/** A height on the line, for a stretch's end. */
export function heightAt(line: EditedLine, index: number): AltitudeMetres | undefined {
  return line.profile.elevations[index];
}
