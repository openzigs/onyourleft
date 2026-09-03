// SPDX-License-Identifier: Apache-2.0

/**
 * The synthetic test regions, and the check that no fixture leaves them.
 *
 * [ADR 0004](../../../docs/adr/0004-privacy-and-location.md) decision G:
 *
 * > No file recorded by a real device from a real ride may be committed to this
 * > repository, referenced by a test, or used as the evidence for any
 * > acceptance criterion in this program. Every fixture is produced by a
 * > committed generator from parameters in the repository.
 *
 * A prohibition nobody can check is a preference. This module is the mechanical
 * form of the rule: every position in every fixture must fall inside one of the
 * regions below, all of which are open water, so no ride has ever been recorded
 * in any of them. A real trace cannot be made to satisfy it — translating,
 * rotating or noising one does not move it into the middle of the Pacific — and
 * ADR 0004 rules out derivation anyway, because a displaced trace keeps its
 * shape, its timing and its health channels.
 *
 * It lives in `src/` rather than beside the corpus because the rule is
 * program-wide. #65's segment-matching corpus, #67's effort overlay and
 * #75–#78's analysis fixtures are each bound by decision G identically, and a
 * check copy-pasted into four packages is four checks that drift.
 *
 * **The regions are ADR 0004's, not this file's.** Adding one requires the ADR's
 * condition — that it contains no land — to be met and recorded in
 * `fixtures/README.md` next to the region.
 */

import type { GeographicPosition } from '@onyourleft/domain';

/** The identifier of a declared synthetic test region. */
export type SyntheticTestRegionId =
  'NULL-ISLAND' | 'ANTIMERIDIAN-EAST' | 'ANTIMERIDIAN-WEST' | 'POINT-NEMO';

/**
 * A closed latitude/longitude box that contains no land.
 *
 * Bounds are **inclusive** on all four edges. An exclusive bound would make the
 * corner cases in the corpus — which is where the sign and wrap bugs live —
 * unrepresentable in the very region chosen to exercise them.
 */
export interface SyntheticTestRegion {
  readonly id: SyntheticTestRegionId;
  readonly minimumLatitude: number;
  readonly maximumLatitude: number;
  readonly minimumLongitude: number;
  readonly maximumLongitude: number;
  /** Why this box contains no land, which is ADR 0004's condition for adding one. */
  readonly noLandBecause: string;
}

/**
 * The regions ADR 0004 decision G tabulates.
 *
 * The ADR states `ANTIMERIDIAN` as one region with a disjunctive longitude rule
 * (`>= +179.0 or <= -179.0`). It is spelled here as the two boxes that rule
 * denotes, because a box is checkable by four comparisons and a disjunction is
 * checkable by a condition somebody can get subtly wrong. Two boxes also means
 * a track crossing the antimeridian visibly changes region halfway through,
 * which is the property the fixture exists to exercise.
 */
export const SYNTHETIC_TEST_REGIONS: readonly SyntheticTestRegion[] = [
  {
    id: 'NULL-ISLAND',
    minimumLatitude: -1,
    maximumLatitude: 1,
    minimumLongitude: -1,
    maximumLongitude: 1,
    noLandBecause:
      'Open water in the Gulf of Guinea. The nearest land is roughly 380 nautical miles away, ' +
      'and the only structure inside the box is the moored Soul buoy at 0, 0. It straddles ' +
      'both axes, so a fixture here exercises both signs of both coordinates and the zero crossing.',
  },
  {
    id: 'ANTIMERIDIAN-EAST',
    minimumLatitude: -1,
    maximumLatitude: 1,
    minimumLongitude: 179,
    maximumLongitude: 180,
    noLandBecause:
      'Open Pacific. The equatorial 179 E to 180 band lies between the Gilbert and Phoenix ' +
      'island groups and contains no island; the nearest, Nikumaroro, is more than three ' +
      'degrees of latitude south of the box.',
  },
  {
    id: 'ANTIMERIDIAN-WEST',
    minimumLatitude: -1,
    maximumLatitude: 1,
    minimumLongitude: -180,
    maximumLongitude: -179,
    noLandBecause:
      'Open Pacific, the western half of the same crossing. The equatorial 180 to 179 W band ' +
      'contains no island; the nearest, Malden, is four degrees of latitude south of the box.',
  },
  {
    id: 'POINT-NEMO',
    minimumLatitude: -49,
    maximumLatitude: -48,
    minimumLongitude: -124,
    maximumLongitude: -123,
    noLandBecause:
      'The oceanic pole of inaccessibility. The nearest land in any direction is about 1450 ' +
      'nautical miles away, which is the greatest such distance on Earth. A ride-sized box ' +
      'with both coordinates negative, which is the pair no positive-only test can distinguish.',
  },
];

/** The declared region identifiers, in declaration order. */
export const SYNTHETIC_TEST_REGION_IDS: readonly SyntheticTestRegionId[] =
  SYNTHETIC_TEST_REGIONS.map((region) => region.id);

/** The region a position falls in, or `undefined` if it falls in none. */
export function syntheticTestRegionOf(
  position: GeographicPosition,
): SyntheticTestRegion | undefined {
  return SYNTHETIC_TEST_REGIONS.find(
    (region) =>
      position.latitude >= region.minimumLatitude &&
      position.latitude <= region.maximumLatitude &&
      position.longitude >= region.minimumLongitude &&
      position.longitude <= region.maximumLongitude,
  );
}

/** True when a position falls inside a declared synthetic test region. */
export function isInsideSyntheticTestRegion(position: GeographicPosition): boolean {
  return syntheticTestRegionOf(position) !== undefined;
}

/**
 * Thrown when a fixture carries a position outside every declared region.
 *
 * Its own class rather than a bare `Error` so a caller can tell "this fixture
 * may be a real ride" apart from every other way a corpus test can fail.
 */
export class SyntheticTestRegionError extends Error {
  override readonly name = 'SyntheticTestRegionError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Assert that a position taken from a fixture is inside a declared region.
 *
 * **The message carries no coordinate value, deliberately.** ADR 0004 decision
 * D makes an error message a boundary and fixes the rule for coordinates as
 * "the field and the constraint, never the value". This assertion fires exactly
 * when a position that may be a real person's is present, and this repository's
 * CI logs are public — so printing the offending value would publish the one
 * thing the check exists to keep out. The fixture name and the index are enough
 * to find it locally, where the file already is.
 *
 * @param position - the position read out of the fixture.
 * @param fixtureName - the fixture it was read from, for the message.
 * @param positionIndex - its ordinal within that fixture, for the message.
 * @throws {SyntheticTestRegionError} if it falls in no declared region.
 */
export function assertInsideSyntheticTestRegion(
  position: GeographicPosition,
  fixtureName: string,
  positionIndex: number,
): void {
  if (isInsideSyntheticTestRegion(position)) {
    return;
  }
  throw new SyntheticTestRegionError(
    `${fixtureName}: position ${String(positionIndex)} falls outside every synthetic test ` +
      `region (${SYNTHETIC_TEST_REGION_IDS.join(', ')}). ADR 0004 decision G: no real ` +
      `person's ride file is a fixture, anywhere in this program, ever. The offending ` +
      `coordinate is deliberately not printed — decision D, an error message is a boundary. ` +
      `Regenerate the corpus with pnpm --filter @onyourleft/fit run fixtures:generate.`,
  );
}
