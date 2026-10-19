// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #51's import criteria, against the **real** local store.
 *
 * Every assertion here reads back through `@onyourleft/store/testing`'s
 * round-trip harness, whose `read` discards every open handle before it opens
 * another. So "the ride imported" means a fresh IndexedDB connection can see
 * it, not that the object the importer just built has the fields it was given —
 * which is docs/agents/quality-gate.md §5's fourth cause of a write that reports success while
 * the read cannot see it, and the one a naive test cannot tell apart from
 * success.
 *
 * The deduplication arm in particular is a **real** `findActivityByOriginalFileHash`
 * against #26's `[athleteId+originalFileSha256]` index, not a mock: #51 asks for
 * exactly that, and a mocked lookup would pass against an importer that never
 * writes the hash at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { activityId, lapId, type ActivityId } from '@onyourleft/store';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  lapFor,
  rideFor,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';

import { needsLoadSummary } from '../analysis/summary';
import { bestLapIndex } from '../recording/laps';

import { webCryptoDigest } from './browser';
import { corpusSource } from './corpus';
import {
  importActivityFiles,
  type ImportOutcome,
  type ImportProgress,
  type ImportSource,
} from './import-batch';
import type { TransferStore } from './store-port';
import {
  bytesSource,
  IMPORT_CLOCK,
  LAPPED_FILE_START,
  lappedFile,
  sequentialActivityIds,
  syntheticCourseGpx,
  syntheticGpx,
} from './testing';

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

interface RunOptions {
  readonly owner?: typeof ATHLETE_A;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: ImportProgress) => void;
  readonly store?: TransferStore;
  readonly newActivityId?: () => ReturnType<ReturnType<typeof sequentialActivityIds>>;
}

/** One batch, written through the harness's handle. */
async function run(
  open: StoreHarness,
  sources: readonly ImportSource[],
  options: RunOptions = {},
): ReturnType<typeof importActivityFiles> {
  const newActivityId = options.newActivityId ?? sequentialActivityIds();
  return open.write(async (store) =>
    importActivityFiles({
      sources,
      store: options.store ?? store,
      athleteId: options.owner ?? ATHLETE_A,
      newActivityId,
      now: () => IMPORT_CLOCK,
      digest: webCryptoDigest,
      timeZone: 'Europe/London',
      signal: options.signal,
      onProgress: options.onProgress,
    }),
  );
}

function named(outcomes: readonly ImportOutcome[], fileName: string): ImportOutcome {
  const found = outcomes.find((outcome) => outcome.fileName === fileName);
  if (found === undefined) {
    throw new Error(`the report has no row for ${fileName}; it has ${outcomes.length} rows`);
  }
  return found;
}

describe('importActivityFiles — a bulk archive', () => {
  it('imports hundreds of mixed files and reports every one by filename', async () => {
    const open = await openSeeded();
    // The shape of a real platform export: a few hundred rides, the three
    // activity formats mixed, and the things an archive also contains — a
    // summary spreadsheet, a compressed ride, a readme, an empty file.
    const rides: ImportSource[] = Array.from({ length: 240 }, (_unused, index) =>
      bytesSource(`activities/ride-${String(index)}.gpx`, syntheticRide(index)),
    );
    const sources: ImportSource[] = [
      ...rides,
      corpusSource('nominal-outdoor-ride.fit', 'activities/2024-06-15.fit'),
      corpusSource('nominal-ride.tcx', 'activities/2024-06-16.tcx'),
      corpusSource('indoor-trainer-no-position.fit', 'activities/turbo.fit'),
      bytesSource('activities.csv', 'name,date\nMorning Ride,2024-01-01\n'),
      corpusSource('zero-length.fit', 'activities/empty.fit'),
      corpusSource('xxe-external-entity.gpx', 'activities/hostile.gpx'),
      bytesSource('activities/ride-1.fit.gz', new Uint8Array([0x1f, 0x8b, 0x08, 0x00])),
      bytesSource('README.md', '# my rides\n'),
    ];

    const report = await run(open, sources);

    // Every file, in the report, by the name the rider sees in their archive.
    expect(report.outcomes).toHaveLength(sources.length);
    expect(report.outcomes.map((outcome) => outcome.fileName)).toEqual(
      sources.map((source) => source.fileName),
    );
    // The batch did not abort on the first bad file: the failures are here and
    // so is everything after them.
    expect(report.imported).toBe(243);
    expect(report.failed).toBe(5);
    expect(report.cancelled).toBe(0);
    expect(named(report.outcomes, 'activities.csv').code).toBe('unsupported-format');
    expect(named(report.outcomes, 'activities/ride-1.fit.gz').code).toBe('unsupported-format');
    expect(named(report.outcomes, 'README.md').code).toBe('unsupported-format');
    expect(named(report.outcomes, 'activities/empty.fit').code).toBe('undecodable');
    expect(named(report.outcomes, 'activities/hostile.gpx').code).toBe('undecodable');

    // And the rides are on disk, read on a connection this process never wrote
    // through.
    const stored = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(stored).toHaveLength(243);
  });

  it('reports which file failed and why, by name, and imports the rest of the batch', async () => {
    const open = await openSeeded();
    const sources = [
      bytesSource('good-first.gpx', syntheticRide(1)),
      corpusSource('xxe-external-entity.tcx', 'hostile.tcx'),
      bytesSource('good-last.gpx', syntheticRide(2)),
    ];

    const report = await run(open, sources);

    const failure = named(report.outcomes, 'hostile.tcx');
    expect(failure.kind).toBe('failed');
    // The codec's own diagnostic reaches the rider. #51's guidance: a picker
    // that swallows the codec's error into "import failed" throws away the one
    // thing the athlete could act on.
    expect(failure.reason).toMatch(/DOCTYPE|entity/i);
    expect(failure.activityId).toBeUndefined();

    expect(named(report.outcomes, 'good-first.gpx').kind).toBe('imported');
    expect(named(report.outcomes, 'good-last.gpx').kind).toBe('imported');

    const stored = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(stored).toHaveLength(2);
  });

  it('carries a recoverable fault through on a file that imported anyway', async () => {
    const open = await openSeeded();

    const report = await run(open, [corpusSource('truncated-mid-record.fit', 'short.fit')]);

    const outcome = named(report.outcomes, 'short.fit');
    expect(outcome.kind).toBe('imported');
    // Imported *and* the file was short. Reporting only one of the two is how a
    // rider ends up believing a partial ride is whole.
    expect(outcome.faults.length).toBeGreaterThan(0);
  });

  it('reports a file it cannot read off the disk separately from one it cannot decode', async () => {
    const open = await openSeeded();
    const unreadable: ImportSource = {
      fileName: 'removed-drive/ride.fit',
      bytes: async () => Promise.reject(new Error('NotReadableError: the file is no longer there')),
    };

    const report = await run(open, [unreadable, bytesSource('fine.gpx', syntheticRide(3))]);

    expect(named(report.outcomes, 'removed-drive/ride.fit').code).toBe('unreadable');
    expect(named(report.outcomes, 'fine.gpx').kind).toBe('imported');
  });

  it('records the archive’s filename as the original-file key, not the ride’s name', async () => {
    const open = await openSeeded();
    // A GPX whose `<name>` is “Ride 9” inside a file called something else.
    // The two are different strings, which is the whole point: a key taken from
    // the ride's name is a key that does not name a file, and #26's
    // `originalFile.key` is the reference back to the archive.
    const source = bytesSource('activities/2019-01-10_1234567.gpx', syntheticRide(9));

    const report = await run(open, [source]);

    const outcome = named(report.outcomes, source.fileName);
    expect(outcome.kind).toBe('imported');
    const stored = await open.read(async (store) =>
      outcome.activityId === undefined
        ? undefined
        : store.getActivity(ATHLETE_A, outcome.activityId),
    );
    expect(stored?.name).toBe('Ride 9');
    expect(stored?.originalFile?.key).toBe('activities/2019-01-10_1234567.gpx');
  });

  it('stores a distance for a GPX that states none, and a fresh read can see it', async () => {
    const open = await openSeeded();
    // #231, through the consumer rather than through the reader. GPX carries no
    // lap total and no per-point cumulative distance, so this ride's distance
    // exists nowhere in the file except its positions — and the assertion is
    // deliberately made from a connection that did not write it, because a
    // number the importer computed and did not persist reads identically at the
    // moment of the write and as nought on the next open.
    const source = corpusSource('nominal-ride.gpx', 'activities/2024-06-15.gpx');

    const report = await run(open, [source]);

    expect(named(report.outcomes, source.fileName).kind).toBe('imported');
    const [summary] = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(summary?.distance).toBeGreaterThan(1000);
  });
});

describe('importActivityFiles — the facts badges are earned from (#947)', () => {
  it('works out a climb from the file’s altitude, and claims no workout and no ghost', async () => {
    const open = await openSeeded();
    const source = corpusSource('nominal-ride.gpx', 'activities/2024-06-15.gpx');
    await run(open, [source]);
    const [summary] = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(summary?.rideFacts).toBeDefined();
    expect(summary?.rideFacts?.ascent).toBeGreaterThan(0);
    expect(summary?.rideFacts?.workoutFinished).toBeUndefined();
    expect(summary?.rideFacts?.ghostRaced).toBeUndefined();
  });
});

describe('importActivityFiles — a ride with nothing to work a load out from (#1084)', () => {
  it('is stored marked, and a fresh read sees no load and nothing left to work out', async () => {
    // Five seconds of heart rate and no power: shorter than the smoothing
    // window, so no pass could ever give it a load.
    const open = await openSeeded();
    await run(open, [bytesSource('brief.gpx', syntheticGpx(3))]);
    const [summary] = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(summary?.loadCoveredTime).toBe(0);
    expect(summary?.effortWeightedHeartRate).toBeUndefined();
    expect(summary === undefined ? undefined : needsLoadSummary(summary)).toBe(false);
  });
});

describe('importActivityFiles — deduplication against the local store', () => {
  it('does not create a second activity for the same file imported twice', async () => {
    const open = await openSeeded();
    const bytes = syntheticRide(7);

    const first = await run(open, [bytesSource('ride.gpx', bytes)], {
      newActivityId: sequentialActivityIds('first'),
    });
    // A separate batch, a separate id generator: nothing about the second run
    // knows what the first one chose, so the only thing that can stop a
    // duplicate is the store lookup.
    const second = await run(open, [bytesSource('ride-copy.gpx', bytes)], {
      newActivityId: sequentialActivityIds('second'),
    });

    expect(first.imported).toBe(1);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(1);
    const duplicate = named(second.outcomes, 'ride-copy.gpx');
    expect(duplicate.kind).toBe('duplicate');
    expect(duplicate.activityId).toBe(named(first.outcomes, 'ride.gpx').activityId);

    const stored = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(stored).toHaveLength(1);
  });

  it('carries a course verdict on a refused file, an imported one and a duplicate', async () => {
    // #232's first criterion, at the layer the screen reads. The three rows a
    // rider can end up with are all rows they might want a route from, and the
    // refusal is the one that matters most: a downloaded course has no times,
    // so it is the row that never becomes a ride at all.
    const open = await openSeeded();
    const alreadyHere = syntheticGpx(41);

    const report = await run(open, [
      bytesSource('course.gpx', syntheticCourseGpx()),
      bytesSource('ride.gpx', alreadyHere),
      bytesSource('ride-again.gpx', alreadyHere),
      bytesSource('notes.txt', 'not an activity file at all'),
    ]);

    const course = named(report.outcomes, 'course.gpx');
    expect(course.kind).toBe('failed');
    expect(course.code).toBe('no-timestamped-samples');
    expect(course.course?.courseShaped).toBe(true);

    // The two ordinary GPX rows carry a verdict too, so the screen can offer a
    // route from either — a wrong guess has to be recoverable in one action.
    expect(named(report.outcomes, 'ride.gpx').kind).toBe('imported');
    expect(named(report.outcomes, 'ride.gpx').course?.courseShaped).toBe(false);
    expect(named(report.outcomes, 'ride-again.gpx').kind).toBe('duplicate');
    expect(named(report.outcomes, 'ride-again.gpx').course).toBeDefined();

    // And a file that never decoded as GPX carries none, so the screen offers
    // nothing it could not do.
    expect(named(report.outcomes, 'notes.txt').course).toBeUndefined();
  });

  it('deduplicates within one batch, not only across batches', async () => {
    const open = await openSeeded();
    const bytes = syntheticRide(8);

    const report = await run(open, [
      bytesSource('a/ride.gpx', bytes),
      bytesSource('b/ride.gpx', bytes),
      bytesSource('c/ride.gpx', bytes),
    ]);

    expect(report.imported).toBe(1);
    expect(report.duplicates).toBe(2);
    const stored = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(stored).toHaveLength(1);
  });

  it('is scoped to the athlete: two athletes each keep their own copy', async () => {
    const open = await openSeeded();
    const bytes = syntheticRide(9);

    await run(open, [bytesSource('ride.gpx', bytes)], { owner: ATHLETE_A });
    const second = await run(open, [bytesSource('ride.gpx', bytes)], {
      owner: ATHLETE_B,
      newActivityId: sequentialActivityIds('b'),
    });

    // The same bytes are a duplicate *for the athlete who has them*, and a new
    // ride for anyone else. A dedup lookup that matched on the hash alone would
    // silently deny the second athlete their own ride.
    expect(second.imported).toBe(1);
    expect(await open.read(async (store) => store.listActivitySummaries(ATHLETE_A))).toHaveLength(
      1,
    );
    expect(await open.read(async (store) => store.listActivitySummaries(ATHLETE_B))).toHaveLength(
      1,
    );
  });
});

describe('importActivityFiles — progress and cancelling', () => {
  it('reports progress after every file', async () => {
    const open = await openSeeded();
    const sources = [
      bytesSource('one.gpx', syntheticRide(11)),
      bytesSource('two.csv', 'not a ride'),
      bytesSource('three.gpx', syntheticRide(12)),
    ];
    const seen: ImportProgress[] = [];

    await run(open, sources, { onProgress: (progress) => seen.push(progress) });

    expect(seen.map((progress) => progress.completed)).toEqual([1, 2, 3]);
    expect(seen.every((progress) => progress.total === 3)).toBe(true);
    // Progress carries the outcome, not only a count: a bar that moves while
    // saying nothing about what happened is what turns a partial failure into a
    // silent one.
    expect(seen.map((progress) => progress.outcome.fileName)).toEqual([
      'one.gpx',
      'two.csv',
      'three.gpx',
    ]);
  });

  it('stops when cancelled and leaves everything already imported on disk', async () => {
    const open = await openSeeded();
    const sources = Array.from({ length: 8 }, (_unused, index) =>
      bytesSource(`ride-${String(index)}.gpx`, syntheticRide(20 + index)),
    );
    const controller = new AbortController();

    const report = await run(open, sources, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (progress.completed === 3) {
          controller.abort();
        }
      },
    });

    expect(report.imported).toBe(3);
    expect(report.cancelled).toBe(5);
    // Cancelling is not rolling back. The three rides already written are the
    // rider's, and re-importing them would cost as long again.
    const stored = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(stored).toHaveLength(3);
    for (const outcome of report.outcomes.slice(3)) {
      expect(outcome.kind).toBe('cancelled');
      expect(outcome.activityId).toBeUndefined();
    }
  });

  it('imports nothing when cancelled before it starts, and still reports every file', async () => {
    const open = await openSeeded();
    const controller = new AbortController();
    controller.abort();

    const report = await run(open, [bytesSource('ride.gpx', syntheticRide(30))], {
      signal: controller.signal,
    });

    expect(report.cancelled).toBe(1);
    expect(await open.read(async (store) => store.listActivitySummaries(ATHLETE_A))).toHaveLength(
      0,
    );
  });
});

describe('importActivityFiles — a store that refuses the write', () => {
  it('reports the file as failed with the store’s own reason, and leaves no ride behind', async () => {
    const open = await openSeeded();
    const bytes = syntheticRide(41);

    const failing = await open.write((store) => {
      const spy = vi
        .spyOn(store, 'putFinishedRide')
        .mockRejectedValueOnce(new Error('QuotaExceededError: the device is full'));
      return Promise.resolve({ store, spy });
    });

    const report = await run(open, [bytesSource('ride.gpx', bytes)], { store: failing.store });
    const outcome = named(report.outcomes, 'ride.gpx');
    expect(outcome.kind).toBe('failed');
    expect(outcome.code).toBe('not-stored');
    expect(outcome.reason).toContain('QuotaExceededError');
    expect(report.imported).toBe(0);
    failing.spy.mockRestore();

    expect(await open.read(async (store) => store.listActivitySummaries(ATHLETE_A))).toHaveLength(
      0,
    );

    const retry = await run(open, [bytesSource('ride.gpx', bytes)], {
      newActivityId: sequentialActivityIds('retry'),
    });
    expect(retry.imported).toBe(1);
  });

  // --- #166: a half-written row an import before #1320 may have left -------

  it('lets the rider retry a file whose half-written row is still on the device', async () => {
    const open = await openSeeded();
    const bytes = new TextEncoder().encode(syntheticRide(43));

    // ⚠️ The residue #166 is about, as an import before #1320 could leave it:
    // the activity row carrying the file's hash, and no samples behind it.
    // The write is one transaction now and cannot leave one, so it is put
    // here by hand — the device that already holds one still needs the
    // read-side check.
    const sha256 = await webCryptoDigest(bytes);
    await open.write(async (store) =>
      store.putActivity({
        ...rideFor(ATHLETE_A, { name: 'Half written' }),
        originalFile: { key: 'ride.gpx', sha256 },
      }),
    );

    const retry = await run(open, [bytesSource('ride.gpx', bytes)], {
      newActivityId: sequentialActivityIds('retry'),
    });
    expect(named(retry.outcomes, 'ride.gpx').kind).toBe('imported');
    expect(retry.imported).toBe(1);
    expect(retry.duplicates).toBe(0);

    // Read back on a fresh connection: one ride, and the data is behind it.
    // Asserting the count alone would pass against an importer that left the
    // orphan and added a second row with the same hash.
    const summaries = await open.read(async (store) => store.listActivitySummaries(ATHLETE_A));
    expect(summaries).toHaveLength(1);
    const streams = await open.read(async (store) =>
      store.getStreamSet(ATHLETE_A, summaries[0]!.id),
    );
    expect(streams?.sampleCount).toBeGreaterThan(0);
  });
});

/**
 * #1320: a file's laps become lap rows, written with the ride, read back on a
 * fresh connection through the scoped `listLaps` the ride's page reads.
 */
describe('importActivityFiles — a file’s laps (#1320)', () => {
  /** Garmin's FIT manufacturer number: a file that names its writer. */
  const GARMIN = 1;

  async function importOne(
    open: StoreHarness,
    fileName: string,
    bytes: Uint8Array,
  ): Promise<ImportOutcome> {
    const report = await run(open, [bytesSource(fileName, bytes)]);
    return named(report.outcomes, fileName);
  }

  async function lapsOf(open: StoreHarness, id: ActivityId | undefined, owner = ATHLETE_A) {
    if (id === undefined) {
      throw new Error('the file was not imported');
    }
    return open.read(async (store) => store.listLaps(owner, id));
  }

  it('writes a FIT file’s laps as rows, in order, with averages worked out from its samples', async () => {
    const open = await openSeeded();
    const outcome = await importOne(
      open,
      'laps.fit',
      lappedFile({
        format: 'fit',
        samples: 120,
        writer: GARMIN,
        laps: [
          { start: 0, elapsed: 40, distance: 200 },
          { start: 40, elapsed: 40, moving: 30, distance: 200 },
          { start: 80, elapsed: 39, distance: 195 },
        ],
      }),
    );
    expect(outcome.kind).toBe('imported');
    const laps = await lapsOf(open, outcome.activityId);

    expect(
      laps.map((lap) => [
        lap.ordinal,
        lap.startedAt - LAPPED_FILE_START,
        lap.elapsedTime,
        lap.movingTime,
        lap.distance,
      ]),
    ).toEqual([
      [0, 0, 40, 40, 200],
      [1, 40, 40, 30, 200],
      [2, 80, 39, 39, 195],
    ]);
    // Sample i has power i and heart rate 100 + i % 50: worked out by hand
    // over each lap's slots, from the slot it began in up to the one it
    // ended in. The file states no average at all, so these can only have
    // come from the samples.
    expect(laps.map((lap) => [lap.averagePower, lap.maxPower])).toEqual([
      [20, 39],
      [60, 79],
      [99, 118],
    ]);
    expect(laps.map((lap) => [lap.averageHeartRate, lap.maxHeartRate])).toEqual([
      [120, 139],
      [122, 149],
      [125, 149],
    ]);
    // A file cannot say a lap stopped short, and has no altitude here.
    expect(laps.some((lap) => lap.partial === true || lap.ascent !== undefined)).toBe(false);
    // Every lap read filters on the owning athlete.
    expect(await lapsOf(open, outcome.activityId, ATHLETE_B)).toEqual([]);
  });

  it('writes a TCX file’s laps, its one time read as both elapsed and moving', async () => {
    const open = await openSeeded();
    const outcome = await importOne(
      open,
      'laps.tcx',
      lappedFile({
        format: 'tcx',
        samples: 120,
        writer: 'Garmin Edge 530',
        laps: [
          { start: 0, elapsed: 60, distance: 300 },
          { start: 60, elapsed: 59, distance: 295 },
        ],
      }),
    );
    const laps = await lapsOf(open, outcome.activityId);
    expect(
      laps.map((lap) => [lap.startedAt - LAPPED_FILE_START, lap.elapsedTime, lap.movingTime]),
    ).toEqual([
      [0, 60, 60],
      [60, 59, 59],
    ]);
  });

  it('ends a paused TCX lap at the next one’s start and reads its TotalTimeSeconds as moving time', async () => {
    const open = await openSeeded();
    // A Garmin TCX with auto-pause: each lap's TotalTimeSeconds (60, 60, 30)
    // is timer time, far short of the wall-clock gap to the next StartTime.
    const outcome = await importOne(
      open,
      'paused.tcx',
      lappedFile({
        format: 'tcx',
        samples: 300,
        writer: 'Garmin Edge 530',
        laps: [
          { start: 0, elapsed: 60, distance: 300 },
          { start: 150, elapsed: 60, distance: 450 },
          { start: 240, elapsed: 30, distance: 295 },
        ],
      }),
    );
    expect(outcome.kind).toBe('imported');
    const laps = await lapsOf(open, outcome.activityId);
    expect(
      laps.map((lap) => [lap.startedAt - LAPPED_FILE_START, lap.elapsedTime, lap.movingTime]),
    ).toEqual([
      [0, 150, 60],
      [150, 90, 60],
      [240, 59, 30],
    ]);
    // Sample i has power i: each lap's highest is its last slot's, so every
    // lap's averages are taken over its whole span, the stretch after a pause
    // included — and not cut off StartTime + TotalTimeSeconds in.
    expect(laps.map((lap) => lap.maxPower)).toEqual([149, 239, 298]);
  });

  it('holds a TCX lap’s moving time to the span it runs to the next lap', async () => {
    const open = await openSeeded();
    const outcome = await importOne(
      open,
      'overlong.tcx',
      lappedFile({
        format: 'tcx',
        samples: 120,
        writer: 'Garmin Edge 530',
        laps: [
          // States 100 s for a lap the next one starts 60 s into.
          { start: 0, elapsed: 100, distance: 300 },
          { start: 60, elapsed: 59, distance: 295 },
        ],
      }),
    );
    const laps = await lapsOf(open, outcome.activityId);
    expect(laps.map((lap) => [lap.elapsedTime, lap.movingTime])).toEqual([
      [60, 60],
      [59, 59],
    ]);
  });

  it('takes a lap’s distance and its averages over the same slots when it ends between two samples', async () => {
    const open = await openSeeded();
    // FIT states a lap's time to the millisecond, so a lap can end between
    // two samples: this one 60.6 s in. The file states no lap distance, so
    // each is the speed (5 m/s) summed over the lap's slots; power i in slot
    // i makes the slots its averages were taken over readable off them.
    const outcome = await importOne(
      open,
      'part-second.fit',
      lappedFile({
        format: 'fit',
        samples: 120,
        writer: GARMIN,
        laps: [
          { start: 0, elapsed: 60.6 },
          { start: 61, elapsed: 58 },
        ],
      }),
    );
    const laps = await lapsOf(open, outcome.activityId);
    // The file's own times, to the millisecond: nothing is moved onto the grid.
    const millis = (value: number): number => Math.round(value * 1000) / 1000;
    expect(laps.map((lap) => [lap.startedAt - LAPPED_FILE_START, millis(lap.elapsedTime)])).toEqual(
      [
        [0, 60.6],
        [61, 58],
      ],
    );
    // Lap 1 is slots 0–59, the slot 60.6 s is in left out (`recording/laps.ts`
    // §`lapSlots`): 60 slots, so 300 m, and power 0–59.
    expect(laps.map((lap) => [lap.distance, lap.maxPower])).toEqual([
      [300, 59],
      [290, 118],
    ]);
  });

  it.each([
    ['a FIT file that names no writer, as this client’s own does', 'fit', undefined],
    ['a TCX file this client wrote', 'tcx', undefined],
    [
      'a GPX file, whose segments are not laps, from a device that names itself',
      'gpx',
      'Garmin Edge 530',
    ],
  ] as const)('lists no laps from %s', async (_name, format, writer) => {
    const open = await openSeeded();
    const outcome = await importOne(
      open,
      `laps.${format}`,
      lappedFile({
        format,
        samples: 120,
        writer,
        laps: [
          { start: 0, elapsed: 60, distance: 300 },
          { start: 60, elapsed: 59, distance: 295 },
        ],
      }),
    );
    // The ride imported; only the laps are left out.
    expect(outcome.kind).toBe('imported');
    expect(await lapsOf(open, outcome.activityId)).toEqual([]);
  });

  it('writes this client’s own marked laps as rows, the part lap a part lap, and no split either side', async () => {
    const open = await openSeeded();
    const outcome = await importOne(
      open,
      'own.fit',
      lappedFile({
        format: 'fit',
        samples: 120,
        writer: undefined,
        laps: [
          { start: 0, elapsed: 20, kind: 'outside' },
          { start: 20, elapsed: 40, distance: 2_000, kind: 'lap' },
          { start: 60, elapsed: 30, distance: 1_000, kind: 'part' },
          { start: 90, elapsed: 29, kind: 'outside' },
        ],
      }),
    );
    const laps = await lapsOf(open, outcome.activityId);
    expect(
      laps.map((lap) => [
        lap.ordinal,
        lap.startedAt - LAPPED_FILE_START,
        lap.distance,
        lap.partial,
      ]),
    ).toEqual([
      [0, 20, 2_000, undefined],
      [1, 60, 1_000, true],
    ]);
    // Worked out from the samples in each lap's slots: power i in slot i.
    expect(laps.map((lap) => lap.maxPower)).toEqual([59, 89]);
  });

  it('writes no lap row for a file with one lap spanning the ride', async () => {
    const open = await openSeeded();
    const outcome = await importOne(
      open,
      'one.fit',
      lappedFile({
        format: 'fit',
        samples: 120,
        writer: GARMIN,
        laps: [{ start: 0, elapsed: 119, distance: 595 }],
      }),
    );
    expect(outcome.kind).toBe('imported');
    expect(await lapsOf(open, outcome.activityId)).toEqual([]);
  });

  it('takes the whole file back out when a lap will not go down', async () => {
    const open = await openSeeded();
    // Another athlete already holds a lap under the id this import's second
    // lap is given, so the store refuses that one lap — inside the write.
    const theirs = rideFor(ATHLETE_B, { name: 'Theirs' });
    await open.write(async (store) => {
      await store.putActivity(theirs);
      await store.putLap(lapFor(theirs, 0, { id: lapId('imported-1:lap:1') }));
    });

    const outcome = await importOne(
      open,
      'laps.fit',
      lappedFile({
        format: 'fit',
        samples: 120,
        writer: GARMIN,
        laps: [
          { start: 0, elapsed: 60, distance: 300 },
          { start: 60, elapsed: 59, distance: 295 },
        ],
      }),
    );
    expect(outcome.kind).toBe('failed');
    expect(outcome.code).toBe('not-stored');
    // Nothing of the file is left: no ride, no samples, no first lap.
    const id = activityId('imported-1');
    expect(await open.read(async (store) => store.getActivity(ATHLETE_A, id))).toBeUndefined();
    expect(await open.read(async (store) => store.getStreamSet(ATHLETE_A, id))).toBeUndefined();
    expect(await lapsOf(open, id)).toEqual([]);
  });

  it('holds a hostile file’s laps to the ride: inside it, one after another, no longer than it', async () => {
    const open = await openSeeded();
    const outcome = await importOne(
      open,
      'hostile.fit',
      lappedFile({
        format: 'fit',
        samples: 120,
        writer: GARMIN,
        moving: 100,
        laps: [
          // Starts long before the ride and claims far more moving time than it lasts.
          { start: -1000, elapsed: 1060, moving: 4000, distance: 300 },
          // Starts inside the lap before, runs a million seconds, and claims
          // more road than the ride has.
          { start: 30, elapsed: 1_000_000, moving: 2_000_000, distance: 10_000_000 },
          // After the ride: no time left, so no lap.
          { start: 5000, elapsed: 10, distance: 50 },
        ],
      }),
    );
    expect(outcome.kind).toBe('imported');
    const ride = await open.read(async (store) =>
      store.getActivity(ATHLETE_A, outcome.activityId ?? activityId('none')),
    );
    const laps = await lapsOf(open, outcome.activityId);

    expect(laps.map((lap) => [lap.startedAt - LAPPED_FILE_START, lap.elapsedTime])).toEqual([
      [0, 60],
      [60, 59],
    ]);
    // Moving times held to the ride's own, which is 100 seconds.
    expect(ride?.movingTime).toBe(100);
    expect(laps.map((lap) => lap.movingTime)).toEqual([60, 40]);
    // And the laps together go no further than the ride did.
    expect(laps.map((lap) => lap.distance)).toEqual([300, (ride?.distance ?? 0) - 300]);
  });

  it('works a lap’s distance out from its speed samples where the file states none', async () => {
    const open = await openSeeded();
    const outcome = await importOne(
      open,
      'no-distance.fit',
      lappedFile({
        format: 'fit',
        samples: 120,
        writer: GARMIN,
        laps: [
          { start: 0, elapsed: 60 },
          { start: 60, elapsed: 59 },
        ],
      }),
    );
    // 5 m/s in every slot: 60 slots, then 59.
    expect((await lapsOf(open, outcome.activityId)).map((lap) => lap.distance)).toEqual([300, 295]);
  });

  it('decides the best of laps of different lengths by average speed', async () => {
    const open = await openSeeded();
    const outcome = await importOne(
      open,
      'auto-lap.fit',
      lappedFile({
        format: 'fit',
        samples: 120,
        writer: GARMIN,
        distance: 800,
        laps: [
          // A long lap at 5 m/s, then a short one at a little over 6.
          { start: 0, elapsed: 80, distance: 400 },
          { start: 80, elapsed: 39, distance: 240 },
        ],
      }),
    );
    const laps = await lapsOf(open, outcome.activityId);
    // The shorter lap is the quicker one: a lap's time alone would pick it
    // for the wrong reason, and its distance alone would pick the other.
    expect(bestLapIndex(laps)).toBe(1);
  });
});

/** A distinct GPX document per index. @see syntheticGpx */
function syntheticRide(index: number): string {
  return syntheticGpx(index);
}
