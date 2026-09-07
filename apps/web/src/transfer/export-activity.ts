// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The exit door: one stored ride → one file the rider owns.
 *
 * ADR 0009 R5 makes this the whole of the interoperability surface out of this
 * project, and #51 calls it *"the exit door out"*. A local-first product with
 * no export is a silo with better marketing, so this path is the one that has
 * to keep working.
 *
 * ## The athlete's own data is not obfuscated for the athlete
 *
 * #21 and ADR 0004: privacy zones exist to keep a home address out of what is
 * *published*. Nothing here is published — Phase 1 has no server at all (owner
 * decision D6) — and an export is the rider asking for their own ride back.
 * **So the track written here is the stored track, coordinate for coordinate.**
 * There is no zone lookup in this file and there must not be one: withholding a
 * rider's own GPS trace from them would be the product deciding it knows better
 * than the person who rode it, and it would make export useless as the
 * migration path off this software.
 *
 * A future publish or share path (#7, Phase 3) is where zones are applied, and
 * it is a different function from this one.
 *
 * ## What each format can carry
 *
 * FIT carries everything the store holds. GPX and TCX each drop something, and
 * the codec states what — {@link GPX_LOSSY_CHANNELS}, {@link TCX_LOSSY_CHANNELS}
 * — rather than this file guessing. The view shows those lists beside the
 * format chooser, so the rider picks knowing the cost.
 */

import { geographicPosition, unixSeconds, type UnixSeconds } from '@onyourleft/domain';
import {
  encodeFitActivity,
  encodeGpx,
  encodeTcx,
  FILE_TYPE_ACTIVITY,
  GPX_LOSSY_CHANNELS,
  SPORT_CYCLING,
  TCX_LOSSY_CHANNELS,
  type FitDateTime,
  type FitEncodeError,
  type FitEncodeFaultCode,
  type FitEncodeInput,
  type FitRecord,
  type TrackActivity,
  type TrackPoint,
} from '@onyourleft/fit';
import type { ActivityId, ActivityRecord, AthleteId, StreamSet } from '@onyourleft/store';

import type { ActivityFileFormat } from './file-format';
import type { DownloadableFile, TransferStore } from './store-port';

/** What a format costs, in the codec's own words. Empty for FIT. */
export const LOSSY_CHANNELS: Readonly<Record<ActivityFileFormat, readonly string[]>> = {
  fit: [],
  gpx: GPX_LOSSY_CHANNELS,
  tcx: TCX_LOSSY_CHANNELS,
};

/**
 * The media types, chosen so a browser saves rather than renders.
 *
 * GPX and TCX are XML and `text/xml` would open them in a tab on some
 * platforms; the registered `application/*+xml` types are the honest answer and
 * are also what every reader sniffs for.
 */
const MEDIA_TYPE: Readonly<Record<ActivityFileFormat, string>> = {
  fit: 'application/vnd.ant.fit',
  gpx: 'application/gpx+xml',
  tcx: 'application/vnd.garmin.tcx+xml',
};

/** Why an export produced nothing. */
export type ExportFaultCode = 'no-such-activity' | 'no-streams';

export class ActivityExportError extends Error {
  readonly code: ExportFaultCode;

  constructor(code: ExportFaultCode, message: string) {
    super(message);
    this.name = 'ActivityExportError';
    this.code = code;
  }
}

/** @see exportActivity */
export interface ExportOptions {
  readonly store: TransferStore;
  readonly athleteId: AthleteId;
  readonly activityId: ActivityId;
  readonly format: ActivityFileFormat;
}

/**
 * What this particular file could not carry, in words a rider can act on.
 *
 * Distinct from {@link LOSSY_CHANNELS}, and the distinction is the whole point:
 * that constant is what a *format* always costs and is known before the export
 * runs, so the screen shows it while the rider is still choosing. This is what
 * *this ride* cost, and it is knowable only after encoding — a value outside
 * what FIT can hold, an instant with no FIT representation. One is a property
 * of the choice; the other is a property of the data.
 *
 * ⚠️ **No value is ever interpolated into these strings.** ADR 0004 decision D
 * binds every layer that formats a coordinate, and the encoder already honours
 * it — `packages/fit/src/encode/errors.ts` says a fault message "never carries
 * the value that caused it". Mapping on the fault's `code` rather than
 * forwarding its `message` keeps that true here by construction rather than by
 * inheritance, and keeps codec prose out of a rider's screen.
 */
export const EXPORT_FAULT_TEXT: Readonly<Record<FitEncodeFaultCode, string>> = {
  'nothing-to-encode': 'there was nothing to write',
  // Thrown by the encoder rather than collected, so it cannot reach `faults`
  // and this line should be unreachable. It is here because the record is
  // keyed by the codec's whole union deliberately — that is what makes a new
  // fault code in `packages/fit` a compile error here instead of a silent
  // omission — and buying that guarantee for the price of one unreachable
  // string is the right trade. If it ever does surface, it says something
  // true rather than `undefined`.
  'too-many-message-types': 'the ride needed more kinds of record than the format allows',
  'missing-file-id': 'the file is missing its file-type record, so a strict reader may reject it',
  'value-not-representable': 'a value this format cannot hold was left out',
  'instant-not-representable': 'a timestamp this format cannot hold was left out',
  'instant-reads-back-as-system-time': 'a timestamp some readers will misread as a device uptime',
};

/** A file, and what it cost to write it. */
export interface ExportedActivity {
  readonly file: DownloadableFile;
  /**
   * One entry per distinct thing that could not be carried, deduplicated by
   * fault code and ordered as the encoder reported them.
   *
   * **Empty for a clean export**, which is what stops this being an always-on
   * warning a rider learns to ignore. Deduplicated because a ride with four
   * hundred unrepresentable altitudes has one problem, not four hundred.
   */
  readonly lost: readonly string[];
}

/**
 * Read a ride back out of the store and write it as a file.
 *
 * Both reads are athlete-scoped by the store's own signatures, so another
 * athlete's ride cannot be exported by knowing its id — the cross-athlete
 * exposure class in CLAUDE.md §6, closed at the only place this screen reads.
 *
 * @throws {ActivityExportError} when this athlete has no such ride, or the ride
 * has no samples. Both are honest refusals: a zero-sample FIT file is a file
 * every reader accepts and no rider wants.
 */
export async function exportActivity(options: ExportOptions): Promise<ExportedActivity> {
  const { store, athleteId, activityId, format } = options;
  const activity = await store.getActivity(athleteId, activityId);
  if (activity === undefined) {
    throw new ActivityExportError(
      'no-such-activity',
      'that ride is not on this device under this athlete',
    );
  }
  const streams = await store.getStreamSet(athleteId, activityId);
  if (streams === undefined || streams.sampleCount === 0) {
    throw new ActivityExportError(
      'no-streams',
      `“${activity.name}” has no stored samples, so there is nothing to write into a file`,
    );
  }

  const points = pointsOf(streams);

  // #162. The encoder's contract is deliberately *bytes plus faults*: the file
  // is still produced, and a caller that reads the faults can tell the rider
  // what did not survive. This is the codec's one production caller, and it
  // used to take `.bytes` and drop the rest — so a ride whose altitude channel
  // could not be written came out as a silently incomplete file.
  //
  // Only FIT reports per-file faults. GPX and TCX lose channels the format has
  // no element for at all, which is a property of the format rather than of the
  // ride, and is `LOSSY_CHANNELS` above.
  let bytes: Uint8Array;
  let faults: readonly FitEncodeError[] = [];
  if (format === 'fit') {
    const encoded = encodeFitActivity(fitInputOf(activity, streams, points));
    bytes = encoded.bytes;
    faults = encoded.faults;
  } else {
    bytes = new TextEncoder().encode(
      format === 'gpx'
        ? encodeGpx(trackActivityOf(activity, points))
        : encodeTcx(trackActivityOf(activity, points)),
    );
  }

  return {
    file: { fileName: `${fileStemOf(activity)}.${format}`, bytes, mediaType: MEDIA_TYPE[format] },
    lost: lostFrom(faults),
  };
}

/**
 * Fault objects to rider-facing lines, deduplicated by code.
 *
 * Order follows the encoder's, so the first thing that went wrong is the first
 * thing read. A code with no entry in {@link EXPORT_FAULT_TEXT} cannot occur —
 * the record is keyed by the codec's own union, so adding a fault code to
 * `packages/fit` fails this file's typecheck until it has words here. That is
 * the point: a new way for an export to be lossy should not be able to ship
 * silently.
 */
function lostFrom(faults: readonly FitEncodeError[]): readonly string[] {
  const seen = new Set<FitEncodeFaultCode>();
  const lost: string[] = [];
  for (const fault of faults) {
    if (seen.has(fault.code)) continue;
    seen.add(fault.code);
    lost.push(EXPORT_FAULT_TEXT[fault.code]);
  }
  return lost;
}

/**
 * The stored samples as track points, in order, gaps dropped.
 *
 * A slot where every channel is absent produces **no point**: the store keeps a
 * dense grid with holes (ADR 0011) and every file format is a list of samples,
 * so writing an empty one would be inventing a reading of nothing. A thirty
 * second sensor dropout comes out as a thirty second gap between timestamps,
 * which is exactly what the file it was imported from said.
 */
function pointsOf(streams: StreamSet): readonly TrackPoint[] {
  const points: TrackPoint[] = [];
  const { channels } = streams;
  for (let index = 0; index < streams.sampleCount; index += 1) {
    const latitude = channels.latitude?.[index];
    const longitude = channels.longitude?.[index];
    const point: TrackPoint = {
      timestamp: at(streams, index),
      // Both or neither: `geographicPosition` takes branded coordinates, so a
      // transposition is a compile error rather than a ride in Kenya.
      position:
        latitude === undefined || longitude === undefined
          ? undefined
          : geographicPosition(latitude, longitude),
      altitude: channels.altitude?.[index],
      // The store keeps no distance channel — ADR 0011's eight channels do not
      // include one — so per-point distance is absent rather than integrated
      // from speed. A derived number written into a rider's exported file is
      // indistinguishable from a measured one afterwards.
      distance: undefined,
      speed: channels.speed?.[index],
      heartRate: channels.heartRate?.[index],
      cadence: channels.cadence?.[index],
      power: channels.power?.[index],
      temperature: channels.temperature?.[index],
    };
    if (hasAnyReading(point)) {
      points.push(point);
    }
  }
  return points;
}

function hasAnyReading(point: TrackPoint): boolean {
  return (
    point.position !== undefined ||
    point.altitude !== undefined ||
    point.speed !== undefined ||
    point.heartRate !== undefined ||
    point.cadence !== undefined ||
    point.power !== undefined ||
    point.temperature !== undefined
  );
}

function at(streams: StreamSet, index: number): UnixSeconds {
  return unixSeconds(streams.startedAt + index * streams.sampleInterval);
}

function instant(value: UnixSeconds): FitDateTime {
  return { kind: 'instant', instant: value };
}

function fitInputOf(
  activity: ActivityRecord,
  streams: StreamSet,
  points: readonly TrackPoint[],
): FitEncodeInput {
  const end = at(streams, Math.max(streams.sampleCount - 1, 0));
  return {
    fileId: {
      type: FILE_TYPE_ACTIVITY,
      manufacturer: undefined,
      product: undefined,
      serialNumber: undefined,
      timeCreated: instant(activity.createdAt),
    },
    records: points.map(fitRecordOf),
    laps: [
      {
        timestamp: instant(end),
        messageIndex: 0,
        startTime: instant(activity.startedAt),
        totalElapsedTime: activity.elapsedTime,
        totalTimerTime: activity.movingTime,
        totalDistance: activity.distance,
      },
    ],
    sessions: [
      {
        timestamp: instant(end),
        messageIndex: 0,
        startTime: instant(activity.startedAt),
        sport: SPORT_CYCLING,
        totalElapsedTime: activity.elapsedTime,
        totalTimerTime: activity.movingTime,
        totalDistance: activity.distance,
        numLaps: 1,
      },
    ],
    summary: {
      timestamp: instant(end),
      totalTimerTime: activity.movingTime,
      numSessions: 1,
      type: undefined,
      event: undefined,
      eventType: undefined,
      localTimestamp: undefined,
    },
  };
}

function fitRecordOf(point: TrackPoint): FitRecord {
  return {
    timestamp: point.timestamp === undefined ? undefined : instant(point.timestamp),
    position: point.position,
    altitude: point.altitude,
    distance: point.distance,
    speed: point.speed,
    heartRate: point.heartRate,
    cadence: point.cadence,
    power: point.power,
    temperature: point.temperature,
    developerFields: [],
  };
}

function trackActivityOf(activity: ActivityRecord, points: readonly TrackPoint[]): TrackActivity {
  return {
    startTime: activity.startedAt,
    name: activity.name,
    // ADR 0009 L1 has nothing to say here — `cycling` is the sport, not a
    // brand. TCX maps it onto its own three-value `Sport` attribute.
    sport: 'cycling',
    creator: undefined,
    laps: [
      {
        startTime: activity.startedAt,
        totalElapsedTime: activity.elapsedTime,
        totalDistance: activity.distance,
        points,
      },
    ],
  };
}

/**
 * A filename a rider can find again: the ride's own name, made safe for a
 * filesystem.
 *
 * Path separators, the Windows-reserved characters and control characters are
 * replaced rather than stripped, so two rides named `a/b` and `a:b` do not
 * collapse onto one filename. This is a **downloaded** filename, so it is also
 * the one place a stored name reaches a filesystem API: a name of `../../x` has
 * to come out as a name and not as a path.
 */
export function fileStemOf(activity: ActivityRecord): string {
  const safe = [...activity.name]
    .map((character) => (isUnsafeInAFileName(character) ? '-' : character))
    .join('')
    // A leading dot hides the file on every Unix-like system, and a name of
    // `..` is a path segment rather than a name.
    .replace(/^\.+/, '')
    .trim();
  return safe === '' ? `activity-${activity.id}` : safe.slice(0, 120);
}

/**
 * The characters a downloaded filename must not carry.
 *
 * A `Set` and a code-point comparison rather than a regular expression, so that
 * the control-character range is written as an escape a reviewer can read
 * instead of as literal control bytes inside a character class — which is what
 * the regular expression spelling puts in the source file, invisibly.
 */
const UNSAFE_FILENAME_CHARACTERS = new Set(['/', '\\', ':', '*', '?', '"', '<', '>', '|']);

function isUnsafeInAFileName(character: string): boolean {
  if (UNSAFE_FILENAME_CHARACTERS.has(character)) {
    return true;
  }
  // The C0 controls and DEL, written as code points. `?? 0` is unreachable —
  // every element of a spread string is a code point — and it is what keeps
  // this total without a non-null assertion.
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f;
}
