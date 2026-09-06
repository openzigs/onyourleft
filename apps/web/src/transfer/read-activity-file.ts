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
  type FitRecord,
  type TrackActivity,
  type TrackPoint,
} from '@onyourleft/fit';
import type { StreamChannel, StreamChannels, StreamChannelValue } from '@onyourleft/store';

import { detectActivityFileFormat, type ActivityFileFormat } from './file-format';

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

  constructor(code: ImportFaultCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ActivityImportError';
    this.code = code;
  }
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
    faults: result.faults.map((fault) => fault.message),
  });
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

function statedElapsedTimeOf(activity: TrackActivity): Seconds | undefined {
  const total = activity.laps.reduce(
    (sum, lap) => (lap.totalElapsedTime === undefined ? sum : sum + lap.totalElapsedTime),
    0,
  );
  return total === 0 ? undefined : seconds(total);
}

function statedDistanceOf(activity: TrackActivity): Metres | undefined {
  const total = activity.laps.reduce(
    (sum, lap) => (lap.totalDistance === undefined ? sum : sum + lap.totalDistance),
    0,
  );
  return total === 0 ? undefined : metres(total);
}

interface RideInput {
  readonly format: ActivityFileFormat;
  readonly fileName: string;
  readonly name: string | undefined;
  readonly points: readonly TrackPoint[];
  readonly statedElapsedTime: Seconds | undefined;
  readonly statedMovingTime: Seconds | undefined;
  readonly statedDistance: Metres | undefined;
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

  const elapsedTime = input.statedElapsedTime ?? seconds(last - first);
  const distance = input.statedDistance ?? metres(furthest ?? 0);
  return {
    format: input.format,
    name: input.name ?? nameFromFileName(input.fileName),
    startedAt: unixSeconds(first),
    elapsedTime,
    // Never longer than the wall clock: a file that states a timer time longer
    // than its own span is stating something impossible, and storing it would
    // put a ride in #11's analysis with a moving time it never had.
    movingTime:
      input.statedMovingTime !== undefined && input.statedMovingTime <= elapsedTime
        ? input.statedMovingTime
        : elapsedTime,
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
    faults: input.faults,
  };
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
