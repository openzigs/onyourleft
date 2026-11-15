// SPDX-License-Identifier: Apache-2.0

/**
 * **A segment as it is published to an instance** (#68): the one definition a
 * device sends, the instance stores and ranks against, and another rider's
 * device adds to its own library.
 *
 * Here rather than in either app, for `segment.ts`'s reason: the device and
 * the instance must agree on what a published segment IS, byte for byte,
 * because its identifier is a digest of it. Two parsers would be two places
 * for a segment the device thinks it published to be one the instance never
 * held.
 *
 * ## What is in it, and what is not
 *
 * The five things a matcher needs and a board names: the name, the sport, the
 * path in the direction of travel, the endpoint radius and the bearing
 * tolerance. **Everything derivable is derived**, on whichever side reads it,
 * by `createSegment` — the distance, both endpoints' bearings — so a
 * publisher cannot state a distance that disagrees with the path.
 *
 * ⚠️ **No elevation.** A device that adds another rider's segment matches
 * against the path alone; the gain and grades a publisher's barometer saw are
 * claims nobody else can check, and a board does not rank by them.
 *
 * ⚠️ **No publisher, no visibility, no time.** Who published a segment is the
 * instance's to record and never to send to another rider (the app never holds
 * another rider's athlete id), and publishing IS the visibility: a published
 * segment is shown to every rider on that instance.
 *
 * ## Its identifier
 *
 * {@link publishedSegmentId}: the first 32 hex digits of the SHA-256 of the
 * definition's RFC 8785 canonical JSON. So the same definition published
 * twice — a retry, a second device, a rider who added it and sends it back —
 * is one segment, and a device can say which published segment its own copy
 * is without being told.
 *
 * ⚠️ **ADR 0004 decision D applies to every message here**: a problem with a
 * coordinate names the field and the constraint and never the value.
 */

import { canonicalBytes, canonicalJson, type CanonicalObject } from '../identity/canonical';
import { toHex } from '../identity/hex';
import type { Sha256 } from '../identity/seam';
import { geographicPosition, unixSeconds } from '../quantities';
import type { DegreesLatitude, DegreesLongitude, Metres } from '../quantities';
import { UnitError } from '../unit-error';

import {
  createSegment,
  MAXIMUM_ENDPOINT_REACH_METRES,
  MINIMUM_SEGMENT_LENGTH_METRES,
  MINIMUM_SEGMENT_POSITIONS,
  type Segment,
  type SegmentSport,
} from './segment';

/**
 * The most positions a published path may carry: **10 000**.
 *
 * A 1 Hz recording of an hour-long climb is 3 600; ten thousand leaves room
 * for a long one at a finer rate and keeps a definition well inside an
 * instance's one-megabyte body. A longer path is refused, not thinned: a
 * thinned path is a different segment with a different identifier.
 */
export const MAXIMUM_PUBLISHED_POSITIONS = 10_000;

/** The longest name a published segment may carry, in UTF-16 code units. */
export const MAXIMUM_PUBLISHED_NAME_LENGTH = 80;

/** A segment as an instance holds it. Every member is required. */
export interface PublishedSegmentDefinition {
  readonly name: string;
  readonly sport: SegmentSport;
  /** `[latitude, longitude]` pairs, WGS 84 decimal degrees, in the direction of travel. */
  readonly geometry: readonly (readonly [number, number])[];
  readonly endpointRadiusMetres: number;
  readonly bearingToleranceDegrees: number;
}

/** What {@link parsePublishedDefinition} answers. */
export type PublishedDefinitionParse =
  | {
      readonly ok: true;
      readonly definition: PublishedSegmentDefinition;
      /** The path length, measured here from the path. */
      readonly distance: Metres;
    }
  | { readonly ok: false; readonly field: string; readonly problem: string };

/** The definition a device publishes for one of its own segments. */
export function publishedDefinitionOf(segment: Segment): PublishedSegmentDefinition {
  return {
    name: segment.name,
    sport: segment.sport,
    geometry: segment.geometry.map((position) => [position.latitude, position.longitude] as const),
    endpointRadiusMetres: segment.start.radius,
    bearingToleranceDegrees: segment.bearingToleranceDegrees,
  };
}

const fail = (field: string, problem: string): PublishedDefinitionParse => ({
  ok: false,
  field,
  problem,
});

/** A C0 or C1 control character, or a line or paragraph separator. */
const CONTROL = /\p{Cc}|\p{Zl}|\p{Zp}/u;

const MEMBERS = [
  'bearingToleranceDegrees',
  'endpointRadiusMetres',
  'geometry',
  'name',
  'sport',
].join();

/**
 * `value` as a definition, or the first thing wrong with it — the field and
 * the constraint, never a coordinate (ADR 0004 decision D).
 *
 * Untrusted on both sides: the instance reads what a device sent, and a device
 * reads what an instance served. So exactly the five members, each its type
 * and range, and then `createSegment`'s own rules — at least
 * {@link MINIMUM_SEGMENT_POSITIONS} positions and
 * {@link MINIMUM_SEGMENT_LENGTH_METRES} of path.
 */
export function parsePublishedDefinition(value: unknown): PublishedDefinitionParse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('segment', 'must be an object');
  }
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join() !== MEMBERS) {
    return fail(
      'segment',
      'must have exactly name, sport, geometry, endpointRadiusMetres and bearingToleranceDegrees',
    );
  }
  const { name, sport, geometry, endpointRadiusMetres, bearingToleranceDegrees } = fields;
  if (
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    name.length > MAXIMUM_PUBLISHED_NAME_LENGTH ||
    CONTROL.test(name)
  ) {
    return fail(
      'name',
      `must be 1 to ${String(MAXIMUM_PUBLISHED_NAME_LENGTH)} characters, not blank, with no control character`,
    );
  }
  if (sport !== 'ride' && sport !== 'run') return fail('sport', 'must be ride or run');
  if (
    typeof endpointRadiusMetres !== 'number' ||
    !Number.isFinite(endpointRadiusMetres) ||
    endpointRadiusMetres <= 0 ||
    endpointRadiusMetres > MAXIMUM_ENDPOINT_REACH_METRES
  ) {
    return fail(
      'endpointRadiusMetres',
      `must be more than 0 and at most ${String(MAXIMUM_ENDPOINT_REACH_METRES)} m`,
    );
  }
  if (
    typeof bearingToleranceDegrees !== 'number' ||
    !Number.isFinite(bearingToleranceDegrees) ||
    bearingToleranceDegrees <= 0 ||
    bearingToleranceDegrees > 180
  ) {
    return fail('bearingToleranceDegrees', 'must be more than 0 and at most 180 degrees');
  }
  if (
    !Array.isArray(geometry) ||
    geometry.length < MINIMUM_SEGMENT_POSITIONS ||
    geometry.length > MAXIMUM_PUBLISHED_POSITIONS
  ) {
    return fail(
      'geometry',
      `must be ${String(MINIMUM_SEGMENT_POSITIONS)} to ${String(MAXIMUM_PUBLISHED_POSITIONS)} positions`,
    );
  }
  const path: (readonly [number, number])[] = [];
  for (const position of geometry as unknown[]) {
    if (!Array.isArray(position) || position.length !== 2) {
      return fail('geometry', 'every position must be [latitude, longitude]');
    }
    const [latitude, longitude] = position as unknown[];
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      // The constraint, never the value (ADR 0004 decision D).
      return fail(
        'geometry',
        'every latitude must be within ±90 and every longitude within ±180 degrees',
      );
    }
    path.push([latitude, longitude]);
  }
  const definition: PublishedSegmentDefinition = {
    name,
    sport,
    geometry: path,
    endpointRadiusMetres,
    bearingToleranceDegrees,
  };
  try {
    const segment = segmentFromPublished(definition, { id: '', createdBy: '', createdAt: 0 });
    return { ok: true, definition, distance: segment.distance };
  } catch (error) {
    if (error instanceof UnitError) {
      return fail(
        'geometry',
        `must be a path of at least ${String(MINIMUM_SEGMENT_LENGTH_METRES)} m that moves`,
      );
    }
    throw error;
  }
}

/**
 * A {@link Segment} from a published definition, with everything derivable
 * derived by `createSegment` — what a device adds to its own library, and what
 * the instance measures the distance of.
 *
 * `visibility` is `public` because a published segment is: the instance shows
 * it to every rider on it. A device that adds one keeps that.
 *
 * @throws {UnitError} for a path `createSegment` refuses.
 */
export function segmentFromPublished(
  definition: PublishedSegmentDefinition,
  identity: { readonly id: string; readonly createdBy: string; readonly createdAt: number },
): Segment {
  return createSegment({
    id: identity.id,
    createdBy: identity.createdBy,
    name: definition.name,
    sport: definition.sport,
    geometry: definition.geometry.map(([latitude, longitude]) =>
      geographicPosition(latitude as DegreesLatitude, longitude as DegreesLongitude),
    ),
    elevationSource: 'none',
    visibility: 'public',
    createdAt: unixSeconds(identity.createdAt),
    endpointRadiusMetres: definition.endpointRadiusMetres,
    bearingToleranceDegrees: definition.bearingToleranceDegrees,
  });
}

/** The five members, named, so nothing else a caller's object carries is digested. */
function definitionValue(definition: PublishedSegmentDefinition): CanonicalObject {
  return {
    name: definition.name,
    sport: definition.sport,
    geometry: definition.geometry.map(([latitude, longitude]) => [latitude, longitude]),
    endpointRadiusMetres: definition.endpointRadiusMetres,
    bearingToleranceDegrees: definition.bearingToleranceDegrees,
  };
}

/** The definition's canonical JSON: what is stored, and what the identifier digests. */
export function canonicalDefinition(definition: PublishedSegmentDefinition): string {
  return canonicalJson(definitionValue(definition));
}

/** How long a published segment's identifier is, in hex digits: 128 bits. */
export const PUBLISHED_SEGMENT_ID_LENGTH = 32;

/** A published segment's identifier: lower-case hex, {@link PUBLISHED_SEGMENT_ID_LENGTH} digits. */
export const PUBLISHED_SEGMENT_ID = /^[0-9a-f]{32}$/;

/** The identifier of a definition: the first 32 hex digits of its canonical JSON's SHA-256. */
export async function publishedSegmentId(
  definition: PublishedSegmentDefinition,
  sha256: Sha256,
): Promise<string> {
  const digest = await sha256(canonicalBytes(definitionValue(definition)));
  return toHex(digest).slice(0, PUBLISHED_SEGMENT_ID_LENGTH);
}
