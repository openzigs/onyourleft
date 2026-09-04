// SPDX-License-Identifier: Apache-2.0

/**
 * Fixtures for the round-trip harness: athletes, rides, and stream sets.
 *
 * ## Three athletes, not one, and not two
 *
 * CLAUDE.md section 6: a query matching on an entity id without also filtering
 * on the owning athlete "passes every single-athlete test in the suite". So a
 * one-athlete fixture is not a fixture.
 *
 * **Two is not enough either**, and #28's revision block says why: two athletes
 * cannot distinguish "scoped correctly" from "returns everything the requester
 * is connected to" — with two, those two behaviours produce the same answer as
 * soon as the pair is related. Three separates them, which is what #34, #68 and
 * #79-#83 will need. Phase 1 has one local athlete and no relationships (owner
 * decision D6), so those assertions belong with #34; the *fixture* is here now
 * because building it in later is a rewrite of every test that used two.
 *
 * ## Both directions of scoping are one call away
 *
 * Review of #26's PR found that a two-athlete **read** fixture is blind to a
 * **write**-path scoping hole: `put` is keyed on the primary key alone, so a
 * second athlete writing the same id destroys the first's row and then owns it.
 * `seedAthletes` therefore returns the ids as an ordered tuple, and
 * `rideFor`/`streamSetFor` take an owner, so writing "athlete B tries to
 * overwrite athlete A's record" is as short as writing the read.
 *
 * ## The stream fixture is grid-aligned, on purpose and not for convenience
 *
 * `stream-codec.ts` declares a resolution per channel, and a value on that grid
 * round-trips exactly. The generators below produce values on the grid — not by
 * rounding a pretty number, but by generating from the stored representation
 * outward: latitude and longitude are walked in **FIT semicircles** and then
 * converted to degrees, altitude in FIT's `uint16` units, speed in mm/s. That
 * is exactly the shape #30's FIT decoder will hand this store, so the
 * four-hour fixture is a realistic ride rather than a test tuned to its own
 * encoding. `stream-codec.test.ts` covers the other half — values placed
 * deliberately between grid points, and the bound on what they lose.
 */

import {
  altitudeMetres,
  beatsPerMinute,
  degreesCelsius,
  degreesLatitude,
  degreesLatitudeToSemicircles,
  degreesLongitude,
  degreesLongitudeToSemicircles,
  fitAltitudeToMetres,
  latitudeSemicircles,
  longitudeSemicircles,
  metres,
  metresPerSecond,
  metresToFitAltitude,
  revolutionsPerMinute,
  seconds,
  semicirclesToDegreesLatitude,
  semicirclesToDegreesLongitude,
  unixSeconds,
  watts,
  type UnixSeconds,
} from '@onyourleft/domain';

import { activityId, athleteId, lapId, type ActivityId, type AthleteId, type LapId } from '../ids';
import type { AthleteRecord, NewActivity, NewLap } from '../records';
import { STREAM_CHANNELS, type NewStreamSet, type Samples, type StreamChannel } from '../streams';

import type { StoreHarness } from './harness';

/** The three athletes every fixture has. See the note at the top of this file. */
export const ATHLETE_A: AthleteId = athleteId('athlete-a');
export const ATHLETE_B: AthleteId = athleteId('athlete-b');
export const ATHLETE_C: AthleteId = athleteId('athlete-c');

/** All three, in order, so a test can iterate or destructure. */
export const ATHLETES: readonly [AthleteId, AthleteId, AthleteId] = [
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
];

/** A fixed instant, so nothing in a fixture depends on when the suite runs. */
export const FIXTURE_EPOCH: UnixSeconds = unixSeconds(1_700_000_000);

/** Four hours at 1 Hz — the size #27's round-trip criterion names. */
export const FOUR_HOUR_SAMPLE_COUNT = 4 * 60 * 60;

export function athleteRecord(id: AthleteId, displayName = id): AthleteRecord {
  return { id, displayName, createdAt: FIXTURE_EPOCH };
}

/**
 * Writes all three athletes through the harness's **public** path.
 *
 * Through `write`, not through a raw Dexie handle, so a seeding step that fails
 * to persist fails the test that needed it rather than producing an empty
 * database nobody looked at.
 */
export async function seedAthletes(
  harness: StoreHarness,
  athletes: readonly AthleteId[] = ATHLETES,
): Promise<readonly AthleteId[]> {
  await harness.write(async (store) => {
    for (const id of athletes) {
      await store.putAthlete(athleteRecord(id));
    }
  });
  return athletes;
}

let rideCounter = 0;

/** Resets the id counter, so a test's ids do not depend on what ran before it. */
export function resetFixtureIds(): void {
  rideCounter = 0;
}

/**
 * An indoor trainer ride — no position data at all.
 *
 * The default rather than the exception: `hasPosition: false` is the common
 * Phase 1 case and half the product, and a fixture set whose default has a
 * track quietly makes the trainer case the one nobody tests.
 */
export function rideFor(owner: AthleteId, overrides: Partial<NewActivity> = {}): NewActivity {
  rideCounter += 1;
  return {
    id: activityId(`activity-${String(rideCounter)}`),
    athleteId: owner,
    name: 'Zwift Watopia',
    startedAt: unixSeconds(FIXTURE_EPOCH + 100_000),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(FOUR_HOUR_SAMPLE_COUNT),
    movingTime: seconds(FOUR_HOUR_SAMPLE_COUNT - 200),
    distance: metres(120_000),
    hasPosition: false,
    createdAt: unixSeconds(FIXTURE_EPOCH + 200_000),
    ...overrides,
  };
}

export function lapFor(
  ride: NewActivity,
  ordinal: number,
  overrides: Partial<NewLap> = {},
): NewLap {
  return {
    id: lapId(`lap-${ride.id}-${String(ordinal)}`),
    activityId: ride.id,
    ordinal,
    startedAt: unixSeconds(FIXTURE_EPOCH + 100_000 + ordinal * 600),
    elapsedTime: seconds(600),
    movingTime: seconds(590),
    distance: metres(5_000),
    ...overrides,
  };
}

/** Seeds an athlete's ride through the public path, and returns it. */
export async function seedRide(
  harness: StoreHarness,
  owner: AthleteId,
  overrides: Partial<NewActivity> = {},
): Promise<NewActivity> {
  const ride = rideFor(owner, overrides);
  await harness.write(async (store) => store.putActivity(ride));
  return ride;
}

/** A run of absent samples in one channel — the dropped-strap case. */
export interface StreamGap {
  readonly channel: StreamChannel;
  /** First absent sample, zero-based. */
  readonly from: number;
  /** How many consecutive samples are absent. */
  readonly count: number;
}

/** @see streamSetFor */
export interface StreamFixtureOptions {
  readonly sampleCount?: number;
  /** Defaults to all eight. Pass a subset for the no-position case. */
  readonly channels?: readonly StreamChannel[];
  readonly gaps?: readonly StreamGap[];
  readonly startedAt?: UnixSeconds;
}

/**
 * The base point the position channels walk away from: central London, on the
 * semicircle grid.
 */
const BASE_LATITUDE_SEMICIRCLES = degreesLatitudeToSemicircles(degreesLatitude(51.5074));
const BASE_LONGITUDE_SEMICIRCLES = degreesLongitudeToSemicircles(degreesLongitude(-0.1278));

/** ~35 m of altitude, on FIT's `uint16` grid. */
const BASE_ALTITUDE_RAW = metresToFitAltitude(altitudeMetres(35));

/**
 * One sample of one channel, at index `i`.
 *
 * Every generator is deterministic and produces a value **on the channel's
 * stored grid** — see the note at the top of this file.
 */
const GENERATORS: {
  readonly [C in StreamChannel]: (index: number) => NonNullable<Samples<C>[number]>;
} = {
  // A ride with intervals: a base and a sawtooth, both whole watts.
  power: (index) => watts(140 + ((index * 7) % 180)),
  heartRate: (index) => beatsPerMinute(96 + (index % 62)),
  cadence: (index) => revolutionsPerMinute(72 + (index % 26)),
  // Generated in mm/s, the stored unit, then divided — so it lands on the grid.
  speed: (index) => metresPerSecond((7_000 + ((index * 13) % 4_000)) / 1_000),
  // Walked in semicircles: ~0.9 m per sample north, which is a plausible pace.
  latitude: (index) =>
    semicirclesToDegreesLatitude(latitudeSemicircles(BASE_LATITUDE_SEMICIRCLES + index * 100)),
  longitude: (index) =>
    semicirclesToDegreesLongitude(longitudeSemicircles(BASE_LONGITUDE_SEMICIRCLES + index * 160)),
  // Walked in FIT's raw units: a rolling profile within +-40 m.
  altitude: (index) => fitAltitudeToMetres(BASE_ALTITUDE_RAW + ((index * 3) % 400)),
  temperature: (index) => degreesCelsius(9 + (index % 11)),
};

/**
 * A four-hour, 1 Hz, eight-channel stream set — #27's round-trip fixture.
 *
 * Not shrunk to make the test fast. #27 asks for 14,400 samples across eight
 * channels precisely because a smaller set does not exercise the thing that
 * costs: if it is slow, that *is* the retrieval-latency measurement the next
 * criterion asks for.
 */
export function streamSetFor(ride: NewActivity, options: StreamFixtureOptions = {}): NewStreamSet {
  const sampleCount = options.sampleCount ?? FOUR_HOUR_SAMPLE_COUNT;
  const wanted = options.channels ?? STREAM_CHANNELS;
  const gaps = options.gaps ?? [];

  const channels: { -readonly [C in StreamChannel]?: Samples<C> } = {};
  for (const channel of STREAM_CHANNELS) {
    if (!wanted.includes(channel)) {
      continue;
    }
    const absent = absentIndexes(gaps, channel);
    const generate = GENERATORS[channel];
    const samples = new Array<ReturnType<typeof generate> | undefined>(sampleCount);
    for (let index = 0; index < sampleCount; index += 1) {
      samples[index] = absent.has(index) ? undefined : generate(index);
    }
    // The channel name is only known at run time; the generator table is keyed
    // by the same name, so the samples are that channel's own quantity.
    (channels as Record<StreamChannel, readonly unknown[]>)[channel] = samples;
  }

  return {
    activityId: ride.id,
    athleteId: ride.athleteId,
    startedAt: options.startedAt ?? ride.startedAt,
    sampleInterval: seconds(1),
    sampleCount,
    channels,
  };
}

function absentIndexes(gaps: readonly StreamGap[], channel: StreamChannel): ReadonlySet<number> {
  const absent = new Set<number>();
  for (const gap of gaps) {
    if (gap.channel !== channel) {
      continue;
    }
    for (let index = gap.from; index < gap.from + gap.count; index += 1) {
      absent.add(index);
    }
  }
  return absent;
}

/** The thirty-second heart-rate dropout #27 names, starting at ten minutes in. */
export const DROPPED_STRAP: StreamGap = { channel: 'heartRate', from: 600, count: 30 };

/** Everything but the two position channels — the indoor trainer case. */
export const CHANNELS_WITHOUT_POSITION: readonly StreamChannel[] = STREAM_CHANNELS.filter(
  (channel) => channel !== 'latitude' && channel !== 'longitude',
);

export type { ActivityId, AthleteId, LapId };
