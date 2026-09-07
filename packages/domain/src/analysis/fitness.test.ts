// SPDX-License-Identifier: Apache-2.0

import { unixSeconds, type UnixSeconds } from '../quantities';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BASE_DAYS,
  DEFAULT_RECENT_DAYS,
  dailyLoads,
  fitnessSeries,
  localDay,
  seriesSpan,
  type DailyLoad,
  type LoadEntry,
} from './fitness';

/** 2026-09-07T12:00:00Z — midday UTC, so no zone within ±11 h changes the date. */
const MIDDAY = unixSeconds(1_788_782_400);

describe('localDay — the calendar, in the zone the ride happened in', () => {
  it('formats a civil date as YYYY-MM-DD', () => {
    expect(localDay(MIDDAY, 'UTC')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('puts a late-evening ride on the day the rider had, not the viewer’s', () => {
    // #77's first criterion, and the bug it names: "a ride that moves between
    // days when the athlete travels is the bug users report as 'my chart
    // changed by itself'". 23:30 in Auckland is still the previous day in UTC.
    const lateInAuckland = unixSeconds(1_788_820_200); // 2026-09-07T22:30:00Z

    const auckland = localDay(lateInAuckland, 'Pacific/Auckland');
    const utc = localDay(lateInAuckland, 'UTC');

    expect(auckland).not.toBe(utc);
    // The ride is on the 8th for the rider who did it and the 7th in UTC.
    expect(auckland > utc).toBe(true);
  });

  it('puts an early-morning ride west of UTC on the previous civil day', () => {
    // The other direction, so the test cannot pass by always rounding up.
    const earlyInLosAngeles = unixSeconds(1_788_760_800); // 2026-09-07T06:00:00Z

    expect(localDay(earlyInLosAngeles, 'America/Los_Angeles')).toBe('2026-09-06');
    expect(localDay(earlyInLosAngeles, 'UTC')).toBe('2026-09-07');
  });

  it('falls back to UTC for a zone this runtime cannot resolve', () => {
    // A hand-edited row, or a zone this browser's ICU does not carry. A chart
    // that refused to plot the ride would be worse than one that plots it a
    // few hours out.
    expect(localDay(MIDDAY, 'Mars/Olympus_Mons')).toBe(localDay(MIDDAY, 'UTC'));
  });
});

describe('dailyLoads', () => {
  function entry(startedAt: UnixSeconds, load: number, timeZone = 'UTC'): LoadEntry {
    return { startedAt, timeZone, load };
  }

  it('sums several rides on one day into one day', () => {
    // #77's third criterion. Two rides on a Saturday are one Saturday; a series
    // that kept them apart would decay twice for a day that happened once.
    const morning = unixSeconds(1_788_760_800); // 06:00Z
    const lunchtime = MIDDAY; // 12:00Z
    const evening = unixSeconds(1_788_804_000); // 18:00Z

    const daily = dailyLoads([entry(morning, 30), entry(lunchtime, 45), entry(evening, 25)]);

    expect(daily).toEqual([{ day: '2026-09-07', load: 100 }]);
  });

  it('is ascending by day', () => {
    const later = unixSeconds(MIDDAY + 86_400 * 3);
    const daily = dailyLoads([entry(later, 10), entry(MIDDAY, 20)]);

    expect(daily.map((point) => point.day)).toEqual(['2026-09-07', '2026-09-10']);
  });

  it('lists only the days that carry a ride', () => {
    // The gaps are filled by `fitnessSeries`, which is where filling them means
    // something. Filling them here would make an empty history a thousand rows.
    const later = unixSeconds(MIDDAY + 86_400 * 10);

    expect(dailyLoads([entry(MIDDAY, 10), entry(later, 10)])).toHaveLength(2);
  });

  it('groups by each ride’s own zone, not by one shared zone', () => {
    // Two rides four hours apart that fall on different civil days, because
    // the rider flew. Both must land where the rider was.
    const evening = unixSeconds(1_788_820_200); // 22:30Z
    const daily = dailyLoads([
      entry(evening, 10, 'Pacific/Auckland'),
      entry(evening, 20, 'America/Los_Angeles'),
    ]);

    expect(daily).toHaveLength(2);
    expect(daily.map((point) => point.load)).toEqual([20, 10]);
  });

  it('is empty for no rides', () => {
    expect(dailyLoads([])).toEqual([]);
  });
});

describe('fitnessSeries — the calendar walk', () => {
  /** A day key `offset` days after 2026-09-07. */
  function day(offset: number): string {
    return localDay(unixSeconds(MIDDAY + offset * 86_400), 'UTC');
  }

  it('emits a point for every day between the first ride and the last', () => {
    // #77's second criterion, and the defect it names: "a series that only
    // iterates over days that have rides does not decay at all and is the most
    // common way this chart is wrong."
    const daily: DailyLoad[] = [
      { day: day(0), load: 100 },
      { day: day(9), load: 100 },
    ];

    const series = fitnessSeries(daily);

    expect(series).toHaveLength(10);
    expect(series.map((point) => point.day)).toEqual(
      Array.from({ length: 10 }, (_unused, offset) => day(offset)),
    );
  });

  it('scores a day with no ride as zero load, which is a real value', () => {
    const series = fitnessSeries([
      { day: day(0), load: 100 },
      { day: day(3), load: 50 },
    ]);

    expect(series[1]?.load).toBe(0);
    expect(series[2]?.load).toBe(0);
    expect(series[3]?.load).toBe(50);
  });

  it('lets a fortnight off pull the slow average down', () => {
    // The assertion the criterion actually asks for. Fourteen days of nothing
    // must cost fitness; if the loop walked the rides it would cost nothing.
    const trained: DailyLoad[] = Array.from({ length: 30 }, (_unused, offset) => ({
      day: day(offset),
      load: 80,
    }));
    const thenRested: DailyLoad[] = [...trained, { day: day(44), load: 0 }];

    const before = fitnessSeries(trained).at(-1)?.base ?? 0;
    const after = fitnessSeries(thenRested).at(-1)?.base ?? 0;

    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  it('drops the fast average faster than the slow one', () => {
    // What makes the difference between them informative rather than noise.
    const trained: DailyLoad[] = Array.from({ length: 60 }, (_unused, offset) => ({
      day: day(offset),
      load: 80,
    }));
    const rested = [...trained, { day: day(74), load: 0 }];

    const end = fitnessSeries(rested).at(-1);

    expect(end?.recent).toBeLessThan(end?.base ?? 0);
    // Rested, therefore fresh.
    expect(end?.freshness).toBeGreaterThan(0);
  });

  it('reports freshness as the gap between the two, exactly', () => {
    const series = fitnessSeries([{ day: day(0), load: 100 }]);
    const point = series[0];

    expect(point?.freshness).toBeCloseTo((point?.base ?? 0) - (point?.recent ?? 0), 12);
  });
});

describe('fitnessSeries — the seeding, stated rather than buried', () => {
  function day(offset: number): string {
    return localDay(unixSeconds(MIDDAY + offset * 86_400), 'UTC');
  }

  it('starts both averages at zero and says the start is not meaningful yet', () => {
    // #77's fourth criterion. Both averages DO start at zero — seeding them
    // from the athlete's early average would make the curve look right by
    // inventing training nobody recorded. The flag is the honest alternative.
    const series = fitnessSeries(
      Array.from({ length: 60 }, (_unused, offset) => ({ day: day(offset), load: 80 })),
    );

    expect(series[0]?.warmingUp).toBe(true);
    expect(series.at(-1)?.warmingUp).toBe(false);
  });

  it('marks exactly the first baseDays of the series', () => {
    const series = fitnessSeries(
      Array.from({ length: 60 }, (_unused, offset) => ({ day: day(offset), load: 80 })),
      { baseDays: 10 },
    );

    expect(series.filter((point) => point.warmingUp)).toHaveLength(10);
  });

  it('climbs from zero rather than beginning at the first ride’s load', () => {
    // A day of 100 does not make an athlete's fitness 100. It moves it by one
    // step of the smoothing, which for a 42-day constant is about 2.4%.
    const series = fitnessSeries([{ day: day(0), load: 100 }]);

    expect(series[0]?.base).toBeGreaterThan(0);
    expect(series[0]?.base).toBeLessThan(5);
  });
});

describe('fitnessSeries — the time constants', () => {
  function day(offset: number): string {
    return localDay(unixSeconds(MIDDAY + offset * 86_400), 'UTC');
  }

  const steady: DailyLoad[] = Array.from({ length: 100 }, (_unused, offset) => ({
    day: day(offset),
    load: 50,
  }));

  it('closes about 63% of the gap after one time constant, which is what a “42-day constant” means', () => {
    // The reason α comes from the exponential rather than from 2/(n+1): the
    // constant is then literally days.
    const series = fitnessSeries(steady, { baseDays: 42, recentDays: 7 });
    const afterOneConstant = series[41];

    expect(afterOneConstant?.base).toBeCloseTo(50 * (1 - Math.exp(-1)), 1);
  });

  it('changes only the intended curve', () => {
    // #77's fifth criterion, asserted as an isolation rather than as "it moved".
    const standard = fitnessSeries(steady);
    const slowerBase = fitnessSeries(steady, { baseDays: 84 });

    expect(slowerBase.at(-1)?.base).not.toBeCloseTo(standard.at(-1)?.base ?? 0, 6);
    expect(slowerBase.at(-1)?.recent).toBeCloseTo(standard.at(-1)?.recent ?? 0, 12);
  });

  it('has the stated defaults', () => {
    expect(DEFAULT_BASE_DAYS).toBe(42);
    expect(DEFAULT_RECENT_DAYS).toBe(7);
  });

  it('refuses a non-positive constant rather than dividing by zero', () => {
    expect(fitnessSeries(steady, { baseDays: 0 })).toEqual([]);
    expect(fitnessSeries(steady, { recentDays: -7 })).toEqual([]);
  });
});

describe('fitnessSeries — a history with nothing in it', () => {
  it('is an empty series rather than a flat line at zero', () => {
    // A rider with no rides has no chart. Drawing one would be a claim about
    // nothing.
    expect(fitnessSeries([])).toEqual([]);
    expect(seriesSpan([])).toBe(0);
  });

  it('spans the days it covers', () => {
    const series = fitnessSeries([
      { day: '2026-09-07', load: 10 },
      { day: '2026-09-17', load: 10 },
    ]);

    expect(series).toHaveLength(11);
    expect(seriesSpan(series)).toBe(10 * 86_400);
  });

  it('walks across a month and a year boundary without losing or repeating a day', () => {
    // The civil-calendar step is done in UTC on purpose: a zone with daylight
    // saving would produce a day that repeats or one that is skipped, in a
    // series where each must appear exactly once.
    const series = fitnessSeries([
      { day: '2026-12-28', load: 10 },
      { day: '2027-01-03', load: 10 },
    ]);

    expect(series.map((point) => point.day)).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });

  it('crosses a spring-forward boundary with one entry per civil day', () => {
    // 2027-03-14 is when US clocks skip an hour. A step taken in a local zone
    // would drop or duplicate a day here.
    const series = fitnessSeries([
      { day: '2027-03-12', load: 10 },
      { day: '2027-03-16', load: 10 },
    ]);

    expect(series.map((point) => point.day)).toEqual([
      '2027-03-12',
      '2027-03-13',
      '2027-03-14',
      '2027-03-15',
      '2027-03-16',
    ]);
    expect(new Set(series.map((point) => point.day)).size).toBe(series.length);
  });
});

describe('fitnessSeries — a day key that is not a date', () => {
  it('returns nothing rather than looping forever', () => {
    // ⚠️ A regression test for a hang, not for a wrong answer. The walk used to
    // step forward until it reached the last day; for a key that does not parse
    // it never did, `nextDay` kept returning something derived from `NaN`, and
    // the tab froze. Found when a test fixture generated month 15.
    //
    // `DailyLoad.day` is typed as a string, so a hand-edited row or a caller
    // that builds a key itself can reach this. Drawing nothing is recoverable;
    // hanging is not.
    expect(fitnessSeries([{ day: '2026-15-08', load: 50 }])).toEqual([]);
    expect(fitnessSeries([{ day: 'not a day', load: 50 }])).toEqual([]);
    expect(
      fitnessSeries([
        { day: '2026-01-01', load: 50 },
        { day: 'garbage', load: 50 },
      ]),
    ).toEqual([]);
  });

  it('draws a one-day series for a single ride', () => {
    // The smallest real history. Named here because the neighbouring case is
    // about a key that is not a date at all, and the two are easy to conflate.
    expect(fitnessSeries([{ day: '2026-01-05', load: 10 }], { baseDays: 1 })).toHaveLength(1);
  });
});
