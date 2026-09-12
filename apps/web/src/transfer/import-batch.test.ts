// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #51's import criteria, against the **real** local store.
 *
 * Every assertion here reads back through `@onyourleft/store/testing`'s
 * round-trip harness, whose `read` discards every open handle before it opens
 * another. So "the ride imported" means a fresh IndexedDB connection can see
 * it, not that the object the importer just built has the fields it was given —
 * which is CLAUDE.md §5's fourth cause of a write that reports success while
 * the read cannot see it, and the one a naive test cannot tell apart from
 * success.
 *
 * The deduplication arm in particular is a **real** `findActivityByOriginalFileHash`
 * against #26's `[athleteId+originalFileSha256]` index, not a mock: #51 asks for
 * exactly that, and a mocked lookup would pass against an importer that never
 * writes the hash at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';

import { webCryptoDigest } from './browser';
import { corpusSource } from './corpus';
import {
  importActivityFiles,
  type ImportOutcome,
  type ImportProgress,
  type ImportSource,
} from './import-batch';
import type { TransferStore } from './store-port';
import { bytesSource, IMPORT_CLOCK, sequentialActivityIds, syntheticGpx } from './testing';

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
  it('reports the file as failed and leaves no half-written ride behind', async () => {
    const open = await openSeeded();
    const bytes = syntheticRide(41);

    const failing = await open.write((store) => {
      const spy = vi
        .spyOn(store, 'putStreamSet')
        .mockRejectedValueOnce(new Error('QuotaExceededError: the device is full'));
      return Promise.resolve({ store, spy });
    });

    const report = await run(open, [bytesSource('ride.gpx', bytes)], { store: failing.store });
    expect(named(report.outcomes, 'ride.gpx').code).toBe('not-stored');
    failing.spy.mockRestore();

    // ⚠️ The defect this asserts against: the activity row goes down first,
    // because `putStreamSet` refuses a set whose activity does not exist. If it
    // survived a failed stream write it would carry the file's hash, so the
    // rider's retry would be reported as a duplicate — of a ride with no data
    // in it, which they could then never import.
    expect(await open.read(async (store) => store.listActivitySummaries(ATHLETE_A))).toHaveLength(
      0,
    );

    const retry = await run(open, [bytesSource('ride.gpx', bytes)], {
      newActivityId: sequentialActivityIds('retry'),
    });
    expect(retry.imported).toBe(1);
  });

  // --- #166: the arm where the compensating delete fails too ---------------

  it('reports the original failure, not the cleanup’s, when the cleanup also fails', async () => {
    const open = await openSeeded();
    const bytes = syntheticRide(42);

    const failing = await open.write((store) => {
      const streams = vi
        .spyOn(store, 'putStreamSet')
        .mockRejectedValueOnce(new Error('QuotaExceededError: the device is full'));
      // The compensation cannot run either, which is the case #166 is about.
      const cleanup = vi
        .spyOn(store, 'deleteActivity')
        .mockRejectedValueOnce(new Error('InvalidStateError: the connection is closing'));
      return Promise.resolve({ store, streams, cleanup });
    });

    const report = await run(open, [bytesSource('ride.gpx', bytes)], { store: failing.store });

    // The rider is told what actually went wrong. Reporting the cleanup's
    // error instead would name the connection when the cause was the disk, and
    // reporting success would be worse than either.
    const outcome = named(report.outcomes, 'ride.gpx');
    expect(outcome.kind).toBe('failed');
    expect(outcome.code).toBe('not-stored');
    expect(outcome.reason).toContain('QuotaExceededError');
    expect(report.imported).toBe(0);
    failing.streams.mockRestore();
    failing.cleanup.mockRestore();

    // And the residue is real: the row is still there, carrying the hash.
    expect(await open.read(async (store) => store.listActivitySummaries(ATHLETE_A))).toHaveLength(
      1,
    );
  });

  it('lets the rider retry a file whose half-written row could not be cleaned up', async () => {
    const open = await openSeeded();
    const bytes = syntheticRide(43);

    const failing = await open.write((store) => {
      const streams = vi
        .spyOn(store, 'putStreamSet')
        .mockRejectedValueOnce(new Error('QuotaExceededError: the device is full'));
      const cleanup = vi
        .spyOn(store, 'deleteActivity')
        .mockRejectedValueOnce(new Error('InvalidStateError: the connection is closing'));
      return Promise.resolve({ store, streams, cleanup });
    });
    await run(open, [bytesSource('ride.gpx', bytes)], { store: failing.store });
    failing.streams.mockRestore();
    failing.cleanup.mockRestore();

    // ⚠️ The defect (#166). The orphan row carries the file's SHA-256, so
    // before this fix the retry below was reported as a duplicate — of a ride
    // with no data — and stayed that way however many times the rider tried,
    // because the row being matched is the broken one. There is no way back
    // from that short of clearing site data.
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

/** A distinct GPX document per index. @see syntheticGpx */
function syntheticRide(index: number): string {
  return syntheticGpx(index);
}
