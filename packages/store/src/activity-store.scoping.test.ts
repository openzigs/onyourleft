// SPDX-License-Identifier: Apache-2.0

/**
 * **Every athlete-scoped read and write, proved not to cross athletes.**
 *
 * [#34](https://github.com/openzigs/onyourleft/issues/34) asks for three things
 * this file delivers and one it cannot:
 *
 * 1. *"Every activity read path is enumerated … and each has a test."*
 * 2. *"For **each** of those paths, a fixture containing two athletes' data
 *    proves athlete A's request cannot return athlete B's data."* — with #34's
 *    own revision block raising two to **three**, for the reason below.
 * 3. *"Authorization is enforced at a single choke point … and a test fails if
 *    a new activity route is added without passing through it."*
 *
 * What it cannot: #34's remaining criteria are about an HTTP response — 404
 * rather than 403, a pre-signed URL, a cache. There is no server (owner
 * decision D6) and this file does not pretend otherwise.
 *
 * ## Why this is the defect worth spending a suite on
 *
 * `CLAUDE.md` section 6 names it: *"**Cross-athlete exposure.** Any query
 * matching on an entity id **without also filtering on the owning athlete**.
 * This passes every single-athlete test in the suite."* That is the whole
 * problem in two sentences. Every other test in `packages/store` seeds one
 * athlete, writes, reads it back and passes — and would pass identically with
 * the `owner` component deleted from every index lookup in the file. The filter
 * could be entirely absent and this package would be green.
 *
 * The payload here is not a preference or a score. It is
 * `getStreamChannel(owner, activity, 'latitude')` — the raw GPS trace of where
 * a named person lives and when they leave the house — and
 * `listPrivacyZones(owner)`, which is the centre of that person's home given
 * directly, and `getDeviceKey(owner)`, which is a signing identity.
 *
 * ## Derived, not written down
 *
 * The enumeration is taken from `ActivityStore.prototype` at run time:
 * **every member whose first parameter is named `owner` is athlete-scoped by
 * construction**, and each one must have a probe here. That is #34's third
 * criterion in the shape a local-first client can have it — there is no route
 * table to derive from, but there is a store surface, and it is the thing a new
 * feature actually adds to.
 *
 * A hand-written list is the failure mode #34 calls out and this repository has
 * shipped before: it silently misses every path added after it was written.
 * Here, adding `getSomethingNew(owner, …)` turns this file red until somebody
 * says what a missing filter on it would leak.
 *
 * ⚠️ **It fails closed, three ways**, because an enumeration that quietly
 * enumerates nothing is worse than no enumeration:
 *
 * - a derivation returning **no** members is a failure, not a clean run;
 * - a member whose source cannot be parsed for its parameters is a failure
 *   rather than a member silently treated as unscoped;
 * - a **stale** probe — one naming a member that no longer exists or no longer
 *   takes `owner` — is a failure, the same rule `LIC006` applies to
 *   `.spdx-exempt`. An assertion that has stopped meaning something stops the
 *   build.
 *
 * ⚠️ The parameter name is read with `Function.prototype.toString()`, which is
 * ECMAScript rather than a platform API — this package may not name a Node
 * builtin, and `packages/store/tsconfig.json` sets `types: []`, so reading the
 * `.ts` source off disk is a compile error here and deliberately stays one.
 * Vitest transforms but does not minify, so parameter names survive; if a
 * future toolchain minifies the test program, the *fail-closed* parse check
 * above turns red rather than the suite passing vacuously.
 *
 * ## Three athletes, not two
 *
 * `seedAthletes` has seeded three since #26 and `CLAUDE.md` section 5 says why
 * the assertions that need the third were left for this issue: **with two
 * athletes, "everything except B's rows" and "everything A is entitled to" are
 * the same set.** A store that returned every row it could reach would pass a
 * two-athlete test that only checks B's row is absent, because there is nothing
 * else for it to hand over. The third athlete is what separates a filter from
 * an exclusion.
 *
 * So each probe seeds a whole world for **all three** and asserts on the two
 * that are not the caller.
 *
 * ## What each probe asserts, and what it deliberately does not
 *
 * Reads: the call as A, given B's id, returns nothing of B's — and the list
 * reads additionally assert that **every** row returned belongs to A, which is
 * the assertion that catches "returns everything" rather than "returns B".
 *
 * Deletes: `false` is not enough on its own and is not what is asserted. A
 * delete that reported `false` and removed the row anyway would pass that; the
 * probe re-reads **as the owner** afterwards and requires the row to still be
 * there. The return value is the weaker half.
 *
 * Writes: the same shape — whatever the call does or throws, the other
 * athlete's rows are unchanged afterwards, read back through their own scope.
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { ActivityStore } from './activity-store';
import type { MatchCheckpointRecord, PrivacyZoneRecord, SegmentEffortRecord } from './records';
import type { AthleteId } from './ids';
import { privacyZoneId } from './ids';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  ATHLETES,
  chunksOf,
  createStoreHarness,
  effortFor,
  extractableDeviceKey,
  FIXTURE_EPOCH,
  lapFor,
  resetFixtureIds,
  recordingFor,
  rideFor,
  routeFor,
  seedAthletes,
  segmentFor,
  signedRecordFor,
  streamSetFor,
  workoutFor,
} from './testing';
import type { PersistentStore, StoreHarness } from './testing';
import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  seconds,
  unixSeconds,
  watts,
} from '@onyourleft/domain';

/**
 * Small on purpose. #27's four-hour fixture exists to measure retrieval latency
 * and this file measures nothing of the sort — it seeds three worlds per probe
 * and the samples are only here so the position channels have something in them
 * to leak.
 */
const SAMPLE_COUNT = 120;

/** Chunks per recording. Two, so a recovery has more than one row to find. */
const CHUNK_SAMPLES = 60;

/** Everything one athlete owns, so a probe can name any of it. */
interface World {
  readonly owner: AthleteId;
  readonly ride: ReturnType<typeof rideFor>;
  readonly fileHash: string;
  readonly route: ReturnType<typeof routeFor>;
  readonly workout: ReturnType<typeof workoutFor>;
  readonly segment: ReturnType<typeof segmentFor>;
  readonly effort: SegmentEffortRecord;
  readonly recording: ReturnType<typeof recordingFor>;
  readonly zone: PrivacyZoneRecord;
  readonly checkpoint: MatchCheckpointRecord;
}

/** A distinct 64-character lowercase hex digest per athlete. */
function fileHashFor(owner: AthleteId): string {
  const seed = owner.replaceAll(/[^a-f0-9]/g, '') || 'a';
  return seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
}

/**
 * Seeds one athlete's entire footprint through the public write path.
 *
 * Everything an `owner`-taking member can read is written here, so that a probe
 * failing means the filter is missing rather than that nothing was there to
 * find. A probe over an empty table passes whatever the query does — the same
 * vacuous pass the fail-closed checks above exist to prevent, one level down.
 */
async function seedWorld(harness: StoreHarness, owner: AthleteId): Promise<World> {
  const route = routeFor(owner);
  const workout = workoutFor(owner);
  const segment = segmentFor(owner);
  const fileHash = fileHashFor(owner);
  const ride = rideFor(owner, {
    routeId: route.id,
    hasPosition: true,
    originalFile: { key: `${owner}/original.fit`, sha256: fileHash },
  });
  const streams = streamSetFor(ride, { sampleCount: SAMPLE_COUNT });
  const lap = lapFor(ride, 1);
  const effort = effortFor(owner, segment.id, ride.id);
  const recording = recordingFor(owner);
  const chunks = chunksOf(recording, streams, CHUNK_SAMPLES);
  const zone: PrivacyZoneRecord = {
    id: privacyZoneId(`zone-${owner}`),
    athleteId: owner,
    // A different centre per athlete: a probe that returned the *right* number
    // of zones with the wrong athlete's centre in them would otherwise pass.
    centre: geographicPosition(
      degreesLatitude(51.5 + ATHLETES.indexOf(owner) * 0.01),
      degreesLongitude(-0.12),
    ),
    radius: metres(500),
    label: 'home',
    createdAt: unixSeconds(FIXTURE_EPOCH),
  };
  const checkpoint: MatchCheckpointRecord = {
    athleteId: owner,
    lastStartedAt: ride.startedAt,
    lastActivityId: ride.id,
    swept: ATHLETES.indexOf(owner) + 1,
    updatedAt: unixSeconds(FIXTURE_EPOCH),
  };
  const { record: deviceKey, key } = await extractableDeviceKey(owner);
  const signed = await signedRecordFor(ride, key);

  await harness.write(async (store) => {
    await store.putRoute(route);
    await store.putWorkout(workout);
    await store.putSegment(segment);
    await store.putActivity(ride);
    await store.putStreamSet(streams);
    await store.putLap(lap);
    await store.putPrivacyZone(zone);
    await store.putActivityEfforts(owner, ride.id, [effort]);
    await store.putRecordingSession(recording);
    for (const chunk of chunks) {
      await store.appendRecordingChunk(chunk);
    }
    await store.putDeviceKey(deviceKey);
    await store.putActivityRecord(signed);
    await store.putMatchCheckpoint(checkpoint);
    await store.setActivityLoadSummary(owner, ride.id, {
      effortWeightedPower: watts(210 + ATHLETES.indexOf(owner)),
      loadCoveredTime: seconds(SAMPLE_COUNT),
    });
  });

  return { owner, ride, fileHash, route, workout, segment, effort, recording, zone, checkpoint };
}

/**
 * One member of the scoped surface, and what a missing `owner` filter on it
 * would hand to the wrong athlete.
 *
 * `leaks` is not decoration. It is the sentence a reviewer reads when this test
 * goes red, and writing it is the step that makes somebody think about what the
 * member actually returns.
 */
interface ScopingProbe {
  readonly member: string;
  readonly leaks: string;
  /** `mine` is the caller. `theirs` is a second athlete whose rows must not appear. */
  run(store: PersistentStore, mine: World, theirs: World): Promise<void>;
}

/** Asserts every row in a list read belongs to the caller, and names the strays. */
function everyRowBelongsTo<
  T extends { readonly athleteId?: AthleteId; readonly createdBy?: AthleteId },
>(rows: readonly T[], owner: AthleteId): void {
  const owners = rows.map((row) => row.athleteId ?? row.createdBy);
  expect(owners.filter((each) => each !== owner)).toStrictEqual([]);
  // And it must not be empty, or "belongs to the caller" is vacuously true —
  // the caller seeded exactly one of each in `seedWorld`.
  expect(rows.length).toBeGreaterThan(0);
}

const PROBES: readonly ScopingProbe[] = [
  {
    member: 'getActivity',
    leaks: "another athlete's ride: its name, route, distance and start time",
    async run(store, mine, theirs) {
      await expect(store.getActivity(mine.owner, theirs.ride.id)).resolves.toBeUndefined();
      await expect(store.getActivity(mine.owner, mine.ride.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'listActivitySummaries',
    leaks: 'every ride on the device, whoever rode it',
    async run(store, mine, theirs) {
      const rows = await store.listActivitySummaries(mine.owner);
      everyRowBelongsTo(rows, mine.owner);
      expect(rows.map((row) => row.id)).not.toContain(theirs.ride.id);
    },
  },
  {
    member: 'findActivityByOriginalFileHash',
    leaks: "another athlete's ride, found by a hash an importer already has",
    async run(store, mine, theirs) {
      await expect(
        store.findActivityByOriginalFileHash(mine.owner, theirs.fileHash),
      ).resolves.toBeUndefined();
      await expect(
        store.findActivityByOriginalFileHash(mine.owner, mine.fileHash),
      ).resolves.toBeDefined();
    },
  },
  {
    member: 'listRouteAttempts',
    leaks: "another athlete's laps of a shared route — #93's ghost, raced against a stranger",
    async run(store, mine, theirs) {
      await expect(store.listRouteAttempts(mine.owner, theirs.route.id)).resolves.toStrictEqual([]);
      const mineRows = await store.listRouteAttempts(mine.owner, mine.route.id);
      everyRowBelongsTo(mineRows, mine.owner);
    },
  },
  {
    member: 'deleteActivity',
    leaks: "another athlete's ride, destroyed rather than disclosed",
    async run(store, mine, theirs) {
      await expect(store.deleteActivity(mine.owner, theirs.ride.id)).resolves.toBe(false);
      // The return value is the weak half. This is the half that matters.
      await expect(store.getActivity(theirs.owner, theirs.ride.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'listLaps',
    leaks: "the splits of another athlete's ride",
    async run(store, mine, theirs) {
      await expect(store.listLaps(mine.owner, theirs.ride.id)).resolves.toStrictEqual([]);
      expect((await store.listLaps(mine.owner, mine.ride.id)).length).toBeGreaterThan(0);
    },
  },
  {
    member: 'listPrivacyZones',
    leaks: "the centre of another athlete's home, given directly rather than inferred",
    async run(store, mine, theirs) {
      const rows = await store.listPrivacyZones(mine.owner);
      everyRowBelongsTo(rows, mine.owner);
      expect(rows.map((row) => row.id)).not.toContain(theirs.zone.id);
      // Asserted on the centre too: a list of the right length carrying the
      // wrong athlete's coordinates is the failure this row exists for.
      expect(rows.map((row) => row.centre.latitude)).not.toContain(theirs.zone.centre.latitude);
    },
  },
  {
    member: 'getSegment',
    leaks: "another athlete's private segment and its geometry",
    async run(store, mine, theirs) {
      await expect(store.getSegment(mine.owner, theirs.segment.id)).resolves.toBeUndefined();
      await expect(store.getSegment(mine.owner, mine.segment.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'listSegments',
    leaks: 'every segment on the device, including other athletes’ private ones',
    async run(store, mine, theirs) {
      const rows = await store.listSegments(mine.owner);
      everyRowBelongsTo(rows, mine.owner);
      expect(rows.map((row) => row.id)).not.toContain(theirs.segment.id);
    },
  },
  {
    member: 'deleteSegment',
    leaks: "another athlete's segment, destroyed",
    async run(store, mine, theirs) {
      await expect(store.deleteSegment(mine.owner, theirs.segment.id)).resolves.toBe(false);
      await expect(store.getSegment(theirs.owner, theirs.segment.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'getRoute',
    leaks: "another athlete's saved route, whose first point is usually their front door",
    async run(store, mine, theirs) {
      await expect(store.getRoute(mine.owner, theirs.route.id)).resolves.toBeUndefined();
      await expect(store.getRoute(mine.owner, mine.route.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'listRoutes',
    leaks: 'every route on the device, whoever planned it',
    async run(store, mine, theirs) {
      const rows = await store.listRoutes(mine.owner);
      everyRowBelongsTo(rows, mine.owner);
      expect(rows.map((row) => row.id)).not.toContain(theirs.route.id);
    },
  },
  {
    member: 'deleteRoute',
    leaks: "another athlete's route, destroyed",
    async run(store, mine, theirs) {
      await expect(store.deleteRoute(mine.owner, theirs.route.id)).resolves.toBe(false);
      await expect(store.getRoute(theirs.owner, theirs.route.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'getWorkout',
    leaks: "another athlete's workout, and through its targets their threshold",
    async run(store, mine, theirs) {
      await expect(store.getWorkout(mine.owner, theirs.workout.id)).resolves.toBeUndefined();
      await expect(store.getWorkout(mine.owner, mine.workout.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'listWorkouts',
    leaks: 'every workout on the device',
    async run(store, mine, theirs) {
      const rows = await store.listWorkouts(mine.owner);
      everyRowBelongsTo(rows, mine.owner);
      expect(rows.map((row) => row.id)).not.toContain(theirs.workout.id);
    },
  },
  {
    member: 'deleteWorkout',
    leaks: "another athlete's workout, destroyed",
    async run(store, mine, theirs) {
      await expect(store.deleteWorkout(mine.owner, theirs.workout.id)).resolves.toBe(false);
      await expect(store.getWorkout(theirs.owner, theirs.workout.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'listEfforts',
    leaks: "another athlete's efforts on a segment — a leaderboard nobody consented to",
    async run(store, mine, theirs) {
      await expect(store.listEfforts(mine.owner, theirs.segment.id)).resolves.toStrictEqual([]);
      everyRowBelongsTo(await store.listEfforts(mine.owner, mine.segment.id), mine.owner);
    },
  },
  {
    member: 'listSharedEfforts',
    leaks: "another athlete's public efforts, which are theirs to publish and not ours",
    async run(store, mine, theirs) {
      await expect(store.listSharedEfforts(mine.owner, theirs.segment.id)).resolves.toStrictEqual(
        [],
      );
      everyRowBelongsTo(await store.listSharedEfforts(mine.owner, mine.segment.id), mine.owner);
    },
  },
  {
    member: 'listActivityEfforts',
    leaks: "the efforts inside another athlete's ride",
    async run(store, mine, theirs) {
      await expect(store.listActivityEfforts(mine.owner, theirs.ride.id)).resolves.toStrictEqual(
        [],
      );
      everyRowBelongsTo(await store.listActivityEfforts(mine.owner, mine.ride.id), mine.owner);
    },
  },
  {
    member: 'putActivityEfforts',
    leaks: "efforts written against another athlete's ride, attributed to them",
    async run(store, mine, theirs) {
      const before = await store.listActivityEfforts(theirs.owner, theirs.ride.id);
      const forged = effortFor(mine.owner, mine.segment.id, theirs.ride.id, {
        startedAt: unixSeconds(FIXTURE_EPOCH + 42),
      });
      // Whether it rejects or resolves is the store's business; that the other
      // athlete's ride is unchanged afterwards is not.
      await store.putActivityEfforts(mine.owner, theirs.ride.id, [forged]).catch(() => 0);
      const after = await store.listActivityEfforts(theirs.owner, theirs.ride.id);
      expect(after).toStrictEqual(before);
    },
  },
  {
    member: 'getMatchCheckpoint',
    leaks: "how far another athlete's library has been swept, and which ride it stopped on",
    async run(store, mine, theirs) {
      const checkpoint = await store.getMatchCheckpoint(mine.owner);
      expect(checkpoint?.athleteId).toBe(mine.owner);
      expect(checkpoint?.lastActivityId).not.toBe(theirs.ride.id);
    },
  },
  {
    member: 'clearMatchCheckpoint',
    leaks: "another athlete's sweep cursor, reset under them",
    async run(store, mine, theirs) {
      await store.clearMatchCheckpoint(mine.owner);
      await expect(store.getMatchCheckpoint(theirs.owner)).resolves.toBeDefined();
    },
  },
  {
    member: 'getStreamSet',
    leaks: "every per-second sample of another athlete's ride, latitude and longitude included",
    async run(store, mine, theirs) {
      await expect(store.getStreamSet(mine.owner, theirs.ride.id)).resolves.toBeUndefined();
      await expect(store.getStreamSet(mine.owner, mine.ride.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'getStreamSetSummary',
    leaks: "which channels another athlete's ride carries, and how long it was",
    async run(store, mine, theirs) {
      await expect(store.getStreamSetSummary(mine.owner, theirs.ride.id)).resolves.toBeUndefined();
      await expect(store.getStreamSetSummary(mine.owner, mine.ride.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'getStreamChannel',
    leaks: "another athlete's raw GPS trace, one channel at a time — the worst row in this table",
    async run(store, mine, theirs) {
      await expect(
        store.getStreamChannel(mine.owner, theirs.ride.id, 'latitude'),
      ).resolves.toBeUndefined();
      await expect(
        store.getStreamChannel(mine.owner, theirs.ride.id, 'longitude'),
      ).resolves.toBeUndefined();
      await expect(
        store.getStreamChannel(mine.owner, mine.ride.id, 'latitude'),
      ).resolves.toBeDefined();
    },
  },
  {
    member: 'deleteStreamSet',
    leaks: "another athlete's samples, destroyed",
    async run(store, mine, theirs) {
      await expect(store.deleteStreamSet(mine.owner, theirs.ride.id)).resolves.toBe(false);
      await expect(store.getStreamSet(theirs.owner, theirs.ride.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'getRecordingSession',
    leaks: "another athlete's ride in progress",
    async run(store, mine, theirs) {
      await expect(
        store.getRecordingSession(mine.owner, theirs.recording.id),
      ).resolves.toBeUndefined();
      await expect(store.getRecordingSession(mine.owner, mine.recording.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'listRecordingSessions',
    leaks: 'every unfinished recording on the device — what #212 offers back to be resumed',
    async run(store, mine, theirs) {
      const rows = await store.listRecordingSessions(mine.owner);
      everyRowBelongsTo(rows, mine.owner);
      expect(rows.map((row) => row.id)).not.toContain(theirs.recording.id);
    },
  },
  {
    member: 'recoverRecording',
    leaks: "the samples inside another athlete's interrupted ride",
    async run(store, mine, theirs) {
      await expect(
        store.recoverRecording(mine.owner, theirs.recording.id),
      ).resolves.toBeUndefined();
      await expect(store.recoverRecording(mine.owner, mine.recording.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'getRecordingFootprint',
    leaks: "how long another athlete's interrupted ride is — what #212's offer quotes",
    async run(store, mine, theirs) {
      await expect(
        store.getRecordingFootprint(mine.owner, theirs.recording.id),
      ).resolves.toBeUndefined();
      await expect(
        store.getRecordingFootprint(mine.owner, mine.recording.id),
      ).resolves.toBeDefined();
    },
  },
  {
    member: 'deleteRecordingSession',
    leaks: "another athlete's ride in progress, destroyed mid-ride",
    async run(store, mine, theirs) {
      await expect(store.deleteRecordingSession(mine.owner, theirs.recording.id)).resolves.toBe(
        false,
      );
      await expect(
        store.getRecordingSession(theirs.owner, theirs.recording.id),
      ).resolves.toBeDefined();
    },
  },
  {
    member: 'getDeviceKey',
    leaks: "another athlete's signing identity — the handle their rides are signed with",
    async run(store, mine, theirs) {
      const key = await store.getDeviceKey(mine.owner);
      expect(key?.athleteId).toBe(mine.owner);
      const theirKey = await store.getDeviceKey(theirs.owner);
      expect(key?.publicKey).not.toBe(theirKey?.publicKey);
    },
  },
  {
    member: 'getActivityRecord',
    leaks: "another athlete's signed record, which carries their claims and their public key",
    async run(store, mine, theirs) {
      await expect(store.getActivityRecord(mine.owner, theirs.ride.id)).resolves.toBeUndefined();
      await expect(store.getActivityRecord(mine.owner, mine.ride.id)).resolves.toBeDefined();
    },
  },
  {
    member: 'setActivityLoadSummary',
    leaks: "another athlete's ride, overwritten with a stranger's numbers",
    async run(store, mine, theirs) {
      const before = await store.getActivity(theirs.owner, theirs.ride.id);
      await store
        .setActivityLoadSummary(mine.owner, theirs.ride.id, {
          effortWeightedPower: watts(999),
          loadCoveredTime: seconds(1),
        })
        .catch(() => undefined);
      const after = await store.getActivity(theirs.owner, theirs.ride.id);
      expect(after).toStrictEqual(before);
    },
  },
];

/**
 * Every member of `ActivityStore` whose first parameter is named `owner`.
 *
 * @throws if a member's source cannot be parsed — see the fail-closed note in
 * this file's header.
 */
function ownerScopedMembers(): readonly string[] {
  const prototype = ActivityStore.prototype as unknown as Record<string, unknown>;
  const scoped: string[] = [];
  for (const key of Object.getOwnPropertyNames(prototype)) {
    if (key === 'constructor') {
      continue;
    }
    const value = Object.getOwnPropertyDescriptor(prototype, key)?.value as unknown;
    if (typeof value !== 'function') {
      continue;
    }
    const source = String(value);
    const parameters = /^(?:async\s+)?[\w$#]+\s*\(([^)]*)\)/.exec(source)?.[1];
    if (parameters === undefined) {
      throw new Error(
        `cannot read the parameters of ActivityStore.${key} — the scoping enumeration ` +
          `cannot be trusted, so it fails rather than treating the member as unscoped`,
      );
    }
    const first =
      parameters
        .split(',')[0]
        ?.trim()
        .split(/[=\s:]/)[0] ?? '';
    if (first === 'owner') {
      scoped.push(key);
    }
  }
  return scoped;
}

describe('the athlete-scoped surface is enumerated from the store, not written down', () => {
  it('finds members at all', () => {
    // The vacuous pass this whole file is built to avoid: a derivation that
    // silently returns nothing would make every assertion below pass.
    expect(ownerScopedMembers().length).toBeGreaterThan(20);
  });

  it('has a probe for every scoped member', () => {
    const probed = new Set(PROBES.map((probe) => probe.member));
    const unprobed = ownerScopedMembers().filter((member) => !probed.has(member));
    expect(
      unprobed,
      'a new athlete-scoped member needs a scoping probe in this file',
    ).toStrictEqual([]);
  });

  it('has no stale probe', () => {
    // The `.spdx-exempt` rule, applied here: an assertion that has stopped
    // meaning something stops the build rather than sitting there unread.
    const scoped = new Set(ownerScopedMembers());
    const stale = PROBES.map((probe) => probe.member).filter((member) => !scoped.has(member));
    expect(stale, 'this probe names a member that no longer takes `owner`').toStrictEqual([]);
  });

  it('names exactly one probe per member', () => {
    const seen = new Set<string>();
    const duplicated = PROBES.map((probe) => probe.member).filter((member) => {
      if (seen.has(member)) {
        return true;
      }
      seen.add(member);
      return false;
    });
    expect(duplicated).toStrictEqual([]);
  });

  it('says what each one would leak', () => {
    expect(PROBES.filter((probe) => probe.leaks.trim().length < 20)).toStrictEqual([]);
  });
});

describe('no athlete-scoped call crosses athletes', () => {
  let harness: StoreHarness;
  let worlds: Map<AthleteId, World>;

  beforeEach(async () => {
    resetFixtureIds();
    harness = createStoreHarness();
    await seedAthletes(harness);
    worlds = new Map();
    for (const athlete of ATHLETES) {
      worlds.set(athlete, await seedWorld(harness, athlete));
    }
  });

  afterEach(async () => {
    await harness.destroy();
  });

  // Read through a connection the writes never touched — CLAUDE.md section 5's
  // "wrong harness" cause. A probe served by the writing handle would be
  // asserting against the objects it just constructed.
  it.each(PROBES.map((probe) => [probe.member, probe] as const))(
    '%s does not leak',
    async (_member, probe) => {
      const a = worlds.get(ATHLETE_A);
      const b = worlds.get(ATHLETE_B);
      const c = worlds.get(ATHLETE_C);
      expect(a && b && c).toBeTruthy();
      if (a === undefined || b === undefined || c === undefined) {
        return;
      }
      // Both of the other two, not just one: with a single other athlete,
      // "excluded B" and "returned everything I am entitled to" are the same
      // answer, which is the reason `seedAthletes` seeds three.
      await harness.read(async (store) => probe.run(store, a, b));
      await harness.read(async (store) => probe.run(store, a, c));
    },
  );
});
