// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #282's first two acceptance criteria, against the **real** local store.
 *
 * - *"A ride that covers a saved segment produces an effort a rider can see,
 *   through the same read path `SegmentDetailView` uses."*
 * - *"A newly created segment finds its efforts in the existing library."*
 *
 * Both end in `efforts/load.ts`'s {@link loadHistory} — the screen's own read —
 * through a connection the write never touched. `@onyourleft/store/testing`'s
 * `read` discards every open handle before it opens another, so the claim here
 * is that a **fresh IndexedDB connection can see the effort**, not that the
 * objects the sweep just built have the fields they were given. That is
 * CLAUDE.md §5's four causes of a write that reports success while the read
 * cannot see it — wrong storage, wrong layer, wrong time, wrong harness —
 * and until this file every one of them was untested on this path, because
 * nothing in the client had ever written a segment effort at all.
 *
 * ⚠️ **The stubs cannot stand in for this.** `match-testing.ts` keeps efforts
 * in a `Map` keyed by the effort's own id; the store keys them through
 * `[athleteId+segmentId+elapsed]` and `[athleteId+activityId]`, filters
 * `excluded` on the way out, and cascades on delete. A sweep that wrote a row
 * Dexie's compound index could not see would pass every test in
 * `sweep.test.ts`.
 */

import {
  createSegment,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  seconds,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  segmentId,
  type NewActivity,
  type NewStreamSet,
  type SegmentRecord,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  rideFor,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { loadHistory } from '../efforts/load';
import { createSegmentFromRide } from './create';
import { matchLibrary } from './sweep';

const METRES_PER_DEGREE_LATITUDE = 111_194.9;

/**
 * ⚠️ **Deliberately ON a cell corner, and this note used to say the opposite.**
 * A reviewer who remembers "deliberately not on a cell boundary" is reading the
 * old file.
 *
 * The matcher's stage-1 prefilter (`packages/domain/src/segment/cells.ts`) is a
 * 0.01° grid, so **51.5 and -0.12 are exactly a cell corner** — and they are
 * also `@onyourleft/store/testing`'s `segmentFor` defaults. A stream set
 * round-trips through the semicircle grid and comes back about 1.4 mm to the
 * west of what was written, which put a noiseless straight track in the *next*
 * column while the segment written from literal coordinates stayed in this one.
 * The covers shared no cell, `matchRide` reported `afterPrefilter: 0` for a
 * ride that traversed the segment exactly, and #282 moved this fixture off the
 * corner to get round it.
 *
 * **[#291](https://github.com/openzigs/onyourleft/issues/291) fixed the
 * prefilter instead**: a corpus cover now reaches `PREFILTER_MARGIN_METRES`
 * outside its own footprint, so a millimetre either side of a grid line meets.
 * The fixture is back on the corner **because that is the harder case**, and
 * this file is now the store-backed half of #291's regression: reverting
 * `indexCorpus` to the unpadded cover turns two of the tests below red, through
 * a real IndexedDB round trip rather than in the matcher's own unit suite.
 */
const ORIGIN_LATITUDE = 51.5;
const ORIGIN_LONGITUDE = -0.12;

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

function northOf(metresNorth: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(ORIGIN_LATITUDE + metresNorth / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(ORIGIN_LONGITUDE),
  );
}

/**
 * A 500 m northbound segment from the origin, in 26 positions.
 *
 * The same shape `backfill.test.ts` matches against. Built here rather than
 * with `segmentFor` because this file needs a 500 m segment with a lead-in the
 * ride can share, and that helper builds a kilometre of its own — not, since
 * #291, because of where it sits on the grid. See {@link ORIGIN_LONGITUDE}.
 */
function theSegment(id = 'the-long-drag'): SegmentRecord {
  const built = createSegment({
    id,
    createdBy: ATHLETE_A,
    name: 'The long drag',
    sport: 'ride',
    geometry: Array.from({ length: 26 }, (_unused, index) => northOf(index * 20)),
    elevationSource: 'none',
    visibility: 'private',
    createdAt: unixSeconds(1_760_000_000),
  });
  return { ...built, id: segmentId(built.id), createdBy: athleteId(built.createdBy) };
}

/**
 * A ride over that segment, with the run-in the matcher needs.
 *
 * `sampleHeading` needs a previous position, so a ride whose first sample is
 * the segment's first point has no direction there and the endpoint gate
 * correctly refuses it — the same lead-in `backfill.test.ts` explains.
 */
function traversingTrack(): GeographicPosition[] {
  const leadIn = [4, 3, 2, 1].map((back) => northOf(-back * 20));
  const path = Array.from({ length: 26 }, (_unused, index) => northOf(index * 20));
  return [...leadIn, ...path];
}

function streamsFor(ride: NewActivity, track: readonly GeographicPosition[]): NewStreamSet {
  return {
    activityId: ride.id,
    athleteId: ride.athleteId,
    startedAt: ride.startedAt,
    sampleInterval: seconds(1),
    sampleCount: track.length,
    channels: {
      latitude: track.map((point) => point.latitude),
      longitude: track.map((point) => point.longitude),
    },
  };
}

async function openSeeded(): Promise<StoreHarness> {
  const opened = createStoreHarness();
  await seedAthletes(opened);
  harness = opened;
  return opened;
}

/** One ride over the segment, written through the public path. */
async function seedTraversingRide(
  open: StoreHarness,
  owner = ATHLETE_A,
  overrides: Partial<NewActivity> = {},
): Promise<NewActivity> {
  const ride = rideFor(owner, { hasPosition: true, ...overrides });
  const streams = streamsFor(ride, traversingTrack());
  await open.write(async (store) => {
    await store.putActivity(ride);
    await store.putStreamSet(streams);
  });
  return ride;
}

/** The sweep, run against a real connection exactly as `main.tsx` wires it. */
async function sweep(open: StoreHarness, owner = ATHLETE_A): ReturnType<typeof matchLibrary> {
  return open.write(async (store) => matchLibrary({ athleteId: owner, store }));
}

/** What the effort screen sees, on a connection the sweep never touched. */
async function historyOf(open: StoreHarness, segment: SegmentRecord, owner = ATHLETE_A) {
  return open.read(async (store) => loadHistory({ athleteId: owner, store }, segment.id));
}

describe('criterion 1 — a ride over a segment produces an effort a rider can see', () => {
  it('shows it through the same read path SegmentDetailView uses', async () => {
    const open = await openSeeded();
    const segment = theSegment();
    await open.write(async (store) => store.putSegment(segment));
    const ride = await seedTraversingRide(open);

    const result = await sweep(open);

    expect(result).toMatchObject({ kind: 'swept', efforts: 1, segments: 1, done: true });

    const history = await historyOf(open, segment);
    expect(history?.rows).toHaveLength(1);
    // The ride the rider is shown beside the time, which is what makes the row
    // mean anything — and the row a deleted ride would leave as `undefined`.
    expect(history?.rows[0]?.activity?.id).toBe(ride.id);
    expect(history?.rows[0]?.effort.elapsed).toBeGreaterThan(0);
    // Nothing here is inside a privacy zone, so the effort is shareable. A
    // sweep that mislabelled this would publish an address.
    expect(history?.rows[0]?.effort.visibility).toBe('public');
  });

  it('files the effort under the athlete whose ride it was, and nobody else', async () => {
    // The cross-athlete shape CLAUDE.md §6 names, on a WRITE. `loadHistory` is
    // athlete-scoped by signature, so the only way B sees A's effort is if the
    // row carries B's id — which `putActivityEfforts` refuses outright.
    const open = await openSeeded();
    const segment = theSegment();
    await open.write(async (store) => store.putSegment(segment));
    await seedTraversingRide(open);

    await sweep(open);

    const asB = await open.read(async (store) =>
      loadHistory({ athleteId: ATHLETE_B, store }, segment.id),
    );
    expect(asB).toBeUndefined();
  });

  it('leaves an indoor ride with no effort and no crash', async () => {
    const open = await openSeeded();
    const segment = theSegment();
    await open.write(async (store) => store.putSegment(segment));
    const indoors = rideFor(ATHLETE_A, { hasPosition: false });
    await open.write(async (store) => store.putActivity(indoors));

    const result = await sweep(open);

    expect(result).toMatchObject({ kind: 'swept', swept: 1, efforts: 0, done: true });
    expect((await historyOf(open, segment))?.rows).toHaveLength(0);
  });
});

describe('criterion 2 — a newly created segment finds its efforts in the existing library', () => {
  it('backfills a segment cut from a ride that was already stored', async () => {
    const open = await openSeeded();
    const ride = await seedTraversingRide(open);

    // The rider makes the segment out of the stretch they just rode, through
    // the screen's own path — so the geometry under test is what #64 writes
    // rather than a fixture chosen to match.
    const created = await open.write(async (store) =>
      createSegmentFromRide(
        { athleteId: ATHLETE_A, store },
        {
          id: 'segment-from-a-ride',
          activityId: activityId(ride.id),
          name: 'The long drag',
          from: 4,
          to: 30,
          requestedVisibility: 'private',
          createdAt: ride.startedAt,
        },
      ),
    );
    expect(created.kind).toBe('created');

    const result = await sweep(open);

    expect(result).toMatchObject({ kind: 'swept', efforts: 1, done: true });
    const history = await open.read(async (store) =>
      loadHistory({ athleteId: ATHLETE_A, store }, segmentId('segment-from-a-ride')),
    );
    expect(history?.rows).toHaveLength(1);
    expect(history?.rows[0]?.effort.activityId).toBe(ride.id);
  });

  it('a second segment made after a completed sweep still finds the old rides', async () => {
    // The case the cleared cursor exists for. The first sweep ran to the end of
    // the library; if it left its checkpoint behind, this second one would
    // resume past every ride and find nothing.
    const open = await openSeeded();
    await seedTraversingRide(open);
    const first = theSegment();
    await open.write(async (store) => store.putSegment(first));
    await sweep(open);

    const second = theSegment('a-later-segment');
    await open.write(async (store) => store.putSegment(second));
    const result = await sweep(open);

    expect(result).toMatchObject({ kind: 'swept', segments: 2, done: true });
    expect((await historyOf(open, second))?.rows).toHaveLength(1);
    // And the first segment's effort is still there: the re-sweep replaced the
    // activity's efforts rather than appending to them or dropping them.
    expect((await historyOf(open, first))?.rows).toHaveLength(1);
  });
});

describe('#293 — two rides that started in the same second', () => {
  it('sweeps both when the page boundary falls between them', async () => {
    // ⚠️ **The whole defect in one case.** `sweepLibrary` resumed from the
    // instant alone and `listActivitySummaries` made that bound strictly
    // exclusive, so the second of two rides at one instant was never returned
    // — not on this press and not on any later one, because the ordering is
    // deterministic and every retry reproduces it. The rider was told "Matched
    // 1 ride … and found 1 effort", which is a true sentence about a sweep that
    // silently skipped a ride.
    //
    // Two rides sharing an instant is not exotic: importing one file twice
    // through #51's batch importer produces exactly that, and so does any two
    // indoor sessions started from a clock with second resolution.
    //
    // Asserted through `loadHistory` on a connection the sweep never touched,
    // so this is the store's own answer rather than a stub's.
    const open = await openSeeded();
    const segment = theSegment();
    await open.write(async (store) => store.putSegment(segment));
    const at = unixSeconds(1_760_100_000);
    const first = await seedTraversingRide(open, ATHLETE_A, {
      id: activityId('ride-a'),
      startedAt: at,
    });
    const second = await seedTraversingRide(open, ATHLETE_A, {
      id: activityId('ride-b'),
      startedAt: at,
    });

    // Pages of one, so the boundary is guaranteed to fall between them.
    const result = await open.write(async (store) =>
      matchLibrary({ athleteId: ATHLETE_A, store }, { pageSize: 1 }),
    );

    expect(result).toMatchObject({ kind: 'swept', swept: 2, efforts: 2, done: true });
    const history = await historyOf(open, segment);
    expect(history?.rows.map((row) => row.effort.activityId).sort()).toEqual(
      [first.id, second.id].sort(),
    );
  });

  it('does not re-sweep the ride it stopped on', async () => {
    // The other half of the same cursor, and what an inclusive bound with no
    // tie-break would break: the page the sweep stopped on must not come back
    // as the next page, or a library whose last page is one ride never ends.
    // A budget of one stops the sweep with a cursor written; pressing again
    // must cover the OTHER ride, not the same one twice.
    const open = await openSeeded();
    await open.write(async (store) => store.putSegment(theSegment()));
    const at = unixSeconds(1_760_100_000);
    await seedTraversingRide(open, ATHLETE_A, { id: activityId('ride-a'), startedAt: at });
    await seedTraversingRide(open, ATHLETE_A, { id: activityId('ride-b'), startedAt: at });

    const press = { pageSize: 1, budget: 1 };
    const one = await open.write(async (store) =>
      matchLibrary({ athleteId: ATHLETE_A, store }, press),
    );
    expect(one).toMatchObject({ kind: 'swept', swept: 1, done: false });

    const two = await open.write(async (store) =>
      matchLibrary({ athleteId: ATHLETE_A, store }, press),
    );

    expect(two).toMatchObject({ kind: 'swept', swept: 1, done: false });
    const cursor = await open.read(async (store) => store.getMatchCheckpoint(ATHLETE_A));
    expect(cursor?.swept).toBe(2);
    expect(cursor?.lastActivityId).toBe('ride-b');
  });
});

describe('the checkpoint, on a real connection', () => {
  it('a budget that stops the sweep short leaves a cursor a fresh connection can read', async () => {
    const open = await openSeeded();
    await open.write(async (store) => store.putSegment(theSegment()));
    await seedTraversingRide(open);
    await seedTraversingRide(open);

    const result = await open.write(async (store) =>
      matchLibrary({ athleteId: ATHLETE_A, store }, { pageSize: 1, budget: 1 }),
    );

    expect(result).toMatchObject({ kind: 'swept', swept: 1, done: false });
    const cursor = await open.read(async (store) => store.getMatchCheckpoint(ATHLETE_A));
    expect(cursor?.swept).toBe(1);
  });

  it('is gone once the sweep reaches the end, on a fresh connection too', async () => {
    const open = await openSeeded();
    await open.write(async (store) => store.putSegment(theSegment()));
    await seedTraversingRide(open);
    await seedTraversingRide(open);

    // Pages of one, so a cursor is genuinely written and then genuinely
    // deleted. A library that fits in one page writes none, and this assertion
    // would then hold over a sweep that never cleared anything.
    await open.write(async (store) =>
      matchLibrary({ athleteId: ATHLETE_A, store }, { pageSize: 1 }),
    );

    expect(await open.read(async (store) => store.getMatchCheckpoint(ATHLETE_A))).toBeUndefined();
  });
});
