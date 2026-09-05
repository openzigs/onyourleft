// SPDX-License-Identifier: Apache-2.0

/**
 * How the encoder decides what a field's base type is, and what it writes for a
 * value that has none.
 *
 * ## The definition message is where a FIT writer chooses, and it can be wrong
 *
 * A FIT definition message declares each field's **size and base type**; the
 * profile's natural width is a convention, not a constraint. `heart-rate-16-bit.fit`
 * exists in the #29 corpus precisely because a real file may declare
 * `record.heart_rate` as a `uint16` and carry values from 260 to 310. An encoder
 * that always writes the natural width cannot round-trip that file: 260 in a
 * `uint8` is 4.
 *
 * So each field carries an ordered list of candidate base types, **narrowest
 * first and starting at the profile's natural width**, and the encoder picks
 * the first candidate that can hold every value the activity actually contains.
 * It never picks something narrower than the natural width, because the whole
 * point of #31 is that other people's readers accept the output and a
 * `manufacturer` squeezed into a `uint8` is a gratuitous way to find out which
 * of them read the definition message properly.
 *
 * ## A value equal to the invalid marker is not a value
 *
 * Every base type reserves a bit pattern for *"not recorded"* — `0xFF` for a
 * `uint8`, `0x7FFFFFFF` for a `sint32`. A heart rate of exactly 255 bpm written
 * into a `uint8` **is a gap** as far as any reader is concerned, this decoder
 * included. Widening is the fix and it is why the marker collision is part of
 * "can this candidate hold every value" rather than a separate check: 255 does
 * not fit a `uint8` for this purpose, and the field becomes a `uint16`.
 *
 * When no candidate can hold a value — a longitude landing exactly on
 * `0x7FFFFFFF`, which is one semicircle short of +180° and the only value a
 * `sint32` cannot carry — the **single offending value** is dropped with a
 * fault, not the whole channel. Dropping the channel would lose an entire ride's
 * positions because of one point; dropping the value loses one point and says
 * so.
 */

import { baseTypeElementSize, baseTypeInvalidValue, baseTypeIsSigned } from '../decode/base-types';
import { BASE_TYPE } from './container';

/** The candidate list for an unsigned field whose natural width is one byte. */
export const UINT8_CANDIDATES = [BASE_TYPE.uint8, BASE_TYPE.uint16, BASE_TYPE.uint32] as const;

/** The candidate list for an unsigned field whose natural width is two bytes. */
export const UINT16_CANDIDATES = [BASE_TYPE.uint16, BASE_TYPE.uint32] as const;

/** The candidate list for an unsigned field whose natural width is four bytes. */
export const UINT32_CANDIDATES = [BASE_TYPE.uint32] as const;

/** The candidate list for an enumerated field. Same layout as a `uint8`. */
export const ENUM_CANDIDATES = [BASE_TYPE.enum, BASE_TYPE.uint16, BASE_TYPE.uint32] as const;

/** The candidate list for a signed field whose natural width is one byte. */
export const SINT8_CANDIDATES = [BASE_TYPE.sint8, BASE_TYPE.sint16, BASE_TYPE.sint32] as const;

/** The candidate list for a signed field whose natural width is four bytes. */
export const SINT32_CANDIDATES = [BASE_TYPE.sint32] as const;

/**
 * Every invalid marker the base types this encoder writes reserve.
 *
 * Derived from the same table the decoder reads, so the two cannot drift, and
 * held as a set so a survey can note "this channel contains a value that is a
 * marker somewhere" in constant space rather than by keeping the values.
 */
const INVALID_MARKERS: ReadonlySet<number> = new Set(
  [
    BASE_TYPE.enum,
    BASE_TYPE.sint8,
    BASE_TYPE.uint8,
    BASE_TYPE.sint16,
    BASE_TYPE.uint16,
    BASE_TYPE.sint32,
    BASE_TYPE.uint32,
  ]
    .map((baseType) => baseTypeInvalidValue(baseType))
    .filter((marker): marker is number => marker !== undefined),
);

/** The inclusive range of values a base type can hold, marker excluded. */
export function baseTypeRange(baseType: number): { min: number; max: number } {
  const size = baseTypeElementSize(baseType) ?? 1;
  const bits = size * 8;
  return baseTypeIsSigned(baseType)
    ? { min: -(2 ** (bits - 1)), max: 2 ** (bits - 1) - 1 }
    : { min: 0, max: 2 ** bits - 1 };
}

/** Whether `value` survives a round trip through `baseType`. */
export function representable(baseType: number, value: number): boolean {
  if (!Number.isInteger(value)) return false;
  const { min, max } = baseTypeRange(baseType);
  if (value < min || value > max) return false;
  return value !== baseTypeInvalidValue(baseType);
}

/**
 * What the encoder learned about one field by walking the messages once.
 *
 * Deliberately O(1) in the number of messages: the extremes and the set of
 * marker values seen, never the values themselves. #127 is the decoder
 * retaining a multiple of the file it read, and an encoder that buffers every
 * channel to choose a base type has the same shape at the same scale.
 */
export class FieldSurvey {
  #present = false;
  #minimum = Number.POSITIVE_INFINITY;
  #maximum = Number.NEGATIVE_INFINITY;
  #nonInteger = false;
  readonly #markersSeen = new Set<number>();

  /** Record one value. `undefined` is a gap and says nothing about the type. */
  observe(value: number | undefined): void {
    if (value === undefined) return;
    this.#present = true;
    if (!Number.isInteger(value)) {
      this.#nonInteger = true;
      return;
    }
    if (value < this.#minimum) this.#minimum = value;
    if (value > this.#maximum) this.#maximum = value;
    // Only the markers are remembered, never the values. See the class comment.
    if (INVALID_MARKERS.has(value)) this.#markersSeen.add(value);
  }

  /** Whether any message carried this field at all. */
  get present(): boolean {
    return this.#present;
  }

  /**
   * The narrowest candidate that can hold everything seen, or the widest when
   * none can.
   *
   * Returning the widest rather than `undefined` is what turns "this channel is
   * impossible" into "one value in this channel is impossible": the field is
   * still declared, and `encodeValue` drops the individual values that do not
   * fit.
   */
  chooseBaseType(candidates: readonly number[]): number {
    const widest = candidates[candidates.length - 1] ?? BASE_TYPE.uint32;
    if (!this.#present || this.#nonInteger) return candidates[0] ?? widest;
    for (const candidate of candidates) {
      const { min, max } = baseTypeRange(candidate);
      if (this.#minimum < min || this.#maximum > max) continue;
      const marker = baseTypeInvalidValue(candidate);
      if (marker !== undefined && this.#markersSeen.has(marker)) continue;
      return candidate;
    }
    return widest;
  }
}
