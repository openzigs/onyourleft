// SPDX-License-Identifier: Apache-2.0

/**
 * The stream encoding: one packed typed array per channel, plus a packed
 * presence bitmap where the channel has gaps.
 *
 * ## Why this shape and not the obvious ones
 *
 * #27's premise is that streams are **append-once and read-whole**: nobody asks
 * for "power at second 4,137", they fetch the series to draw a chart. The three
 * candidate shapes fall out of that immediately.
 *
 * | Shape | 4 h, 1 Hz, 8 channels | Why not |
 * |---|---|---|
 * | One row per sample per channel | ~115,200 rows | ~25x the bytes, and every read is a range scan over rows nobody queries individually |
 * | One JSON document | ~900 KB | Every number becomes decimal text; the parse allocates the whole set before a single point is drawn |
 * | **Per-channel packed binary** | **~239 KB raw, ~53 KB stored** | This file |
 *
 * **Per channel, not one blob for the set.** A chart that renders power alone —
 * #11's and #62's common case — reads one row instead of eight, and a channel
 * added by a later protocol client (#41-#43) is a new row rather than a
 * re-encode of everything the athlete already has. The cost is `n` gets instead
 * of one, on an engine where a keyed get is cheap and the eight are issued
 * together.
 *
 * ## Gaps are a bitmap, not a sentinel
 *
 * A dropped heart-rate strap must come back **absent**, distinguishable from
 * `0` bpm, because interpolating a gap into fiction corrupts every metric in
 * #11 and a zero is worse than a gap: it is a value the type admits, so nothing
 * downstream can tell it from a reading.
 *
 * FIT's answer is an all-ones sentinel per field. This file's answer is a
 * separate bit per sample, for two reasons. A sentinel steals a value from the
 * range, and `temperature` is a `sint8` where every one of the 256 values is a
 * real temperature. And a bitmap is uniform: one rule for eight channels rather
 * than eight invalid constants a reader has to look up. It costs one bit per
 * sample — 1,800 bytes per channel over four hours before compression, and
 * almost nothing after it, because a bitmap of a single thirty-second dropout
 * is the most compressible thing in the set. **The bitmap is omitted entirely
 * when a channel has no gaps**, which is the common case and the reason the
 * dense set costs nothing for the feature.
 *
 * ## The resolution is the contract
 *
 * `streams.ts`'s `CHANNEL_RESOLUTION` states each channel's grid. A value on
 * the grid round-trips **exactly**; a value off it comes back at the nearest
 * grid point. That is a deliberate property of a *derived* artefact — ADR 0005
 * section F keeps the immutable original file as the source of truth — and it
 * is what buys the 4x over storing eight `Float64` channels. Both halves are
 * tested: exact equality over a grid-aligned four-hour set, and a bounded error
 * for values deliberately placed between grid points.
 *
 * ## ADR 0004 decision D binds this file
 *
 * Three channels carry coordinates: `latitude`, `longitude`, and `altitude`,
 * which in a stream is always reported beside them. **No error raised for those
 * three may name the value.** `@onyourleft/domain`'s `UnitError` used to name it
 * — `assertInRange` appended `received 91.2` — and #104 has since stopped it for
 * a latitude or a longitude. This file does not rely on that: `coordinateSafe`
 * below catches a `UnitError` from a coordinate channel and re-raises with the
 * channel, the sample index and the constraint, and nothing else. It is the
 * layer that knows `altitude` is beside a position, which the domain package
 * cannot know from one number. The other five channels keep their values in the
 * message, which is what decision D explicitly chose: "a blanket rule would buy
 * a coordinate's privacy at the cost of every other quantity's debuggability".
 */

import {
  altitudeMetres,
  beatsPerMinute,
  degreesLatitude,
  degreesLongitude,
  degreesLatitudeToSemicircles,
  degreesLongitudeToSemicircles,
  fitAltitudeToMetres,
  metresToFitAltitude,
  metresPerSecond,
  revolutionsPerMinute,
  semicirclesToDegreesLatitude,
  semicirclesToDegreesLongitude,
  latitudeSemicircles,
  longitudeSemicircles,
  degreesCelsius,
  watts,
  UnitError,
} from '@onyourleft/domain';

import { StoreDecodeError, StoreValidationError } from './errors';
import { POSITION_CHANNELS, type Samples, type StreamChannel } from './streams';

/** How one channel's samples are laid out on disk. Stored per blob, so drift is detectable. */
export type ChannelEncoding =
  'uint8' | 'sint8' | 'uint16' | 'uint16-milli' | 'uint16-fit-altitude' | 'sint32-semicircle';

/** One channel, encoded. `present` is absent when the channel has no gaps. */
export interface EncodedChannel {
  readonly channel: StreamChannel;
  readonly encoding: ChannelEncoding;
  readonly sampleCount: number;
  /** `sampleCount * bytesPerSample` bytes, little-endian. */
  readonly values: Uint8Array;
  /** `ceil(sampleCount / 8)` bytes, bit `i` set when sample `i` is present. */
  readonly present?: Uint8Array;
}

/**
 * A channel's conversion to and from its raw stored integer.
 *
 * `toRaw`/`fromRaw` are where `@onyourleft/domain` is consulted: `fromRaw` runs
 * the domain constructor, so "read off disk" and "validated" are the same step,
 * exactly as `persisted.ts` does for the summary records.
 */
interface ChannelCodec {
  readonly encoding: ChannelEncoding;
  readonly bytesPerSample: number;
  /** Inclusive bounds of the raw integer, for the range message. */
  readonly rawMin: number;
  readonly rawMax: number;
  /** The unit the range message names, for a caller reading it in a console. */
  readonly unit: string;
  toRaw(value: number): number;
  fromRaw(raw: number): number;
  read(view: DataView, byteOffset: number): number;
  write(view: DataView, byteOffset: number, raw: number): void;
}

const LITTLE_ENDIAN = true;

/** Latitude's semicircle range is a quarter turn either way, not the full `sint32`. */
const SEMICIRCLES_PER_QUARTER_TURN = 2 ** 30;
const SEMICIRCLES_MIN = -(2 ** 31);
const SEMICIRCLES_MAX = 2 ** 31 - 1;

/** FIT's `uint16` altitude: raw 65535 is the invalid marker, so 65534 is the ceiling. */
const FIT_ALTITUDE_RAW_MAX = 65534;

function uint8(
  encoding: ChannelEncoding,
  unit: string,
  toRaw: (value: number) => number,
  fromRaw: (raw: number) => number,
  rawMax: number,
): ChannelCodec {
  return {
    encoding,
    bytesPerSample: 1,
    rawMin: 0,
    rawMax,
    unit,
    toRaw,
    fromRaw,
    read: (view, at) => view.getUint8(at),
    write: (view, at, raw) => {
      view.setUint8(at, raw);
    },
  };
}

function uint16(
  encoding: ChannelEncoding,
  unit: string,
  toRaw: (value: number) => number,
  fromRaw: (raw: number) => number,
  rawMax: number,
): ChannelCodec {
  return {
    encoding,
    bytesPerSample: 2,
    rawMin: 0,
    rawMax,
    unit,
    toRaw,
    fromRaw,
    read: (view, at) => view.getUint16(at, LITTLE_ENDIAN),
    write: (view, at, raw) => {
      view.setUint16(at, raw, LITTLE_ENDIAN);
    },
  };
}

function sint32(
  unit: string,
  toRaw: (value: number) => number,
  fromRaw: (raw: number) => number,
  rawMin: number,
  rawMax: number,
): ChannelCodec {
  return {
    encoding: 'sint32-semicircle',
    bytesPerSample: 4,
    rawMin,
    rawMax,
    unit,
    toRaw,
    fromRaw,
    read: (view, at) => view.getInt32(at, LITTLE_ENDIAN),
    write: (view, at, raw) => {
      view.setInt32(at, raw, LITTLE_ENDIAN);
    },
  };
}

/**
 * The eight codecs, one per channel.
 *
 * The three conversions that are not "round it" are borrowed from
 * `@onyourleft/domain` rather than rewritten here — semicircles for the two
 * coordinates and FIT's scale-and-offset for altitude. That is not only reuse:
 * those are the encodings #30's FIT decoder will hand this store, so a stream
 * imported from a file is stored at exactly the precision it arrived with, and
 * the import path adds no second rounding.
 */
const CODECS: Readonly<Record<StreamChannel, ChannelCodec>> = {
  power: uint16(
    'uint16',
    'W',
    (value) => Math.round(value),
    (raw) => watts(raw),
    65_535,
  ),
  heartRate: uint8(
    'uint8',
    'bpm',
    (value) => Math.round(value),
    (raw) => beatsPerMinute(raw),
    255,
  ),
  cadence: uint8(
    'uint8',
    'rpm',
    (value) => Math.round(value),
    (raw) => revolutionsPerMinute(raw),
    255,
  ),
  speed: uint16(
    'uint16-milli',
    'm/s',
    (value) => Math.round(value * 1_000),
    (raw) => metresPerSecond(raw / 1_000),
    65_535,
  ),
  latitude: sint32(
    'degrees',
    (value) => degreesLatitudeToSemicircles(degreesLatitude(value)),
    (raw) => semicirclesToDegreesLatitude(latitudeSemicircles(raw)),
    -SEMICIRCLES_PER_QUARTER_TURN,
    SEMICIRCLES_PER_QUARTER_TURN,
  ),
  longitude: sint32(
    'degrees',
    (value) => degreesLongitudeToSemicircles(degreesLongitude(value)),
    (raw) => semicirclesToDegreesLongitude(longitudeSemicircles(raw)),
    SEMICIRCLES_MIN,
    SEMICIRCLES_MAX,
  ),
  altitude: uint16(
    'uint16-fit-altitude',
    'm',
    (value) => metresToFitAltitude(altitudeMetres(value)),
    (raw) => fitAltitudeToMetres(raw),
    FIT_ALTITUDE_RAW_MAX,
  ),
  temperature: {
    encoding: 'sint8',
    bytesPerSample: 1,
    rawMin: -128,
    rawMax: 127,
    unit: '°C',
    toRaw: (value) => Math.round(value),
    fromRaw: (raw) => degreesCelsius(raw),
    read: (view, at) => view.getInt8(at),
    write: (view, at, raw) => {
      view.setInt8(at, raw);
    },
  },
};

const COORDINATE_CHANNELS = new Set<StreamChannel>([...POSITION_CHANNELS, 'altitude']);

/**
 * Runs a conversion, and stops a coordinate's value escaping in the message.
 *
 * ADR 0004 decision D: for a latitude, a longitude or an altitude reported
 * beside one, a message may name **the field and the constraint** and must not
 * name **the value**. Since #104 `@onyourleft/domain`'s guards no longer name a
 * coordinate's value either, so this is now the second of two independent
 * redactions rather than the only one — and it stays, for three reasons it
 * covers on its own: `altitude`, which the domain package cannot redact because
 * it never sees the position the value sits beside; a `UnitError` raised by a
 * non-coordinate guard reached through a coordinate channel; and the sample
 * index, which is this layer's alone to add. The three coordinate channels
 * never propagate a `UnitError`'s text — they raise the channel, the sample
 * index and the constraint instead. Every other channel keeps the domain
 * message, because for those the number is the diagnostic.
 */
function coordinateSafe<T>(
  channel: StreamChannel,
  index: number,
  run: () => T,
  raise: (message: string) => Error,
): T {
  try {
    return run();
  } catch (cause) {
    if (!(cause instanceof UnitError)) {
      throw cause;
    }
    const where = `stream channel ${channel}, sample ${String(index)}`;
    if (COORDINATE_CHANNELS.has(channel)) {
      // The cause's own message is **discarded**, not reworded: it is the one
      // thing here that is known to carry the coordinate.
      throw raise(`${where}: the value is outside the range this channel can represent`);
    }
    throw raise(`${where}: ${cause.message}`);
  }
}

function packedPresenceBytes(sampleCount: number): number {
  return Math.ceil(sampleCount / 8);
}

function setPresenceBit(bitmap: Uint8Array, index: number): void {
  const byte = index >> 3;
  bitmap[byte] = (bitmap[byte] ?? 0) | (1 << (index & 7));
}

function isPresent(bitmap: Uint8Array, index: number): boolean {
  return (((bitmap[index >> 3] ?? 0) >> (index & 7)) & 1) === 1;
}

/**
 * Encodes one channel.
 *
 * @throws {StoreValidationError} if a sample is outside what the channel's
 * encoding can represent. Rejected rather than clamped: a power of 70 kW is a
 * decode fault upstream, and clamping it would write a plausible 65 kW that
 * round-trips cleanly for ever.
 */
export function encodeChannel<C extends StreamChannel>(
  channel: C,
  samples: Samples<C>,
): EncodedChannel {
  const codec = CODECS[channel];
  const sampleCount = samples.length;
  const values = new Uint8Array(sampleCount * codec.bytesPerSample);
  const view = new DataView(values.buffer);
  let present: Uint8Array | undefined;

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = samples[index];
    if (sample === undefined) {
      // The first gap is what allocates the bitmap. A dense channel never
      // allocates one and never stores one.
      present ??= filledPresence(sampleCount, index);
      continue;
    }
    // The range check runs **inside** `coordinateSafe`, and raises the same
    // `UnitError` the domain constructors do, so there is exactly one place
    // where an out-of-range value becomes a message and exactly one place where
    // ADR 0004 decision D is applied. Checking it outside would be a second
    // path, and a second path is one nobody remembers to mask.
    const raw = coordinateSafe(
      channel,
      index,
      () => {
        const encoded = codec.toRaw(sample);
        if (!Number.isInteger(encoded) || encoded < codec.rawMin || encoded > codec.rawMax) {
          throw new UnitError(
            `${String(sample)} ${codec.unit} is outside this channel's encodable range, ` +
              `${String(codec.rawMin)} to ${String(codec.rawMax)} in steps of its resolution`,
          );
        }
        return encoded;
      },
      (message) => new StoreValidationError(message),
    );
    codec.write(view, index * codec.bytesPerSample, raw);
    if (present !== undefined) {
      setPresenceBit(present, index);
    }
  }

  return {
    channel,
    encoding: codec.encoding,
    sampleCount,
    values,
    ...(present === undefined ? {} : { present }),
  };
}

/** A presence bitmap with every sample before `firstGap` marked present. */
function filledPresence(sampleCount: number, firstGap: number): Uint8Array {
  const bitmap = new Uint8Array(packedPresenceBytes(sampleCount));
  for (let index = 0; index < firstGap; index += 1) {
    setPresenceBit(bitmap, index);
  }
  return bitmap;
}

/**
 * Decodes one channel back to samples, gaps included.
 *
 * Everything here treats the bytes as untrusted, for `persisted.ts`'s reason:
 * they were written by some earlier build, or hand-edited in a devtools pane,
 * or partially corrupted. A length that does not match the sample count, an
 * encoding this build does not know, or a raw value the domain constructor
 * rejects is a `StoreDecodeError` rather than a chart with a wrong axis.
 *
 * @throws {StoreDecodeError}
 */
export function decodeChannel<C extends StreamChannel>(
  channel: C,
  encoded: EncodedChannel,
): Samples<C> {
  const codec = CODECS[channel];
  if (encoded.encoding !== codec.encoding) {
    throw new StoreDecodeError(
      `stream channel ${channel}: stored encoding ${encoded.encoding} is not the ` +
        `${codec.encoding} this build writes`,
    );
  }
  const { sampleCount } = encoded;
  if (!Number.isInteger(sampleCount) || sampleCount < 0) {
    throw new StoreDecodeError(
      `stream channel ${channel}: sample count must be a non-negative integer, found ` +
        `${String(sampleCount)}`,
    );
  }
  const expectedBytes = sampleCount * codec.bytesPerSample;
  if (encoded.values.byteLength !== expectedBytes) {
    throw new StoreDecodeError(
      `stream channel ${channel}: expected ${String(expectedBytes)} bytes for ` +
        `${String(sampleCount)} samples, found ${String(encoded.values.byteLength)}`,
    );
  }
  const { present } = encoded;
  if (present !== undefined && present.byteLength !== packedPresenceBytes(sampleCount)) {
    throw new StoreDecodeError(
      `stream channel ${channel}: presence bitmap is ${String(present.byteLength)} bytes, ` +
        `expected ${String(packedPresenceBytes(sampleCount))} for ${String(sampleCount)} samples`,
    );
  }

  const view = new DataView(encoded.values.buffer, encoded.values.byteOffset, expectedBytes);
  const samples: (number | undefined)[] = new Array<number | undefined>(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    if (present !== undefined && !isPresent(present, index)) {
      samples[index] = undefined;
      continue;
    }
    const raw = codec.read(view, index * codec.bytesPerSample);
    samples[index] = coordinateSafe(
      channel,
      index,
      () => codec.fromRaw(raw),
      (message) => new StoreDecodeError(message),
    );
  }
  // The only cast in this file. It is sound because every quantity in
  // `@onyourleft/domain` is a branded `number` that erases at runtime, and
  // because `codec.fromRaw` is the channel's own domain constructor — so each
  // element has already been validated as the type this cast claims.
  return samples as Samples<C>;
}

/** Bytes one sample of a channel occupies before compression. Used by the cost measurement. */
export function channelBytesPerSample(channel: StreamChannel): number {
  return CODECS[channel].bytesPerSample;
}
