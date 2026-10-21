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
 * FIT carries every sample channel and total the store holds, and which splits
 * are laps (#1320, `fit-lap-mark.ts`), but not a lap row's figures (#1471). GPX and TCX each drop something, and
 * the codec states what — {@link GPX_LOSSY_CHANNELS}, {@link TCX_LOSSY_CHANNELS}
 * — rather than this file guessing. The view shows those lists beside the
 * format chooser, so the rider picks knowing the cost.
 */

import {
  geographicPosition,
  metres,
  seconds,
  unixSeconds,
  type Metres,
  type Seconds,
  type UnixSeconds,
} from '@onyourleft/domain';
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
  type TrackLap,
  type TrackPoint,
} from '@onyourleft/fit';
import type {
  ActivityId,
  ActivityRecord,
  ActivitySummary,
  AthleteId,
  LapRecord,
  StreamSet,
} from '@onyourleft/store';

import type { ActivityFileFormat } from './file-format';
import { fitLapMarkDeclarations, fitLapMarkOf, type FitLapKind } from './fit-lap-mark';
import type { DownloadableFile, TransferStore } from './store-port';

/** @see LOSSY_CHANNELS */
const MOVING_TIME = 'activity.movingTime';

/** @see LOSSY_CHANNELS — #1321. */
const LAP_ASCENT = 'lap.ascent';

/** @see LOSSY_CHANNELS — #1321. */
const LAP_DISTANCE = 'lap.distance';

/**
 * What a FIT lap does not carry of a lap row: its figures and its climb.
 * `packages/fit`'s profile subset names no lap field for either: a field number
 * goes in only with a provenance ADR 0006 R2 admits, and finding one is
 * #1471's. Its kind (which splits are laps, and the part-lap mark) is carried
 * since #1320, in a developer field of this client's own (`fit-lap-mark.ts`).
 * Named as TCX's lap names them, which is how GPX's codec list names them too.
 *
 * @see LOSSY_CHANNELS
 */
const FIT_LAP_LOSSY_CHANNELS = [
  'lap.averageHeartRate',
  'lap.maxHeartRate',
  'lap.averageCadence',
  'lap.averagePower',
  'lap.maxPower',
  LAP_ASCENT,
];

/**
 * What a format costs, in the codec's own words.
 *
 * Plus the ride's **moving time**, which is a loss of this exporter's rather
 * than of the codec's — #1323. The codec's track has no moving time to drop: a
 * GPX file states no totals at all, and a TCX `<Lap>` states one time,
 * `TotalTimeSeconds`, which this client writes as the elapsed time so that its
 * laps add up to the ride. So a paused ride exported as either comes back with
 * no pause in it (`read-activity-file.ts` takes a GPX ride's moving time as the
 * span of its samples, and a TCX ride's as its laps' times added up, which in
 * this client's file are that span too — §`statedMovingTimeOf`), and the rider is told
 * before choosing the format rather than after importing it. FIT's session
 * carries it.
 *
 * And, since #1321, two figures of a lap row: its **climb**, which neither has
 * an element for, and in TCX its **own distance**, because a TCX lap states its
 * share of the ride's (`trackActivityOf`). GPX's codec list already names the
 * lap's distance.
 *
 * FIT carries every sample channel, the moving time, a lap's own distance and,
 * since #1320, its kind, but none of a lap row's figures:
 * {@link FIT_LAP_LOSSY_CHANNELS}. Until #1321 it was empty, and the screen said
 * FIT carries every channel — which was not true of a lap row's figures, and
 * the owner's ruling of 2026-10-19 on #1458 leaves FIT's lap fields as they
 * were until #1471.
 */
export const LOSSY_CHANNELS: Readonly<Record<ActivityFileFormat, readonly string[]>> = {
  fit: FIT_LAP_LOSSY_CHANNELS,
  gpx: [...GPX_LOSSY_CHANNELS, LAP_ASCENT, MOVING_TIME],
  tcx: [...TCX_LOSSY_CHANNELS, LAP_ASCENT, LAP_DISTANCE, MOVING_TIME],
};

/** A lap's kind: `lap.intensity` and `lap.triggerMethod` said as one — #1452. */
const LAP_KIND = 'which splits are laps and which are part laps';

/**
 * Each entry of {@link LOSSY_CHANNELS} in plain words, as the export screen
 * says it — #1452. The codes stay the codec's (tests and the README table read
 * them); a rider reads these. `export-activity.test.ts` fails for an entry
 * with no name here, so a codec that starts dropping something new cannot
 * reach the screen as a code path.
 */
const LOSSY_CHANNEL_NAMES: Readonly<Record<string, string>> = {
  'point.distance': 'the distance at each point',
  'point.temperature': 'temperature',
  'lap.totalElapsedTime': 'each lap’s elapsed time',
  'lap.totalDistance': 'each lap’s distance',
  'lap.averageHeartRate': 'each lap’s average heart rate',
  'lap.maxHeartRate': 'each lap’s highest heart rate',
  'lap.averageCadence': 'each lap’s average cadence',
  'lap.averagePower': 'each lap’s average power',
  'lap.maxPower': 'each lap’s best power',
  [LAP_ASCENT]: 'each lap’s climb',
  [LAP_DISTANCE]: 'each lap’s distance',
  // One phrase for the pair: a lap's kind is both of them together, and
  // `lossyChannelNames` says a shared name once.
  'lap.intensity': LAP_KIND,
  'lap.triggerMethod': LAP_KIND,
  'activity.name': 'the ride’s name',
  [MOVING_TIME]: 'moving time',
};

/** The plain name of a {@link LOSSY_CHANNELS} entry, or `undefined` for one the table lacks. */
export function lossyChannelName(channel: string): string | undefined {
  return Object.hasOwn(LOSSY_CHANNEL_NAMES, channel) ? LOSSY_CHANNEL_NAMES[channel] : undefined;
}

/**
 * What `format` cannot carry, in plain words — #1452. Each name once: two
 * entries that share a name (a lap's intensity and trigger, which together
 * are its kind) are said as one.
 */
export function lossyChannelNames(format: ActivityFileFormat): readonly string[] {
  // An entry the table lacks is shown as its code rather than hidden: a loss
  // left unsaid is worse than one said badly, and the test above keeps it rare.
  return [
    ...new Set(LOSSY_CHANNELS[format].map((channel) => lossyChannelName(channel) ?? channel)),
  ];
}

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
  // #221. Read from the store rather than synthesised from the summary: a ride
  // that was recorded with splits had them destroyed by the erase and never
  // written to a file, so the responsible sequence — export everything, then
  // erase — lost them. Scoped on `athleteId`, not on `activity.athleteId`: the
  // ride is already known to be this athlete's, and reaching for the record's
  // own owner would be the shape that reads somebody else's rows.
  const laps = splitsOf(await store.listLaps(athleteId, activityId), points, activity, streams);

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
    const encoded = encodeFitActivity(fitInputOf(activity, streams, framed(laps, streams)));
    bytes = encoded.bytes;
    faults = encoded.faults;
  } else {
    const written = framed(withASampleEach(laps), streams);
    bytes = new TextEncoder().encode(
      format === 'gpx'
        ? encodeGpx(trackActivityOf(activity, written))
        : encodeTcx(trackActivityOf(activity, written)),
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

/** The instant of the last stored sample. The end every summary message uses. */
function endOf(streams: StreamSet): UnixSeconds {
  return at(streams, Math.max(streams.sampleCount - 1, 0));
}

function instant(value: UnixSeconds): FitDateTime {
  return { kind: 'instant', instant: value };
}

/**
 * One split of the ride: its totals, and the samples that fall inside it.
 *
 * A shape of this file's own rather than `LapRecord` plus an array, because the
 * whole-ride fallback is not a stored lap and never was — pretending it is one
 * would mean inventing a `LapId` for a row that does not exist, which is the
 * kind of fiction that later gets written back to disk by somebody. Since
 * #1312 the same is true of the stretches of a ride that no stored lap covers.
 */
interface ExportLap {
  readonly startedAt: UnixSeconds;
  readonly endsAt: UnixSeconds;
  readonly elapsedTime: Seconds;
  readonly movingTime: Seconds;
  /**
   * What this split states as its own distance: a stored lap's own figure, and
   * for a stretch no stored lap covers its share of the ride's.
   */
  readonly distance: Metres;
  /**
   * The RIDE's own elapsed time and distance from its start through the end of
   * this split. The last split's are the activity's totals exactly, so a
   * format with no total of its own (TCX) can state splits that add up to the
   * ride — {@link trackActivityOf}.
   */
  readonly rideThrough: { readonly elapsedTime: number; readonly distance: number };
  /**
   * The one split of a ride with no stored laps. ⚠️ Its totals go into a
   * file as the activity's own, untouched — what such a ride has always
   * exported as, to the byte (`trackActivityOf`).
   */
  readonly wholeRide?: true;
  /**
   * #1321: the stored lap this split is, when it is one — whose figures and
   * whose part-lap mark go into the file — or `undefined` for a stretch of the
   * ride outside every lap. A split another was folded into keeps its own.
   */
  readonly lap?: LapRecord | undefined;
  readonly points: readonly TrackPoint[];
}

/** A stretch of the ride's timeline: a stored lap, or what lies outside every one. */
interface Stretch {
  readonly startedAt: UnixSeconds;
  readonly endsAt: UnixSeconds;
  readonly lap: LapRecord | undefined;
}

/**
 * The ride's timeline cut into stretches that leave none of it out — #1312.
 *
 * The stored laps in `ordinal` order, with a stretch of its own for the time
 * before the first, between two that do not meet, and after the last. A course
 * lap (`recording/laps.ts`) covers the game ride and not the recording: the
 * time before the rider left the line and after *End ride* is the rider's ride
 * too, and it is on no lap row.
 *
 * ⚠️ **It does not sort**, for {@link splitsOf}'s reason. A row that starts
 * before its predecessor ended gets no stretch in front of it and loses
 * nothing.
 */
function stretchesOf(stored: readonly LapRecord[], activity: ActivityRecord): readonly Stretch[] {
  const stretches: Stretch[] = [];
  let cursor: number = activity.startedAt;
  for (const lap of stored) {
    if (lap.startedAt > cursor) {
      stretches.push({ startedAt: unixSeconds(cursor), endsAt: lap.startedAt, lap: undefined });
    }
    const endsAt = unixSeconds(lap.startedAt + lap.elapsedTime);
    stretches.push({ startedAt: lap.startedAt, endsAt, lap });
    cursor = endsAt;
  }
  // ⚠️ Only when the ride runs on past its last lap. A lap's mark is the
  // session's clock and the ride's elapsed time ends at the wall clock's
  // `stop`, which can be BEHIND it: such a ride ends before its last lap
  // does, and a stretch from one to the other would last less than nothing —
  // which no duration can say, so the export of that ride threw, in every
  // format, and with it the push to an instance.
  const rideEnds = activity.startedAt + activity.elapsedTime;
  if (rideEnds > cursor) {
    stretches.push({
      startedAt: unixSeconds(cursor),
      endsAt: unixSeconds(rideEnds),
      lap: undefined,
    });
  }
  return stretches;
}

/**
 * The ride's samples dealt into splits that cover the whole ride — #221,
 * ADR 0019 D-5, and #1312.
 *
 * **A partition twice over, and both are the property to hold on to.**
 *
 * 1. *Of the samples.* Every point lands in exactly one split: the sweep walks
 *    the points in order and advances whenever the *next* split's first slot
 *    has been reached, so a sample before the first split goes into the first
 *    and one after the last goes into the last. Neither is dropped. A boundary
 *    test written as "start ≤ t < start + elapsed" reads more naturally and
 *    silently loses every sample in a gap — which is a paused ride, and is
 *    common.
 * 2. *Of the ride's totals* (#1312). {@link stretchesOf} gives the time outside
 *    every stored lap a split of its own, and each split carries the ride's
 *    own elapsed time and distance through its end ({@link ExportLap.rideThrough}).
 *    ⚠️ **Before this a TCX file of a ride with course laps stated the laps'
 *    totals as the ride's**: TCX has no session total, a reader sums its laps
 *    (`read-activity-file.ts` §`statedMovingTimeOf`), and the laps of a game
 *    ride cover neither the whole recording nor the recording's own distance —
 *    a course lap's distance is the game's road, the ride's is the speed
 *    channel summed. Export, erase, import again gave back a different ride.
 *
 * ⚠️ **By slot, as `recording/laps.ts` §`courseLap` counts**: a lap owns the
 * samples from the slot it began in up to the slot it ended in. So the samples
 * a file holds inside a course lap are the samples its stored averages were
 * worked out from.
 *
 * ⚠️ **A stretch outside every lap has no moving time or distance of its
 * own on record.** Its moving time is its share, by elapsed time, of what the
 * ride moved outside its laps; its distance is its share of the ride's.
 *
 * ⚠️ **It does not sort.** `listLaps` returns `ordinal` order, which is the
 * order the laps were ridden in and the order every reader renders. A store
 * row whose `startedAt` disagrees with its `ordinal` would make the sweep put
 * more points in an earlier split than a reader expects — and it still loses
 * nothing, which is the invariant that matters. Re-ordering the splits to
 * repair a bad row would hide it.
 *
 * With no stored laps, one lap spanning the ride: the shape this file has
 * always written, and the shape a reader expects of a file with no splits in
 * it.
 */
function splitsOf(
  stored: readonly LapRecord[],
  points: readonly TrackPoint[],
  activity: ActivityRecord,
  streams: StreamSet,
): readonly ExportLap[] {
  const whole = { elapsedTime: activity.elapsedTime, distance: activity.distance };
  if (stored.length === 0) {
    return [
      {
        startedAt: activity.startedAt,
        endsAt: endOf(streams),
        elapsedTime: activity.elapsedTime,
        movingTime: activity.movingTime,
        distance: activity.distance,
        rideThrough: whole,
        wholeRide: true,
        points,
      },
    ];
  }

  const stretches = stretchesOf(stored, activity);
  /** The instant of the slot an instant falls in: `courseLap`'s rule. */
  const slotInstant = (instant: number): number =>
    streams.startedAt +
    Math.floor((instant - streams.startedAt) / streams.sampleInterval) * streams.sampleInterval;
  const firstSlots = stretches.map((stretch) => slotInstant(stretch.startedAt));

  const buckets: TrackPoint[][] = stretches.map(() => []);
  /** The speed channel summed over each split: `recording/finish.ts` §`distanceOf`'s sum. */
  const recorded = stretches.map(() => 0);
  let index = 0;
  for (const point of points) {
    while (
      index + 1 < stretches.length &&
      point.timestamp !== undefined &&
      point.timestamp >= (firstSlots[index + 1] ?? Number.POSITIVE_INFINITY)
    ) {
      index += 1;
    }
    // Total by construction: `buckets` has one entry per stretch and `index`
    // is bounded by the loop above, so the `?? ` branch cannot be taken. It is
    // here because a non-null assertion would be a stronger claim than this
    // function needs to make.
    (buckets[index] ?? buckets[0])?.push(point);
    recorded[index] = (recorded[index] ?? 0) + (point.speed ?? 0) * streams.sampleInterval;
  }

  const recordedTotal = recorded.reduce((sum, part) => sum + part, 0);
  /**
   * A stretch outside the laps that is not written as a split of its own: one
   * with no sample in it, or shorter than one sample. @see folded, below
   */
  const slight = (ordinal: number): boolean => {
    const stretch = stretches[ordinal];
    return (
      stretch !== undefined &&
      stretch.lap === undefined &&
      ((buckets[ordinal]?.length ?? 0) === 0 ||
        stretch.endsAt - stretch.startedAt < streams.sampleInterval)
    );
  };
  const outsideSeconds = stretches.reduce(
    (sum, stretch) =>
      stretch.lap === undefined ? sum + (stretch.endsAt - stretch.startedAt) : sum,
    0,
  );
  const movedOutside = Math.max(
    0,
    activity.movingTime - stored.reduce((sum, lap) => sum + lap.movingTime, 0),
  );

  let recordedThrough = 0;
  let through = { elapsedTime: 0, distance: 0 };
  const splits = stretches.map((stretch, ordinal): ExportLap => {
    const last = ordinal === stretches.length - 1;
    const duration = stretch.endsAt - stretch.startedAt;
    recordedThrough += recorded[ordinal] ?? 0;
    // Never backwards and never past the ride, whatever a row says; and the
    // last split ends where the ride does.
    const elapsedThrough = last
      ? whole.elapsedTime
      : Math.min(
          whole.elapsedTime,
          Math.max(through.elapsedTime, stretch.endsAt - activity.startedAt),
        );
    // The ride's own distance, shared out as the speed channel was ridden —
    // and by time for a ride with no speed on record.
    const share =
      recordedTotal > 0
        ? recordedThrough / recordedTotal
        : whole.elapsedTime > 0
          ? elapsedThrough / whole.elapsedTime
          : 1;
    const before = through;
    through = {
      elapsedTime: elapsedThrough,
      // (The last split's share is the whole: the same sums, in the same order.)
      distance: whole.distance * share,
    };
    return {
      startedAt: stretch.startedAt,
      endsAt: stretch.endsAt,
      elapsedTime: stretch.lap?.elapsedTime ?? seconds(duration),
      movingTime:
        stretch.lap?.movingTime ??
        seconds(outsideSeconds > 0 ? (movedOutside * duration) / outsideSeconds : 0),
      distance: stretch.lap?.distance ?? metres(through.distance - before.distance),
      rideThrough: through,
      lap: stretch.lap,
      points: buckets[ordinal] ?? [],
    };
  });

  // ⚠️ **No split with nothing in it, and none shorter than a sample.** A
  // stretch outside the laps that holds no sample — a game ride begun half a
  // second into its recording, a recording stopped a moment after *End ride*
  // — would be a TCX `<Lap>` with an empty `<Track>`, which a strict reader
  // may refuse, and a FIT lap a fraction of a second long; and one shorter
  // than a sample that DOES hold one would be a lap of a few metres in no
  // time at all, which a reader dividing one by the other shows as an
  // infinite speed. Either is folded into the split before it: that split's
  // running totals run on through it, and its samples go with it, so the
  // splits still add up to the ride and hold every sample. One at the very
  // start with nothing in it needs nothing: the first split written counts
  // from the ride's start whatever it is.
  //
  // ⚠️ **So a file's lap holds every sample its stored row counted, first and
  // in order, and then the samples of whatever stretch was folded into it —
  // which its row's averages leave out** (#1312's second review note,
  // `export-activity.test.ts` §"a stretch folded into the lap before it"). A
  // lap owns the slots up to and not including the one it ended in, so a
  // folded stretch begins in that slot; it lasts less than one sample, so it
  // reaches into one slot more at the most. Between two laps that is one
  // sample (the next lap's first slot is its own); after the last lap, two.
  // They are not made to agree because the only other place those samples
  // could go is a split of their own lasting less than a sample, and the
  // third pass's lap of nought seconds in every such ride's file was the
  // worse answer. A ride that ends before its last lap does has no stretch
  // after it, and the sweep puts any sample from that lap's end slot on into
  // that lap the same way.
  //
  // ⚠️ **The folded samples go AFTER the split's own**: they were recorded
  // after them, and FIT's records are these points end to end.
  const folded: ExportLap[] = [];
  splits.forEach((split, ordinal) => {
    const before = folded[folded.length - 1];
    if (!slight(ordinal) || (before === undefined && split.points.length > 0)) {
      folded.push(split);
    } else if (before !== undefined) {
      folded[folded.length - 1] = {
        ...before,
        rideThrough: split.rideThrough,
        points: [...before.points, ...split.points],
      };
    }
  });
  return folded;
}

/**
 * The splits a format that needs a sample in every one of them is given: one
 * with none is left out, and the split before it runs on through it, so the
 * ones written still add up to the ride.
 *
 * ⚠️ **This is where a STORED lap with no sample goes, in TCX and GPX.** A
 * whole lap ridden while the recording is paused is a real lap with no
 * reading in it (the engine takes none while paused). FIT writes it: a lap
 * message needs no record. TCX would write a `<Lap>` with an empty `<Track>`,
 * so that lap is not in a TCX file — its time is in the lap before it, and
 * the file says the ride's totals still. Stated in the PR, with the rest of
 * what TCX cannot carry.
 */
function withASampleEach(laps: readonly ExportLap[]): readonly ExportLap[] {
  const kept: ExportLap[] = [];
  for (const lap of laps) {
    const before = kept[kept.length - 1];
    if (lap.points.length > 0) {
      kept.push(lap);
    } else if (before !== undefined) {
      kept[kept.length - 1] = { ...before, rideThrough: lap.rideThrough };
    }
  }
  // A ride with no reading in any slot keeps the one shape it always had.
  return kept.length === 0 ? laps : kept;
}

/**
 * The splits with the ride's first and last slots stated, where no reading
 * does — #1323.
 *
 * {@link pointsOf} writes no point for a slot with no reading in it, and an
 * import starts a ride at its first timed sample and bounds its elapsed time by
 * the span of its samples (`read-activity-file.ts` §`observedSpan`, which is
 * deliberate: it stops a file inflating a ride). So a recording whose first
 * second held no reading came back a second late and a second short, in every
 * format. A point with a time and nothing else — what a head unit writes when a
 * recording starts before a sensor answers — says where the ride starts and
 * ends and invents no reading: every format here writes one (a FIT record, a
 * TCX `<Trackpoint>` with only a `<Time>`, a GPX `<trkpt>` with only a
 * `<time>`), and the import places it on the grid and writes nothing into it.
 *
 * The first and last SLOTS, not `activity.startedAt + elapsedTime`: the stored
 * grid is the extent of the ride on disk, and stating it is what makes the
 * import build a grid of the same length.
 *
 * ⚠️ **Added after the splits are cut**, into the first split and the last, so
 * that a lead-in or a tail with no reading in it is still folded exactly as
 * {@link splitsOf} and {@link withASampleEach} decided — a bare time is not a
 * sample those rules should count.
 */
function framed(laps: readonly ExportLap[], streams: StreamSet): readonly ExportLap[] {
  const first = laps[0];
  const lastIndex = laps.length - 1;
  if (first === undefined) {
    return laps;
  }
  const points = laps.flatMap((lap) => lap.points);
  const start = at(streams, 0);
  const end = endOf(streams);
  const bare = (timestamp: UnixSeconds): TrackPoint => ({
    timestamp,
    position: undefined,
    altitude: undefined,
    distance: undefined,
    speed: undefined,
    heartRate: undefined,
    cadence: undefined,
    power: undefined,
    temperature: undefined,
  });
  const opens = points[0]?.timestamp === start;
  const closes = points[points.length - 1]?.timestamp === end;
  return laps.map((lap, ordinal) => {
    const before = ordinal === 0 && !opens ? [bare(start)] : [];
    const after = ordinal === lastIndex && !closes ? [bare(end)] : [];
    return before.length === 0 && after.length === 0
      ? lap
      : { ...lap, points: [...before, ...lap.points, ...after] };
  });
}

function fitInputOf(
  activity: ActivityRecord,
  streams: StreamSet,
  laps: readonly ExportLap[],
): FitEncodeInput {
  const end = endOf(streams);
  // #1320: a ride with laps marks which of its splits are laps (`fit-lap-mark.ts`).
  // A ride with none writes no mark and no declaration, so it exports as it
  // always has, to the byte.
  const marked = laps.some((lap) => lap.wholeRide !== true);
  return {
    fileId: {
      type: FILE_TYPE_ACTIVITY,
      manufacturer: undefined,
      product: undefined,
      serialNumber: undefined,
      timeCreated: instant(activity.createdAt),
    },
    ...(marked ? fitLapMarkDeclarations() : {}),
    // Flattened from the laps rather than taken from `points` directly, so the
    // records written and the records counted by the laps are the same list.
    // The split preserves order, so this is the stored order sample for sample.
    records: laps.flatMap((lap) => lap.points.map(fitRecordOf)),
    laps: laps.map((lap, ordinal) => ({
      timestamp: instant(lap.endsAt),
      messageIndex: ordinal,
      startTime: instant(lap.startedAt),
      totalElapsedTime: lap.elapsedTime,
      totalTimerTime: lap.movingTime,
      totalDistance: lap.distance,
      developerFields: marked ? [fitLapMarkOf(fitLapKindOf(lap))] : [],
    })),
    sessions: [
      {
        timestamp: instant(end),
        messageIndex: 0,
        startTime: instant(activity.startedAt),
        sport: SPORT_CYCLING,
        // The ride's own totals, not the sum of the laps'. A lap's distance is
        // what the head unit recorded for that split, and summing them to
        // produce a session total would put a number in the athlete's file that
        // no instrument ever measured.
        totalElapsedTime: activity.elapsedTime,
        totalTimerTime: activity.movingTime,
        totalDistance: activity.distance,
        // ⚠️ Counted, never hard-coded. A session declaring one lap beside a
        // file carrying three is the shape a strict reader trusts and a rider
        // then finds their splits missing from.
        numLaps: laps.length,
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

/** A split as #1320's FIT mark says it: as {@link tcxLapFiguresOf} says it in TCX. */
function fitLapKindOf(lap: ExportLap): FitLapKind {
  if (lap.lap === undefined) return 'outside';
  return lap.lap.partial === true ? 'part' : 'lap';
}

/**
 * What a TCX lap states beyond its times and distance — its `Intensity` and
 * `TriggerMethod`, and the figures TCX has an element for — #1321.
 *
 * | split | `Intensity` | `TriggerMethod` |
 * |---|---|---|
 * | a whole lap | `Active` | `Location`: it ended at the line |
 * | a part lap | `Active` | `Manual`: the rider ended it |
 * | a stretch outside every lap | `Resting` | `Manual` |
 *
 * ⚠️ **No session-end value in TCX**, so the part lap is told from the whole by
 * `Location` against `Manual`, which a TCX from elsewhere uses for every lap
 * its rider pressed. A reader has to know whose file it is to read `Manual` as
 * a part lap (`TCX_CREATOR`). Climb has no element at all; the lap's own
 * distance has one, `DistanceMeters`, and it holds the lap's share of the
 * ride's ({@link trackActivityOf}), so the lap's own is not in the file either.
 *
 * Not called for the one split of a ride with no laps, which
 * {@link trackActivityOf} writes as it always has, with no mark.
 */
function tcxLapFiguresOf(lap: ExportLap): Partial<TrackLap> {
  const stored = lap.lap;
  if (stored === undefined) return { intensity: 'Resting', triggerMethod: 'Manual' };
  return {
    intensity: 'Active',
    triggerMethod: stored.partial === true ? 'Manual' : 'Location',
    averageHeartRate: stored.averageHeartRate,
    maxHeartRate: stored.maxHeartRate,
    averageCadence: stored.averageCadence,
    averagePower: stored.averagePower,
    maxPower: stored.maxPower,
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

/** A total to the tenth TCX writes it to (`packages/fit` §`encodeTcx`). */
function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function trackActivityOf(activity: ActivityRecord, laps: readonly ExportLap[]): TrackActivity {
  return {
    startTime: activity.startedAt,
    name: activity.name,
    // ADR 0009 L1 has nothing to say here — `cycling` is the sport, not a
    // brand. TCX maps it onto its own three-value `Sport` attribute.
    sport: 'cycling',
    creator: undefined,
    // TCX has a `<Lap>` with its own totals; GPX has neither, and writes one
    // `<trkseg>` per lap instead — `GPX_LOSSY_CHANNELS` already declares that
    // `lap.totalElapsedTime` and `lap.totalDistance` have nowhere to go there.
    // A rider exporting GPX keeps where each split started and stopped, which
    // is the part that cannot be recomputed from anything else.
    //
    // ⚠️ **A TCX lap states its part of the RIDE's totals, not the stored
    // lap's own** (#1312). The file has no other total: a reader adds its
    // laps up, so they have to add up to the ride. Each is the difference of
    // two running totals rounded to the tenth the format is written to, so
    // the tenths add up to the ride's total and not to a rounding of it. A
    // course lap's own distance — the game's road — is therefore not in a TCX
    // file; FIT has a session total, and its laps keep theirs.
    //
    // ⚠️ **And a ride with NO stored laps is written exactly as it always
    // was**: the activity's own totals, handed to the codec as they are.
    // Rounding them here first is not the same thing — 38613.35 is a hair
    // under the half as a float, so the codec's `toFixed(1)` writes `38613.3`
    // and `Math.round(x * 10) / 10` gives `38613.4` (#1316's third review).
    laps: laps.map((lap, ordinal) => {
      if (lap.wholeRide === true) {
        return {
          startTime: lap.startedAt,
          totalElapsedTime: lap.elapsedTime,
          totalDistance: lap.distance,
          points: lap.points,
        };
      }
      const before = laps[ordinal - 1]?.rideThrough ?? { elapsedTime: 0, distance: 0 };
      return {
        startTime: lap.startedAt,
        totalElapsedTime: seconds(
          tenths(tenths(lap.rideThrough.elapsedTime) - tenths(before.elapsedTime)),
        ),
        totalDistance: metres(tenths(tenths(lap.rideThrough.distance) - tenths(before.distance))),
        points: lap.points,
        ...tcxLapFiguresOf(lap),
      };
    }),
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
export function fileStemOf(activity: ActivitySummary): string {
  return safeFileStem(activity.name, `activity-${activity.id}`);
}

/**
 * The same rule, for anything else a rider downloads.
 *
 * Extracted by #74 so the route exporter shares it rather than growing a second
 * filename sanitiser — the same objection #74 makes to a second XML writer, and
 * a worse one here: a divergent copy would be a second place where a stored
 * name reaches a filesystem API, and only one of them would have been read.
 *
 * @param fallback used verbatim when the name sanitises to nothing. It is the
 * caller's, because only the caller knows what kind of thing this is.
 */
export function safeFileStem(name: string, fallback: string): string {
  const safe = [...name]
    .map((character) => (isUnsafeInAFileName(character) ? '-' : character))
    .join('')
    // A leading dot hides the file on every Unix-like system, and a name of
    // `..` is a path segment rather than a name.
    .replace(/^\.+/, '')
    .trim();
  return safe === '' ? fallback : safe.slice(0, 120);
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
