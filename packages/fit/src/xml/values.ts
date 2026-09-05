// SPDX-License-Identifier: Apache-2.0

/**
 * Turning a string out of a document into a `@onyourleft/domain` quantity.
 *
 * The XML counterpart of `decode/activity.ts`'s `quantity`, and it exists for
 * the same reason: *"Validation happens at construction, once, at the boundary
 * where an untrusted number becomes a typed quantity."* A GPX file is
 * user-supplied input, a rejected value must not throw out of an importer, and
 * the fault it produces must name the field and the constraint and **never the
 * value** (ADR 0004 decision D).
 *
 * `Number(text)` rather than `parseFloat(text)`, and the difference is the
 * point: `parseFloat('12abc')` is 12, and `parseFloat('')` is `NaN` but
 * `parseFloat('  ')` is too while `Number('  ')` is 0. `Number` rejects trailing
 * junk outright, which is what an importer of files that arrive *"hand-edited,
 * truncated and encoded inconsistently"* wants. The empty-string case is
 * handled before it, because `Number('')` is 0 and a `<Cadence></Cadence>` is
 * not a cadence of zero.
 */

import { UnitError } from '@onyourleft/domain';

import { ActivityXmlError } from './errors';

/** A finite number, or `undefined` with a fault recorded. */
export function finiteNumber(
  text: string | undefined,
  what: string,
  characterOffset: number,
  faults: ActivityXmlError[],
): number | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    faults.push(
      new ActivityXmlError(
        'invalid-value',
        characterOffset,
        `${what} is not a number; the field is dropped`,
      ),
    );
    return undefined;
  }
  return value;
}

/** A quantity, or `undefined` with a fault recorded. Never throws. */
export function quantity<T>(
  text: string | undefined,
  make: (raw: number) => T,
  what: string,
  characterOffset: number,
  faults: ActivityXmlError[],
): T | undefined {
  const value = finiteNumber(text, what, characterOffset, faults);
  if (value === undefined) return undefined;
  try {
    return make(value);
  } catch (cause) {
    if (!(cause instanceof UnitError)) throw cause;
    faults.push(
      new ActivityXmlError(
        'invalid-value',
        characterOffset,
        `${what} holds a value @onyourleft/domain rejects; the field is dropped`,
      ),
    );
    return undefined;
  }
}
