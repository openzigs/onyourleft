// SPDX-License-Identifier: Apache-2.0

/**
 * The on-disk shapes of a stream set, and the conversions between them and the
 * types in `streams.ts`.
 *
 * Two object stores rather than one, and the split is the whole of #27's
 * "relational store and object storage" translated onto the one engine Phase 1
 * has:
 *
 * | Store | Row | Size |
 * |---|---|---|
 * | `streamSets` | one small indexed row per activity — the time base, the channel list, the byte count | tens of bytes |
 * | `streamBlobs` | one row per channel per activity, holding the packed bytes | kilobytes |
 *
 * That is a real split, not a cosmetic one: `getStreamSetSummary` answers "does
 * this ride have a power trace, and what does it cost me" by reading the small
 * store alone, and #62's activity list can render without ever touching a blob.
 * What #27 calls object storage is the second store; what it calls the
 * relational store is the first. Both live in IndexedDB because owner decision
 * D6 leaves exactly one engine, and ADR 0011 records what changes when #7 adds
 * a real object store in Phase 4 — the answer is the blob store's backing, not
 * this shape.
 *
 * **A `Uint8Array` is what goes on disk**, not a `Blob`. Both survive the
 * structured clone algorithm, and `Blob` would be the more obvious choice for
 * something called object storage. `Uint8Array` wins on two counts: reading a
 * `Blob` back is asynchronous a second time, inside code that has already
 * spent its asynchrony on decompression; and a `Blob` in IndexedDB is stored by
 * reference to a file the browser manages separately, so a `blob` whose backing
 * file has gone is a failure mode with no analogue for a byte array.
 *
 * Everything read back is untrusted, for the reason `persisted.ts` gives: it
 * was written by an earlier build, hand-edited in a devtools pane, or partially
 * corrupted. Every field is re-validated on the way out.
 */

import { seconds, unixSeconds } from '@onyourleft/domain';

import { StoreDecodeError } from './errors';
import { activityId, athleteId } from './ids';
import { decoded, decodedNumber, decodedString } from './persisted';
import type { ChannelEncoding, EncodedChannel } from './stream-codec';
import { STREAM_CHANNELS, type StreamChannel, type StreamSetSummary } from './streams';

/** The small indexed row: one per activity. @see StreamSetSummary */
export interface PersistedStreamSet {
  /** The primary key. A stream set *is* its activity's, so it needs no id of its own. */
  activityId: string;
  /** The scoping column. Every read of this row filters on it. */
  athleteId: string;
  startedAt: number;
  sampleIntervalSeconds: number;
  sampleCount: number;
  /** Which channels have a blob row. Ordered as `STREAM_CHANNELS` orders them. */
  channels: string[];
  /** Bytes this device holds for this ride, after compression. ADR 0011's measurement. */
  encodedBytes: number;
}

/** One channel's stored bytes. @see EncodedChannel */
export interface PersistedStreamBlob {
  activityId: string;
  channel: string;
  /**
   * Denormalised from the owning activity, for `LapRecord.athleteId`'s reason:
   * it is the scoping column, and without it a blob read would have to consult
   * another store to learn whose bytes these are.
   */
  athleteId: string;
  encoding: string;
  compression: string;
  sampleCount: number;
  /** Compressed. @see stream-compression.ts */
  values: Uint8Array;
  /** Compressed, and absent when the channel has no gaps. */
  present?: Uint8Array;
}

const CHANNEL_NAMES = new Set<string>(STREAM_CHANNELS);

/** @throws {StoreDecodeError} if `value` is not one of the eight channel names. */
export function parseStreamChannel(value: unknown): StreamChannel {
  if (typeof value === 'string' && CHANNEL_NAMES.has(value)) {
    return value as StreamChannel;
  }
  throw new StoreDecodeError(
    `stream channel must be one of ${STREAM_CHANNELS.join(', ')}, found ` +
      `${typeof value === 'string' ? JSON.stringify(value) : typeof value}`,
  );
}

/** @throws {StoreDecodeError} */
export function fromPersistedStreamSet(row: PersistedStreamSet): StreamSetSummary {
  const channels = row.channels;
  if (!Array.isArray(channels)) {
    throw new StoreDecodeError(
      `streamSet.channels: expected an array, found ${typeof row.channels as string}`,
    );
  }
  return {
    activityId: activityId(decodedString('streamSet.activityId', row.activityId)),
    athleteId: athleteId(decodedString('streamSet.athleteId', row.athleteId)),
    startedAt: decoded(
      'streamSet.startedAt',
      decodedNumber('streamSet.startedAt', row.startedAt),
      unixSeconds,
    ),
    sampleInterval: decoded(
      'streamSet.sampleInterval',
      decodedNumber('streamSet.sampleInterval', row.sampleIntervalSeconds),
      seconds,
    ),
    sampleCount: decodedSampleCount('streamSet.sampleCount', row.sampleCount),
    channels: channels.map((channel) => parseStreamChannel(channel)),
    encodedBytes: decodedSampleCount('streamSet.encodedBytes', row.encodedBytes),
  };
}

/**
 * Rebuilds an `EncodedChannel` from a row whose byte arrays have already been
 * decompressed.
 *
 * Decompression is the caller's, because it is asynchronous and must not happen
 * inside the Dexie transaction that read the row — an `await` on a promise
 * Dexie did not create lets the underlying IndexedDB transaction commit out
 * from under the code still using it.
 *
 * @throws {StoreDecodeError}
 */
export function fromPersistedStreamBlob(
  row: PersistedStreamBlob,
  values: Uint8Array,
  present: Uint8Array | undefined,
): EncodedChannel {
  const channel = parseStreamChannel(row.channel);
  return {
    channel,
    // Cast, then checked: `decodeChannel` compares this against the encoding
    // the build writes and refuses anything else, so an unknown string on disk
    // fails there rather than being trusted here.
    encoding: decodedString(`streamBlob.${channel}.encoding`, row.encoding) as ChannelEncoding,
    sampleCount: decodedSampleCount(`streamBlob.${channel}.sampleCount`, row.sampleCount),
    values,
    ...(present === undefined ? {} : { present }),
  };
}

function decodedSampleCount(field: string, value: unknown): number {
  const count = decodedNumber(field, value);
  if (!Number.isInteger(count) || count < 0) {
    throw new StoreDecodeError(`${field}: expected a non-negative integer, found ${String(count)}`);
  }
  return count;
}

/** The bytes a stored blob row occupies, for the `encodedBytes` measurement. */
export function persistedBlobBytes(row: PersistedStreamBlob): number {
  return row.values.byteLength + (row.present?.byteLength ?? 0);
}
