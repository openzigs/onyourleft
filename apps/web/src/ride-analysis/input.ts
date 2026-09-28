// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride-analysis input: a saved ride turned into **exactly** the numbers a
 * model is sent, and nothing that locates or identifies the rider
 * ([#809](https://github.com/openzigs/onyourleft/issues/809), epic #795).
 *
 * The owner's second ruling on #795 names what goes in: *"heart rate, cadence,
 * power, rider weight, W/kg, ride length and the ride profile, so the model
 * can evaluate how the rider did in each section of the ride. Pose summary
 * numbers are added when there is a side-camera session. Never a picture."*
 * And #796's fifth answer adds the rider's threshold power when it is set.
 *
 * ## Pure, and narrow on purpose
 *
 * {@link rideAnalysisInput} reads no clock, no store and no network. Its
 * parameters are `Pick`s of the store's records rather than the records, so
 * the function cannot NAME a ride's name, its start time, its time zone, its
 * id or the athlete's id without a compile error. ⚠️ That holds at compile
 * time only: callers pass whole records, which a `Pick` still admits, so at
 * run time those fields ARE on the objects it is handed. What keeps them out
 * of the input is that nothing here spreads `ride`, `streams` or `athlete` —
 * every field is copied by name — and `input.test.ts` walks a built input to
 * hold that. The one absolute instant it reads is the stream set's
 * `startedAt`, which it subtracts from each lap's start and never copies.
 *
 * ## What is never in the input
 *
 * - **No coordinate and no absolute altitude** (ADR 0004 decision D; an
 *   altitude is a coordinate when it is reported beside one). The profile is
 *   a mean gradient and an elevation gain RELATIVE to the section's start.
 * - **No date, time of day, time zone, ride name, route name, athlete id,
 *   activity id, device key or signed record.** A route name is often a place
 *   name, which is why the route arrives as its `RouteProfile` alone.
 * - **No picture and nothing made from one** beyond the pose DIFFERENCES of
 *   `camera/side-session-summary.ts`.
 * - **No string** but the template version and the members of this file's own
 *   enumerations. `input.test.ts` walks a built input for all of it.
 *
 * ## Sections — #796's second answer
 *
 * The saved route's gradient runs when the ride was ridden on a route whose
 * profile is still saved and the ride has a speed channel to say where on it
 * the rider was; otherwise the laps, when there are at least two; otherwise
 * equal stretches of time. **At most {@link MAXIMUM_SECTIONS}**, because each
 * section is one agent step (#811), reached by merging the shortest section
 * into its shorter neighbour. No section is shorter than
 * {@link MINIMUM_SECTION_SECONDS} unless it is the whole ride.
 *
 * ## A gap is not a zero
 *
 * `packages/store/src/streams.ts` rule 2, and `detail/series.ts`'s: an absent
 * sample is absent. A channel's mean and maximum are taken over the samples it
 * reported, its `coverage` says what share of the stretch that was, and below
 * {@link MINIMUM_REPORTED_COVERAGE} it reports its coverage and no figure at
 * all — a mean over a tenth of a climb is not the climb's.
 *
 * ## The names are this project's own
 *
 * CLAUDE.md §6: the load metrics' familiar names are somebody's trademarks.
 * Nothing here computes one, and no key names one; `input.test.ts` holds that.
 */

import {
  ASCENT_THRESHOLD_METRES,
  distanceOnRoute,
  elevationAt,
  gradeAt,
  watts,
  wattsPerKilogram,
  type Kilograms,
  type RouteProfile,
} from '@onyourleft/domain';
import type { ActivityRecord, AthleteRecord, LapRecord, StreamSet } from '@onyourleft/store';

import { SIDE_POSE_SOURCES, type SideSessionSummary } from '../camera/side-session-summary';
import { SIDE_OBSERVATION_KINDS } from '../camera/side-report-wording';

/**
 * The most sections an input carries: eight (#796, answer 2).
 *
 * Each section is one agent step (#811), so this bounds the number of model
 * calls a write-up can cost as well as the size of the input.
 */
export const MAXIMUM_SECTIONS = 8;

/**
 * The shortest a section may be, unless it is the whole ride: five minutes.
 *
 * ## Provenance — ⚠️ a provisional choice, not a measurement
 *
 * Long enough that a mean heart rate is not still climbing towards the effort
 * it describes, and short enough that an hour's ride divides into sections at
 * all. The consequence to hold onto: **a ride shorter than twice this is one
 * section**, because any split of it would leave one side short.
 */
export const MINIMUM_SECTION_SECONDS = 5 * 60;

/**
 * A run of one gradient class shorter than this is folded into the run before
 * it before any other merging: one minute.
 *
 * A route's gradient changes every ten metres, and a rider crosses a two-second
 * dip in a flat road without it being a descent. Folding these first keeps the
 * shortest-first merge that follows from walking thousands of runs.
 */
export const MINIMUM_RUN_SECONDS = 60;

/**
 * The gradient, in percent, from which a stretch is a climb (and minus it, a
 * descent): two.
 *
 * ## Provenance — ⚠️ a provisional choice, not a measurement
 *
 * About where a rider on a trainer feels a road tilt; below it the road is
 * ridden as flat.
 */
export const CLIMB_GRADE_PERCENT = 2;

/**
 * The share of a stretch a channel must have reported before its mean and
 * maximum are sent: a half. Below it only the coverage is.
 */
export const MINIMUM_REPORTED_COVERAGE = 0.5;

/**
 * The most bytes the serialised input may take: four kibibytes.
 *
 * A bound rather than a measurement: the largest ride this client imports
 * (`transfer/read-activity-file.ts` §`MAXIMUM_IMPORTED_SAMPLES`, 48 hours),
 * with thirty laps, every channel, a mass and a pose summary, serialised to
 * 3 205 bytes on 2026-09-28. About 1 KB of headroom, so that a field added
 * later which would crowd a step's prompt (#811) turns `input.test.ts` red
 * rather than a model's context window. Eight sections bound it whatever the
 * ride's length — the samples never reach the input, only their summaries.
 */
export const INPUT_BYTE_BUDGET = 4096;

/** What a section is: a stretch of the route's gradient, a lap (or laps), or a stretch of time. */
export type SectionKind = 'climb' | 'flat' | 'descent' | 'lap' | 'time';

/** Every section kind — the enumeration `input.test.ts` admits as strings. */
export const SECTION_KINDS: readonly SectionKind[] = ['climb', 'flat', 'descent', 'lap', 'time'];

/** One channel over one stretch. @see MINIMUM_REPORTED_COVERAGE */
export interface ChannelSummary {
  /** The share of the stretch's samples the channel reported, 0 to 1. */
  readonly coverage: number;
  /** Over the samples that were reported. Absent below {@link MINIMUM_REPORTED_COVERAGE}. */
  readonly mean?: number;
  readonly max?: number;
}

/** The metrics of one stretch. A channel the ride never recorded is absent, not zero. */
export interface MetricSummary {
  readonly power?: ChannelSummary;
  readonly heartRate?: ChannelSummary;
  readonly cadence?: ChannelSummary;
  /** Only when the rider's mass is set AND power was reported — never at a default mass. */
  readonly wattsPerKilogram?: { readonly mean: number; readonly max: number };
}

/** One section of the ride. Never carries the pose summary (ADR 0033 D-3). */
export interface SectionSummary {
  /** 1-based, in the order ridden. */
  readonly index: number;
  readonly kind: SectionKind;
  readonly minutes: number;
  /** From the speed channel; absent when the ride has none. */
  readonly distanceKilometres?: number;
  /** Relative only — no absolute altitude ever leaves. */
  readonly meanGradientPercent?: number;
  readonly elevationGainMetres?: number;
  /** For a `lap` section, which laps it covers, 1-based. */
  readonly laps?: { readonly first: number; readonly last: number };
  readonly metrics: MetricSummary;
}

/** What the model is sent. @see the file comment for what it may never carry. */
export interface RideAnalysisInput {
  /** From the analysis template (#810). */
  readonly templateVersion: string;
  readonly ride: { readonly movingMinutes: number; readonly distanceKilometres: number };
  /**
   * `null` says the rider has not set it, so a model is told it is absent
   * rather than left to assume a figure (#796, answer 5).
   */
  readonly rider: {
    readonly massKilograms: number | null;
    readonly thresholdPower: number | null;
  };
  readonly whole: MetricSummary;
  /** At most {@link MAXIMUM_SECTIONS}; empty for a ride with no samples. */
  readonly sections: readonly SectionSummary[];
  /** Whole-session only, and only with camera consent. */
  readonly pose?: SideSessionSummary;
}

/** Everything the input is built from beyond the ride, its streams and its athlete. */
export interface RideAnalysisOptions {
  readonly templateVersion: string;
  /** The ride's laps, from `listLaps`. */
  readonly laps?: readonly LapRecord[];
  /** The profile of the route `ride.routeId` names, when that route is still saved. */
  readonly route?: RouteProfile;
  /** The ride's side-camera pose summary (#801), when it has one. */
  readonly pose?: SideSessionSummary;
  /** Whether the rider's camera consent covers sending the pose summary (owner ruling 5). */
  readonly cameraConsented: boolean;
}

/** The fields of a ride the input may read. Not its name, date, zone or id. */
export type AnalysedRide = Pick<ActivityRecord, 'movingTime' | 'distance' | 'routeId'>;

/** The fields of a stream set the input may read. */
export type AnalysedStreams = Pick<
  StreamSet,
  'startedAt' | 'sampleInterval' | 'sampleCount' | 'channels'
>;

/** The fields of an athlete the input may read. Not their name or id. */
export type AnalysedAthlete = Pick<AthleteRecord, 'mass' | 'thresholdPower'>;

/** Build the input. Pure. @see the file comment. */
export function rideAnalysisInput(
  ride: AnalysedRide,
  streams: AnalysedStreams | undefined,
  athlete: AnalysedAthlete | undefined,
  options: RideAnalysisOptions,
): RideAnalysisInput {
  const mass = athlete?.mass;
  const sampleCount = streams?.sampleCount ?? 0;
  const pose =
    options.pose !== undefined && options.cameraConsented ? copiedPose(options.pose) : undefined;

  const input: RideAnalysisInput = {
    templateVersion: options.templateVersion,
    ride: {
      movingMinutes: rounded(ride.movingTime / 60, 1),
      distanceKilometres: rounded(ride.distance / 1000, 2),
    },
    rider: {
      massKilograms: mass === undefined ? null : rounded(mass, 1),
      thresholdPower:
        athlete?.thresholdPower === undefined ? null : Math.round(athlete.thresholdPower),
    },
    whole:
      streams === undefined || sampleCount === 0 ? {} : metricsOver(streams, 0, sampleCount, mass),
    sections:
      streams === undefined || sampleCount === 0 ? [] : sectionsOf(ride, streams, mass, options),
  };
  return pose === undefined ? input : { ...input, pose };
}

// --- Sections ---------------------------------------------------------------

/** A half-open stretch of samples, and the laps it covers when it came from laps. */
interface Stretch {
  readonly start: number;
  readonly end: number;
  readonly firstLap?: number;
  readonly lastLap?: number;
}

type SectionMode = 'route' | 'lap' | 'time';

/** Where the rider was, in metres from the start of the ride, before each sample. */
function travelled(streams: AnalysedStreams): Float64Array | undefined {
  const speed = streams.channels.speed;
  if (speed === undefined) {
    return undefined;
  }
  const along = new Float64Array(streams.sampleCount + 1);
  for (let index = 0; index < streams.sampleCount; index += 1) {
    // A gap advances nothing: the rider's distance over it is unknown, and
    // inventing it is the fabrication `streams.ts` rule 2 forbids.
    along[index + 1] = (along[index] ?? 0) + (speed[index] ?? 0) * streams.sampleInterval;
  }
  return along;
}

function sectionsOf(
  ride: AnalysedRide,
  streams: AnalysedStreams,
  mass: Kilograms | undefined,
  options: RideAnalysisOptions,
): readonly SectionSummary[] {
  const along = travelled(streams);
  const route =
    ride.routeId !== undefined &&
    options.route !== undefined &&
    along !== undefined &&
    (along[streams.sampleCount] ?? 0) > 0
      ? options.route
      : undefined;

  let mode: SectionMode;
  let stretches: Stretch[];
  if (route !== undefined && along !== undefined) {
    mode = 'route';
    stretches = foldShortRuns(gradientRuns(route, along, streams.sampleCount), streams);
  } else {
    const laps = lapStretches(options.laps ?? [], streams);
    if (laps.length >= 2) {
      mode = 'lap';
      stretches = laps;
    } else {
      mode = 'time';
      stretches = timeStretches(streams);
    }
  }

  stretches = mergeShortest(stretches, streams);
  if (mode === 'route' && route !== undefined && along !== undefined) {
    stretches = coalesceByKind(stretches, (stretch) =>
      gradientKind(meanRouteGradient(route, along, stretch)),
    );
  }

  return stretches.map((stretch, position) =>
    sectionSummary(stretch, position + 1, mode, streams, along, route, mass),
  );
}

function gradientKind(grade: number | undefined): SectionKind {
  if (grade === undefined) {
    return 'flat';
  }
  if (grade >= CLIMB_GRADE_PERCENT) {
    return 'climb';
  }
  return grade <= -CLIMB_GRADE_PERCENT ? 'descent' : 'flat';
}

/** Consecutive samples of one gradient class, on the saved route. */
function gradientRuns(route: RouteProfile, along: Float64Array, sampleCount: number): Stretch[] {
  const runs: Stretch[] = [];
  let start = 0;
  let current: SectionKind | undefined;
  for (let index = 0; index < sampleCount; index += 1) {
    const kind = gradientKind(gradeAt(route, distanceOnRoute(route, along[index] ?? 0)));
    if (current !== undefined && kind !== current) {
      runs.push({ start, end: index });
      start = index;
    }
    current = kind;
  }
  runs.push({ start, end: sampleCount });
  return runs;
}

/** Fold every run shorter than {@link MINIMUM_RUN_SECONDS} into the one before it. Linear. */
function foldShortRuns(runs: readonly Stretch[], streams: AnalysedStreams): Stretch[] {
  const folded: Stretch[] = [];
  for (const run of runs) {
    const previous = folded[folded.length - 1];
    if (previous !== undefined && secondsOf(run, streams) < MINIMUM_RUN_SECONDS) {
      folded[folded.length - 1] = { start: previous.start, end: run.end };
    } else {
      folded.push(run);
    }
  }
  // A short FIRST run has nothing before it; it joins the one after instead.
  const first = folded[0];
  const second = folded[1];
  if (
    first !== undefined &&
    second !== undefined &&
    secondsOf(first, streams) < MINIMUM_RUN_SECONDS
  ) {
    folded.splice(0, 2, { start: first.start, end: second.end });
  }
  return folded;
}

/** The laps as stretches of samples, each lap from its start to the next lap's. */
function lapStretches(laps: readonly LapRecord[], streams: AnalysedStreams): Stretch[] {
  const ordered = [...laps].sort((a, b) => a.ordinal - b.ordinal);
  const stretches: { start: number; firstLap: number; lastLap: number }[] = [];
  for (const lap of ordered) {
    const offset = Math.round((lap.startedAt - streams.startedAt) / streams.sampleInterval);
    const start = stretches.length === 0 ? 0 : Math.min(Math.max(offset, 0), streams.sampleCount);
    const previous = stretches[stretches.length - 1];
    const number = lap.ordinal + 1;
    if (previous !== undefined && start <= previous.start) {
      // A lap that starts where (or before) the last one did adds no samples of
      // its own; it is counted in the stretch already there.
      previous.lastLap = number;
      continue;
    }
    if (start >= streams.sampleCount) {
      if (previous !== undefined) {
        previous.lastLap = number;
      }
      continue;
    }
    stretches.push({ start, firstLap: number, lastLap: number });
  }
  return stretches.map((stretch, position) => ({
    start: stretch.start,
    end: stretches[position + 1]?.start ?? streams.sampleCount,
    firstLap: stretch.firstLap,
    lastLap: stretch.lastLap,
  }));
}

/** Equal stretches of time: as many as fit {@link MINIMUM_SECTION_SECONDS}, at most {@link MAXIMUM_SECTIONS}. */
function timeStretches(streams: AnalysedStreams): Stretch[] {
  const total = streams.sampleCount * streams.sampleInterval;
  const count = Math.min(
    MAXIMUM_SECTIONS,
    Math.max(1, Math.floor(total / MINIMUM_SECTION_SECONDS)),
  );
  const stretches: Stretch[] = [];
  for (let part = 0; part < count; part += 1) {
    stretches.push({
      start: Math.round((streams.sampleCount * part) / count),
      end: Math.round((streams.sampleCount * (part + 1)) / count),
    });
  }
  return stretches;
}

/**
 * Merge the shortest stretch into its shorter neighbour until there are at
 * most {@link MAXIMUM_SECTIONS} and none is shorter than
 * {@link MINIMUM_SECTION_SECONDS} — or there is one.
 */
function mergeShortest(input: readonly Stretch[], streams: AnalysedStreams): Stretch[] {
  const stretches = [...input];
  for (;;) {
    if (stretches.length <= 1) {
      return stretches;
    }
    let shortest = 0;
    for (let index = 1; index < stretches.length; index += 1) {
      if (
        secondsOf(stretches[index] as Stretch, streams) <
        secondsOf(stretches[shortest] as Stretch, streams)
      ) {
        shortest = index;
      }
    }
    const short = stretches[shortest] as Stretch;
    if (
      stretches.length <= MAXIMUM_SECTIONS &&
      secondsOf(short, streams) >= MINIMUM_SECTION_SECONDS
    ) {
      return stretches;
    }
    const left = stretches[shortest - 1];
    const right = stretches[shortest + 1];
    const intoLeft =
      left !== undefined &&
      (right === undefined || secondsOf(left, streams) <= secondsOf(right, streams));
    if (intoLeft) {
      stretches.splice(shortest - 1, 2, joined(left, short));
    } else {
      stretches.splice(shortest, 2, joined(short, right as Stretch));
    }
  }
}

/** Neighbouring stretches of one kind become one. */
function coalesceByKind(
  stretches: readonly Stretch[],
  kindOf: (stretch: Stretch) => SectionKind,
): Stretch[] {
  const coalesced: Stretch[] = [];
  let previousKind: SectionKind | undefined;
  for (const stretch of stretches) {
    const kind = kindOf(stretch);
    const previous = coalesced[coalesced.length - 1];
    if (previous !== undefined && kind === previousKind) {
      coalesced[coalesced.length - 1] = joined(previous, stretch);
    } else {
      coalesced.push(stretch);
    }
    previousKind = kind;
  }
  return coalesced;
}

function joined(first: Stretch, second: Stretch): Stretch {
  const firstLap = first.firstLap ?? second.firstLap;
  const lastLap = second.lastLap ?? first.lastLap;
  return {
    start: first.start,
    end: second.end,
    ...(firstLap === undefined ? {} : { firstLap }),
    ...(lastLap === undefined ? {} : { lastLap }),
  };
}

function secondsOf(stretch: Stretch, streams: AnalysedStreams): number {
  return (stretch.end - stretch.start) * streams.sampleInterval;
}

// --- One section's figures --------------------------------------------------

function sectionSummary(
  stretch: Stretch,
  index: number,
  mode: SectionMode,
  streams: AnalysedStreams,
  along: Float64Array | undefined,
  route: RouteProfile | undefined,
  mass: Kilograms | undefined,
): SectionSummary {
  const metres =
    along === undefined ? undefined : (along[stretch.end] ?? 0) - (along[stretch.start] ?? 0);
  const profile =
    route !== undefined && along !== undefined
      ? {
          grade: meanRouteGradient(route, along, stretch),
          gain: gainOf(routeElevations(route, along, stretch)),
        }
      : altitudeProfile(streams, stretch, metres);

  let kind: SectionKind;
  if (mode === 'route') {
    kind = gradientKind(profile.grade);
  } else {
    kind = mode;
  }

  return {
    index,
    kind,
    minutes: rounded(secondsOf(stretch, streams) / 60, 1),
    ...(metres === undefined ? {} : { distanceKilometres: rounded(metres / 1000, 2) }),
    ...(profile.grade === undefined ? {} : { meanGradientPercent: rounded(profile.grade, 1) }),
    ...(profile.gain === undefined ? {} : { elevationGainMetres: Math.round(profile.gain) }),
    ...(mode === 'lap' && stretch.firstLap !== undefined && stretch.lastLap !== undefined
      ? { laps: { first: stretch.firstLap, last: stretch.lastLap } }
      : {}),
    metrics: metricsOver(streams, stretch.start, stretch.end, mass),
  };
}

/** The route's gradient over a stretch, weighted by the distance ridden at each sample. */
function meanRouteGradient(
  route: RouteProfile,
  along: Float64Array,
  stretch: Stretch,
): number | undefined {
  let weighted = 0;
  let distance = 0;
  for (let index = stretch.start; index < stretch.end; index += 1) {
    const step = (along[index + 1] ?? 0) - (along[index] ?? 0);
    if (step <= 0) {
      continue;
    }
    weighted += gradeAt(route, distanceOnRoute(route, along[index] ?? 0)) * step;
    distance += step;
  }
  return distance > 0 ? weighted / distance : undefined;
}

function routeElevations(route: RouteProfile, along: Float64Array, stretch: Stretch): number[] {
  const heights: number[] = [];
  for (let index = stretch.start; index <= stretch.end; index += 1) {
    heights.push(elevationAt(route, distanceOnRoute(route, along[index] ?? 0)));
  }
  return heights;
}

/**
 * The gradient and gain from the ride's own altitude channel, for a ride with
 * no saved route. The gradient needs a distance to be a gradient at all.
 */
function altitudeProfile(
  streams: AnalysedStreams,
  stretch: Stretch,
  metres: number | undefined,
): { readonly grade: number | undefined; readonly gain: number | undefined } {
  const altitude = streams.channels.altitude;
  if (altitude === undefined) {
    return { grade: undefined, gain: undefined };
  }
  const heights: number[] = [];
  for (let index = stretch.start; index < stretch.end; index += 1) {
    const height = altitude[index];
    if (height !== undefined) {
      heights.push(height);
    }
  }
  const first = heights[0];
  const last = heights[heights.length - 1];
  if (first === undefined || last === undefined) {
    return { grade: undefined, gain: undefined };
  }
  return {
    grade: metres !== undefined && metres > 0 ? ((last - first) / metres) * 100 : undefined,
    gain: gainOf(heights),
  };
}

/**
 * Climbing, with {@link ASCENT_THRESHOLD_METRES} of hysteresis so a noisy
 * altimeter's wobble on a flat road is not counted as a climb. Only the
 * DIFFERENCES of the heights are used; no height leaves this function.
 */
function gainOf(heights: readonly number[]): number | undefined {
  let reference = heights[0];
  if (reference === undefined) {
    return undefined;
  }
  let gain = 0;
  for (const height of heights) {
    if (height > reference + ASCENT_THRESHOLD_METRES) {
      gain += height - reference;
      reference = height;
    } else if (height < reference - ASCENT_THRESHOLD_METRES) {
      reference = height;
    }
  }
  return gain;
}

// --- Channels ---------------------------------------------------------------

function metricsOver(
  streams: AnalysedStreams,
  start: number,
  end: number,
  mass: Kilograms | undefined,
): MetricSummary {
  const power = channelOver(streams.channels.power, start, end);
  const heartRate = channelOver(streams.channels.heartRate, start, end);
  const cadence = channelOver(streams.channels.cadence, start, end);
  const perKilogram =
    mass !== undefined && power?.mean !== undefined && power.max !== undefined
      ? {
          mean: rounded(wattsPerKilogram(watts(power.exactMean ?? 0), mass), 2),
          max: rounded(wattsPerKilogram(watts(power.max), mass), 2),
        }
      : undefined;
  return {
    ...(power === undefined ? {} : { power: published(power) }),
    ...(heartRate === undefined ? {} : { heartRate: published(heartRate) }),
    ...(cadence === undefined ? {} : { cadence: published(cadence) }),
    ...(perKilogram === undefined ? {} : { wattsPerKilogram: perKilogram }),
  };
}

interface Measured extends ChannelSummary {
  /** The unrounded mean, for the watts-per-kilogram figure. Never sent. */
  readonly exactMean?: number;
}

function channelOver(
  samples: readonly (number | undefined)[] | undefined,
  start: number,
  end: number,
): Measured | undefined {
  if (samples === undefined || end <= start) {
    return undefined;
  }
  let present = 0;
  let sum = 0;
  let max = -Infinity;
  for (let index = start; index < end; index += 1) {
    const value = samples[index];
    if (value === undefined) {
      continue;
    }
    present += 1;
    sum += value;
    max = Math.max(max, value);
  }
  const coverage = present / (end - start);
  if (present === 0 || coverage < MINIMUM_REPORTED_COVERAGE) {
    return { coverage: rounded(coverage, 2) };
  }
  return {
    coverage: rounded(coverage, 2),
    mean: Math.round(sum / present),
    max: Math.round(max),
    exactMean: sum / present,
  };
}

/** A channel summary as sent: the working fields dropped. */
function published(measured: Measured): ChannelSummary {
  return {
    coverage: measured.coverage,
    ...(measured.mean === undefined ? {} : { mean: measured.mean }),
    ...(measured.max === undefined ? {} : { max: measured.max }),
  };
}

// --- The pose half ----------------------------------------------------------

/**
 * A copy of the pose summary holding only what `SideSessionSummary` declares,
 * so a field a later producer adds is not sent until this file says so — and
 * a source that is not one of {@link SIDE_POSE_SOURCES} sends nothing.
 */
function copiedPose(pose: SideSessionSummary): SideSessionSummary | undefined {
  if (!SIDE_POSE_SOURCES.includes(pose.source) || !Number.isFinite(pose.posesCompared)) {
    return undefined;
  }
  const differences: Partial<Record<(typeof SIDE_OBSERVATION_KINDS)[number], number>> = {};
  for (const kind of SIDE_OBSERVATION_KINDS) {
    const difference = pose.differences[kind];
    if (difference !== undefined && Number.isFinite(difference)) {
      differences[kind] = rounded(difference, 2);
    }
  }
  return { source: pose.source, posesCompared: Math.round(pose.posesCompared), differences };
}

function rounded(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}
