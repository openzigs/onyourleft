// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One file of somebody else's bytes → one ride this device can store.
 *
 * This is `packages/fit`'s **first production consumer**. Everything about the
 * three formats is the codec's; everything about the 1 Hz sample grid the store
 * keeps (ADR 0011) is here, because the codec deliberately does not know what a
 * store is.
 *
 * ## A file is untrusted input, and this is where the trust boundary is
 *
 * `SECURITY.md` and CLAUDE.md §6 put activity-file parsing in scope and require
 * that malformed input produce an **error** — never memory corruption, a crash
 * loop, resource exhaustion or code execution. The codec closes most of that:
 * it refuses a `<!DOCTYPE` outright (so XXE and billion-laughs are refused at
 * the declaration), and since #127 the FIT decoder streams with a declared
 * retention bound.
 *
 * What the codec **cannot** close, because it has no sample grid, is the one
 * this file owns: **a file's timestamps decide the length of the arrays built
 * here.** Two records a decade apart are perfectly well-formed FIT and would
 * ask this module for 315 million slots per channel. So the span is checked
 * against {@link MAXIMUM_IMPORTED_SAMPLES} *before* a single array is
 * allocated, and a file that exceeds it is a named, reported failure like any
 * other. `read-activity-file.test.ts` proves the check with a two-record file.
 *
 * ## Faults are carried, not swallowed
 *
 * Both decoders separate "the ride" from "everything wrong with the file", and
 * so does this. A truncated file yields the records that were readable **and**
 * a fault; the ride is imported and the fault is reported beside its filename.
 * Discarding either half is what makes an import screen useless: a rider who is
 * told only "import failed" has nothing to act on, and a rider told nothing at
 * all does not know a third of the ride is missing.
 */

import {
  metres,
  seconds,
  unixSeconds,
  watts,
  type Metres,
  type Seconds,
  type UnixSeconds,
  type Watts,
} from '@onyourleft/domain';
import {
  ActivityXmlError,
  decodeFitActivity,
  decodeGpx,
  decodeTcx,
  FitDecodeError,
  TCX_CREATOR,
  type FitLap,
  type FitRecord,
  type TrackActivity,
  type TrackPoint,
} from '@onyourleft/fit';
import type { StreamChannel, StreamChannels, StreamChannelValue } from '@onyourleft/store';

import { recordedStretch } from '../recording/laps';
import { courseVerdict, type CourseVerdict } from './course-shaped';
import { detectActivityFileFormat, type ActivityFileFormat } from './file-format';
import { distanceAlongTrack } from './track-distance';

/**
 * The longest ride this client will build a sample grid for: 48 hours at 1 Hz.
 *
 * Comfortably past a Race Across America stage and past every ultra-endurance
 * ride a single file plausibly holds, and 172,800 slots is about 1.4 MB per
 * numeric channel — bounded, and bounded by a constant in this file rather than
 * by a number the file supplies.
 *
 * Rejecting is the right answer rather than truncating: a file whose timestamps
 * span three years is not a long ride, it is a broken clock or a hostile file,
 * and silently importing its first two days would file fiction under the
 * rider's history.
 */
export const MAXIMUM_IMPORTED_SAMPLES = 172_800;

/** The grid every imported ride is placed on. ADR 0011, and what FIT expects. */
export const IMPORT_SAMPLE_INTERVAL: Seconds = seconds(1);

/**
 * The most laps this client will list for one imported ride — #1320.
 *
 * A file's lap count is a number the file supplies, and each lap listed is a
 * row written and a pass over its slots. The passes are bounded already (the
 * laps are made to follow one another, {@link lapsWithin}, so together they
 * cover no slot twice); this bounds the rows. Ten thousand is a lap every
 * seventeen seconds of a 48-hour ride ({@link MAXIMUM_IMPORTED_SAMPLES}), far
 * past an auto-lap every kilometre. A file past it keeps its ride, lists no
 * laps, and says so in its faults.
 */
export const MAXIMUM_IMPORTED_LAPS = 10_000;

/** Why one file could not become a ride. */
export type ImportFaultCode =
  /** Not FIT, GPX or TCX — a `.csv`, a `.gz`, an image, a readme. */
  | 'unsupported-format'
  /** The right format, and the decoder refused it. `cause` carries the codec's error. */
  | 'undecodable'
  /** Decoded, and carried no sample with an absolute time to place it at. */
  | 'no-timestamped-samples'
  /** @see MAXIMUM_IMPORTED_SAMPLES */
  | 'too-many-samples';

/**
 * One file's refusal, carrying the code the import report shows.
 *
 * An `Error` subclass rather than a result union because every caller wants the
 * same thing — the file's name beside a sentence — and the codec's own errors
 * arrive as exceptions anyway. {@link ActivityImportError.cause} keeps the
 * codec's error so the reason a rider sees is the codec's own diagnostic and
 * not "import failed".
 */
export class ActivityImportError extends Error {
  readonly code: ImportFaultCode;
  /**
   * Whether the file this refusal is about looked like a **course** (#232).
   *
   * ⚠️ **A refusal is where this matters most.** A GPX carrying a line and no
   * time on any point is exactly what a route planner exports, and it is also
   * the one file `readActivityFile` cannot import at all — so without this the
   * screen's only answer to the commonest course in the wild would be
   * "no-timestamped-samples", and the rider would never learn that the other
   * importer would have taken it. `undefined` for every refusal with no
   * decoded track behind it, and for every format but GPX.
   */
  readonly course: CourseVerdict | undefined;

  constructor(
    code: ImportFaultCode,
    message: string,
    options?: { cause?: unknown; course?: CourseVerdict | undefined },
  ) {
    super(message, options);
    this.name = 'ActivityImportError';
    this.code = code;
    this.course = options?.course;
  }
}

/**
 * One of a file's laps, as the import lists it — #1320.
 *
 * Its times are the file's, bounded to the ride ({@link lapsWithin}); its
 * distance is the file's where it states one, and otherwise the recording's
 * own rule over the lap's slots; its climb is the recording's own rule over
 * the lap's altitude readings (`recording/laps.ts` §`recordedStretch`, the
 * rule for a lap with no course under it).
 *
 * The two follow ONE preference order — the file's figure where the import
 * has one, the samples' otherwise — and differ only because no file this
 * client reads states a lap's climb: TCX's `<Lap>` has no element for it, GPX
 * lists no laps, and `packages/fit` decodes a FIT lap's `total_distance` but
 * not its `total_ascent`. A lap distance is stated by both formats that list
 * laps, so it is the file's, as the ride's own distance is ({@link rideOf}).
 *
 * Its averages are NOT here: they are
 * worked out from the imported samples by `recording/laps.ts` when the row is
 * written (`import-batch.ts`), never taken on trust from the file.
 */
export interface ImportedLap {
  readonly startedAt: UnixSeconds;
  readonly elapsedTime: Seconds;
  readonly movingTime: Seconds;
  readonly distance: Metres;
  readonly ascent: Metres | undefined;
}

/** A ride read out of a file, ready to be written to the store. */
export interface ImportedRide {
  readonly format: ActivityFileFormat;
  readonly name: string;
  readonly startedAt: UnixSeconds;
  readonly elapsedTime: Seconds;
  readonly movingTime: Seconds;
  readonly distance: Metres;
  readonly hasPosition: boolean;
  readonly averagePower: Watts | undefined;
  readonly sampleInterval: Seconds;
  readonly sampleCount: number;
  readonly channels: StreamChannels;
  /**
   * Whether this file looked like a **course to ride** rather than the ride it
   * has just been imported as — #232, and `course-shaped.ts` for the rule.
   *
   * `undefined` for every format but GPX, because `routes/save.ts` reads GPX
   * and nothing else: a verdict on a FIT file would describe an offer this app
   * cannot make.
   */
  readonly course: CourseVerdict | undefined;
  /**
   * The file's laps, in order — #1320. **Empty unless the file has two or
   * more, and was written by something that names itself and is not this
   * client** ({@link lapsWithin} says why). One lap is the ride said again.
   */
  readonly laps: readonly ImportedLap[];
  /**
   * Recoverable faults the codec reported, one sentence each.
   *
   * Non-empty is **not** a failure: the ride imported, and this is what was
   * wrong with the file on the way in.
   */
  readonly faults: readonly string[];
}

/**
 * Read one file.
 *
 * @throws {ActivityImportError} for every reason a file does not become a ride.
 * Nothing else escapes: a codec error is caught and re-thrown as `undecodable`
 * with the original on `cause`.
 */
export function readActivityFile(fileName: string, bytes: Uint8Array): ImportedRide {
  const format = detectActivityFileFormat(fileName, bytes);
  if (format === undefined) {
    throw new ActivityImportError(
      'unsupported-format',
      'not a FIT, GPX or TCX activity file. A bulk export from another platform contains ' +
        'other things too — a summary spreadsheet, media, and compressed copies of the rides ' +
        'themselves — and this client reads the three activity formats uncompressed.',
    );
  }
  return format === 'fit' ? readFit(fileName, bytes) : readXml(format, fileName, bytes);
}

function readFit(fileName: string, bytes: Uint8Array): ImportedRide {
  const result = decode(() => decodeFitActivity(bytes));
  const session = result.activity.sessions[0];
  return rideOf({
    format: 'fit',
    fileName,
    // FIT's profile subset carries no activity name, so the file's own name is
    // the only name there is. Deliberately not "Imported ride": a rider
    // recognises `2024-07-14-morning-ride` and cannot tell twelve identical
    // placeholders apart.
    name: undefined,
    points: result.activity.records.map(pointOfFitRecord),
    statedElapsedTime: session?.totalElapsedTime,
    statedMovingTime: session?.totalTimerTime,
    statedDistance: session?.totalDistance,
    statedLaps: result.activity.laps.map(statedLapOfFit),
    // FIT's `file_id` names the maker of the device or app that wrote it. This
    // client's own export names none (`export-activity.ts` §`fitInputOf`).
    listsLaps: result.activity.fileId?.manufacturer !== undefined,
    faults: result.faults.map((fault) => fault.message),
  });
}

function statedLapOfFit(lap: FitLap): StatedLap {
  return {
    // A system time cannot be placed on the ride's clock: the lap then starts
    // where the one before it ended (`lapsWithin`).
    startedAt: lap.startTime?.kind === 'instant' ? lap.startTime.instant : undefined,
    elapsedTime: lap.totalElapsedTime,
    movingTime: lap.totalTimerTime,
    distance: lap.totalDistance,
  };
}

function readXml(format: 'gpx' | 'tcx', fileName: string, bytes: Uint8Array): ImportedRide {
  // `fatal: true`, unlike the sniffer: at this point the file has claimed to be
  // XML, and bytes that are not valid UTF-8 make it a file whose text cannot be
  // believed rather than a file with an odd character in it.
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause: unknown) {
    throw new ActivityImportError(
      'undecodable',
      'the file claims to be XML and its bytes are not valid UTF-8',
      { cause },
    );
  }
  const result = decode(() => (format === 'gpx' ? decodeGpx(text) : decodeTcx(text)));
  return rideOf({
    format,
    fileName,
    name: result.activity.name,
    points: result.activity.laps.flatMap((lap) => lap.points),
    statedElapsedTime: statedElapsedTimeOf(result.activity),
    statedMovingTime: undefined,
    statedDistance: statedDistanceOf(result.activity),
    statedLaps: result.activity.laps.map((lap) => ({
      startedAt: lap.startTime ?? lap.points[0]?.timestamp,
      // ⚠️ **A TCX lap's one time is its MOVING time, and its end is where
      // the next lap starts** (#1320). `TotalTimeSeconds` (the codec's
      // `totalElapsedTime`) is timer time in Garmin's files and most others':
      // it leaves auto-pause out. Read as elapsed time it ended a lap that
      // held a pause early, and cut the slots its averages are taken over.
      // Every `<Lap>` carries a `StartTime`, so a lap runs to the next one's
      // and the last to the ride's last sample — an untimed lap, in
      // `lapsWithin`'s terms — and the stated time is held to that span.
      // This client's own export writes each split's wall-clock span there,
      // which is the same number by either reading (`controller.test.ts`,
      // "reads this client's own TCX splits back with the times it wrote").
      elapsedTime: undefined,
      movingTime: lap.totalElapsedTime,
      distance: lap.totalDistance,
    })),
    // ⚠️ GPX lists no laps: a `<trkseg>` is as often a new segment after a lost
    // signal or a pause as it is a lap, and it states no totals of its own.
    // TCX's `<Creator>` names what wrote the file; this client writes its own
    // name there (`TCX_CREATOR`).
    listsLaps:
      format === 'tcx' &&
      result.activity.creator !== undefined &&
      result.activity.creator !== TCX_CREATOR,
    faults: result.faults.map((fault) => fault.message),
  });
}

/**
 * Run a decoder, turning its refusal into this module's error.
 *
 * Narrowed to the codec's two error types rather than catching everything: a
 * `RangeError` from a bug in this client is not a malformed file, and reporting
 * it beside a filename as "this file is bad" would send the rider looking at
 * their archive for a defect that is ours.
 */
function decode<T>(run: () => T): T {
  try {
    return run();
  } catch (cause: unknown) {
    if (cause instanceof FitDecodeError || cause instanceof ActivityXmlError) {
      throw new ActivityImportError('undecodable', cause.message, { cause });
    }
    throw cause;
  }
}

/**
 * A FIT record as a track point.
 *
 * The two shapes are the same ride sample with one difference, and it is the
 * one that matters here: a FIT timestamp may be a *system* time — seconds since
 * the device powered on — which cannot be placed on an absolute grid at all.
 * Those become `undefined` and are dropped by {@link rideOf}, which is what
 * makes "a file with no absolute times" a named failure rather than a ride
 * dated 1989.
 */
function pointOfFitRecord(record: FitRecord): TrackPoint {
  return {
    timestamp: record.timestamp?.kind === 'instant' ? record.timestamp.instant : undefined,
    position: record.position,
    altitude: record.altitude,
    distance: record.distance,
    speed: record.speed,
    heartRate: record.heartRate,
    cadence: record.cadence,
    power: record.power,
    temperature: record.temperature,
  };
}

/**
 * A sum of the totals a file's laps state, to the thousandth.
 *
 * ⚠️ **A decimal a file wrote is exact as text and not as a float** (#1312):
 * laps stating `5.3`, `10.2` and `12.1` are 27.6 seconds between them, and
 * adding the three floats gives `27.599999999999998`. Stored as it comes, a
 * ride exported with its laps would come back a hair shorter than the same
 * ride exported with none. A thousandth is finer than either XML format is
 * written to and far coarser than the error.
 *
 * ⚠️ **This applies to EVERY file with lap totals, not only this client's
 * own.** A lap from somewhere else that states `12345.678912` metres is
 * stored as `12345.679`: under half a millimetre, and under half a
 * millisecond for a time. A file written to tenths, as this client's are,
 * reads back exactly as it did.
 */
function summed(parts: readonly (number | undefined)[]): number {
  const total = parts.reduce<number>((sum, part) => (part === undefined ? sum : sum + part), 0);
  return Math.round(total * 1000) / 1000;
}

function statedElapsedTimeOf(activity: TrackActivity): Seconds | undefined {
  const total = summed(activity.laps.map((lap) => lap.totalElapsedTime));
  return total === 0 ? undefined : seconds(total);
}

function statedDistanceOf(activity: TrackActivity): Metres | undefined {
  const total = summed(activity.laps.map((lap) => lap.totalDistance));
  return total === 0 ? undefined : metres(total);
}

/** A lap as a file states it, before it is bounded to the ride. */
interface StatedLap {
  readonly startedAt: UnixSeconds | undefined;
  readonly elapsedTime: Seconds | undefined;
  readonly movingTime: Seconds | undefined;
  readonly distance: Metres | undefined;
}

interface RideInput {
  readonly format: ActivityFileFormat;
  readonly fileName: string;
  readonly name: string | undefined;
  readonly points: readonly TrackPoint[];
  readonly statedElapsedTime: Seconds | undefined;
  readonly statedMovingTime: Seconds | undefined;
  readonly statedDistance: Metres | undefined;
  readonly statedLaps: readonly StatedLap[];
  /** Whether this file's laps are listed at all. @see lapsWithin */
  readonly listsLaps: boolean;
  readonly faults: readonly string[];
}

/**
 * The grid under construction: channel name → its samples, by index.
 *
 * A `Map` of `unknown[]` rather than a mutable `StreamChannels`, and the
 * difference is not cosmetic. A mapped type indexed by a *generic* channel
 * resolves its element type to the **intersection** of all eight quantities, so
 * every write needs a cast — and a cast inside {@link put} is a cast that no
 * longer relates `channel` to `value`, which is precisely the guard that stops
 * a longitude being written into the latitude channel. Keeping the container
 * untyped and {@link put} generic puts the one cast at the assembly step, where
 * it relates nothing and can hide nothing.
 */
type BuiltChannels = Map<StreamChannel, unknown[]>;

/** A sample that has somewhere to go: a point and the instant it happened. */
interface TimedPoint {
  readonly at: UnixSeconds;
  readonly point: TrackPoint;
}

function rideOf(input: RideInput): ImportedRide {
  // Judged before anything can throw, so a file that is refused still carries
  // the one thing the screen can usefully say about it. Only GPX is judged —
  // see `course-shaped.ts`, and the field's own note on {@link ImportedRide}.
  const course = input.format === 'gpx' ? courseVerdict(input.points) : undefined;
  const timed: TimedPoint[] = [];
  // ⚠️ A loop rather than `Math.min(...timestamps)`. A four-hour ride is about
  // 14,400 points and an ultra-endurance file is well past a hundred thousand,
  // and spreading an array that size into a call throws `RangeError: Maximum
  // call stack size exceeded` — on the *large* files, which are exactly the
  // ones nobody tests with. The narrowing in the same pass is what lets
  // `at` be a `UnixSeconds` with no assertion anywhere below.
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const point of input.points) {
    const at = point.timestamp;
    if (at === undefined) {
      continue;
    }
    timed.push({ at, point });
    first = Math.min(first, at);
    last = Math.max(last, at);
  }
  if (timed.length === 0) {
    throw new ActivityImportError(
      'no-timestamped-samples',
      'the file decoded and carried no sample with an absolute time, so there is no ride to ' +
        'place on a timeline',
      { course },
    );
  }
  // Checked before anything is allocated. This is the whole of the bound: past
  // this line the arrays are sized by `sampleCount` and nothing else.
  const sampleCount = last - first + 1;
  if (sampleCount > MAXIMUM_IMPORTED_SAMPLES) {
    throw new ActivityImportError(
      'too-many-samples',
      `the file's samples span ${String(Math.round(sampleCount / 3600))} hours, past the ` +
        `${String(MAXIMUM_IMPORTED_SAMPLES / 3600)}-hour limit this client will build a ` +
        'sample grid for. A span that long is a device clock that jumped rather than a ride',
      { course },
    );
  }

  const built: BuiltChannels = new Map();
  let furthest: number | undefined;
  let powerTotal = 0;
  let powerSamples = 0;
  let hasPosition = false;

  for (const { at, point } of timed) {
    // `Math.round` rather than a floor: a device that samples at 1.0 Hz with a
    // few milliseconds of jitter would otherwise alternate between two slots,
    // and every second sample would overwrite the one before it.
    const index = Math.round(at - first);
    put(built, 'power', index, point.power, sampleCount);
    put(built, 'heartRate', index, point.heartRate, sampleCount);
    put(built, 'cadence', index, point.cadence, sampleCount);
    put(built, 'speed', index, point.speed, sampleCount);
    put(built, 'latitude', index, point.position?.latitude, sampleCount);
    put(built, 'longitude', index, point.position?.longitude, sampleCount);
    put(built, 'altitude', index, point.altitude, sampleCount);
    put(built, 'temperature', index, point.temperature, sampleCount);
    if (point.distance !== undefined && (furthest === undefined || point.distance > furthest)) {
      furthest = point.distance;
    }
    if (point.power !== undefined) {
      powerTotal += point.power;
      powerSamples += 1;
    }
    // Read from the sample rather than from the built channels. Both formats
    // carry a position as one both-or-neither value, so `channels.latitude !==
    // undefined && channels.longitude !== undefined` would be a conjunction
    // whose two halves cannot disagree — a branch no test could distinguish
    // from either half alone, which is a guard in appearance only.
    hasPosition ||= point.position !== undefined;
  }

  /**
   * The wall clock, and the only number here the file cannot inflate: the last
   * sample's timestamp minus the first.
   *
   * ⚠️ **Both stated totals are bounded by this and not by each other.** The
   * clamp below used to compare the stated moving time against the stated
   * *elapsed* time, which is one number a file wrote checked against another
   * number the same file wrote — so `paused-laps.fit` re-encoded with
   * `totalElapsedTime = totalTimerTime = 86_400` read back as a 24-hour ride
   * with 419 samples spanning 418 seconds, and passed the guard whose comment
   * says it prevents exactly that. A device whose clock is corrected mid-ride
   * writes a summary that disagrees with its own records; storing it would put
   * a ride in #11's analysis with an elapsed and a moving time it never had.
   */
  const observedSpan = seconds(last - first);
  const elapsedTime = boundedBy(input.statedElapsedTime, observedSpan);
  /**
   * The distance, in the order of preference the file itself sets.
   *
   * 1. **A total the file states.** A session or lap total is what every other
   *    reader shows for this file, and deriving over the top of it is how an
   *    imported ride ends up disagreeing with the platform it came from.
   * 2. **The largest per-point cumulative distance.** Also the file's own
   *    number, one record at a time rather than one summary.
   * 3. **Derived from the track's positions**, and only then. `track-distance.ts`
   *    owns that rule and the three thresholds it rejects on; the header there
   *    says why it is not the rule `recording/finish.ts` uses.
   *
   * ⚠️ **The derivation is a fallback and never an override** — #231's second
   * criterion, and the reason it sits at the end of a `??` chain rather than
   * inside a `Math.max`. A file that states a distance keeps the one it states,
   * even when this module would have derived a larger one.
   */
  const distance =
    input.statedDistance ??
    (furthest === undefined ? distanceAlongTrack(input.points) : metres(furthest));
  const laps = input.listsLaps
    ? lapsWithin(input.statedLaps, unixSeconds(first), unixSeconds(first + observedSpan), {
        startedAt: first,
        sampleCount,
        built,
        distance,
      })
    : { laps: [], fault: undefined };
  return {
    format: input.format,
    name: input.name ?? nameFromFileName(input.fileName),
    startedAt: unixSeconds(first),
    elapsedTime,
    // And the moving time is bounded by the elapsed time in turn, which is now
    // itself bounded by the span — so a moving time can never exceed either.
    movingTime: boundedBy(input.statedMovingTime, elapsedTime),
    distance,
    hasPosition,
    averagePower: powerSamples === 0 ? undefined : watts(Math.round(powerTotal / powerSamples)),
    sampleInterval: IMPORT_SAMPLE_INTERVAL,
    sampleCount,
    // The one cast, and it relates nothing: every entry was written by `put`
    // under its own channel's key, so the object it produces is exactly
    // `StreamChannels`. `putStreamSet` re-validates every sample against the
    // channel's declared resolution regardless, which is the second net.
    channels: Object.fromEntries(built),
    course,
    laps: laps.laps,
    faults: laps.fault === undefined ? input.faults : [...input.faults, laps.fault],
  };
}

/** What {@link lapsWithin} reads of the grid under construction. */
interface LapGrid {
  readonly startedAt: number;
  readonly sampleCount: number;
  readonly built: BuiltChannels;
  readonly distance: Metres;
}

/**
 * A file's laps, bounded to the ride and made to follow one another — #1320.
 *
 * ## Which files' laps are listed
 *
 * A file lists its laps (`RideInput.listsLaps`) when it names what wrote it
 * and that is not this client: a FIT `file_id` with a manufacturer, a TCX
 * `<Creator>` that is not {@link TCX_CREATOR}. Such a file's laps are the
 * device's own — the rider's lap button, or an auto-lap every so far — and
 * every one of them is a lap. GPX never lists any.
 *
 * ⚠️ **This client's own files list none, yet.** Since #1316 a file this
 * client writes has a split for the time before a course's first lap, between
 * two that do not meet and after the last (`export-activity.ts` §`splitsOf`),
 * and nothing in the file says which splits are laps of the course. Listing
 * them all would show a lead-in as a lap and could make it the best one. The
 * mark is #1321's; until a file carries it, a file that names no writer, or
 * names this client, is read with no laps — as every file was before #1320.
 *
 * ## A lap's times
 *
 * - **FIT** states both: a lap ends at `start_time + total_elapsed_time`, and
 *   `total_timer_time` is its moving time.
 * - **TCX** states one, `TotalTimeSeconds`, which is timer time: a lap ends
 *   where the next one starts, the last where the ride's samples do, and the
 *   stated time is its moving time (`readXml` says why).
 * - A FIT lap that states no time runs to the next lap's start, the same way.
 *
 * ## The bounds, because a file is untrusted input
 *
 * - **A lap starts no earlier than the one before it ended, and inside the
 *   ride; it ends no earlier than it starts and no later than the ride.** So
 *   the laps cover no slot twice, and the passes over their slots (here, and
 *   `recording/laps.ts` when the rows are written) are one pass over the ride
 *   between them, whatever the file states. A lap left with no time is
 *   dropped.
 * - A lap's moving time is no more than its elapsed time. Their sum is held
 *   to the ride's own when the rows are written (`recording/laps.ts`
 *   §`lapsToSave`).
 * - A lap's distance is no more than what the ride has left after the laps
 *   before it: together they go no further than the ride did.
 * - Past {@link MAXIMUM_IMPORTED_LAPS}, none are listed, and a fault says so.
 * - Fewer than two left, and none are listed: a single lap is the ride said
 *   again — every file with no splits in it.
 */
function lapsWithin(
  stated: readonly StatedLap[],
  rideStart: UnixSeconds,
  rideEnd: UnixSeconds,
  grid: LapGrid,
): { readonly laps: readonly ImportedLap[]; readonly fault: string | undefined } {
  if (stated.length > MAXIMUM_IMPORTED_LAPS) {
    return {
      laps: [],
      fault:
        `the file states ${String(stated.length)} laps, past the ` +
        `${String(MAXIMUM_IMPORTED_LAPS)} this client will list, so the ride was imported ` +
        'without its laps',
    };
  }
  const within = (value: number, low: number, high: number): number =>
    Math.min(high, Math.max(low, value));
  const laps: ImportedLap[] = [];
  let cursor: number = rideStart;
  let distanceLeft: number = grid.distance;
  stated.forEach((lap, index) => {
    const statedStart = lap.startedAt ?? cursor;
    const startedAt = within(statedStart, cursor, rideEnd);
    // Where the file says the lap ended, before either end is bounded; and a
    // lap that states no time of its own runs to where the next one starts —
    // every TCX lap, whose one time is its moving time (`readXml`).
    const statedEnd =
      lap.elapsedTime === undefined
        ? (stated[index + 1]?.startedAt ?? rideEnd)
        : statedStart + lap.elapsedTime;
    const endsAt = within(statedEnd, startedAt, rideEnd);
    cursor = endsAt;
    const elapsed = endsAt - startedAt;
    if (elapsed <= 0) {
      return;
    }
    const recorded = recordedStretch(
      {
        sampleInterval: IMPORT_SAMPLE_INTERVAL,
        channels: {
          speed: slotsOf(grid, 'speed', startedAt, endsAt),
          altitude: slotsOf(grid, 'altitude', startedAt, endsAt),
        },
      },
      false,
    );
    const lapDistance = Math.min(lap.distance ?? recorded.distance, distanceLeft);
    distanceLeft -= lapDistance;
    laps.push({
      startedAt: unixSeconds(startedAt),
      elapsedTime: seconds(elapsed),
      movingTime: seconds(Math.min(lap.movingTime ?? elapsed, elapsed)),
      distance: metres(lapDistance),
      ascent: recorded.ascent,
    });
  });
  return { laps: laps.length < 2 ? [] : laps, fault: undefined };
}

/**
 * The samples of one channel in the slots from the one `from` is in up to and
 * not including the one `to` is in — `recording/laps.ts` §`lapSlots`'s rule,
 * on the import's 1 Hz grid. `undefined` for a channel the file did not carry.
 *
 * ⚠️ **A floor, as `lapSlots` is, and not `rideOf`'s `Math.round`.** The
 * row's averages are worked out by `lapSlots` itself when it is written
 * (`import-batch.ts` §`lapRowsOf`), so a lap's distance and climb must be
 * taken over the same slots or a lap ending between two samples — FIT states
 * a lap's time to the millisecond — would count one slot's road that its
 * averages leave out. The two rules for a SAMPLE cannot disagree: every
 * sample time a FIT, GPX or TCX file carries is read as a whole second
 * (FIT's `date_time`; `packages/fit` §`parseIsoInstant` drops a fraction), so
 * `rideOf`'s round moves none of them.
 */
function slotsOf<C extends 'speed' | 'altitude'>(
  grid: LapGrid,
  channel: C,
  from: number,
  to: number,
): (StreamChannelValue[C] | undefined)[] | undefined {
  const samples = grid.built.get(channel);
  if (samples === undefined) {
    return undefined;
  }
  const slot = (at: number): number =>
    Math.min(grid.sampleCount, Math.max(0, Math.floor(at - grid.startedAt)));
  // The one cast, and `put`'s reason: every entry under this key was written
  // by `put` under this channel.
  return samples.slice(slot(from), slot(to)) as (StreamChannelValue[C] | undefined)[];
}

/**
 * A total a file states, if it is not longer than what the file's own samples
 * support — and the supported value otherwise.
 *
 * Absent is the same answer as impossible on purpose: in both cases the number
 * the file offered is not usable, and the derived one is what a reader that had
 * never looked at the summary would show.
 */
function boundedBy(stated: Seconds | undefined, bound: Seconds): Seconds {
  return stated !== undefined && stated <= bound ? stated : bound;
}

/**
 * Write one sample into one channel, creating the channel's array on first use.
 *
 * Lazy, so a ride with no heart-rate strap has **no** `heartRate` channel
 * rather than one full of gaps — which is the difference ADR 0011 draws
 * between "the sensor dropped out" and "there was no sensor".
 */
function put<C extends StreamChannel>(
  built: BuiltChannels,
  channel: C,
  index: number,
  value: StreamChannelValue[C] | undefined,
  sampleCount: number,
): void {
  if (value === undefined) {
    return;
  }
  let samples = built.get(channel);
  if (samples === undefined) {
    samples = new Array<unknown>(sampleCount).fill(undefined);
    built.set(channel, samples);
  }
  samples[index] = value;
}

/** `2024-07-14-morning-ride.fit` → `2024-07-14-morning-ride`. */
function nameFromFileName(fileName: string): string {
  const withoutPath = fileName.split('/').pop() ?? fileName;
  const dot = withoutPath.lastIndexOf('.');
  const stem = dot <= 0 ? withoutPath : withoutPath.slice(0, dot);
  return stem === '' ? fileName : stem;
}
