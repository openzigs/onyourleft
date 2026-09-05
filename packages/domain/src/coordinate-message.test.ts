// SPDX-License-Identifier: Apache-2.0

/**
 * ADR 0004 decision D — the coordinate-message rule — asserted at the only
 * place in this package that formats a rejected value into a string.
 *
 * > When the quantity being reported is a coordinate — a latitude, a longitude,
 * > a semicircle field of either, a position, or an altitude reported together
 * > with one — a message may name **the field** and **the constraint** and must
 * > not name **the value**. Every other quantity keeps its value in the message.
 *
 * ## What is asserted, and what deliberately is not
 *
 * The assertion is the **absence of the caller's value**, not the wording. A
 * test that pinned `latitude in semicircles must be a whole number` verbatim
 * would go red on a copy edit and stay green on a reworded leak — the opposite
 * of the property the ADR cares about.
 *
 * Absence is asserted structurally rather than by `not.toContain(String(value))`:
 * every run of digits in the message must be a digit run of one of the
 * **constraint bounds** the message is allowed to name. That catches a leak
 * that arrives in a different spelling — six decimal places instead of ten, a
 * rounded value, an exponent, the integer part alone — where a substring check
 * would pass. `1803997218` truncated to `1803997` is still 151.2° to within a
 * few hundred metres.
 *
 * The values below are the two the ADR and #104 name, and they are real
 * coordinates: `614507218` semicircles is 51.5074°N (London) and `1803997218`
 * is 151.2093°E (Sydney). The second case must use a coordinate outside ±90° of
 * longitude — a European pair does not reach the guard it is testing at all.
 */

import { describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  beatsPerMinute,
  degreesLatitude,
  degreesLongitude,
  FIT_UINT16_INVALID,
  fitAltitudeToMetres,
  latitudeSemicircles,
  longitudeSemicircles,
  metres,
  SEMICIRCLES_MAX,
  SEMICIRCLES_MIN,
  SEMICIRCLES_PER_QUARTER_TURN,
  unixSeconds,
  UnitError,
} from './index';

/** The message of the `UnitError` `run` is required to throw. */
function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (cause) {
    if (cause instanceof UnitError) {
      return cause.message;
    }
    throw cause;
  }
  throw new Error('expected a UnitError; nothing was thrown');
}

/** Every run of digits in a string, as strings. `-90.5` yields `90` and `5`. */
function digitRuns(text: string): readonly string[] {
  return text.match(/\d+/g) ?? [];
}

/**
 * Assert a message names no number except the bounds of its own constraint.
 *
 * `allowedBounds` is the constraint the message is permitted to state — ADR
 * 0004 decision D allows `must be between -1073741824 and 1073741824` and
 * forbids only the caller's value. Pass `[]` where the message states no bound.
 */
function expectNamesNoValue(message: string, allowedBounds: readonly number[]): void {
  const allowed = new Set(allowedBounds.flatMap((bound) => digitRuns(String(bound))));
  const leaked = digitRuns(message).filter((run) => !allowed.has(run));
  expect(leaked, `coordinate message named a number that is not a bound: ${message}`).toEqual([]);
}

describe('a coordinate message names the field and the constraint, never the value', () => {
  // The path named in the #21 deferral. A fractional semicircle is a plausible
  // read error rather than a hostile input -- a caller that scaled a field
  // before labelling it -- and the value it echoed was a real coordinate to
  // sub-centimetre precision.
  it('hides a fractional latitude semicircle: 614507218.4 is 51.5074N', () => {
    const message = messageOf(() => latitudeSemicircles(614507218.4));

    expectNamesNoValue(message, []);
    expect(message).toContain('latitude in semicircles');
    expect(message).toContain('whole number');
  });

  // Not named in the deferral, and the more dangerous of the two: it leaks an
  // in-range, VALID coordinate. latitudeSemicircles bounds its argument at the
  // pole rather than at the field width, so a transposed field pair -- the bug
  // position.ts exists to catch -- reaches assertInRange for every athlete
  // whose longitude is outside +/-90 degrees. That is the Americas, Oceania and
  // East Asia. London does not trigger it, which is why it was invisible in the
  // review of #102.
  it('hides a transposed Sydney longitude: 1803997218 is 151.2093E', () => {
    const sydneyLongitude = 1803997218;
    const message = messageOf(() => latitudeSemicircles(sydneyLongitude));

    expectNamesNoValue(message, [-SEMICIRCLES_PER_QUARTER_TURN, SEMICIRCLES_PER_QUARTER_TURN]);
    expect(message).not.toContain(String(sydneyLongitude));
    expect(message).toContain('latitude in semicircles');
    // The bounds may still appear; it is the caller's value that may not.
    expect(message).toContain(String(SEMICIRCLES_PER_QUARTER_TURN));
  });

  // A `sint32` field read as a `uint32` -- the decode fault position.ts names
  // in its opening comment. The unsigned reading of Los Angeles' longitude is
  // past the field width, so it reaches assertInRange, and it is one
  // subtraction away from being a real coordinate again.
  //
  // The value must not share a digit run with either bound, or the assertion
  // below cannot fail: SEMICIRCLES_MAX + 1 reads as `2147483648`, which is the
  // digits of SEMICIRCLES_MIN, so a test written with it passes against the
  // leaking implementation. It did, on the first run of this file.
  it('hides a uint32 read of a negative longitude field: 2884265006 is -118.2437', () => {
    const unsignedReading = 2884265006;
    const message = messageOf(() => longitudeSemicircles(unsignedReading));

    expectNamesNoValue(message, [SEMICIRCLES_MIN, SEMICIRCLES_MAX]);
    expect(message).not.toContain(String(unsignedReading));
    expect(message).toContain('longitude in semicircles');
  });

  it('hides a fractional longitude semicircle: 1410702290 is -118.2437', () => {
    const message = messageOf(() => longitudeSemicircles(-1410702290.25));

    expectNamesNoValue(message, []);
    expect(message).toContain('longitude in semicircles');
  });

  it('hides an out-of-range latitude in degrees', () => {
    const message = messageOf(() => degreesLatitude(151.2093));

    expectNamesNoValue(message, [-90, 90]);
    expect(message).toContain('latitude in degrees');
  });

  it('hides an out-of-range longitude in degrees', () => {
    const message = messageOf(() => degreesLongitude(-33.8688 - 180));

    expectNamesNoValue(message, [-180, 180]);
    expect(message).toContain('longitude in degrees');
  });

  // NaN and the infinities carry no position, so redacting them buys nothing
  // directly. They are redacted anyway because "a coordinate message never
  // names the caller's value" is a rule with no exceptions to remember, and
  // because a guard that echoes the value on ONE of its branches is one edit
  // away from echoing it on the others.
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('hides %s offered as a latitude', (rendered, value) => {
    const message = messageOf(() => degreesLatitude(value));

    expectNamesNoValue(message, []);
    expect(message).not.toContain(rendered);
    expect(message).toContain('latitude in degrees');
  });

  // Every coordinate constructor, so that a guard reached by only one of them
  // cannot be the one that still echoes.
  it.each([
    ['latitude in degrees', () => degreesLatitude(Number.NaN)],
    ['longitude in degrees', () => degreesLongitude(Number.NaN)],
    ['latitude in semicircles', () => latitudeSemicircles(Number.NaN)],
    ['longitude in semicircles', () => longitudeSemicircles(Number.NaN)],
  ])('%s reports the field it rejected', (field, run) => {
    const message = messageOf(run);

    expect(message).toContain(field);
    expect(message).not.toContain('received');
  });
});

describe('every other quantity keeps its value in the message', () => {
  // The rule is narrow on purpose. For a malformed GATT payload, a doubly
  // scaled FIT field or an out-of-epoch timestamp the offending number is most
  // of the diagnostic, and a blanket redaction would buy a coordinate's privacy
  // at the cost of every other quantity's debuggability. These cases are what
  // makes over-application a failing test rather than a review opinion.
  it.each([
    ['a negative distance', () => metres(-5), '-5'],
    ['a NaN heart rate', () => beatsPerMinute(Number.NaN), 'NaN'],
    ['an infinite instant', () => unixSeconds(Number.POSITIVE_INFINITY), 'Infinity'],
    [
      'a FIT altitude past the invalid sentinel',
      () => fitAltitudeToMetres(FIT_UINT16_INVALID + 1),
      String(FIT_UINT16_INVALID + 1),
    ],
  ])('%s keeps its value', (_, run, expected) => {
    expect(messageOf(run)).toContain(expected);
  });

  // Altitude is the one the ADR qualifies: it is a coordinate only "reported
  // together with" a latitude or a longitude, and this package never reports it
  // together with anything -- `altitudeMetres` takes one number and knows
  // nothing about a position. A bare altitude is not a location, so it keeps
  // its value here, and the layer that DOES have the positional context applies
  // the rule there: `packages/store`'s stream codec redacts the altitude
  // channel along with latitude and longitude, because in a stream the three
  // arrive at the same sample index.
  it('altitude keeps its value, because in this package it is never beside a coordinate', () => {
    expect(messageOf(() => altitudeMetres(Number.NaN))).toContain('NaN');
  });
});
