// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The game's season clock — #1622, the foundation of epic #1621.
 *
 * Two answers from one calendar day: **which holiday is on**, if any, and
 * **how far into autumn and winter the route's own nature is**. Nothing here
 * draws; #1623 to #1627 read the {@link Season} a view is handed through
 * `port.ts` §`GameView.setSeason`.
 *
 * ## Whose date, owner ruling (a) of 2026-10-24
 *
 * - **Nature follows the ROUTE**: its hemisphere (`world.ts`
 *   §`routeHemisphere`) and how far it is from the equator. 15 January is
 *   winter on a route at 45° N and summer on one at 34° S.
 * - **Holidays follow the RIDER's local date at ride start**, held for the
 *   whole ride. `GameView` reads the day once, when a live ride starts; a ghost
 *   or a past activity never supplies it.
 *
 * ## Windows, owner ruling (b)
 *
 * Halloween is 24 October to 1 November, winter lights 1 December to 6
 * January, both inclusive, in the rider's local calendar. Winter lights cross
 * the new year, which is why {@link holidayOn} names both ends of it.
 *
 * ## Reads no clock, except {@link deviceToday}
 *
 * Every other function here is pure: an instant and a time zone in, a day out.
 * {@link deviceToday} is the one place the device's clock is read, and it is
 * the default `GameView` falls back to when no `today` is injected.
 *
 * ⚠️ **No latitude is ever formatted into a string here** (ADR 0004 D): the
 * route's latitude arrives as a magnitude and is only compared and scaled.
 */

/** A local calendar day. `month` is 1 to 12. */
export interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** The holidays the game decorates for. */
export type Holiday = 'halloween' | 'winter-lights';

/** Which half of the world a route is in; `unknown` for a route with no positions. */
export type Hemisphere = 'north' | 'south' | 'unknown';

/** How far into autumn and into winter a route's nature is, each 0 to 1. */
export interface Nature {
  readonly autumn: number;
  readonly winter: number;
}

/** What a view is told when a ride starts. @see GameView.setSeason */
export interface Season {
  /** The holiday on the rider's day, or none — also none when decorations are switched off. */
  readonly holiday: Holiday | undefined;
  /** The route's own season. Never touched by the decorations switch. */
  readonly nature: Nature;
}

/** No holiday and no seasonal nature: what a view holds before it is told anything. */
export const NO_SEASON: Season = { holiday: undefined, nature: { autumn: 0, winter: 0 } };

/** The local calendar day of `instantMs` in `timeZone` (IANA), via Intl. Reads no clock. */
export function calendarDayAt(instantMs: number, timeZone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'gregory',
    numberingSystem: 'latn',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(instantMs);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((each) => each.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

/** Today on this device, in its own time zone. The one function here that reads a clock. */
export function deviceToday(): CalendarDay {
  return calendarDayAt(Date.now(), new Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/**
 * Parse a strict `YYYY-MM-DD` that names a real day; `undefined` otherwise.
 *
 * @unwired reached only from the owner's page under `apps/web/browser/`
 * (`realistic/config.ts` §`dateFrom`, its `?date=`), which the wiring gate
 * deliberately does not count as an entry point. A ride reads its day from
 * the device (`deviceToday`), never from text.
 */
export function parseCalendarDay(text: string): CalendarDay | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  return { year, month, day };
}

/** The holiday on a day, by owner ruling (b)'s inclusive windows. */
export function holidayOn(day: CalendarDay): Holiday | undefined {
  if ((day.month === 10 && day.day >= 24) || (day.month === 11 && day.day <= 1)) {
    return 'halloween';
  }
  if (day.month === 12 || (day.month === 1 && day.day <= 6)) return 'winter-lights';
  return undefined;
}

/**
 * The days of a 365-day year a season is centred on, and how far either side
 * of that centre it reaches — for the NORTHERN hemisphere; the southern is the
 * same half a year on. Judgements, stated as such: autumn's colour from early
 * September to mid-December, peaking in late October; winter's bareness from
 * mid-November to the end of March, deepest in late January.
 */
const AUTUMN_CENTRE_DAY = 298; // 25 October
const AUTUMN_HALF_WIDTH_DAYS = 55;
const WINTER_CENTRE_DAY = 20; // 20 January
const WINTER_HALF_WIDTH_DAYS = 70;
const DAYS_IN_YEAR = 365;
const HALF_YEAR_DAYS = DAYS_IN_YEAR / 2;

/**
 * Between these magnitudes of latitude the seasons go from none to full. The
 * tropics have no autumn colour or bare winter worth drawing; past 40° the
 * seasons are as strong as the game draws them.
 */
const SEASONS_FROM_DEGREES = 23.44;
const SEASONS_FULL_DEGREES = 40;

/** 0..1 weights for the route's season; all 0 when the hemisphere is unknown. */
export function natureOn(day: CalendarDay, hemisphere: Hemisphere, absLatitude: number): Nature {
  if (hemisphere === 'unknown') return NO_SEASON.nature;
  const strength = latitudeStrength(absLatitude);
  if (strength === 0) return NO_SEASON.nature;
  const northern = dayOfYear(day) + (hemisphere === 'south' ? HALF_YEAR_DAYS : 0);
  return {
    autumn: strength * peak(northern, AUTUMN_CENTRE_DAY, AUTUMN_HALF_WIDTH_DAYS),
    winter: strength * peak(northern, WINTER_CENTRE_DAY, WINTER_HALF_WIDTH_DAYS),
  };
}

/**
 * The whole of what a view is told: the holiday, unless decorations are off,
 * and the route's nature, whatever the switch says.
 */
export function seasonOn(
  day: CalendarDay,
  hemisphere: Hemisphere,
  absLatitude: number,
  decorations: boolean,
): Season {
  return {
    holiday: decorations ? holidayOn(day) : undefined,
    nature: natureOn(day, hemisphere, absLatitude),
  };
}

function latitudeStrength(absLatitude: number): number {
  if (!Number.isFinite(absLatitude)) return 0;
  const share =
    (absLatitude - SEASONS_FROM_DEGREES) / (SEASONS_FULL_DEGREES - SEASONS_FROM_DEGREES);
  return Math.min(1, Math.max(0, share));
}

/** 1 at `centre`, falling straight to 0 at `halfWidth` days either side, round the year. */
function peak(dayNumber: number, centre: number, halfWidth: number): number {
  const apart = Math.abs((((dayNumber - centre) % DAYS_IN_YEAR) + DAYS_IN_YEAR) % DAYS_IN_YEAR);
  const distance = Math.min(apart, DAYS_IN_YEAR - apart);
  return Math.max(0, 1 - distance / halfWidth);
}

/** Day of a 365-day year, 1 January being 1; 29 February counts as 1 March's neighbour. */
function dayOfYear(day: CalendarDay): number {
  let total = 0;
  for (let month = 1; month < day.month; month += 1) total += daysInMonth(2001, month);
  return total + day.day;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
