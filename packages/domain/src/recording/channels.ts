// SPDX-License-Identifier: Apache-2.0

/**
 * What the recorder merges, and what it produces.
 *
 * ## Why this is generic and not the eight channels by name
 *
 * The stream merge needs to know *which* channels exist and what each one's
 * values are. Two places already spell that out: `@onyourleft/sensors`'
 * `SensorMeasurement` and `@onyourleft/store`'s `StreamChannelValue`. This
 * package can import **neither** — both depend on it, and a package with no
 * dependencies at all cannot acquire one without inverting the graph
 * (docs/architecture.md). Copying the eight names into this file would put a
 * storage decision (ADR 0011 chose those eight and their resolutions) in the
 * units package, where a ninth channel would then have to be added twice.
 *
 * So the engine is **generic over a channel map**, and the composition root —
 * `apps/web` today, `apps/mobile` at #85 — instantiates it at the map the store
 * already declares and adapts sensor measurements into readings. The engine
 * therefore has no opinion about how many channels there are or what they mean,
 * and #49 and the analysis issues inherit a merge that a new channel does not
 * change.
 *
 * The cost is one type parameter on every public name here. The benefit is that
 * a reading still cannot carry a heart rate in a power channel: {@link
 * ChannelReading} is a **discriminated union over the map**, so `channel` and
 * `value` are checked against each other. `recording-safety.test.ts` pins that
 * with `@ts-expect-error`, which is the only way to assert a compile-time
 * guarantee (CLAUDE.md section 5).
 */

import { unixSeconds, type Seconds, type UnixSeconds } from '../quantities';

/**
 * The shape a channel map has: channel name to the type of that channel's
 * samples.
 *
 * ⚠️ **`object`, not `Record<string, unknown>`.** The obvious constraint is the
 * record, and it silently excludes every `interface` — TypeScript gives an
 * implicit index signature to a type alias and not to an interface, so
 * `@onyourleft/store`'s `StreamChannelValue`, which is an interface, does not
 * satisfy `Record<string, unknown>` and could not be used here at all. That
 * failure surfaces at the composition root rather than in this package, which
 * is the worst place for it, so the constraint is the loose one and the
 * per-channel typing is done by {@link ChannelReading}'s distribution instead.
 *
 * Nothing is required of a channel's *value*: the engine stores it in a slot
 * and hands it back. A consumer recording an enum, a device id or a gear state
 * is not doing anything this engine needs to refuse.
 */
export type RecordingChannelMap = object;

/** The channel names of a map, as a string union. */
export type ChannelOf<Channels extends RecordingChannelMap> = keyof Channels & string;

/**
 * One sensor reading: a value, the channel it belongs to, and when the sensor
 * produced it.
 *
 * A distributed union over the map rather than `{ channel: keyof Channels;
 * value: Channels[keyof Channels] }`, which would accept every value for every
 * channel — the transposition that no range check can see, because a cadence
 * and a heart rate are both small positive numbers.
 *
 * `at` is an **instant**, not a device event counter. `@onyourleft/sensors`'
 * `MeasurementEnvelope.at` is the receive instant and says so: almost nothing
 * in BLE cycling telemetry carries an absolute time, and the wrapping 1/1024 s
 * counters CSC and CPS report are good for an interval and useless as an
 * instant.
 */
export type ChannelReading<Channels extends RecordingChannelMap> = {
  [C in ChannelOf<Channels>]: {
    readonly channel: C;
    readonly value: Channels[C];
    readonly at: UnixSeconds;
  };
}[ChannelOf<Channels>];

/**
 * One channel's merged samples: one slot per sample, `undefined` where nothing
 * was recorded.
 *
 * **A gap is `undefined`, never a sentinel and never zero.** Zero power is a
 * rider coasting; absent power is a sensor that is gone. #45 makes keeping
 * those apart end to end its most important criterion, and `@onyourleft/store`
 * carries the same rule into the encoding with a presence bitmap rather than an
 * invalid value.
 */
export type RecordedSamples<
  Channels extends RecordingChannelMap,
  C extends ChannelOf<Channels>,
> = readonly (Channels[C] | undefined)[];

/** The channels a series carries. A channel nothing was ever recorded for is absent. */
export type RecordedChannels<Channels extends RecordingChannelMap> = {
  readonly [C in ChannelOf<Channels>]?: RecordedSamples<Channels, C>;
};

/** Whether a pause was asked for or inferred. */
export type PauseReason = 'manual' | 'automatic';

/**
 * A stretch of the ride during which nothing was recorded **on purpose**.
 *
 * This is what keeps a pause distinguishable from a dropout. Both are runs of
 * `undefined` in every channel, and they mean opposite things: a dropout is
 * missing data about a rider who was riding, and a pause is correct data about
 * a rider who was not. Without this list an analysis pass (#75-#78) would have
 * to guess, and the guess it would make — "a long gap in every channel is a
 * pause" — is wrong exactly when a rider's whole sensor set drops at once.
 *
 * `to` is absent while the pause is open.
 */
export interface RecordedPause {
  readonly from: UnixSeconds;
  readonly to?: UnixSeconds;
  readonly reason: PauseReason;
}

/**
 * The merged record series: several irregular sensor feeds as one regular grid.
 *
 * Sample `i` of every channel is the same instant, `startedAt + i *
 * sampleInterval`. That shared time base is what makes a chart's x axis one
 * computation, and it is the shape `@onyourleft/store`'s `StreamSet` stores —
 * deliberately, so that persisting a recording is a field rename and not a
 * transformation.
 */
export interface RecordedSeries<Channels extends RecordingChannelMap> {
  /** The instant of sample 0. */
  readonly startedAt: UnixSeconds;
  /** The spacing between samples. `seconds(1)` for the 1 Hz case FIT expects. */
  readonly sampleInterval: Seconds;
  /** How many slots each channel array has, gaps included. */
  readonly sampleCount: number;
  readonly channels: RecordedChannels<Channels>;
  /** Every pause, in order. See {@link RecordedPause}. */
  readonly pauses: readonly RecordedPause[];
}

/** A contiguous window of a series — what an incremental flush writes. */
export interface RecordedSlice<Channels extends RecordingChannelMap> {
  /** Index of this window's first slot within the whole series. */
  readonly fromIndex: number;
  /** How many slots this window covers. */
  readonly sampleCount: number;
  readonly channels: RecordedChannels<Channels>;
}

/**
 * The instant of every slot of a series.
 *
 * Exists so that "the merged series is strictly monotonic in time with no
 * duplicate timestamps" (#45) is a property something can assert rather than a
 * property of an implementation nobody looked at. It is also what a FIT encoder
 * (#31) needs, since FIT records carry an absolute `date_time` per record and
 * not an index.
 */
export function seriesTimestamps<Channels extends RecordingChannelMap>(
  series: RecordedSeries<Channels>,
): UnixSeconds[] {
  const timestamps: UnixSeconds[] = new Array<UnixSeconds>(series.sampleCount);
  for (let index = 0; index < series.sampleCount; index += 1) {
    // Not `previous + interval`: accumulating a float `interval` drifts, and a
    // sub-second interval is a legitimate configuration. Through the
    // constructor rather than a cast, so a series whose start or interval is a
    // nonsense number is rejected here rather than charted.
    timestamps[index] = unixSeconds(series.startedAt + index * series.sampleInterval);
  }
  return timestamps;
}
