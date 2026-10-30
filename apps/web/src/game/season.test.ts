// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The season clock — #1622. Every holiday edge is its own case, so moving a
 * boundary by one day turns one of them red. ⚠️ No case name, message or
 * assertion here formats a latitude (ADR 0004 D): the fixture routes are named
 * by their hemisphere, never by their coordinates.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import {
  calendarDayAt,
  deviceToday,
  holidayOn,
  natureOn,
  NO_SEASON,
  parseCalendarDay,
  seasonOn,
  type CalendarDay,
} from './season';
import { routeHemisphere, routeLatitudeMagnitude } from './world';

function on(month: number, day: number, year = 2026): CalendarDay {
  return { year, month, day };
}

/** A short road around a latitude. */
function routeAt(latitude: number): RouteProfile {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(latitude + index / 111_320),
        degreesLongitude(151.2),
      ),
      elevation: altitudeMetres(20),
    });
  }
  return routeProfile(points);
}

const SOUTHERN = routeAt(-33.9);
const NORTHERN = routeAt(45.2);
/** A profile with no positions — a `RouteProfile` may carry none. */
const PLACELESS: RouteProfile = { ...NORTHERN, positions: [] };

describe('holidayOn — owner ruling (b)’s inclusive windows', () => {
  const cases: readonly [string, CalendarDay, string | undefined][] = [
    ['23 Oct is no holiday', on(10, 23), undefined],
    ['24 Oct is Halloween', on(10, 24), 'halloween'],
    ['31 Oct is Halloween', on(10, 31), 'halloween'],
    ['1 Nov is Halloween', on(11, 1), 'halloween'],
    ['2 Nov is no holiday', on(11, 2), undefined],
    ['30 Nov is no holiday', on(11, 30), undefined],
    ['1 Dec is winter lights', on(12, 1), 'winter-lights'],
    ['31 Dec is winter lights', on(12, 31), 'winter-lights'],
    ['1 Jan is winter lights', on(1, 1), 'winter-lights'],
    ['6 Jan is winter lights', on(1, 6), 'winter-lights'],
    ['7 Jan is no holiday', on(1, 7), undefined],
    ['15 Jul is no holiday', on(7, 15), undefined],
  ];
  for (const [name, day, holiday] of cases) {
    it(name, () => {
      expect(holidayOn(day)).toBe(holiday);
    });
  }
});

describe('calendarDayAt — the LOCAL day, never UTC’s', () => {
  // 2026-10-24T06:30Z: 23:30 on 23 Oct in Los Angeles (PDT, UTC−7), and
  // 19:30 on 24 Oct in Auckland (NZDT, UTC+13).
  const INSTANT = Date.UTC(2026, 9, 24, 6, 30);

  it('is 23 Oct in Los Angeles, so no Halloween, though UTC has reached the 24th', () => {
    expect(calendarDayAt(INSTANT, 'UTC')).toEqual(on(10, 24));
    const day = calendarDayAt(INSTANT, 'America/Los_Angeles');
    expect(day).toEqual(on(10, 23));
    expect(holidayOn(day)).toBeUndefined();
  });

  it('is 24 Oct in Auckland, so Halloween', () => {
    const day = calendarDayAt(INSTANT, 'Pacific/Auckland');
    expect(day).toEqual(on(10, 24));
    expect(holidayOn(day)).toBe('halloween');
  });

  it('gives a real day for the device', () => {
    const day = deviceToday();
    expect(
      parseCalendarDay(
        `${String(day.year).padStart(4, '0')}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`,
      ),
    ).toEqual(day);
  });
});

describe('parseCalendarDay — strict YYYY-MM-DD naming a real day', () => {
  for (const text of [
    '2026-02-30',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-10-00',
    '2026-1-5',
    '26-10-31',
    '2026-10-31T00:00',
    '',
    '2026-10-31 ',
    '2026-10-31x',
    ' 2026-10-31',
    '2026-02-29',
    '1900-02-29',
  ]) {
    it(`refuses "${text}"`, () => {
      expect(parseCalendarDay(text)).toBeUndefined();
    });
  }

  it('accepts a real day, a leap day in a leap year included', () => {
    expect(parseCalendarDay('2026-10-31')).toEqual(on(10, 31));
    expect(parseCalendarDay('2024-02-29')).toEqual(on(2, 29, 2024));
    expect(parseCalendarDay('2000-02-29')).toEqual(on(2, 29, 2000));
    expect(parseCalendarDay('2026-12-31')).toEqual(on(12, 31));
    expect(parseCalendarDay('2026-01-01')).toEqual(on(1, 1));
  });
});

describe('routeHemisphere — the route’s signed half of the world', () => {
  it('is south for the southern fixture and north for the northern one', () => {
    expect(routeHemisphere(SOUTHERN)).toBe('south');
    expect(routeHemisphere(NORTHERN)).toBe('north');
  });

  it('is unknown for a profile with no positions, and nothing is NaN', () => {
    expect(routeHemisphere(PLACELESS)).toBe('unknown');
    expect(routeLatitudeMagnitude(PLACELESS)).toBe(0);
    expect(Number.isNaN(routeLatitudeMagnitude(SOUTHERN))).toBe(false);
    expect(routeLatitudeMagnitude(SOUTHERN)).toBeGreaterThan(0);
    const nature = natureOn(
      on(1, 15),
      routeHemisphere(PLACELESS),
      routeLatitudeMagnitude(PLACELESS),
    );
    expect(nature).toEqual({ autumn: 0, winter: 0 });
  });

  it('is unknown for a route exactly on the equator: it has no half', () => {
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 20; index += 1) {
      points.push({
        position: geographicPosition(degreesLatitude(0), degreesLongitude(10 + index / 111_320)),
        elevation: altitudeMetres(20),
      });
    }
    expect(routeHemisphere(routeProfile(points))).toBe('unknown');
  });
});

describe('natureOn — the route’s season, mirrored across the equator', () => {
  const north = (day: CalendarDay) =>
    natureOn(day, routeHemisphere(NORTHERN), routeLatitudeMagnitude(NORTHERN));
  const south = (day: CalendarDay) =>
    natureOn(day, routeHemisphere(SOUTHERN), routeLatitudeMagnitude(SOUTHERN));

  it('is all zeros for an unknown hemisphere, on any day', () => {
    for (const day of [on(1, 15), on(4, 15), on(7, 15), on(10, 15)]) {
      expect(natureOn(day, 'unknown', 50)).toEqual({ autumn: 0, winter: 0 });
    }
  });

  it('15 Jan is winter in the north and not in the south', () => {
    expect(north(on(1, 15)).winter).toBeGreaterThan(0);
    expect(south(on(1, 15)).winter).toBe(0);
  });

  it('15 Jul is winter in the south and not in the north', () => {
    expect(south(on(7, 15)).winter).toBeGreaterThan(0);
    expect(north(on(7, 15)).winter).toBe(0);
  });

  it('15 Oct is autumn in the north and not in the south', () => {
    expect(north(on(10, 15)).autumn).toBeGreaterThan(0);
    expect(south(on(10, 15)).autumn).toBe(0);
  });

  it('15 Apr is autumn in the south and not in the north', () => {
    expect(south(on(4, 15)).autumn).toBeGreaterThan(0);
    expect(north(on(4, 15)).autumn).toBe(0);
  });

  it('stays within 0 to 1 on every day of the year, and the tropics have none', () => {
    for (let month = 1; month <= 12; month += 1) {
      for (let day = 1; day <= 28; day += 1) {
        for (const nature of [north(on(month, day)), south(on(month, day))]) {
          expect(nature.autumn).toBeGreaterThanOrEqual(0);
          expect(nature.autumn).toBeLessThanOrEqual(1);
          expect(nature.winter).toBeGreaterThanOrEqual(0);
          expect(nature.winter).toBeLessThanOrEqual(1);
        }
        expect(natureOn(on(month, day), 'north', 10)).toEqual({ autumn: 0, winter: 0 });
      }
    }
    expect(natureOn(on(1, 15), 'north', Number.NaN)).toEqual({ autumn: 0, winter: 0 });
  });
});

describe('seasonOn — the decorations switch governs holidays only', () => {
  it('drops the holiday and keeps the nature when decorations are off', () => {
    const on31Oct = on(10, 31);
    const shown = seasonOn(on31Oct, 'north', 50, true);
    const hidden = seasonOn(on31Oct, 'north', 50, false);
    expect(shown.holiday).toBe('halloween');
    expect(hidden.holiday).toBeUndefined();
    expect(hidden.nature).toEqual(shown.nature);
    expect(shown.nature.autumn).toBeGreaterThan(0);
  });

  it('holds nothing before it is told anything', () => {
    expect(NO_SEASON).toEqual({ holiday: undefined, nature: { autumn: 0, winter: 0 } });
  });
});
