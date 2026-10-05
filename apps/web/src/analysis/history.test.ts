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

  it('counts a ride it cannot summarise as having nothing to work out, so the remainder can reach zero', async () => {
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
    expect(outcome.nothingToWorkOut).toBe(1);
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

describe('#1070 — a power channel that read 0 W is no basis for a load', () => {
  /** A ride stored before #1070 from an all-zero power channel. */
  function storedAtZero(id: string, offset: number, extra: Partial<StubAnalysisRide> = {}) {
    return {
      activity: stubActivity({
        id: activityId(id),
        startedAt: unixSeconds(START + offset * DAY),
        startedAtTimeZone: 'UTC',
        effortWeightedPower: watts(0),
        loadCoveredTime: seconds(600),
      }),
      power: Array.from({ length: 600 }, () => watts(0)),
      ...extra,
    };
  }

  it('counts a ride stored at 0 W as having no load, not as a rest day', async () => {
    const port = stubAnalysis(OWNER, [summarised('real', 0), storedAtZero('zero', 1)]);

    const history = await loadFitnessHistory(port);

    expect(history.ridesCounted).toBe(1);
    expect(history.ridesWithoutSummary).toBe(1);
  });

  it('backfills a ride stored at 0 W from its heart-rate strap', async () => {
    const port = stubAnalysis(OWNER, [
      storedAtZero('zero', 0, {
        heartRate: Array.from({ length: 600 }, () => beatsPerMinute(150)),
      }),
    ]);

    const outcome = await backfillLoadSummaries(port);
    const history = await loadFitnessHistory(port);

    expect(outcome.computed).toBe(1);
    expect(port.summaryWrites).toEqual(['zero']);
    // Read back fresh: the stale 0 W is still on the row beside the new
    // heart-rate figure, and it is the read rule that keeps it out.
    expect(history.ridesCounted).toBe(1);
    expect(history.ridesWithoutSummary).toBe(0);
    expect(history.bases).toEqual(['heartRate']);
  });

  it('summarises an unsummarised all-zero power ride from heart rate', async () => {
    const port = stubAnalysis(OWNER, [
      unsummarised('zero', 0, {
        power: Array.from({ length: 600 }, () => watts(0)),
        heartRate: Array.from({ length: 600 }, () => beatsPerMinute(150)),
      }),
    ]);

    await backfillLoadSummaries(port);
    const history = await loadFitnessHistory(port);

    expect(history.bases).toEqual(['heartRate']);
  });

  it('marks an all-zero power ride with no strap as having nothing to work out — #1084', async () => {
    const port = stubAnalysis(OWNER, [
      unsummarised('zero', 0, { power: Array.from({ length: 600 }, () => watts(0)) }),
    ]);

    const outcome = await backfillLoadSummaries(port);

    expect(outcome.computed).toBe(0);
    expect(outcome.nothingToWorkOut).toBe(1);
    // The marker, not a summary: no basis, a load covering no time.
    expect(port.summaryWrites).toEqual(['zero']);
    const history = await loadFitnessHistory(port);
    expect(history.ridesCounted).toBe(0);
    expect(history.ridesWithoutSummary).toBe(0);
    expect(history.ridesWithNoLoad).toBe(1);
  });

  it('still reads only power for a ride whose power gave a summary', async () => {
    const port = stubAnalysis(OWNER, [
      unsummarised('real', 0, {
        heartRate: Array.from({ length: 600 }, () => beatsPerMinute(150)),
      }),
    ]);

    await backfillLoadSummaries(port);

    expect(port.channelReads).toEqual(['real:power']);
  });
});

describe('#1084 — a ride that can never have a load is found once, not on every pass', () => {
  /** A ride stored before #1084 with nothing a load could come from. */
  function nothingIn(id: string, offset: number, extra: Partial<StubAnalysisRide> = {}) {
    return unsummarised(id, offset, {
      power: Array.from({ length: 5 }, () => watts(200)),
      ...extra,
    });
  }

  it('decodes and counts it on the first pass only', async () => {
    const port = stubAnalysis(OWNER, [nothingIn('brief', 0), unsummarised('real', 1)]);

    const first = await backfillLoadSummaries(port);
    expect(first).toEqual({ computed: 1, nothingToWorkOut: 1, noStreamsYet: 0, remaining: 0 });
    const decodedOnce = port.channelReads.length;

    const second = await backfillLoadSummaries(port);
    expect(second).toEqual({ computed: 0, nothingToWorkOut: 0, noStreamsYet: 0, remaining: 0 });
    // Nothing was decoded again: the marked ride is not selected.
    expect(port.channelReads).toHaveLength(decodedOnce);
  });

  it('leaves a ride with no stream set unmarked, so a save still in progress is looked at again', async () => {
    // ADR 0027: a tab on an older bundle writes a bare activity row, then its
    // streams. A pass between the two must not mark the ride for ever.
    const saving: StubAnalysisRide = {
      activity: stubActivity({
        id: activityId('saving'),
        startedAt: unixSeconds(START),
        startedAtTimeZone: 'UTC',
      }),
    };
    // Mutable: the stub reads this list on every call, so replacing the entry
    // is the streams landing.
    const rides: StubAnalysisRide[] = [saving];
    const port = stubAnalysis(OWNER, rides);

    const first = await backfillLoadSummaries(port);
    expect(first).toEqual({ computed: 0, nothingToWorkOut: 0, noStreamsYet: 1, remaining: 0 });
    expect(port.summaryWrites).toEqual([]);
    const between = await loadFitnessHistory(port);
    expect(between.ridesWithNoLoad).toBe(0);
    expect(between.ridesWithoutSummary).toBe(1);

    // The older tab's streams land; the next pass works the ride out.
    rides[0] = { ...saving, power: Array.from({ length: 600 }, () => watts(200)) };
    const second = await backfillLoadSummaries(port);
    expect(second).toEqual({ computed: 1, nothingToWorkOut: 0, noStreamsYet: 0, remaining: 0 });
    expect((await loadFitnessHistory(port)).ridesCounted).toBe(1);
  });

  it('does not let rides with no stream set use up the batch', async () => {
    const bare = (id: string, offset: number): StubAnalysisRide => ({
      activity: stubActivity({
        id: activityId(id),
        startedAt: unixSeconds(START + offset * DAY),
        startedAtTimeZone: 'UTC',
      }),
    });
    const port = stubAnalysis(OWNER, [bare('a', 0), bare('b', 1), unsummarised('real', 2)]);

    const outcome = await backfillLoadSummaries(port, 1);

    expect(outcome).toEqual({ computed: 1, nothingToWorkOut: 0, noStreamsYet: 2, remaining: 0 });
  });

  it('works a stale 0 W ride out from its strap, and marks one with no strap', async () => {
    const stale = (id: string, offset: number, extra: Partial<StubAnalysisRide> = {}) => ({
      activity: stubActivity({
        id: activityId(id),
        startedAt: unixSeconds(START + offset * DAY),
        startedAtTimeZone: 'UTC',
        effortWeightedPower: watts(0),
        loadCoveredTime: seconds(600),
      }),
      power: Array.from({ length: 600 }, () => watts(0)),
      ...extra,
    });
    const port = stubAnalysis(OWNER, [
      stale('strap', 0, { heartRate: Array.from({ length: 600 }, () => beatsPerMinute(150)) }),
      stale('bare', 1),
    ]);

    const outcome = await backfillLoadSummaries(port);
    const history = await loadFitnessHistory(port);

    expect(outcome).toEqual({ computed: 1, nothingToWorkOut: 1, noStreamsYet: 0, remaining: 0 });
    expect(history.ridesCounted).toBe(1);
    expect(history.ridesWithNoLoad).toBe(1);
    expect(history.ridesWithoutSummary).toBe(0);
    expect((await backfillLoadSummaries(port)).nothingToWorkOut).toBe(0);
  });

  it('still offers to work out a ride nobody has looked at yet', async () => {
    const port = stubAnalysis(OWNER, [unsummarised('later', 0)]);

    const history = await loadFitnessHistory(port);

    expect(history.ridesWithoutSummary).toBe(1);
    expect(history.ridesWithNoLoad).toBe(0);
  });
});
