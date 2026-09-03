// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/fit` — the FIT / GPX / TCX codec.
 *
 * **The codec itself is not here yet.** The decoder is #30, the encoder is #31
 * and GPX/TCX import and export are #32. What this package holds today is what
 * those three will be tested against: the synthetic fixture corpus in
 * `fixtures/`, the generator that produces it in `tools/fixture-corpus/`, and
 * the one piece of it that is program-wide rather than corpus-local — the
 * ADR 0004 decision G region check exported below.
 *
 * Everything here obeys [ADR 0006](../../docs/adr/0006-fit-codec-licensing.md):
 * the FIT container is implemented from the public protocol documentation, and
 * nothing carrying Garmin's terms is in this package, its dependencies or its
 * toolchain. `fixtures/README.md` records where every protocol number came
 * from, as R2 requires.
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
