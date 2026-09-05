// SPDX-License-Identifier: Apache-2.0

/**
 * The round-trip assertions — the half of the harness that decides pass or fail.
 *
 * ## Why these are plain functions that throw, and not `expect` calls
 *
 * #28's decisive criterion is that the harness be **proved by deliberately
 * breaking persistence and watching the test go red**. The only way to make
 * that a permanent, mechanical fact rather than a screenshot in a pull request
 * is to run the *same assertion body* twice: once against the real store, where
 * it must pass, and once against a repository that does not persist, where it
 * must throw. That requires the assertions to be values a test can call and
 * wrap, so they live here as functions that throw `RoundTripFailure`, and
 * `harness.test.ts` asserts both directions.
 *
 * Keeping them free of any test framework also means #61's signed records,
 * #34's scoping tests and #7's instance store can use them unchanged, which is
 * the reuse #28 is for.
 *
 * ## What each assertion closes
 *
 * `assertStreamSetRoundTrip` writes through the public path, discards every
 * connection and cache, reads through the public path, and compares
 * sample-for-sample. That single call closes all four causes of the
 * write-succeeds-read-cannot-see-it defect: it cannot be satisfied by a cache
 * (the connection is gone), by an unflushed transaction (the connection is
 * gone), by a write to a store the reader does not consult (the reader is the
 * real public read path), or by asserting against the object the caller built
 * (the comparison is against what came back).
 */

import type { RecoveredRecording } from '../recording';
import type { StreamChannel, StreamChannels, StreamSet } from '../streams';
import { STREAM_CHANNELS, type NewStreamSet } from '../streams';

import type { StoreHarness } from './harness';

/**
 * A round trip did not come back.
 *
 * A distinct class so a test can require *this* failure rather than any
 * failure: a fake that throws on write would also make a naive
 * `expect(...).rejects` pass, and would prove nothing about the read.
 */
export class RoundTripFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoundTripFailure';
  }
}

/**
 * Writes a stream set through the public path, discards every connection, reads
 * it back through the public path, and asserts it is the same set.
 *
 * The athlete and the activity must already exist — `seedAthletes` and
 * `seedRide` in `fixtures.ts` put them there.
 *
 * @returns what came back, so a caller can make further assertions about it.
 * @throws {RoundTripFailure}
 */
export async function assertStreamSetRoundTrip(
  harness: StoreHarness,
  set: NewStreamSet,
): Promise<StreamSet> {
  const read = await harness.roundTrip(
    async (store) => store.putStreamSet(set),
    async (store) => store.getStreamSet(set.athleteId, set.activityId),
  );

  if (read === undefined) {
    throw new RoundTripFailure(
      `the stream set for activity ${set.activityId} was written and reported success, and a ` +
        `fresh connection cannot see it`,
    );
  }
  assertSameStreamSet(set, read);
  return read;
}

/**
 * Compares two stream sets field by field and sample by sample.
 *
 * Exact equality, including for the coordinate channels: the encoding's
 * declared resolution is its contract, and a value on the grid comes back
 * unchanged. A tolerance here would hide exactly the quantisation bug it looks
 * like it is guarding against.
 *
 * @throws {RoundTripFailure}
 */
export function assertSameStreamSet(expected: NewStreamSet, actual: StreamSet): void {
  requireEqual('activityId', expected.activityId, actual.activityId);
  requireEqual('athleteId', expected.athleteId, actual.athleteId);
  requireEqual('startedAt', expected.startedAt, actual.startedAt);
  requireEqual('sampleInterval', expected.sampleInterval, actual.sampleInterval);
  requireEqual('sampleCount', expected.sampleCount, actual.sampleCount);

  for (const channel of STREAM_CHANNELS) {
    const before = expected.channels[channel];
    const after = actual.channels[channel];
    if (before === undefined && after === undefined) {
      continue;
    }
    if (before === undefined) {
      throw new RoundTripFailure(
        `channel ${channel} was not written and came back with ${String(after?.length)} samples`,
      );
    }
    if (after === undefined) {
      throw new RoundTripFailure(`channel ${channel} was written and did not come back at all`);
    }
    assertSameSamples(channel, before, after);
  }
}

/**
 * Compares one channel's samples, gaps included.
 *
 * A gap is `undefined` and a zero is `0`, and this comparison distinguishes
 * them — which is the point of #27's gap criterion. `===` on `undefined` versus
 * `0` is not an accident of the comparison, it is the assertion.
 *
 * @throws {RoundTripFailure}
 */
export function assertSameSamples(
  channel: StreamChannel,
  expected: readonly (number | undefined)[],
  actual: readonly (number | undefined)[],
): void {
  if (expected.length !== actual.length) {
    throw new RoundTripFailure(
      `channel ${channel}: wrote ${String(expected.length)} samples and read back ` +
        `${String(actual.length)}`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const before = expected[index];
    const after = actual[index];
    if (before === after) {
      continue;
    }
    throw new RoundTripFailure(
      `channel ${channel}, sample ${String(index)}: wrote ${describe(channel, before)} and read ` +
        `back ${describe(channel, after)}`,
    );
  }
}

const COORDINATE_CHANNELS: ReadonlySet<StreamChannel> = new Set<StreamChannel>([
  'latitude',
  'longitude',
  'altitude',
]);

/**
 * Renders a sample for a failure message.
 *
 * ADR 0004 decision D applies to this file too: it is a message that reaches a
 * console and a CI log. A mismatched coordinate is reported as present or
 * absent and nothing more; every other channel keeps its value, which is what
 * makes the message useful for the seven channels where the number is the
 * diagnostic. "Absent" versus "a value" is the whole of what a gap assertion
 * needs to say anyway.
 */
function describe(channel: StreamChannel, sample: number | undefined): string {
  if (sample === undefined) {
    return 'a gap';
  }
  return COORDINATE_CHANNELS.has(channel) ? 'a coordinate' : String(sample);
}

function requireEqual(field: string, expected: unknown, actual: unknown): void {
  if (expected !== actual) {
    throw new RoundTripFailure(
      `${field}: wrote ${String(expected)} and read back ${String(actual)}`,
    );
  }
}

/**
 * What a recording is expected to look like once recovered.
 *
 * Deliberately **not** the recording the caller wrote chunk by chunk. A crash
 * test's whole subject is the difference between what was offered and what
 * survived, so the expectation is stated as the assembled series a fresh
 * connection should be able to produce — which is the thing a rider gets back.
 */
export interface ExpectedRecording {
  readonly sampleCount: number;
  readonly channels: StreamChannels;
}

/**
 * Discards every connection, reads a recording back through the public
 * recovery path, and asserts it is the series expected.
 *
 * The write half is the caller's, because a recording is written by many calls
 * over time and a crash test needs to choose where the crash lands. What this
 * supplies is the half that must not be hand-rolled: the fresh connection, and
 * a sample-by-sample comparison that distinguishes a gap from a zero.
 *
 * @returns what came back, so a caller can make further assertions about it.
 * @throws {RoundTripFailure}
 */
export async function assertRecordingRecovers(
  harness: StoreHarness,
  owner: RecoveredRecording['athleteId'],
  id: RecoveredRecording['id'],
  expected: ExpectedRecording,
): Promise<RecoveredRecording> {
  const read = await harness.read(async (store) => store.recoverRecording(owner, id));

  if (read === undefined) {
    throw new RoundTripFailure(
      `recording ${id} was checkpointed and reported success, and a fresh connection cannot ` +
        `see it`,
    );
  }
  if (read.sampleCount !== expected.sampleCount) {
    throw new RoundTripFailure(
      `recording ${id}: expected ${String(expected.sampleCount)} samples to survive and ` +
        `${String(read.sampleCount)} did`,
    );
  }
  for (const channel of STREAM_CHANNELS) {
    const before = expected.channels[channel];
    const after = read.channels[channel];
    if (before === undefined && after === undefined) {
      continue;
    }
    if (before === undefined) {
      throw new RoundTripFailure(
        `channel ${channel} was not recorded and came back with ${String(after?.length)} samples`,
      );
    }
    if (after === undefined) {
      throw new RoundTripFailure(`channel ${channel} was recorded and did not come back at all`);
    }
    assertSameSamples(channel, before, after);
  }
  return read;
}
