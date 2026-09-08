// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The sweep (#66) — resumable, idempotent, bounded in what it reads, and
 * measured.
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

import { indexSegments, sweepLibrary, SWEEP_PAGE_SIZE } from './backfill';
import { stubMatchPort, type StubMatchRide } from './match-testing';

import type {
  ActivityRecord,
  AthleteId,
  MatchCheckpointRecord,
  PrivacyZoneRecord,
  SegmentRecord,
} from '@onyourleft/store';

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

/**
 * A ride that traverses the segment, with a short run-in.
 *
 * The run-in matters: `sampleHeading` needs a previous position, so a ride
 * beginning exactly on the segment's first point has no direction there and the
 * endpoint gate correctly refuses it.
 */
function traversingRide(index: number, startedAt = 1_760_000_000 + index * 86_400): StubMatchRide {
  const leadIn = [4, 3, 2, 1].map((back) => northOf(ORIGIN, -back * 20));
  return { activity: rideRecord(index, startedAt), track: [...leadIn, ...northboundPath(26)] };
}

function libraryOf(count: number): StubMatchRide[] {
  return Array.from({ length: count }, (_unused, index) => traversingRide(index));
}

/** Run the sweep to exhaustion, returning every step. */
async function sweepToEnd(
  port: ReturnType<typeof stubMatchPort>,
  corpus: ReturnType<typeof indexSegments>,
  from?: MatchCheckpointRecord,
): Promise<{ efforts: number; steps: number }> {
  let cursor = from;
  let efforts = 0;
  let steps = 0;
  for (;;) {
    const step = await sweepLibrary({
      athleteId: OWNER,
      store: port.store,
      corpus,
      ...(cursor === undefined ? {} : { from: cursor }),
    });
    efforts += step.efforts;
    steps += 1;
    if (step.done || step.checkpoint === undefined) {
      break;
    }
    cursor = step.checkpoint;
  }
  return { efforts, steps };
}

describe('the sweep finds efforts, and tells the truth about how many', () => {
  it('matches every ride in the library that traversed the segment', async () => {
    const port = stubMatchPort({ athleteId: OWNER, rides: libraryOf(3), segments: [theSegment()] });
    const corpus = indexSegments([theSegment()]);

    const { efforts } = await sweepToEnd(port, corpus);

    expect(efforts).toBe(3);
    expect(port.stored.size).toBe(3);
  });

  it('writes an EMPTY effort set for a ride with no track, rather than skipping it', async () => {
    // An indoor-trainer session, which is most rides in the v0.1 milestone. The
    // empty write matters: a re-sweep after the rider deleted a segment has to
    // be able to REMOVE what a previous sweep found, and an activity the sweep
    // silently steps over never gets that chance.
    const indoors: StubMatchRide = { activity: rideRecord(9, 1_760_500_000) };
    const port = stubMatchPort({
      athleteId: OWNER,
      rides: [traversingRide(0), indoors],
      segments: [theSegment()],
    });

    await sweepToEnd(port, indexSegments([theSegment()]));

    expect(port.writes.map((write) => write.activityId)).toContain(indoors.activity.id);
  });

  it('does nothing at all when the corpus is empty', async () => {
    const port = stubMatchPort({ athleteId: OWNER, rides: libraryOf(3) });
    const step = await sweepLibrary({ athleteId: OWNER, store: port.store, corpus: [] });

    expect(step).toEqual({
      swept: 0,
      efforts: 0,
      abandoned: [],
      checkpoint: undefined,
      done: true,
    });
    expect(port.reads).toEqual([]);
  });
});

describe('resuming — #66’s fifth criterion', () => {
  it('an interrupted-then-resumed run produces the same effort count as a clean run', async () => {
    // ⚠️ The criterion, in its literal form. The interruption is a thrown write
    // part-way through, which is what a closed tab looks like from here.
    const rides = libraryOf(SWEEP_PAGE_SIZE * 2 + 3);
    const corpus = indexSegments([theSegment()]);

    const clean = stubMatchPort({ athleteId: OWNER, rides, segments: [theSegment()] });
    const cleanRun = await sweepToEnd(clean, corpus);

    const interrupted = stubMatchPort({ athleteId: OWNER, rides, segments: [theSegment()] });
    const first = await sweepLibrary({ athleteId: OWNER, store: interrupted.store, corpus });
    expect(first.checkpoint).toBeDefined();
    // The tab closes during the second page.
    interrupted.failNextWrite = true;
    await expect(
      sweepLibrary({
        athleteId: OWNER,
        store: interrupted.store,
        corpus,
        ...(first.checkpoint === undefined ? {} : { from: first.checkpoint }),
      }),
    ).rejects.toThrow();
    // …and the sweep resumes from the last checkpoint it managed to record.
    await sweepToEnd(interrupted, corpus, first.checkpoint);

    expect(interrupted.stored.size).toBe(clean.stored.size);
    expect(interrupted.stored.size).toBe(rides.length);
    expect(cleanRun.efforts).toBe(rides.length);
  });

  it('resuming from a checkpoint does not re-read the activity it stopped on', async () => {
    // The cursor is strictly after `lastStartedAt`. Without that a library whose
    // final page holds one ride never terminates.
    const port = stubMatchPort({
      athleteId: OWNER,
      rides: libraryOf(SWEEP_PAGE_SIZE + 1),
      segments: [theSegment()],
    });
    const corpus = indexSegments([theSegment()]);

    const first = await sweepLibrary({ athleteId: OWNER, store: port.store, corpus });
    expect(first.swept).toBe(SWEEP_PAGE_SIZE);
    const second = await sweepLibrary({
      athleteId: OWNER,
      store: port.store,
      corpus,
      ...(first.checkpoint === undefined ? {} : { from: first.checkpoint }),
    });

    expect(second.swept).toBe(1);
    expect(second.done).toBe(true);
    expect(second.checkpoint).toBeUndefined();
  });

  it('re-sweeping the whole library three times leaves the effort count unchanged', async () => {
    // #66's sixth criterion at the sweep's level, where the store's own test
    // proves the same thing at the write's.
    const port = stubMatchPort({
      athleteId: OWNER,
      rides: libraryOf(4),
      segments: [theSegment()],
    });
    const corpus = indexSegments([theSegment()]);

    for (let run = 0; run < 3; run += 1) {
      await sweepToEnd(port, corpus);
    }

    expect(port.stored.size).toBe(4);
  });
});

describe('what the sweep reads per activity — the bound', () => {
  it('reads one summary and two channels per ride, and never a whole stream set', async () => {
    // Decoding power, heart rate, cadence, speed and temperature to find out
    // whether a rider went up a hill is the cost the port exists to refuse.
    const port = stubMatchPort({
      athleteId: OWNER,
      rides: libraryOf(2),
      segments: [theSegment()],
    });

    await sweepToEnd(port, indexSegments([theSegment()]));

    const channelReads = port.reads.filter((read) => read.startsWith('channel:'));
    expect(channelReads).toHaveLength(4);
    for (const read of channelReads) {
      expect(read.startsWith('channel:latitude') || read.startsWith('channel:longitude')).toBe(
        true,
      );
    }
  });

  it('reads the athlete and the zones once per STEP, not once per ride', async () => {
    // Both are properties of the athlete rather than of the ride, so reading
    // them inside the loop would multiply a library-sized sweep by two reads.
    const port = stubMatchPort({
      athleteId: OWNER,
      rides: libraryOf(5),
      segments: [theSegment()],
    });

    await sweepLibrary({
      athleteId: OWNER,
      store: port.store,
      corpus: indexSegments([theSegment()]),
    });

    expect(port.reads.filter((read) => read.startsWith('athlete:'))).toHaveLength(1);
    expect(port.reads.filter((read) => read.startsWith('zones:'))).toHaveLength(1);
  });
});

describe('a recording gap, and telling the athlete why — #66’s fourth criterion', () => {
  it('a gap across the middle of the segment yields no effort, and says so', async () => {
    // ⚠️ The gap is a run of ABSENT samples, which is how a gap actually
    // reaches the store. `backfill.ts` reconstructs the times from the sample
    // index, so dropping those samples advances the clock without producing a
    // position — which is the time jump the matcher's gap check sees. Rebuilding
    // the times as 0,1,2,… over the kept samples instead would erase every gap
    // in the library and silently bridge them.
    const leadIn = [4, 3, 2, 1].map((back) => northOf(ORIGIN, -back * 20));
    const path = northboundPath(26);
    const holed = [
      ...path.slice(0, 12),
      ...Array.from({ length: 40 }, () => undefined),
      ...path.slice(12),
    ];
    const port = stubMatchPort({
      athleteId: OWNER,
      rides: [{ activity: rideRecord(0, 1_760_000_000), track: [...leadIn, ...holed] }],
      segments: [theSegment()],
    });

    const step = await sweepLibrary({
      athleteId: OWNER,
      store: port.store,
      corpus: indexSegments([theSegment()]),
    });

    expect(step.efforts).toBe(0);
    expect(step.abandoned).toEqual([
      { activityId: activityId('ride-0'), segmentId: 'segment-1', reason: 'recording-gap' },
    ]);
  });
});

describe('privacy and frozen attributes reach the stored effort', () => {
  it('an effort whose start is inside a zone is stored as private-match', async () => {
    const zone: PrivacyZoneRecord = {
      id: 'zone-1',
      athleteId: OWNER,
      centre: ORIGIN,
      radius: 200,
      label: 'home',
      createdAt: unixSeconds(1),
    } as unknown as PrivacyZoneRecord;
    const port = stubMatchPort({
      athleteId: OWNER,
      rides: [traversingRide(0)],
      segments: [theSegment()],
      zones: [zone],
    });

    await sweepToEnd(port, indexSegments([theSegment()]));

    expect([...port.stored.values()][0]?.visibility).toBe('private-match');
  });

  it('the athlete’s recorded mass is copied onto the effort', async () => {
    const port = stubMatchPort({
      athleteId: OWNER,
      athlete: {
        id: OWNER,
        displayName: 'A',
        createdAt: unixSeconds(1),
        mass: 78,
      } as unknown as Parameters<typeof stubMatchPort>[0]['athlete'],
      rides: [traversingRide(0)],
      segments: [theSegment()],
    });

    await sweepToEnd(port, indexSegments([theSegment()]));

    expect([...port.stored.values()][0]?.attributes.riderMass).toBe(78);
  });
});

describe('the measured budget — #66’s fifth criterion', () => {
  it(
    'sweeps a 1,000-activity library within its stated budget',
    // ⚠️ The budget is a **Vitest timeout**, not a clock the code reads — the
    // pattern `packages/domain`'s power-duration test established, and for the
    // same reason: the code under test still cannot tell the time. What the
    // number pins is the COMPLEXITY. The sweep is linear in the library and the
    // matcher is linear in the ride against a prefiltered corpus, so a
    // regression to anything quadratic fails this by orders of magnitude rather
    // than by a few per cent, which is the only way a wall-clock assertion is
    // worth having. Measured at roughly 1.4 s in this container against a 30 s
    // budget; the headroom is deliberate, because an assertion tuned near the
    // observed value is a flake on a loaded runner (#165's lesson).
    { timeout: 30_000 },
    async () => {
      const port = stubMatchPort({
        athleteId: OWNER,
        rides: libraryOf(1000),
        segments: [theSegment()],
      });

      const { efforts, steps } = await sweepToEnd(port, indexSegments([theSegment()]));

      expect(efforts).toBe(1000);
      expect(port.stored.size).toBe(1000);
      // 1000 / 25 = 40 pages, and a 41st that comes back short and ends it.
      expect(steps).toBe(41);
    },
  );
});
