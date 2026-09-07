// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #77's seventh criterion is a **budget**, so most of this file counts things.
 *
 * *"Rendering the full history of a 1,000-activity library issues a bounded
 * number of store reads, asserted by a counter, and does not load stream data
 * for any activity."* The stub port counts both, and the assertions below are
 * on the counters rather than on how long anything took.
 */

import { beatsPerMinute, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { activityId, athleteId as toAthleteId } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { stubActivity } from '../detail/testing';

import {
  BACKFILL_BATCH,
  backfillLoadSummaries,
  HISTORY_ACTIVITY_LIMIT,
  loadFitnessHistory,
} from './history';
import { stubAnalysis, type StubAnalysisRide } from './testing';

const OWNER = toAthleteId('athlete-a');
const DAY = 86_400;
/** 2026-09-07T12:00:00Z — midday, so a ±11 h zone does not move the date. */
const START = 1_788_782_400;

/** A ride that already carries a load summary, `offset` days in. */
function summarised(id: string, offset: number, weighted = 200): StubAnalysisRide {
  return {
    activity: stubActivity({
      id: activityId(id),
      startedAt: unixSeconds(START + offset * DAY),
      startedAtTimeZone: 'UTC',
      effortWeightedPower: watts(weighted),
      loadCoveredTime: seconds(3600),
    }),
  };
}

/** A ride with samples but no stored summary — imported before #77. */
function unsummarised(id: string, offset: number, extra: Partial<StubAnalysisRide> = {}) {
  return {
    activity: stubActivity({
      id: activityId(id),
      startedAt: unixSeconds(START + offset * DAY),
      startedAtTimeZone: 'UTC',
    }),
    power: Array.from({ length: 600 }, () => watts(200)),
    ...extra,
  };
}

describe('loadFitnessHistory — the read budget', () => {
  it('reads the list once and decodes no channel, over a thousand rides', () => {
    // The criterion, literally. A thousand rides is one read and zero decodes
    // because each ride carries the expensive half of its load already.
    const rides = Array.from({ length: 1000 }, (_unused, index) =>
      summarised(`ride-${String(index)}`, index),
    );
    const port = stubAnalysis(OWNER, rides);

    return loadFitnessHistory(port).then(() => {
      expect(port.listReads).toHaveLength(1);
      expect(port.channelReads).toEqual([]);
      expect(port.summaryReads).toEqual([]);
    });
  });

  it('bounds the read and says when the bound bit', async () => {
    const rides = Array.from({ length: 5 }, (_unused, index) =>
      summarised(`ride-${String(index)}`, index),
    );
    const port = stubAnalysis(OWNER, rides);

    const history = await loadFitnessHistory(port, 3);

    expect(history.truncated).toBe(true);
    expect(port.listReads[0]?.limit).toBe(4);
  });

  it('reads oldest first, so a truncation drops old history and not recent form', async () => {
    // The averages build forward from the first ride, so the recent end is the
    // part that must survive.
    const port = stubAnalysis(OWNER, [summarised('old', 0), summarised('new', 30)]);

    await loadFitnessHistory(port);

    expect(port.listReads[0]?.direction).toBe('ascending');
  });

  it('defaults to the stated bound', async () => {
    const port = stubAnalysis(OWNER, []);
    await loadFitnessHistory(port);
    expect(port.listReads[0]?.limit).toBe(HISTORY_ACTIVITY_LIMIT + 1);
  });
});

describe('loadFitnessHistory — what it can and cannot count', () => {
  it('counts a ride with no summary rather than scoring it as a rest day', () => {
    // The distinction the whole chart turns on: a day with no ride is zero
    // load, and a ride we have not measured is not.
    const port = stubAnalysis(OWNER, [summarised('has', 0), unsummarised('has-not', 1)]);

    return loadFitnessHistory(port).then((history) => {
      expect(history.ridesCounted).toBe(1);
      expect(history.ridesWithoutSummary).toBe(1);
    });
  });

  it('states the basis, and states it as a set when the history is mixed', async () => {
    // #77's eighth criterion. "Power" would be false for part of the line on a
    // history that has both.
    const powered = summarised('powered', 0);
    const strapped: StubAnalysisRide = {
      activity: stubActivity({
        id: activityId('strapped'),
        startedAt: unixSeconds(START + DAY),
        startedAtTimeZone: 'UTC',
        effortWeightedHeartRate: beatsPerMinute(150),
        loadCoveredTime: seconds(3600),
      }),
    };
    const port = stubAnalysis(OWNER, [powered, strapped]);

    const history = await loadFitnessHistory(port);

    expect([...history.bases].sort()).toEqual(['heartRate', 'power']);
  });

  it('moves every point when the athlete’s threshold moves', async () => {
    // The reason the load is derived rather than stored: a rider who corrects
    // their threshold gets a corrected history, not a stale one.
    const rides = Array.from({ length: 30 }, (_unused, index) =>
      summarised(`ride-${String(index)}`, index),
    );
    const athlete = {
      id: OWNER,
      displayName: 'A',
      createdAt: unixSeconds(START),
      thresholdPower: watts(400),
    };

    const atDefault = await loadFitnessHistory(stubAnalysis(OWNER, rides));
    const atHigher = await loadFitnessHistory(stubAnalysis(OWNER, rides, athlete));

    // 200 W is threshold at the 200 W default and half of 400, so a quarter of
    // the load — and every point of the series with it.
    expect(atHigher.points.at(-1)?.base).toBeCloseTo((atDefault.points.at(-1)?.base ?? 0) / 4, 6);
  });

  it('is an empty series for a library with no measurable rides', async () => {
    const port = stubAnalysis(OWNER, [unsummarised('ride-1', 0)]);

    const history = await loadFitnessHistory(port);

    expect(history.points).toEqual([]);
    expect(history.ridesWithoutSummary).toBe(1);
  });
});

describe('backfillLoadSummaries — the explicit act', () => {
  it('computes the missing summaries and writes them back', async () => {
    const port = stubAnalysis(OWNER, [unsummarised('ride-1', 0), unsummarised('ride-2', 1)]);

    const outcome = await backfillLoadSummaries(port);

    expect(outcome.computed).toBe(2);
    expect(outcome.remaining).toBe(0);
    expect(port.summaryWrites).toEqual(['ride-1', 'ride-2']);

    // And the history can now count them, on a fresh read.
    const history = await loadFitnessHistory(port);
    expect(history.ridesCounted).toBe(2);
    expect(history.ridesWithoutSummary).toBe(0);
  });

  it('leaves a ride that already has one alone', async () => {
    const port = stubAnalysis(OWNER, [summarised('done', 0), unsummarised('todo', 1)]);

    const outcome = await backfillLoadSummaries(port);

    expect(outcome.computed).toBe(1);
    expect(port.summaryWrites).toEqual(['todo']);
  });

  it('stops at the batch size and says how many are left', async () => {
    // Responsive rather than fast: the rider sees it finish and sees the
    // remainder, instead of watching a frozen screen.
    const rides = Array.from({ length: 5 }, (_unused, index) =>
      unsummarised(`ride-${String(index)}`, index),
    );
    const port = stubAnalysis(OWNER, rides);

    const outcome = await backfillLoadSummaries(port, 2);

    expect(outcome.computed).toBe(2);
    expect(outcome.remaining).toBe(3);
    expect(port.summaryWrites).toHaveLength(2);
  });

  it('counts a ride it cannot summarise as skipped, so the remainder can reach zero', async () => {
    // A ride shorter than the smoothing window will never produce a summary.
    // Retrying it forever would make the control never finish, and a control
    // that never finishes is one a rider learns to ignore.
    const tooShort = {
      activity: stubActivity({
        id: activityId('brief'),
        startedAt: unixSeconds(START),
        startedAtTimeZone: 'UTC',
      }),
      power: Array.from({ length: 5 }, () => watts(200)),
    };
    const port = stubAnalysis(OWNER, [tooShort]);

    const outcome = await backfillLoadSummaries(port);

    expect(outcome.computed).toBe(0);
    expect(outcome.skipped).toBe(1);
    expect(outcome.remaining).toBe(0);
  });

  it('falls back to heart rate for a ride with no power', async () => {
    const strapOnly = {
      activity: stubActivity({
        id: activityId('strap'),
        startedAt: unixSeconds(START),
        startedAtTimeZone: 'UTC',
      }),
      heartRate: Array.from({ length: 600 }, () => beatsPerMinute(150)),
    };
    const port = stubAnalysis(OWNER, [strapOnly]);

    await backfillLoadSummaries(port);
    const history = await loadFitnessHistory(port);

    expect(history.bases).toEqual(['heartRate']);
  });

  it('has a stated batch size', () => {
    expect(BACKFILL_BATCH).toBe(50);
  });
});
