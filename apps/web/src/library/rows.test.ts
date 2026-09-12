// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The library's row model, without rendering anything.
 *
 * The view's own tests drive these through the DOM; these pin the decisions
 * that are easy to get wrong and hard to see in a rendered row — which time
 * zone a start is shown in, what an absent power reads as, and what happens to
 * two rides the store returns in an order it does not promise.
 */

import { metres, seconds, unixSeconds, watts } from '@onyourleft/domain';
import { activityId, athleteId, type ActivitySummary } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { orderedRows, rowFor } from './rows';

const OWNER = athleteId('athlete-a');

function summary(id: string, overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id: activityId(id),
    athleteId: OWNER,
    name: 'Ride',
    startedAt: unixSeconds(1_700_000_000),
    startedAtTimeZone: 'Europe/London',
    elapsedTime: seconds(3_725),
    movingTime: seconds(3_600),
    distance: metres(42_195),
    visibility: 'private',
    hasPosition: true,
    createdAt: unixSeconds(1_700_000_000),
    ...overrides,
  };
}

describe('rowFor', () => {
  it('shows the start in the ride’s own time zone, not the reader’s', () => {
    // The reason `startedAtTimeZone` is stored beside the instant at all. A
    // 7am ride in Lisbon is a 7am ride forever; re-rendering it as 8am because
    // the rider has since flown to Paris is wrong in a way they would notice
    // and could not correct.
    const instant = unixSeconds(1_700_000_000);
    const lisbon = rowFor(
      summary('a', { startedAt: instant, startedAtTimeZone: 'Europe/Lisbon' }),
      'metric',
    );
    const tokyo = rowFor(
      summary('b', { startedAt: instant, startedAtTimeZone: 'Asia/Tokyo' }),
      'metric',
    );

    expect(lisbon.startedAt).not.toBe(tokyo.startedAt);
    expect(tokyo.startedAt).toContain('2023');
  });

  it('falls back to UTC for a zone this browser cannot resolve', () => {
    // A hand-edited row, or a zone an older ICU does not carry. Refusing to
    // list the ride would be worse than listing it an hour out — every other
    // column still identifies it.
    const row = rowFor(summary('a', { startedAtTimeZone: 'Mars/Olympus_Mons' }), 'metric');

    expect(row.startedAt).not.toBe('');
    expect(row.startedAt).toContain('2023');
  });

  it('renders an absent average power as undefined rather than zero', () => {
    // A ride with no power meter and a ride that averaged 0 W are different
    // facts, and 0 is a plausible-looking number for the first one.
    expect(rowFor(summary('a'), 'metric').averagePower).toBeUndefined();
    expect(rowFor(summary('b', { averagePower: watts(0) }), 'metric').averagePower).toBe('0');
    expect(rowFor(summary('c', { averagePower: watts(212.6) }), 'metric').averagePower).toBe('213');
  });

  it('formats duration and distance the way the rest of the shell does', () => {
    const row = rowFor(summary('a'), 'metric');

    expect(row.duration).toBe('1:02:05');
    expect(row.distance).toBe('42.2');
  });

  it('renders the same ride in miles for an imperial rider (#238)', () => {
    // 42 195 m is 42.2 km and 26.2 mi. The digits change, and nothing else
    // about the row does — the unit itself is the column heading, which
    // `ActivitiesView` takes from the same module.
    const metric = rowFor(summary('a'), 'metric');
    const imperial = rowFor(summary('a'), 'imperial');

    expect(metric.distance).toBe('42.2');
    expect(imperial.distance).toBe('26.2');
    expect(imperial.duration).toBe(metric.duration);
    expect(imperial.startedAt).toBe(metric.startedAt);
  });
});

describe('orderedRows', () => {
  it('keeps the store’s ordering and only breaks ties', () => {
    // The bug this guards: a tie-break that sorts the whole page by id would
    // throw away the ordering the store was asked for.
    const rows = orderedRows(
      [
        summary('b', { name: 'Newest', startedAt: unixSeconds(300) }),
        summary('a', { name: 'Oldest', startedAt: unixSeconds(100) }),
        summary('c', { name: 'Middle', startedAt: unixSeconds(200) }),
      ],
      'startedAt',
      'descending',
      'metric',
    );

    expect(rows.map((row) => row.name)).toStrictEqual(['Newest', 'Middle', 'Oldest']);
  });

  it('breaks ties by id, ascending in both directions', () => {
    // Deterministic, not symmetrical: mirroring the tie order when the arrow
    // flips would read as the rows shuffling for no reason.
    const tied = [
      summary('zulu', { name: 'Zulu', startedAt: unixSeconds(100) }),
      summary('alpha', { name: 'Alpha', startedAt: unixSeconds(100) }),
    ];

    expect(
      orderedRows(tied, 'startedAt', 'descending', 'metric').map((row) => row.name),
    ).toStrictEqual(['Alpha', 'Zulu']);
    expect(
      orderedRows(tied, 'startedAt', 'ascending', 'metric').map((row) => row.name),
    ).toStrictEqual(['Alpha', 'Zulu']);
  });

  it('orders by distance when that is the column asked for', () => {
    const rows = orderedRows(
      [
        summary('a', { name: 'Short', distance: metres(5_000) }),
        summary('b', { name: 'Long', distance: metres(100_000) }),
      ],
      'distance',
      'descending',
      'metric',
    );

    expect(rows.map((row) => row.name)).toStrictEqual(['Long', 'Short']);
  });

  it('does not mutate what it was given', () => {
    const summaries = [
      summary('b', { startedAt: unixSeconds(100) }),
      summary('a', { startedAt: unixSeconds(200) }),
    ];
    const before = summaries.map((entry) => entry.id);

    orderedRows(summaries, 'startedAt', 'descending', 'metric');

    expect(summaries.map((entry) => entry.id)).toStrictEqual(before);
  });
});
