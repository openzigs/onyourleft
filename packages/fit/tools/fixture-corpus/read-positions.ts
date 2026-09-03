// SPDX-License-Identifier: Apache-2.0

/**
 * Read every position **out of a committed fixture**.
 *
 * The ADR 0004 decision G criterion is that *a test asserts every position in
 * every fixture falls inside a documented synthetic test region*. "In every
 * fixture" is doing the work: a check that asked the generator what it believed
 * it had written would pass over a corpus whose committed bytes said something
 * else. So these functions take bytes and text.
 *
 * This is **not** a decoder, and it must not become one. For FIT it reads two
 * `sint32` fields at offsets the builder recorded while writing them — four
 * bytes each, little-endian, no message parsing at all — and the byte-equality
 * test in `corpus.test.ts` is what ties those offsets to the committed file.
 * For GPX and TCX it scans the document text for coordinate tokens, which needs
 * no XML parser and, more to the point, cannot inherit an XML parser's bugs. A
 * corpus validated by the parser it exists to test proves only that the two
 * share a defect.
 */

import type { GeographicPosition } from '@onyourleft/domain';
import {
  latitudeSemicircles,
  longitudeSemicircles,
  semicirclesToPosition,
} from '@onyourleft/domain';

import type { CorpusEntry } from './corpus';
import type { PositionFieldOffsets } from './fit-file-builder';

/** Every latitude token GPX and TCX use, in the order they appear. */
const LATITUDE_PATTERNS = [/\blat="([^"]*)"/g, /<LatitudeDegrees>([^<]*)<\/LatitudeDegrees>/g];

/** Every longitude token GPX and TCX use, in the order they appear. */
const LONGITUDE_PATTERNS = [/\blon="([^"]*)"/g, /<LongitudeDegrees>([^<]*)<\/LongitudeDegrees>/g];

/** Decode the positions a FIT fixture holds at the recorded field offsets. */
export function positionsInFitBytes(
  bytes: Uint8Array,
  offsets: readonly PositionFieldOffsets[],
): readonly GeographicPosition[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return offsets.map((offset) =>
    // `latitudeSemicircles` and `longitudeSemicircles` are the labelling
    // functions packages/domain exposes for exactly this moment: an unlabelled
    // sint32 off the wire becoming one coordinate or the other. They are
    // distinct branded types, so these two arguments cannot be transposed
    // without a compile error.
    semicirclesToPosition(
      latitudeSemicircles(view.getInt32(offset.latitudeOffset, true)),
      longitudeSemicircles(view.getInt32(offset.longitudeOffset, true)),
    ),
  );
}

function tokens(text: string, patterns: readonly RegExp[]): readonly string[] {
  return patterns
    .flatMap((pattern) =>
      [...text.matchAll(pattern)].map((match) => ({ index: match.index, value: match[1] ?? '' })),
    )
    .sort((left, right) => left.index - right.index)
    .map((found) => found.value);
}

/** Thrown when a text fixture's coordinates do not pair up. */
export class UnpairedCoordinateError extends Error {
  override readonly name = 'UnpairedCoordinateError';
}

/**
 * Every position in a GPX or TCX document, by scanning its text.
 *
 * A latitude with no longitude beside it is an error rather than something to
 * skip: an unpaired coordinate is a coordinate the region check would not see,
 * which is the one way a real position could slip past this guard.
 */
export function positionsInXmlText(text: string): readonly GeographicPosition[] {
  const latitudes = tokens(text, LATITUDE_PATTERNS);
  const longitudes = tokens(text, LONGITUDE_PATTERNS);
  if (latitudes.length !== longitudes.length) {
    throw new UnpairedCoordinateError(
      `found ${String(latitudes.length)} latitude tokens and ${String(longitudes.length)} ` +
        'longitude tokens; every coordinate must be paired or the region check cannot see it',
    );
  }
  return latitudes.map((latitude, index) => {
    const longitude = longitudes[index] ?? '';
    return coordinatePair(latitude, longitude);
  });
}

function coordinatePair(latitude: string, longitude: string): GeographicPosition {
  const parsedLatitude = Number(latitude);
  const parsedLongitude = Number(longitude);
  if (!Number.isFinite(parsedLatitude) || !Number.isFinite(parsedLongitude)) {
    throw new UnpairedCoordinateError('a coordinate token was not a finite number');
  }
  // Deliberately not `degreesLatitude`/`degreesLongitude`: those throw on a
  // value outside the coordinate range, and this guard has to be able to *see*
  // a position that is wrong rather than fail on the way to looking at it.
  // Out-of-range values are reported by the region check like anything else.
  return { latitude: parsedLatitude, longitude: parsedLongitude } as GeographicPosition;
}

/** Every position in a committed fixture, whatever format it is in. */
export function positionsIn(
  entry: CorpusEntry,
  committedBytes: Uint8Array,
): readonly GeographicPosition[] {
  if (entry.format === 'fit') {
    return positionsInFitBytes(committedBytes, entry.positionOffsets);
  }
  return positionsInXmlText(new TextDecoder('utf-8', { fatal: true }).decode(committedBytes));
}
