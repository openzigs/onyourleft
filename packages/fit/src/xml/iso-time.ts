// SPDX-License-Identifier: Apache-2.0

/**
 * ISO 8601 instants, parsed and written out by hand.
 *
 * ## Why not `new Date(text)`
 *
 * Because the answer would depend on the runtime. ECMAScript specifies parsing
 * for its own *Date Time String Format* and leaves everything else
 * implementation-defined, and GPX and TCX files arrive *"hand-edited, truncated
 * and encoded inconsistently"* (#32). A string one engine reads as an instant
 * and another reads as `NaN` is a ride that imports on a phone and not on a
 * laptop.
 *
 * More sharply: **an offset-less timestamp must not be read as local time.**
 * `new Date('2024-06-15T09:00:00')` is 09:00 in *the reader's* zone, so the
 * same file imports as a different ride depending on where the rider is
 * sitting. #32's criterion is *"a ride exported and re-imported keeps its
 * absolute instant"*, and the only honest answer for a timestamp with no zone
 * is to refuse it rather than to guess.
 *
 * ## What is accepted
 *
 *     YYYY-MM-DD T HH:MM[:SS[.fff…]] (Z | ±HH:MM | ±HHMM | ±HH)
 *
 * with `T` or a space as the separator, because real files use both. Fractional
 * seconds are read and **truncated toward the past**, not rounded: this
 * project's canonical instant is whole seconds (`UnixSeconds`), and rounding
 * 09:00:00.6 up to 09:00:01 moves a sample past the next one.
 *
 * A missing zone designator is rejected. So is a date that does not exist —
 * `2024-02-31` — which `Date.UTC` would otherwise roll silently into March.
 */

import type { UnixSeconds } from '@onyourleft/domain';
import { unixSeconds } from '@onyourleft/domain';

/**
 * ⚠️ **The zone designator group at the end carries no `?`.** That is where
 * "a timestamp with no zone is refused" is actually enforced — a zone-less
 * string does not match this pattern at all, and `parseIsoInstant` returns
 * `undefined` at its first line.
 *
 * It is called out because it does not look like a security-relevant character.
 * A first draft of this file also carried an explicit `if (no zone) return
 * undefined` further down; the mutation battery for #32 found that branch was
 * unreachable — the regex had already rejected every input that could reach it
 * — and a rule enforced in a place nobody would think to look for it is a rule
 * one refactor away from being gone. Making the group optional here makes
 * `iso-time.test.ts`'s "refuses a timestamp with no zone" go red.
 */
const PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(?:[Zz]|([+-])(\d{2}):?(\d{2})?)$/;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

function digits(value: string | undefined, fallback = 0): number {
  return value === undefined ? fallback : Number.parseInt(value, 10);
}

/**
 * The instant an ISO 8601 string denotes, or `undefined` if it denotes none.
 *
 * `undefined` rather than a throw: a single unreadable `<time>` in a
 * ten-thousand-point track is one dropped sample and a collected fault, not a
 * failed import.
 */
export function parseIsoInstant(text: string): UnixSeconds | undefined {
  const match = PATTERN.exec(text.trim());
  if (!match) return undefined;

  const year = digits(match[1]);
  const month = digits(match[2]);
  const day = digits(match[3]);
  const hour = digits(match[4]);
  const minute = digits(match[5]);
  const second = digits(match[6]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  if (hour > 23 || minute > 59 || second > 60) return undefined;

  const milliseconds = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(milliseconds)) return undefined;

  const rolled = new Date(milliseconds);
  // `Date.UTC(2024, 1, 31)` is 2024-03-02. Reading the components back is how a
  // date that does not exist is caught rather than silently moved.
  if (
    rolled.getUTCFullYear() !== year ||
    rolled.getUTCMonth() !== month - 1 ||
    rolled.getUTCDate() !== day
  ) {
    return undefined;
  }

  // A `Z` leaves every offset group unmatched and `offsetSeconds` at zero,
  // which is the right answer for UTC. A missing designator never reaches here
  // at all — see the note on PATTERN.
  let offsetSeconds = 0;
  if (match[8] !== undefined) {
    const sign = match[8] === '-' ? -1 : 1;
    const offsetHours = digits(match[9]);
    const offsetMinutes = digits(match[10]);
    if (offsetHours > 23 || offsetMinutes > 59) return undefined;
    offsetSeconds = sign * (offsetHours * SECONDS_PER_HOUR + offsetMinutes * SECONDS_PER_MINUTE);
  }

  // Fractional seconds are dropped, not rounded. Truncation toward the past
  // keeps samples in order; rounding does not.
  return unixSeconds(Math.floor(milliseconds / 1000) - offsetSeconds);
}

/**
 * The last instant `YYYY-MM-DDTHH:MM:SSZ` can spell, and the first.
 *
 * `Date.prototype.toISOString` spells a year outside 0000–9999 in the expanded
 * form — `+010000-01-01T00:00:00.000Z` — and beyond ±8.64e15 milliseconds it
 * throws instead. Both are outside what this exporter may write, so the range
 * is stated here rather than discovered at the slice.
 */
const LATEST_ISO_SECONDS = 253_402_300_799; // 9999-12-31T23:59:59Z
const EARLIEST_ISO_SECONDS = -62_167_219_200; // 0000-01-01T00:00:00Z

/**
 * An instant as `YYYY-MM-DDTHH:MM:SSZ`.
 *
 * Always UTC and always with the `Z`, whatever zone the ride was ridden in.
 * A local time with an offset would round-trip equally well and would put the
 * rider's approximate longitude into a file they may have exported precisely
 * because they wanted to share it without that.
 *
 * ⚠️ **An instant outside the four-digit-year range is refused, not written.**
 * The expanded form `Date` produces for one is nineteen characters longer at
 * the front, so the fixed slice below cut `+010000-01-01T00:00:00.000Z` down to
 * `+010000-01-01T00:00` and appended a `Z` — a timestamp that looks well formed
 * and means something else. A refusal is the lesser outcome, and it matches
 * `decimal`'s treatment of a value it cannot render.
 *
 * @throws {RangeError} for an instant no ISO 8601 `dateTime` in this form can
 * carry. The instant is deliberately **not** named in the message: an exception
 * from an export is the string most likely to end up in a public issue, and the
 * timestamps of a rider's ride are the metadata half of what ADR 0004
 * decision D keeps out of one.
 */
export function formatIsoInstant(instant: UnixSeconds): string {
  if (!Number.isFinite(instant) || instant < EARLIEST_ISO_SECONDS || instant > LATEST_ISO_SECONDS) {
    throw new RangeError(
      'an instant outside the range an ISO 8601 timestamp with a four-digit year can carry',
    );
  }
  return `${new Date(instant * 1000).toISOString().slice(0, 19)}Z`;
}
