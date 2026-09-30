// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * An activity file as the instance sees one: what kind it is, whether it
 * decodes at all, and its samples as a chart reads them (#37, #38).
 *
 * ## The type is read from the bytes, never from a name
 *
 * The ingestion request carries no filename and no media type, on purpose: a
 * file called `.fit` holding GPX is still GPX here (#37's content-sniffing
 * criterion), because {@link sniffActivityFile} looks only at the bytes. A FIT
 * file says `.FIT` at offset 8 (the FIT protocol's own header); GPX and TCX are
 * XML whose root element names them. Anything else is refused as
 * `file_type_unsupported` before any decoder sees it.
 *
 * ## Decoding is the fallback, and it is untrusted input
 *
 * The main path of #37 is "verify the signature, verify the content hash,
 * index" — the device has already decoded the file. The decode here is the
 * check that what arrived is an activity file at all, and what the stream read
 * (#38) is served from. It goes through `@onyourleft/fit`, whose XML reader
 * refuses a `<!DOCTYPE` outright (XXE and entity expansion, `CLAUDE.md` §6),
 * and whose FIT decoder bounds what a file can make it allocate.
 *
 * A file that throws, or that decodes to no samples at all, is
 * `file_undecodable`. A file with RECOVERABLE faults — a head unit whose
 * battery died mid-record — decodes to the samples it has and is accepted: the
 * rider signed exactly those bytes, and refusing them would lose a ride nobody
 * can repair. That is a decision, recorded in the pull request.
 *
 * ## No position ever leaves through here
 *
 * {@link samplesOf} reads time, power, heart rate, cadence, speed, altitude and
 * distance, and never a coordinate. A chart does not need one, and a stream
 * response that cannot carry one cannot leak a home address (#21, #38's
 * revision). The rider's own true trace leaves through the account export
 * (#35), as the original file.
 */

import { decodeFitActivity, decodeGpx, decodeTcx, trackPointsOf } from '@onyourleft/fit';

/** What kind of activity file some bytes are. */
export type ActivityFileKind = 'fit' | 'gpx' | 'tcx';

/** One sample, as a chart reads it. `null` is "no reading", never zero. */
export interface Sample {
  /** Seconds from the file's first sample. */
  readonly t: number;
  readonly power: number | null;
  readonly heartRate: number | null;
  readonly cadence: number | null;
  readonly speed: number | null;
  readonly altitude: number | null;
  readonly distance: number | null;
}

/** The channels a stream response carries, in order. */
export const STREAM_CHANNELS = [
  'power',
  'heartRate',
  'cadence',
  'speed',
  'altitude',
  'distance',
] as const;

export type StreamChannel = (typeof STREAM_CHANNELS)[number];

/** Why a file was refused. */
export type FileRefusal = 'file_type_unsupported' | 'file_undecodable';

/** The FIT header's data type, at bytes 8–11. */
const FIT_SIGNATURE = [0x2e, 0x46, 0x49, 0x54];

/** What `bytes` are, from the bytes alone, or `undefined`. */
export function sniffActivityFile(bytes: Uint8Array): ActivityFileKind | undefined {
  if (bytes.length >= 12 && FIT_SIGNATURE.every((byte, index) => bytes[8 + index] === byte)) {
    return 'fit';
  }
  const text = utf8(bytes.subarray(0, 4096));
  if (text === undefined) return undefined;
  const root = rootElement(text);
  const local = root?.split(':').at(-1);
  if (local === 'gpx') return 'gpx';
  if (local === 'TrainingCenterDatabase') return 'tcx';
  return undefined;
}

/**
 * The name of the first element that is not a comment, a processing
 * instruction or a declaration — the document's root — or `undefined` when
 * the text holds none. A scan rather than a regular expression over the whole
 * text, so a comment that mentions `<gpx` is skipped as a comment.
 */
function rootElement(text: string): string | undefined {
  let at = 0;
  for (;;) {
    const open = text.indexOf('<', at);
    if (open < 0) return undefined;
    const skip: readonly [string, number] | undefined = text.startsWith('<!--', open)
      ? ['-->', 4]
      : text.startsWith('<?', open)
        ? ['?>', 2]
        : text.startsWith('<!', open)
          ? ['>', 2]
          : undefined;
    if (skip === undefined) {
      return /^<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)[\s/>]/.exec(
        text.slice(open, open + 256),
      )?.[1];
    }
    const [close, length] = skip;
    const end = text.indexOf(close, open + length);
    if (end < 0) return undefined;
    at = end + close.length;
  }
}

function utf8(bytes: Uint8Array): string | undefined {
  // Not fatal: the first 4 KiB may end inside a character. A NUL is binary.
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.includes('\u0000') ? undefined : text;
}

/** The samples of an activity file, or why it has none a chart could read. */
export type Decoded =
  | { readonly ok: true; readonly kind: ActivityFileKind; readonly samples: readonly Sample[] }
  | { readonly ok: false; readonly refusal: FileRefusal };

const valueOf = (value: number | undefined): number | null =>
  value === undefined || !Number.isFinite(value) ? null : value;

/** Decode `bytes` by what they are, never by what anybody called them. */
export function decodeActivityFile(bytes: Uint8Array): Decoded {
  const kind = sniffActivityFile(bytes);
  if (kind === undefined) return { ok: false, refusal: 'file_type_unsupported' };
  let samples: Sample[];
  try {
    samples = kind === 'fit' ? fitSamples(bytes) : trackSamples(kind, bytes);
  } catch {
    return { ok: false, refusal: 'file_undecodable' };
  }
  return samples.length === 0
    ? { ok: false, refusal: 'file_undecodable' }
    : { ok: true, kind, samples };
}

function fitSamples(bytes: Uint8Array): Sample[] {
  const { records } = decodeFitActivity(bytes).activity;
  const timed = records.flatMap((record) => {
    const at = record.timestamp;
    if (at === undefined) return [];
    const seconds = at.kind === 'instant' ? Number(at.instant) : Number(at.sinceDeviceStart);
    return [{ seconds, record }];
  });
  const first = timed[0]?.seconds ?? 0;
  return timed.map(({ seconds, record }) => ({
    t: seconds - first,
    power: valueOf(record.power),
    heartRate: valueOf(record.heartRate),
    cadence: valueOf(record.cadence),
    speed: valueOf(record.speed),
    altitude: valueOf(record.altitude),
    distance: valueOf(record.distance),
  }));
}

function trackSamples(kind: 'gpx' | 'tcx', bytes: Uint8Array): Sample[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const { activity } = kind === 'gpx' ? decodeGpx(text) : decodeTcx(text);
  const points = trackPointsOf(activity).filter((point) => point.timestamp !== undefined);
  const first = Number(points[0]?.timestamp ?? 0);
  return points.map((point) => ({
    t: Number(point.timestamp) - first,
    power: valueOf(point.power),
    heartRate: valueOf(point.heartRate),
    cadence: valueOf(point.cadence),
    speed: valueOf(point.speed),
    altitude: valueOf(point.altitude),
    distance: valueOf(point.distance),
  }));
}

/**
 * `samples` in at most `points` buckets: each bucket's first time and the mean
 * of the readings in it. A bucket with no reading of a channel is `null` for
 * that channel — a gap stays a gap, it is not averaged into a zero.
 */
export function downsample(samples: readonly Sample[], points: number): readonly Sample[] {
  if (samples.length <= points) return samples;
  const out: Sample[] = [];
  for (let bucket = 0; bucket < points; bucket += 1) {
    const from = Math.floor((bucket * samples.length) / points);
    const to = Math.floor(((bucket + 1) * samples.length) / points);
    const slice = samples.slice(from, to);
    const mean = (channel: StreamChannel): number | null => {
      let sum = 0;
      let count = 0;
      for (const sample of slice) {
        const value = sample[channel];
        if (value !== null) {
          sum += value;
          count += 1;
        }
      }
      return count === 0 ? null : sum / count;
    };
    out.push({
      t: slice[0]?.t ?? 0,
      power: mean('power'),
      heartRate: mean('heartRate'),
      cadence: mean('cadence'),
      speed: mean('speed'),
      altitude: mean('altitude'),
      distance: mean('distance'),
    });
  }
  return out;
}
