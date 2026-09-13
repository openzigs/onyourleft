// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Making a route out of a file the Files screen was handed — #232's first
 * criterion, against the **real** local store.
 *
 * Every "it saved" assertion here reads back through `@onyourleft/store/testing`,
 * whose `read` discards every open handle before it opens another. So the claim
 * is that a fresh IndexedDB connection can see the route, not that the object
 * this module just built has the fields it was given — CLAUDE.md §5's fourth
 * cause of a write that reports success while the read cannot see it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { unixSeconds } from '@onyourleft/domain';
import { routeId, type RouteRecord } from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';

import type { ImportOutcome, ImportSource } from './import-batch';
import {
  COURSE_NOT_SAVED,
  COURSE_UNREADABLE,
  courseOffers,
  routeFromImportedFile,
  type CourseImportOutcome,
} from './route-from-import';
import type { CourseStore } from './store-port';
import { bytesSource, IMPORT_CLOCK, syntheticCourseGpx, syntheticGpx } from './testing';

let harness: StoreHarness | undefined;

afterEach(async () => {
  await harness?.destroy();
  harness = undefined;
});

async function openSeeded(): Promise<StoreHarness> {
  const opened = createStoreHarness();
  await seedAthletes(opened);
  harness = opened;
  return opened;
}

/** One attempt, written through the harness's own handle. */
async function makeRoute(
  open: StoreHarness,
  source: ImportSource,
  options: { readonly store?: CourseStore; readonly owner?: typeof ATHLETE_A } = {},
): Promise<CourseImportOutcome> {
  return open.write(async (store) =>
    routeFromImportedFile({
      source,
      store: options.store ?? store,
      owner: options.owner ?? ATHLETE_A,
      id: routeId('route-from-a-file'),
      now: IMPORT_CLOCK,
    }),
  );
}

/** The route a fresh connection can see, or a failure saying there is none. */
async function readBack(open: StoreHarness): Promise<RouteRecord> {
  const found = await open.read(async (store) =>
    store.getRoute(ATHLETE_A, routeId('route-from-a-file')),
  );
  if (found === undefined) {
    throw new Error('a fresh connection can see no route with that id');
  }
  return found;
}

describe('routeFromImportedFile', () => {
  it('saves a downloaded course as a route a fresh connection can read', async () => {
    const open = await openSeeded();

    const outcome = await makeRoute(open, bytesSource('course.gpx', syntheticCourseGpx()));

    expect(outcome.status).toBe('saved');
    const stored = await readBack(open);
    expect(stored.name).toBe('A course somebody downloaded 0');
    expect(stored.profile.totalDistance).toBeGreaterThan(0);
    // ADR 0004 decision A and #73's fourth criterion. There is no parameter
    // here that could have made it anything else.
    expect(stored.visibility).toBe('private');
    expect(stored.createdBy).toBe(ATHLETE_A);
  });

  it('makes a route from an ordinary ride file too, which is what makes a wrong guess cheap', async () => {
    // The other direction of #232's "recoverable in one action": a GPX the
    // heuristic did NOT flag is still one click from a route. If this needed a
    // course-shaped verdict first, a false negative would be unrecoverable
    // here and the rider would be back to re-finding the file.
    const open = await openSeeded();

    const outcome = await makeRoute(open, bytesSource('ride.gpx', syntheticGpx(3)));

    expect(outcome.status).toBe('saved');
    expect((await readBack(open)).profile.totalDistance).toBeGreaterThan(0);
  });

  it('passes the route importer’s own refusal through rather than replacing it', async () => {
    const open = await openSeeded();

    const outcome = await makeRoute(open, bytesSource('notes.txt', 'this is not a GPX file'));

    expect(outcome.status).toBe('refused');
    expect(outcome.status === 'refused' ? outcome.message : '').toContain('notes.txt');
    await expect(readBack(open)).rejects.toThrow('no route');
  });

  it('says the file could not be read when the disk refuses it a second time', async () => {
    const open = await openSeeded();
    const gone: ImportSource = {
      fileName: 'course.gpx',
      bytes: () => Promise.reject(new Error('the file is no longer where it was')),
    };

    const outcome = await makeRoute(open, gone);

    expect(outcome).toStrictEqual({ status: 'refused', message: COURSE_UNREADABLE });
  });

  it('blames this device, not the file, when the store refuses the write', async () => {
    const open = await openSeeded();
    const broken: CourseStore = {
      putRoute: () => Promise.reject(new Error('the transaction was aborted')),
    };

    const outcome = await makeRoute(open, bytesSource('course.gpx', syntheticCourseGpx()), {
      store: broken,
    });

    expect(outcome).toStrictEqual({ status: 'refused', message: COURSE_NOT_SAVED });
    // And nothing was left behind for a later read to find.
    await expect(readBack(open)).rejects.toThrow('no route');
  });

  it('writes the route to the athlete it was told about, and to no other', async () => {
    const open = await openSeeded();

    await makeRoute(open, bytesSource('course.gpx', syntheticCourseGpx()), { owner: ATHLETE_B });

    // ATHLETE_A cannot see it, which is the scoping every read in this app is
    // built on — and the third athlete in the fixtures is what tells "scoped
    // correctly" apart from "returns everything".
    await expect(readBack(open)).rejects.toThrow('no route');
    const theirs = await open.read(async (store) =>
      store.getRoute(ATHLETE_B, routeId('route-from-a-file')),
    );
    expect(theirs?.createdBy).toBe(ATHLETE_B);
  });

  it('stamps the route with the instant it was handed, not one it read', async () => {
    const open = await openSeeded();

    await makeRoute(open, bytesSource('course.gpx', syntheticCourseGpx()));

    const stored = await readBack(open);
    expect(stored.createdAt).toBe(unixSeconds(Math.floor(IMPORT_CLOCK)));
    expect(stored.updatedAt).toBe(stored.createdAt);
  });
});

/** One report row, with only the fields {@link courseOffers} reads set. */
function row(fileName: string, course: ImportOutcome['course']): ImportOutcome {
  return {
    fileName,
    kind: 'imported',
    activityId: undefined,
    reason: undefined,
    code: undefined,
    course,
    faults: [],
  };
}

describe('courseOffers', () => {
  const flagged = { courseShaped: true, signals: ['no-times'] } as const;
  const ordinary = { courseShaped: false, signals: [] } as const;

  it('offers every GPX that decoded, flagged or not', () => {
    // The whole of "recoverable in one action" in one assertion: an offer
    // gated on the verdict would drop the second row here, and a rider whose
    // course was not recognised would be back to re-finding the file.
    const sources = [bytesSource('course.gpx', ''), bytesSource('ride.gpx', '')];
    const outcomes = [row('course.gpx', flagged), row('ride.gpx', ordinary)];

    const offers = courseOffers(sources, outcomes);

    expect(offers.map((offer) => offer.source.fileName)).toStrictEqual(['course.gpx', 'ride.gpx']);
    expect(offers[0]?.note).toContain('course to ride');
    expect(offers[1]?.note).toBeUndefined();
  });

  it('offers nothing for a row with no decoded GPX behind it', () => {
    const sources = [bytesSource('ride.fit', ''), bytesSource('notes.txt', '')];
    const outcomes = [row('ride.fit', undefined), row('notes.txt', undefined)];

    expect(courseOffers(sources, outcomes)).toStrictEqual([]);
  });

  it('refuses to pair a row with a file of a different name', () => {
    // The invariant is that the batch reports one row per file in order. If it
    // ever stops holding, the failure would be a button that writes one file's
    // line into a rider's routes under another file's name.
    const sources = [bytesSource('a.gpx', ''), bytesSource('b.gpx', '')];
    const outcomes = [row('b.gpx', flagged), row('a.gpx', flagged)];

    expect(courseOffers(sources, outcomes)).toStrictEqual([]);
  });

  it('offers nothing for a file the run has not reached yet', () => {
    const sources = [bytesSource('a.gpx', ''), bytesSource('b.gpx', '')];

    expect(courseOffers(sources, [row('a.gpx', flagged)])).toHaveLength(1);
  });
});
