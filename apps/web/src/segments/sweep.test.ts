// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sweep's production driver (#282) — what one press does, what it refuses
 * to do, and what it leaves behind for the next one.
 *
 * `backfill.test.ts` already proves the page loop matches, resumes and is
 * idempotent. What is new here is the part that had no caller at all: the
 * **checkpoint**, which nothing in this repository had ever read or written
 * outside a stub's own memory, and the two refusals that stop a sweep doing
 * damage a bounded read could not do.
 */

import {
  createSegment,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  unixSeconds,
  type GeographicPosition,
} from '@onyourleft/domain';
import { activityId, athleteId, segmentId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { stubMatchPort, type StubMatchRide } from './match-testing';
import { abandonedSentence, matchLibrary, sweepSentence } from './sweep';

import type { ActivityRecord, AthleteId, SegmentRecord } from '@onyourleft/store';

const OWNER: AthleteId = athleteId('athlete-a');
const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

function northOf(from: GeographicPosition, metresNorth: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(from.latitude + metresNorth / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(from.longitude),
  );
}

/** A 500 m northbound path of `points` samples. */
function northboundPath(points: number, from: GeographicPosition = ORIGIN): GeographicPosition[] {
  return Array.from({ length: points }, (_unused, index) =>
    northOf(from, (500 * index) / (points - 1)),
  );
}

function theSegment(id = 'segment-1'): SegmentRecord {
  const built = createSegment({
    id,
    createdBy: OWNER,
    name: 'The long drag',
    sport: 'ride',
    geometry: northboundPath(26),
    elevationSource: 'none',
    visibility: 'private',
    createdAt: unixSeconds(1_760_000_000),
  });
  return { ...built, id: segmentId(built.id), createdBy: OWNER };
}

function rideRecord(index: number, startedAt: number): ActivityRecord {
  return {
    id: activityId(`ride-${String(index)}`),
    athleteId: OWNER,
    name: `Ride ${String(index)}`,
    startedAt: unixSeconds(startedAt),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: 3600,
    movingTime: 3400,
    distance: 30_000,
    hasPosition: true,
    visibility: 'private',
  } as unknown as ActivityRecord;
}

/** A ride that traverses the segment, with the run-in `sampleHeading` needs. */
function traversingRide(index: number): StubMatchRide {
  const leadIn = [4, 3, 2, 1].map((back) => northOf(ORIGIN, -back * 20));
  return {
    activity: rideRecord(index, 1_760_000_000 + index * 86_400),
    track: [...leadIn, ...northboundPath(26)],
  };
}

function libraryOf(count: number): StubMatchRide[] {
  return Array.from({ length: count }, (_unused, index) => traversingRide(index));
}

function portWith(rides: readonly StubMatchRide[], segments: readonly SegmentRecord[]) {
  return stubMatchPort({ athleteId: OWNER, rides, segments });
}

describe('one press of the control', () => {
  it('writes an effort for every ride that covered a segment, and says how many', async () => {
    const port = portWith(libraryOf(3), [theSegment()]);

    const result = await matchLibrary(port);

    expect(result.kind).toBe('swept');
    expect(result).toMatchObject({ swept: 3, efforts: 3, segments: 1, done: true });
    expect(port.stored.size).toBe(3);
  });

  it('indexes the corpus once, not once per page', async () => {
    const port = portWith(libraryOf(4), [theSegment()]);

    await matchLibrary(port, { pageSize: 2 });

    expect(port.reads.filter((read) => read.startsWith('segments:'))).toHaveLength(1);
  });

  it('carries a recording gap out as a reason rather than a shorter list', async () => {
    // A run of ABSENT samples across the middle of the traversal, which is how
    // a receiver losing its fix reaches the store: the derived times advance
    // while no position is produced, and that jump is what the matcher sees.
    // #66's fourth criterion — the athlete is told, across pages as well as
    // within one, which is what the driver adds to `sweepLibrary`.
    const leadIn = [4, 3, 2, 1].map((back) => northOf(ORIGIN, -back * 20));
    const path = northboundPath(26);
    const holed = [
      ...path.slice(0, 12),
      ...Array.from<undefined>({ length: 40 }).fill(undefined),
      ...path.slice(12),
    ];
    const port = portWith(
      [{ activity: rideRecord(0, 1_760_000_000), track: [...leadIn, ...holed] }],
      [theSegment()],
    );

    const result = await matchLibrary(port, { pageSize: 1 });

    expect(result.kind === 'swept' ? result.efforts : -1).toBe(0);
    expect(result.kind === 'swept' ? result.abandoned : []).toEqual([
      { activityId: activityId('ride-0'), segmentId: 'segment-1', reason: 'recording-gap' },
    ]);
  });
});

describe('the two refusals — a sweep that would do damage does nothing instead', () => {
  it('does not sweep at all when there is no segment to match against', async () => {
    const port = portWith(libraryOf(2), []);

    const result = await matchLibrary(port);

    expect(result).toEqual({ kind: 'no-segments' });
    // Not merely "no efforts": no activity was read either. An empty corpus
    // reaching `sweepLibrary` would still write an empty effort set per ride.
    expect(port.reads.some((read) => read.startsWith('list:'))).toBe(false);
    expect(port.writes).toHaveLength(0);
  });

  it('refuses a corpus larger than it can hold, rather than matching part of it', async () => {
    // ⚠️ The whole point. `putActivityEfforts` REPLACES an activity's efforts,
    // so a sweep against a truncated corpus deletes every effort on the
    // segments it did not carry. A read budget may drop rows; this one may not.
    const port = portWith(libraryOf(2), [theSegment('segment-1'), theSegment('segment-2')]);

    const result = await matchLibrary(port, { corpusLimit: 1 });

    expect(result).toEqual({ kind: 'too-many-segments', limit: 1, found: 2 });
    expect(port.writes).toHaveLength(0);
  });
});

describe('the checkpoint — the part nothing had ever written', () => {
  it('stops at the budget and leaves a cursor the next press resumes from', async () => {
    const port = portWith(libraryOf(3), [theSegment()]);

    const first = await matchLibrary(port, { pageSize: 2, budget: 2 });

    expect(first).toMatchObject({ kind: 'swept', swept: 2, done: false });
    const cursor = await port.store.getMatchCheckpoint(OWNER);
    expect(cursor?.lastActivityId).toBe(activityId('ride-1'));

    // A fresh call, with no memory of the first: the cursor is the only thing
    // carrying the position, which is what a closed tab leaves behind.
    port.reads.length = 0;
    const second = await matchLibrary(port, { pageSize: 2, budget: 2 });

    expect(second).toMatchObject({ kind: 'swept', swept: 1, done: true });
    expect(port.reads).not.toContain('summary:ride-0');
    expect(port.stored.size).toBe(3);
  });

  it('clears the cursor at the end, so the next press starts at the beginning again', async () => {
    // This is what makes a segment created tomorrow find yesterday's rides: a
    // finished sweep leaves nothing to resume from, so the sweep after it reads
    // the whole library against the new corpus.
    //
    // ⚠️ **The page size is what makes this test able to fail.** A library that
    // fits in one page never writes a cursor at all, so "it was cleared" and
    // "it was never written" look identical and deleting the clear leaves the
    // suite green — which is exactly what the first version of this test did.
    // Three rides in pages of two writes one cursor and then clears it.
    const port = portWith(libraryOf(3), [theSegment()]);

    await matchLibrary(port, { pageSize: 2 });

    expect(await port.store.getMatchCheckpoint(OWNER)).toBeUndefined();

    port.reads.length = 0;
    const again = await matchLibrary(port, { pageSize: 2 });

    expect(again).toMatchObject({ swept: 3, done: true });
    expect(port.reads).toContain('summary:ride-0');
  });

  it('a budget that stops it short still leaves the efforts it found', async () => {
    const port = portWith(libraryOf(4), [theSegment()]);

    const first = await matchLibrary(port, { pageSize: 2, budget: 2 });

    expect(first.kind === 'swept' ? first.efforts : 0).toBe(2);
    expect(port.stored.size).toBe(2);
  });
});

describe('what a rider is told, as a pure function of the result', () => {
  it('distinguishes a finished sweep from one that stopped at the budget', async () => {
    const port = portWith(libraryOf(3), [theSegment()]);

    const stopped = sweepSentence(await matchLibrary(port, { pageSize: 2, budget: 2 }));
    const finished = sweepSentence(await matchLibrary(port, { pageSize: 2, budget: 2 }));

    expect(stopped).toContain('Press again to carry on');
    // Not merely "different": a finished sweep must not invite another press,
    // which is the one thing a rider acts on.
    expect(finished).not.toContain('Press again');
  });

  it('counts one ride, one segment and one effort in the singular', async () => {
    const port = portWith(libraryOf(1), [theSegment()]);

    expect(sweepSentence(await matchLibrary(port))).toBe(
      'Matched 1 ride against 1 segment and found 1 effort.',
    );
  });

  it('says nothing at all when no traversal was abandoned', () => {
    expect(abandonedSentence([])).toBeUndefined();
  });

  it('counts abandoned traversals by ride, not by note', () => {
    // Two segments abandoned in one ride is one hole in one recording.
    const note = abandonedSentence([
      { activityId: activityId('ride-0'), segmentId: 'a', reason: 'recording-gap' },
      { activityId: activityId('ride-0'), segmentId: 'b', reason: 'recording-gap' },
    ]);

    expect(note).toContain('on 1 ride,');
  });
});
