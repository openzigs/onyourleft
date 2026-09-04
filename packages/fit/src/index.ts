// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/fit` — the FIT / GPX / TCX codec.
 *
 * **The FIT decoder is here** (#30). The encoder is #31 and GPX/TCX import and
 * export are #32. Alongside it this package holds what all three are tested
 * against: the synthetic fixture corpus in `fixtures/`, the generator that
 * produces it in `tools/fixture-corpus/`, and the one piece of it that is
 * program-wide rather than corpus-local — the ADR 0004 decision G region check
 * exported below.
 *
 * Everything here obeys [ADR 0006](../../docs/adr/0006-fit-codec-licensing.md):
 * the FIT container and the decoder's profile subset are implemented from the
 * public protocol documentation, and nothing carrying Garmin's terms is in this
 * package, its dependencies or its toolchain. `README.md` records where every
 * number the decoder relies on came from, and `fixtures/README.md` records the
 * same for the corpus — separately, so a disagreement is visible. R2 requires
 * both.
 */

export type { SyntheticTestRegion, SyntheticTestRegionId } from './synthetic-test-regions';

export {
  assertInsideSyntheticTestRegion,
  isInsideSyntheticTestRegion,
  SYNTHETIC_TEST_REGION_IDS,
  SYNTHETIC_TEST_REGIONS,
  SyntheticTestRegionError,
  syntheticTestRegionOf,
} from './synthetic-test-regions';

// --- The FIT decoder (#30) --------------------------------------------------

export * from './decode';
