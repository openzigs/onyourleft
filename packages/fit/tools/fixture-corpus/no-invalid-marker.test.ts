// SPDX-License-Identifier: Apache-2.0

/**
 * No committed position may encode to the FIT `sint32` invalid marker.
 *
 * `0x7FFFFFFF` means "this field was not recorded". A *position* carrying it is
 * byte-indistinguishable from an absent one, so a fixture containing one is a
 * trap rather than a test case: a #30 decoder that correctly maps the marker to
 * absent — which `sensor-dropout-30s.fit` requires it to — drops the sample and
 * looks broken against a fixture that claims to exercise something else.
 *
 * This is not hypothetical. Review of PR #111 found exactly one: the
 * antimeridian track stepped onto exactly +180.0000000, and
 * `degreesLongitudeToSemicircles` clamps +180 to `2^31 - 1`, which is the
 * marker. The clamp is correct and documented in `packages/domain`; the fixture
 * was wrong to land on the value that triggers it.
 *
 * The plausible-but-wrong fix, had this reached #30, would have been to
 * special-case position longitude to accept the marker — which breaks dropout
 * handling everywhere else. Hence a guard here rather than a note.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { degreesLatitudeToSemicircles, degreesLongitudeToSemicircles } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { buildCorpus } from './corpus';
import { CORPUS_DIRECTORY } from './corpus-files';
import { INVALID_VALUE } from './fit-profile';
import { positionsIn } from './read-positions';

const corpus = buildCorpus();

describe('no committed position encodes the FIT invalid marker', () => {
  it.each(corpus.map((entry) => [entry.name, entry] as const))(
    '%s carries no position equal to INVALID_VALUE.sint32',
    (name, entry) => {
      const bytes = Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name)));

      positionsIn(entry, bytes).forEach((position, index) => {
        // Decoded from the COMMITTED bytes, then re-encoded through the same
        // function the generator used. That asks the question that matters —
        // "does this position encode to the marker?" — rather than inspecting a
        // degree value and reasoning about the clamp separately. The round trip
        // is exact here because the clamped value decodes and re-encodes to
        // itself.
        expect(
          degreesLatitudeToSemicircles(position.latitude),
          `${name} position ${index} latitude encodes to the sint32 invalid marker`,
        ).not.toBe(INVALID_VALUE.sint32);
        expect(
          degreesLongitudeToSemicircles(position.longitude),
          `${name} position ${index} longitude encodes to the sint32 invalid marker`,
        ).not.toBe(INVALID_VALUE.sint32);
      });
    },
  );
});
