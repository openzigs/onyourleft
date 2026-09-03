// SPDX-License-Identifier: Apache-2.0

/**
 * GPX 1.1 and TCX v2 fixture writers.
 *
 * Both formats are XML, both are text, and both are deliberately built by
 * string concatenation here rather than by a serialiser. Two reasons:
 *
 *  - **A serialiser would refuse to write the hostile fixtures.** The whole
 *    point of `xxe-external-entity.gpx` and `.tcx` is a document that a
 *    conforming writer would never emit, so #32 has something to prove it
 *    rejects XXE against. `SECURITY.md` names XXE in GPX and TCX explicitly.
 *  - **Byte stability.** A serialiser's attribute order, self-closing-tag
 *    choice and whitespace are its business and can change with a patch
 *    release. A fixture whose bytes move for that reason produces a test
 *    failure that reads exactly like a parser bug.
 *
 * Every number that reaches a document goes through {@link decimal}, which
 * fixes the digit count. `String(0.1 + 0.2)` and `(0.30000000000000004)
 * .toFixed(7)` differ, and a corpus that formats coordinates with the default
 * `toString` is one refactor away from a diff nobody can explain.
 */

/** A number at a fixed number of decimal places, so the bytes cannot drift. */
export function decimal(value: number, places: number): string {
  if (!Number.isFinite(value)) {
    throw new RangeError(`cannot format ${String(value)} as a fixed-point decimal`);
  }
  const rendered = value.toFixed(places);
  // `toFixed` already renders -0 as "0.0000000" — the specification takes the
  // "is it negative" branch on `x < 0`, which -0 is not. What it does *not*
  // handle is a small negative magnitude that rounds away to nothing:
  // `(-1e-9).toFixed(7)` is "-0.0000000", a signed zero written into a
  // coordinate. That is the same point as "0.0000000" and the sign is pure
  // noise in a diff, so it comes off.
  //
  // A first attempt here normalised `value === 0 ? 0 : value` instead, which is
  // dead code for the reason above: it was written against a hazard `toFixed`
  // had already dealt with, and left the real one. The mutation battery in the
  // pull request caught it — deleting that line changed nothing.
  return /^-0(\.0*)?$/.test(rendered) ? rendered.slice(1) : rendered;
}

/** Decimal degrees, at the 1e-7 resolution both formats are read at in practice. */
export function degrees(value: number): string {
  return decimal(value, 7);
}

/** An ISO 8601 instant in UTC, from whole seconds since the Unix epoch. */
export function isoInstant(unixSeconds: number): string {
  if (!Number.isInteger(unixSeconds)) {
    throw new RangeError(
      `instant must be a whole number of seconds, received ${String(unixSeconds)}`,
    );
  }
  return `${new Date(unixSeconds * 1000).toISOString().slice(0, 19)}Z`;
}

/** Escape the five characters that cannot appear literally in XML text. */
export function xmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Join lines with `\n` and end with one, so the bytes do not depend on a platform. */
export function document(lines: readonly string[]): string {
  return `${lines.join('\n')}\n`;
}
