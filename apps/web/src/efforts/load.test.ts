// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The effort screen's reads (#67) — what the list costs, what the overlay
 * costs, and what happens when a read throws.
 */

import {
  createSegment,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  seconds,
  unixSeconds,
} from '@onyourleft/domain';
import { activityId, athleteId, segmentEffortId, segmentId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { EFFORT_LIMIT, loadHistory, loadOverlay, sampleIndexAt } from './load';
import { stubEffortPort, type StubEffortRide } from './testing';

import type { GeographicPosition } from '@onyourleft/domain';
import type {
  ActivityRecord,
  AthleteId,
  SegmentEffortRecord,
  SegmentRecord,
  StreamSetSummary,
} from '@onyourleft/store';

const OWNER: AthleteId = athleteId('athlete-a');
const OTHER: AthleteId = athleteId('athlete-b');
const SEGMENT = segmentId('segment-1');
const METRES_PER_DEGREE_LATITUDE = 111_194.9;
const ORIGIN = geographicPosition(degreesLatitude(51.5), degreesLongitude(-0.12));

function northOf(metresNorth: number): GeographicPosition {
  return geographicPosition(
    degreesLatitude(ORIGIN.latitude + metresNorth / METRES_PER_DEGREE_LATITUDE),
    degreesLongitude(ORIGIN.longitude),
  );
}

function theSegment(owner: AthleteId = OWNER): SegmentRecord {
  const built = createSegment({
    id: 'segment-1',
    createdBy: owner,
    name: 'The long drag',
    sport: 'ride',
    geometry: [northOf(0), northOf(250), northOf(500)],
    elevationSource: 'none',
    visibility: 'private',
    createdAt: unixSeconds(1_760_000_000),
  });
  return { ...built, id: SEGMENT, createdBy: owner };
}

function ride(id: string, startedAt: number, visibility = 'private'): ActivityRecord {
  return {
    id: activityId(id),
    athleteId: OWNER,
    name: `Ride ${id}`,
    startedAt: unixSeconds(startedAt),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: 3600,
    movingTime: 3400,
    distance: 30_000,
    hasPosition: true,
    visibility,
  } as unknown as ActivityRecord;
}

function effort(
  id: string,
  activity: string,
  startedAt: number,
  elapsedSeconds: number,
  visibility: SegmentEffortRecord['visibility'] = 'public',
): SegmentEffortRecord {
  return {
    id: segmentEffortId(id),
    athleteId: OWNER,
    segmentId: SEGMENT,
    activityId: activityId(activity),
    startedAt: unixSeconds(startedAt),
    elapsed: seconds(elapsedSeconds),
    deviation: metres(5),
    visibility,
    attributes: {},
  };
}

/** A ride whose track runs 500 m north at `metresPerSecond`, sampled every `interval`. */
function tracked(
  id: string,
  startedAt: number,
  metresPerSecond: number,
  interval: number,
): StubEffortRide {
  const track: GeographicPosition[] = [];
  for (let at = 0; at <= 500 / metresPerSecond + 1e-9; at += interval) {
    track.push(northOf(at * metresPerSecond));
  }
  return { activity: ride(id, startedAt), track, sampleIntervalSeconds: interval };
}

describe('the list costs no sample decode — the read budget', () => {
  it('reads the segment, the efforts and one activity per row, and nothing else', () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [
        effort('e1', 'ride-1', 1_760_000_100, 90),
        effort('e2', 'ride-2', 1_760_100_100, 95),
      ],
      rides: [
        { activity: ride('ride-1', 1_760_000_000) },
        { activity: ride('ride-2', 1_760_100_000) },
      ],
    });

    return loadHistory(port, SEGMENT).then((history) => {
      expect(history?.rows).toHaveLength(2);
      // Not one `channel:` and not one `summary:` — the whole point of splitting
      // the two loads.
      expect(port.reads.filter((one) => one.startsWith('channel:'))).toEqual([]);
      expect(port.reads.filter((one) => one.startsWith('summary:'))).toEqual([]);
      expect(port.reads.filter((one) => one.startsWith('activity:'))).toHaveLength(2);
    });
  });

  it('asks for one more than the budget, so truncation is observed rather than inferred', async () => {
    const many = Array.from({ length: EFFORT_LIMIT + 5 }, (_unused, index) =>
      effort(`e${String(index)}`, 'ride-1', 1_760_000_000 + index, 90 + index),
    );
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: many,
      rides: [{ activity: ride('ride-1', 1_760_000_000) }],
    });

    const history = await loadHistory(port, SEGMENT);

    expect(history?.rows).toHaveLength(EFFORT_LIMIT);
    expect(history?.truncated).toBe(true);
  });

  it('does not claim truncation on a library holding exactly the budget', async () => {
    const exactly = Array.from({ length: EFFORT_LIMIT }, (_unused, index) =>
      effort(`e${String(index)}`, 'ride-1', 1_760_000_000 + index, 90 + index),
    );
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: exactly,
      rides: [{ activity: ride('ride-1', 1_760_000_000) }],
    });

    expect((await loadHistory(port, SEGMENT))?.truncated).toBe(false);
  });

  it('keeps a row whose ride has been deleted, rather than silently shortening the list', async () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [effort('e1', 'gone', 1_760_000_100, 90)],
      rides: [],
    });

    const history = await loadHistory(port, SEGMENT);

    expect(history?.rows).toHaveLength(1);
    expect(history?.rows[0]?.activity).toBeUndefined();
  });
});

describe('a personal best survives a privacy-setting change — #67’s sixth criterion', () => {
  it('is still returned after the ride it came from is made private', async () => {
    // ⚠️ Nothing in this path reads an activity's visibility, and the test is
    // what says so. A personal best "must not be a hostage to a visibility
    // toggle": an effort's own three-state visibility is about privacy ZONES,
    // and making a ride private is not a statement about whether it was ridden.
    const best = effort('e1', 'ride-1', 1_760_000_100, 90);
    const before = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [best],
      rides: [{ activity: ride('ride-1', 1_760_000_000, 'public') }],
    });
    const after = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [best],
      rides: [{ activity: ride('ride-1', 1_760_000_000, 'private') }],
    });

    expect((await loadHistory(before, SEGMENT))?.rows.map((row) => row.effort.id)).toEqual(['e1']);
    expect((await loadHistory(after, SEGMENT))?.rows.map((row) => row.effort.id)).toEqual(['e1']);
  });

  it('lists a private-match effort, because it is the athlete’s own data', async () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [effort('hidden', 'ride-1', 1_760_000_100, 88, 'private-match')],
      rides: [{ activity: ride('ride-1', 1_760_000_000) }],
    });

    expect((await loadHistory(port, SEGMENT))?.rows[0]?.effort.visibility).toBe('private-match');
  });
});

describe('the segment is athlete-scoped', () => {
  it('finds nothing for a segment belonging to somebody else', async () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment(OTHER)],
      efforts: [],
      rides: [],
    });

    expect(await loadHistory(port, SEGMENT)).toBeUndefined();
  });
});

describe('the overlay’s reads, and its refusals', () => {
  it('costs one summary and two channels per activity — six, never a whole set', async () => {
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [],
      rides: [tracked('ride-1', 1_760_000_000, 10, 1), tracked('ride-2', 1_760_100_000, 8, 5)],
    });

    const result = await loadOverlay(
      port,
      effort('e1', 'ride-1', 1_760_000_000, 50),
      effort('e2', 'ride-2', 1_760_100_000, 62),
    );

    expect(result.kind).toBe('comparison');
    expect(port.reads.filter((one) => one.startsWith('summary:'))).toHaveLength(2);
    const channels = port.reads.filter((one) => one.startsWith('channel:'));
    expect(channels).toHaveLength(4);
    for (const read of channels) {
      expect(read.startsWith('channel:latitude') || read.startsWith('channel:longitude')).toBe(
        true,
      );
    }
  });

  it('compares two efforts recorded at DIFFERENT rates without truncating either', async () => {
    // #67's second criterion, end to end through the store port.
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [],
      rides: [tracked('ride-1', 1_760_000_000, 10, 1), tracked('ride-2', 1_760_100_000, 8, 5)],
    });

    const result = await loadOverlay(
      port,
      effort('e1', 'ride-1', 1_760_000_000, 50),
      effort('e2', 'ride-2', 1_760_100_000, 62),
    );

    expect(result.kind).toBe('comparison');
    if (result.kind !== 'comparison') {
      return;
    }
    expect(result.comparison.first.sampleIntervalSeconds).toBeCloseTo(1, 3);
    expect(result.comparison.second.sampleIntervalSeconds).toBeCloseTo(5, 3);
    expect(result.comparison.first.points.length).not.toBe(result.comparison.second.points.length);
    expect(result.comparison.durationDelta).toBeGreaterThan(0);
  });

  it('names the rides that had no track, rather than drawing an empty chart', async () => {
    // The ordinary case: an indoor ride records no position, and most rides in
    // the v0.1 milestone are indoor.
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [],
      rides: [
        tracked('ride-1', 1_760_000_000, 10, 1),
        { activity: ride('indoors', 1_760_200_000) },
      ],
    });

    const result = await loadOverlay(
      port,
      effort('e1', 'ride-1', 1_760_000_000, 50),
      effort('e2', 'indoors', 1_760_200_000, 60),
    );

    expect(result.kind).toBe('no-track');
    if (result.kind === 'no-track') {
      expect(result.missing).toEqual([activityId('indoors')]);
    }
  });
});

describe('the sample index, which is derived rather than stored', () => {
  const summary: StreamSetSummary = {
    activityId: activityId('ride-1'),
    athleteId: OWNER,
    startedAt: unixSeconds(1_000),
    sampleInterval: seconds(1),
    sampleCount: 100,
    channels: ['latitude'],
    encodedBytes: 8,
  };

  it('maps an instant back to the sample it came from', () => {
    expect(sampleIndexAt(summary, unixSeconds(1_000))).toBe(0);
    expect(sampleIndexAt(summary, unixSeconds(1_042))).toBe(42);
  });

  it('rounds rather than floors, because the instants came off this grid', () => {
    // Flooring turns 41.999999 into sample 41 — an off-by-one that only shows
    // up on a ride whose interval does not divide the numbers cleanly.
    expect(sampleIndexAt(summary, unixSeconds(1_041.999_999))).toBe(42);
  });

  it('clamps rather than reading out of range', () => {
    expect(sampleIndexAt(summary, unixSeconds(0))).toBe(0);
    expect(sampleIndexAt(summary, unixSeconds(999_999))).toBe(99);
  });

  it('is index zero for a set with no interval, rather than dividing by zero', () => {
    expect(sampleIndexAt({ ...summary, sampleInterval: seconds(0) }, unixSeconds(5_000))).toBe(0);
  });
});

describe('a failing read is a sentence, not a blank screen — #67’s seventh criterion', () => {
  it('rejects rather than resolving with a half-built history', async () => {
    // There is no network in Phase 1, so what the criterion asks is that a
    // failing read propagate somewhere the view can catch it. The view turns
    // this into a message; swallowing it here would leave a permanent spinner.
    const port = stubEffortPort({
      athleteId: OWNER,
      segments: [theSegment()],
      efforts: [effort('e1', 'ride-1', 1_760_000_100, 90)],
      rides: [{ activity: ride('ride-1', 1_760_000_000) }],
    });
    port.failNextRead = true;

    await expect(loadHistory(port, SEGMENT)).rejects.toThrow();
  });
});
