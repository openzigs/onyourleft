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

import { verifyRecordSignature, type SignatureVerifier } from '@onyourleft/domain';

import type { StoredActivityRecord } from '../identity';
import type { RecoveredRecording } from '../recording';
import type { StreamChannel, StreamChannels, StreamSet } from '../streams';
import { STREAM_CHANNELS, type NewStreamSet } from '../streams';

import type { RouteRecord, SegmentEndpointRecord, SegmentRecord } from '../records';
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

/**
 * Writes a signed record through the public path, discards every connection,
 * reads it back through the public path, and **verifies the signature on what
 * came back** using only the public key inside it.
 *
 * The verification, not a comparison, is the assertion — #61's third acceptance
 * criterion asks for exactly that, and `roundedClaimStoreFactory` in `fakes.ts`
 * is why. A layer above the store that tidies one claim on its way in produces
 * a record that comes back complete, well-formed and parseable, and a round
 * trip that only compared what it wrote against what it read would have to be
 * given the untidied original to notice. Verifying needs nothing but the row: a
 * record that cannot be verified is worse than one that did not come back,
 * because it looks like evidence.
 *
 * Nothing here uses the writer's `SigningKey`, or any key at all. That is the
 * other half of the criterion: the check runs on the public key **in the
 * record**, which is what a stranger would have.
 *
 * @returns what came back, so a caller can make further assertions about it.
 * @throws {RoundTripFailure}
 */
export async function assertSignedRecordRoundTrip(
  harness: StoreHarness,
  row: StoredActivityRecord,
  verifier: SignatureVerifier,
): Promise<StoredActivityRecord> {
  const read = await harness.roundTrip(
    async (store) => store.putActivityRecord(row),
    async (store) => store.getActivityRecord(row.athleteId, row.activityId),
  );

  if (read === undefined) {
    throw new RoundTripFailure(
      `the signed record for activity ${row.activityId} was written and reported success, and a ` +
        `fresh connection cannot see it`,
    );
  }
  requireEqual('athleteId', row.athleteId, read.athleteId);
  requireEqual('activityId', row.activityId, read.activityId);

  const outcome = await verifyRecordSignature(read.record, verifier);
  if (outcome.status !== 'verified') {
    throw new RoundTripFailure(
      `the signed record for activity ${row.activityId} came back and did not verify: ` +
        `${outcome.status}`,
    );
  }
  return read;
}

/**
 * Writes a segment through the public path, discards every connection, reads it
 * back through the public path, and asserts it is the same segment —
 * **including every position of its geometry**.
 *
 * The athlete must already exist; `seedAthletes` in `fixtures.ts` puts three
 * there.
 *
 * ⚠️ **The geometry comparison is the assertion, and the rest is scaffolding.**
 * #64's eighth criterion says so in terms: the round trip asserts equality
 * *"including the geometry, which is the field most likely to survive as a
 * stale in-memory object"*. `thinnedGeometryStoreFactory` in `fakes.ts` is a
 * store that gets every other field right and thins the path, and it exists so
 * that deleting the loop below turns a test red rather than leaving the suite
 * green.
 *
 * @returns what came back, so a caller can make further assertions about it.
 * @throws {RoundTripFailure}
 */
export async function assertSegmentRoundTrip(
  harness: StoreHarness,
  segment: SegmentRecord,
): Promise<SegmentRecord> {
  const read = await harness.roundTrip(
    async (store) => store.putSegment(segment),
    async (store) => store.getSegment(segment.createdBy, segment.id),
  );

  if (read === undefined) {
    throw new RoundTripFailure(
      `segment ${segment.id} was written and reported success, and a fresh connection cannot ` +
        `see it`,
    );
  }

  requireEqual('segment.id', segment.id, read.id);
  requireEqual('segment.createdBy', segment.createdBy, read.createdBy);
  requireEqual('segment.name', segment.name, read.name);
  requireEqual('segment.sport', segment.sport, read.sport);
  requireEqual('segment.distance', segment.distance, read.distance);
  requireEqual('segment.visibility', segment.visibility, read.visibility);
  requireEqual('segment.createdAt', segment.createdAt, read.createdAt);
  requireEqual('segment.elevationSource', segment.elevationSource, read.elevationSource);
  requireEqual('segment.elevationGain', segment.elevationGain, read.elevationGain);
  requireEqual('segment.averageGrade', segment.averageGrade, read.averageGrade);
  requireEqual('segment.maximumGrade', segment.maximumGrade, read.maximumGrade);
  requireEqual(
    'segment.elevationResolutionMetres',
    segment.elevationResolutionMetres,
    read.elevationResolutionMetres,
  );
  requireEqual(
    'segment.bearingToleranceDegrees',
    segment.bearingToleranceDegrees,
    read.bearingToleranceDegrees,
  );
  requireSameEndpoint('segment.start', segment.start, read.start);
  requireSameEndpoint('segment.end', segment.end, read.end);

  // The count first, so a thinned path fails with a message that says what
  // happened rather than with a coordinate mismatch at position 1.
  requireEqual('segment.geometry.length', segment.geometry.length, read.geometry.length);
  for (const [index, expected] of segment.geometry.entries()) {
    const actual = read.geometry[index];
    if (actual === undefined) {
      throw new RoundTripFailure(`segment.geometry[${String(index)}]: nothing came back`);
    }
    // ⚠️ The message names the INDEX and never the coordinate, per ADR 0004
    // decision D — a round-trip failure is exactly the message that ends up
    // pasted into a bug report.
    if (expected.latitude !== actual.latitude || expected.longitude !== actual.longitude) {
      throw new RoundTripFailure(
        `segment.geometry[${String(index)}]: the position that came back is not the one written`,
      );
    }
  }
  return read;
}

function requireSameEndpoint(
  field: string,
  expected: SegmentEndpointRecord,
  actual: SegmentEndpointRecord,
): void {
  requireEqual(`${field}.bearing`, expected.bearing, actual.bearing);
  requireEqual(`${field}.radius`, expected.radius, actual.radius);
  if (
    expected.position.latitude !== actual.position.latitude ||
    expected.position.longitude !== actual.position.longitude
  ) {
    throw new RoundTripFailure(`${field}.position: what came back is not what was written`);
  }
}

/**
 * Writes a route through the public path, discards every connection, reads it
 * back through the public path, and asserts it is the same route — **including
 * its `loop` flag, every position, every elevation and every gradient**.
 *
 * The athlete must already exist; `seedAthletes` in `fixtures.ts` puts three
 * there.
 *
 * ⚠️ **`loop` is checked first and on its own line**, which looks like fussiness
 * and is not. It is one bit, it is the field with no structural redundancy
 * behind it, and it is the one that decides what happens when the rider reaches
 * the end — #89's fifth criterion. `openedLoopStoreFactory` in `fakes.ts` is a
 * store that gets all four arrays right to the last bit and writes `false`
 * there, and it exists so that deleting this line turns a test red rather than
 * leaving the suite green.
 *
 * @returns what came back, so a caller can make further assertions about it.
 * @throws {RoundTripFailure}
 */
export async function assertRouteRoundTrip(
  harness: StoreHarness,
  route: RouteRecord,
): Promise<RouteRecord> {
  const read = await harness.roundTrip(
    async (store) => store.putRoute(route),
    async (store) => store.getRoute(route.createdBy, route.id),
  );

  if (read === undefined) {
    throw new RoundTripFailure(
      `route ${route.id} was written and reported success, and a fresh connection cannot see it`,
    );
  }

  requireEqual('route.loop', route.profile.loop, read.profile.loop);
  requireEqual('route.id', route.id, read.id);
  requireEqual('route.createdBy', route.createdBy, read.createdBy);
  requireEqual('route.name', route.name, read.name);
  requireEqual('route.createdAt', route.createdAt, read.createdAt);
  requireEqual('route.resolution', route.profile.resolution, read.profile.resolution);
  requireEqual('route.totalDistance', route.profile.totalDistance, read.profile.totalDistance);
  requireEqual('route.totalAscent', route.profile.totalAscent, read.profile.totalAscent);
  requireEqual('route.totalDescent', route.profile.totalDescent, read.profile.totalDescent);

  // Counts first, so a truncated profile fails with a message that says what
  // happened rather than with a mismatch at sample 1.
  requireEqual(
    'route.elevations.length',
    route.profile.elevations.length,
    read.profile.elevations.length,
  );
  requireEqual('route.grades.length', route.profile.grades.length, read.profile.grades.length);
  requireEqual(
    'route.positions.length',
    route.profile.positions.length,
    read.profile.positions.length,
  );

  for (const [index, expected] of route.profile.elevations.entries()) {
    requireEqual(`route.elevations[${String(index)}]`, expected, read.profile.elevations[index]);
  }
  for (const [index, expected] of route.profile.grades.entries()) {
    requireEqual(`route.grades[${String(index)}]`, expected, read.profile.grades[index]);
  }
  for (const [index, expected] of route.profile.positions.entries()) {
    const actual = read.profile.positions[index];
    if (actual === undefined) {
      throw new RoundTripFailure(`route.positions[${String(index)}]: nothing came back`);
    }
    // ⚠️ The message names the INDEX and never the coordinate, per ADR 0004
    // decision D — a round-trip failure is exactly the message that ends up
    // pasted into a bug report.
    if (expected.latitude !== actual.latitude || expected.longitude !== actual.longitude) {
      throw new RoundTripFailure(
        `route.positions[${String(index)}]: the position that came back is not the one written`,
      );
    }
  }
  return read;
}
