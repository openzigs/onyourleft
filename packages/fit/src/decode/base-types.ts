// SPDX-License-Identifier: Apache-2.0

/**
 * The FIT base types, and how one field's bytes become a value.
 *
 * ## Provenance — ADR 0006 R2
 *
 * The type numbers, their sizes and their invalid values are recorded in
 * `packages/fit/README.md` with the sources they were read from and the date.
 * The summary: the public FIT protocol documentation at
 * `developer.garmin.com/fit/articles/fit-protocol/fit_protocol.html`,
 * corroborated against the independent format reference at
 * `fitfileeditor.com/skill`, both read 2026-09-04. No Garmin FIT SDK,
 * `Profile.xlsx` or Garmin FIT tool was consulted (R1, R4).
 *
 * ## The invalid marker is not a value, and this is where that is decided
 *
 * Every base type reserves one bit pattern to mean *"this field was not
 * recorded"*. Turning it into a number is the single most consequential bug a
 * FIT decoder can have and it produces no symptom: a heart rate of `0xFF`
 * stored as 255 bpm averages plausibly, and stored as 0 bpm averages plausibly
 * too. `sensor-dropout-30s.fit` exists for exactly this, and the answer is
 * `undefined` — the same answer `packages/store`'s stream channels give a gap,
 * decided in ADR 0011: *"A gap is `undefined`, never a sentinel and never
 * zero."*
 *
 * ## Every field keeps its raw bytes
 *
 * A field carries `bytes` whatever its base type, which is what lets a
 * developer field whose `field_description` has not been seen yet be decoded
 * later rather than dropped — an explicit requirement of #30 — and what lets a
 * base type this narrow profile does not decode be skipped cleanly instead of
 * desynchronising the record.
 */

import { decodeFitString } from './utf8';

/** The base types this decoder reads as numbers. */
export const BASE_TYPE_NUMBER = {
  enum: 0,
  sint8: 1,
  uint8: 2,
  sint16: 3,
  uint16: 4,
  sint32: 5,
  uint32: 6,
  string: 7,
  float32: 8,
  float64: 9,
  uint8z: 10,
  uint16z: 11,
  uint32z: 12,
  byte: 13,
} as const;

/** How the low five bits of a base type byte are extracted. */
export const BASE_TYPE_NUMBER_MASK = 0x1f;

/**
 * The bit that marks a base type whose byte order follows the definition
 * message's architecture field. Read for completeness; the size table below is
 * what the reader actually needs, and a one-byte type has no order to get
 * wrong regardless of what this bit says.
 */
export const BASE_TYPE_ENDIAN_FLAG = 0x80;

interface BaseTypeSpecification {
  readonly name: string;
  /** The width of one element, in bytes. */
  readonly size: number;
  /**
   * The bit pattern that means "not recorded", as the number this decoder
   * reads. `undefined` for the two array-shaped types, whose invalid marker is
   * per element — see `isInvalidByteArray`.
   */
  readonly invalid: number | undefined;
  readonly signed: boolean;
  readonly float: boolean;
}

const SPECIFICATIONS: readonly (readonly [number, BaseTypeSpecification])[] = [
  [BASE_TYPE_NUMBER.enum, { name: 'enum', size: 1, invalid: 0xff, signed: false, float: false }],
  [BASE_TYPE_NUMBER.sint8, { name: 'sint8', size: 1, invalid: 0x7f, signed: true, float: false }],
  [BASE_TYPE_NUMBER.uint8, { name: 'uint8', size: 1, invalid: 0xff, signed: false, float: false }],
  [
    BASE_TYPE_NUMBER.sint16,
    { name: 'sint16', size: 2, invalid: 0x7fff, signed: true, float: false },
  ],
  [
    BASE_TYPE_NUMBER.uint16,
    { name: 'uint16', size: 2, invalid: 0xffff, signed: false, float: false },
  ],
  [
    BASE_TYPE_NUMBER.sint32,
    { name: 'sint32', size: 4, invalid: 0x7fffffff, signed: true, float: false },
  ],
  [
    BASE_TYPE_NUMBER.uint32,
    { name: 'uint32', size: 4, invalid: 0xffffffff, signed: false, float: false },
  ],
  [
    BASE_TYPE_NUMBER.string,
    { name: 'string', size: 1, invalid: undefined, signed: false, float: false },
  ],
  [
    BASE_TYPE_NUMBER.float32,
    { name: 'float32', size: 4, invalid: undefined, signed: true, float: true },
  ],
  [
    BASE_TYPE_NUMBER.float64,
    { name: 'float64', size: 8, invalid: undefined, signed: true, float: true },
  ],
  [
    BASE_TYPE_NUMBER.uint8z,
    { name: 'uint8z', size: 1, invalid: 0x00, signed: false, float: false },
  ],
  [
    BASE_TYPE_NUMBER.uint16z,
    { name: 'uint16z', size: 2, invalid: 0x0000, signed: false, float: false },
  ],
  [
    BASE_TYPE_NUMBER.uint32z,
    { name: 'uint32z', size: 4, invalid: 0x00000000, signed: false, float: false },
  ],
  [
    BASE_TYPE_NUMBER.byte,
    { name: 'byte', size: 1, invalid: undefined, signed: false, float: false },
  ],
];

const BASE_TYPES = new Map<number, BaseTypeSpecification>(SPECIFICATIONS);

/** The base type number a definition message's base type byte denotes. */
export function baseTypeNumberOf(baseTypeByte: number): number {
  return baseTypeByte & BASE_TYPE_NUMBER_MASK;
}

/** The name of a base type, or `undefined` for one this decoder does not read. */
export function baseTypeName(baseTypeByte: number): string | undefined {
  return BASE_TYPES.get(baseTypeNumberOf(baseTypeByte))?.name;
}

/** The width of one element of a base type, or `undefined` if it is unknown. */
export function baseTypeElementSize(baseTypeByte: number): number | undefined {
  return BASE_TYPES.get(baseTypeNumberOf(baseTypeByte))?.size;
}

/**
 * The bit pattern a base type reserves to mean "this field was not recorded",
 * or `undefined` for a type whose invalid marker is not a single number.
 *
 * Exported for the encoder (#31), which has to write the marker the decoder
 * reads. This is the one table the two halves of the codec **must** share: an
 * encoder with its own copy of the invalid markers can drift from the decoder
 * silently, and the symptom is a gap that comes back as data. Contrast
 * `tools/fixture-corpus/fit-profile.ts`, which duplicates the markers on
 * purpose so the corpus can disagree with `src/`.
 */
export function baseTypeInvalidValue(baseTypeByte: number): number | undefined {
  return BASE_TYPES.get(baseTypeNumberOf(baseTypeByte))?.invalid;
}

/** Whether a base type's numeric values are two's-complement signed. */
export function baseTypeIsSigned(baseTypeByte: number): boolean {
  return BASE_TYPES.get(baseTypeNumberOf(baseTypeByte))?.signed ?? false;
}

/** One field of a data message, decoded as far as its base type allows. */
export interface FitFieldValue {
  /** The field definition number, from the definition message. */
  readonly number: number;
  /** The base type byte the definition message declared. */
  readonly baseType: number;
  /** The declared width of the whole field, which may hold several elements. */
  readonly size: number;
  /** Where the field's bytes begin in the file. */
  readonly byteOffset: number;
  /**
   * The value, for a single-element numeric field that is not the invalid
   * marker. `undefined` for a gap, for an array, for a string, and for a base
   * type this decoder does not read as a number.
   */
  readonly numeric: number | undefined;
  /** The text, for a `string` field that is not empty. */
  readonly text: string | undefined;
  /** The field's bytes, always. A view into the file, not a copy. */
  readonly bytes: Uint8Array;
}

function readNumeric(
  view: DataView,
  offset: number,
  specification: BaseTypeSpecification,
  littleEndian: boolean,
): number {
  if (specification.float) {
    return specification.size === 4
      ? view.getFloat32(offset, littleEndian)
      : view.getFloat64(offset, littleEndian);
  }
  if (specification.size === 1) {
    return specification.signed ? view.getInt8(offset) : view.getUint8(offset);
  }
  if (specification.size === 2) {
    return specification.signed
      ? view.getInt16(offset, littleEndian)
      : view.getUint16(offset, littleEndian);
  }
  return specification.signed
    ? view.getInt32(offset, littleEndian)
    : view.getUint32(offset, littleEndian);
}

/**
 * True when every byte of a `byte`-typed field is `0xFF`.
 *
 * The public documentation's note on the `byte` type is that it is an array
 * and is invalid only when *all* its bytes are the invalid value — one
 * `0xFF` inside a sixteen-byte application id is data, not a gap.
 */
export function isInvalidByteArray(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  return bytes.every((byte) => byte === 0xff);
}

/** Decode one field of a data message. Never throws. */
export function readFieldValue(
  bytes: Uint8Array,
  view: DataView,
  field: { readonly number: number; readonly size: number; readonly baseType: number },
  byteOffset: number,
  littleEndian: boolean,
): FitFieldValue {
  const { size, baseType } = field;
  const raw = bytes.subarray(byteOffset, byteOffset + size);
  const specification = BASE_TYPES.get(baseTypeNumberOf(baseType));
  const base = { number: field.number, baseType, size, byteOffset, bytes: raw };

  if (!specification) {
    // A base type outside this narrow profile — a 64-bit integer, say. The
    // definition message gave the field's size, so it is skipped cleanly and
    // its bytes are kept; nothing desynchronises.
    return { ...base, numeric: undefined, text: undefined };
  }

  if (specification.name === 'string') {
    const text = decodeFitString(bytes, byteOffset, size);
    return { ...base, numeric: undefined, text: text === '' ? undefined : text };
  }

  if (specification.name === 'byte' || size !== specification.size) {
    // A `byte` array, or an array of a numeric base type. Nothing in this
    // profile subset reads one as a scalar, so it keeps its bytes and has no
    // numeric value rather than silently becoming its first element.
    return { ...base, numeric: undefined, text: undefined };
  }

  const value = readNumeric(view, byteOffset, specification, littleEndian);
  const invalid =
    specification.invalid === undefined ? Number.isNaN(value) : value === specification.invalid;
  return { ...base, numeric: invalid ? undefined : value, text: undefined };
}
