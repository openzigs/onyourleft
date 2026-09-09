// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * One ride, defined once, for every client that claims to encode it the same —
 * [#15](https://github.com/openzigs/onyourleft/issues/15)'s sixth criterion.
 *
 * > Activities recorded on mobile and on the web client are byte-identical in
 * > their FIT output for the same input stream, **asserted by a shared
 * > fixture**.
 *
 * ⚠️ **"Shared" is the operative word, and it is why this is a module rather
 * than a `const` inside a test.** A fixture copied into two test files is two
 * fixtures, and the day they drift the comparison keeps passing while the claim
 * stops being true. Anything asserting cross-client identity imports *this*.
 *
 * ⚠️ **The stream is deliberately not the simplest one that would pass.** Six
 * channels including a coordinate pair and an altitude, with a **gap in each**,
 * because a dropout is what two encoders are most likely to disagree about —
 * one writes a record with the field absent, another writes a zero. Identical
 * bytes across a stream with no holes would not notice either.
 *
 * ⚠️ **Every value here is a function of its index.** No clock, no random
 * source, no device-dependent quantity. That is what makes byte-identity
 * assertable at all rather than merely hard to assert — and it is worth saying,
 * because "the encoder stamps the file with the time of encoding" is the
 * obvious way this stops being true and it would present as a flaky test rather
 * than as the design change it is.
 */

import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';
import {
  activityId,
  type ActivityId,
  type NewActivity,
  type NewStreamSet,
} from '@onyourleft/store';
import { rideFor, streamSetFor, type StreamFixtureOptions } from '@onyourleft/store/testing';
import type { AthleteId } from '@onyourleft/store';

/** Fixed, because a generated id would change the bytes it appears in. */
export const CROSS_CLIENT_ACTIVITY: ActivityId = activityId('cross-client-fixture');

/** The instant sample 0 was taken. Fixed, for the reason the id is. */
export const CROSS_CLIENT_EPOCH: UnixSeconds = unixSeconds(1_800_000_000);

/** Long enough to span several FIT record definitions, short enough to stay fast. */
export const CROSS_CLIENT_SAMPLES = 600;

/**
 * Where the holes are.
 *
 * One per channel, at a different offset each, so a mistake that drops the
 * *first* gap or coalesces adjacent ones has somewhere to show.
 */
const CROSS_CLIENT_GAPS: NonNullable<StreamFixtureOptions['gaps']> = [
  { channel: 'power', from: 61, count: 13 },
  { channel: 'heartRate', from: 130, count: 8 },
  { channel: 'speed', from: 201, count: 4 },
  { channel: 'altitude', from: 333, count: 16 },
];

/** The shared ride, identical on every call. */
export function crossClientRide(owner: AthleteId): NewActivity {
  return {
    ...rideFor(owner),
    id: CROSS_CLIENT_ACTIVITY,
    startedAt: CROSS_CLIENT_EPOCH,
    name: 'Cross-client fixture',
  };
}

/** Its stream, identical on every call. */
export function crossClientStreams(owner: AthleteId): NewStreamSet {
  return streamSetFor(crossClientRide(owner), {
    sampleCount: CROSS_CLIENT_SAMPLES,
    startedAt: CROSS_CLIENT_EPOCH,
    gaps: CROSS_CLIENT_GAPS,
  });
}

/** How many channels the fixture carries. A one-channel fixture proves nothing. */
export function crossClientChannelCount(owner: AthleteId): number {
  return Object.keys(crossClientStreams(owner).channels).length;
}
