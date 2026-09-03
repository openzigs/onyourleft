// SPDX-License-Identifier: Apache-2.0

/**
 * ADR 0004 decision G, made mechanical.
 *
 * > No file recorded by a real device from a real ride may be committed to this
 * > repository, referenced by a test, or used as the evidence for any
 * > acceptance criterion in this program.
 *
 * The tests below assert against the **committed files on disk**, not against
 * anything the generator is holding in memory, and they iterate **every**
 * position rather than a sample.
 *
 * The chain that makes them sufficient has three links, each asserted
 * separately here and in `corpus.test.ts`:
 *
 *  1. the corpus directory contains exactly the files the generator produces,
 *     so a real ride file dropped in beside them fails whatever it contains;
 *  2. every committed file's bytes equal a fresh generation, so the offsets the
 *     generator recorded describe the committed file;
 *  3. every position read out of those bytes is inside a declared region.
 *
 * This has been watched to fail. See the pull request for the output of a run
 * with a real-looking coordinate temporarily added to the corpus.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertInsideSyntheticTestRegion,
  isInsideSyntheticTestRegion,
  SyntheticTestRegionError,
} from '@onyourleft/fit';
import { describe, expect, it } from 'vitest';

import { buildCorpus } from './corpus';
import { CORPUS_DIRECTORY } from './corpus-files';
import { positionsIn, positionsInXmlText, UnpairedCoordinateError } from './read-positions';

const corpus = buildCorpus();

const committedBytes = (name: string): Uint8Array =>
  Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name)));

describe('every position in every committed fixture', () => {
  it.each(corpus.map((entry) => [entry.name, entry] as const))(
    '%s is entirely inside a declared synthetic test region',
    (name, entry) => {
      const positions = positionsIn(entry, committedBytes(name));

      // For the six XML fixtures this is a real check: the count comes from
      // scanning tokens in the committed text, against a count the generator
      // recorded separately.
      //
      // ⚠️ For the thirteen FIT fixtures it is a TAUTOLOGY, and saying so is the
      // point. `entry.positionCount` is `built.positionOffsets.length` and
      // `positionsInFitBytes` maps those same offsets, so it reduces to
      // `offsets.length === offsets.length`. It was previously commented as
      // though it closed a gap it cannot close. CLAUDE.md §5: a test that cannot
      // fail is not a test.
      //
      // The property IS anchored, just not here — `MANIFEST.json` and the README
      // both record `positionCount` independently of the generator, so shrinking
      // `positionOffsets` reddens `corpus.test.ts`. That is the real guard; this
      // line is kept for the XML half and is left honest about the rest.
      expect(positions).toHaveLength(entry.positionCount);

      positions.forEach((position, index) => {
        assertInsideSyntheticTestRegion(position, name, index);
      });
    },
  );

  it('is a non-trivial number of positions, so this cannot pass vacuously', () => {
    const total = corpus.reduce(
      (count, entry) => count + positionsIn(entry, committedBytes(entry.name)).length,
      0,
    );
    expect(total).toBeGreaterThan(500);
  });

  it('includes at least one position in each of the four regions', () => {
    const seen = new Set<string>();
    for (const entry of corpus) {
      for (const position of positionsIn(entry, committedBytes(entry.name))) {
        if (position.latitude < -40) seen.add('POINT-NEMO');
        else if (position.longitude >= 179) seen.add('ANTIMERIDIAN-EAST');
        else if (position.longitude <= -179) seen.add('ANTIMERIDIAN-WEST');
        else seen.add('NULL-ISLAND');
      }
    }
    expect([...seen].sort()).toEqual([
      'ANTIMERIDIAN-EAST',
      'ANTIMERIDIAN-WEST',
      'NULL-ISLAND',
      'POINT-NEMO',
    ]);
  });

  it('includes a negative latitude and a negative longitude, in the same position', () => {
    const anyNegativePair = corpus.some((entry) =>
      positionsIn(entry, committedBytes(entry.name)).some(
        (position) => position.latitude < 0 && position.longitude < 0,
      ),
    );
    expect(anyNegativePair).toBe(true);
  });

  it('carries no position at all in the indoor fixtures', () => {
    for (const name of ['indoor-trainer-no-position.fit', 'indoor-no-position.tcx']) {
      const entry = corpus.find((candidate) => candidate.name === name);
      expect(entry).toBeDefined();
      expect(entry && positionsIn(entry, committedBytes(name))).toHaveLength(0);
    }
  });
});

// The guard is only worth what its ability to say "no" is worth. These are the
// cases that prove it can.
describe('the guard rejects what it is for', () => {
  it('rejects a real-looking coordinate read out of a FIT fixture', () => {
    // London: 51.5074 N, 0.1278 W, in the semicircles a FIT file would hold.
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setInt32(0, Math.round(51.5074 / (180 / 2 ** 31)), true);
    view.setInt32(4, Math.round(-0.1278 / (180 / 2 ** 31)), true);

    const [position] = positionsIn(
      {
        ...(corpus[0] as (typeof corpus)[number]),
        positionOffsets: [{ latitudeOffset: 0, longitudeOffset: 4 }],
      },
      bytes,
    );
    expect(position).toBeDefined();
    expect(position && isInsideSyntheticTestRegion(position)).toBe(false);
    expect(() => {
      assertInsideSyntheticTestRegion(
        position as NonNullable<typeof position>,
        'someones-commute.fit',
        0,
      );
    }).toThrow(SyntheticTestRegionError);
  });

  it('rejects a real-looking coordinate in a GPX attribute', () => {
    const [position] = positionsInXmlText('<trkpt lat="41.9794000" lon="2.8214000"></trkpt>');
    expect(position && isInsideSyntheticTestRegion(position)).toBe(false);
  });

  it('rejects a real-looking coordinate in a TCX element', () => {
    const [position] = positionsInXmlText(
      '<LatitudeDegrees>40.0150000</LatitudeDegrees><LongitudeDegrees>-105.2705000</LongitudeDegrees>',
    );
    expect(position && isInsideSyntheticTestRegion(position)).toBe(false);
  });

  it('refuses a document whose coordinates do not pair up, rather than skipping one', () => {
    expect(() => positionsInXmlText('<trkpt lat="0.5" lon="0.5"/><trkpt lat="51.5074"/>')).toThrow(
      UnpairedCoordinateError,
    );
  });

  it('sees a coordinate that is not a valid coordinate at all, instead of throwing on the way', () => {
    // A latitude of 91 is not a position; the guard must still report it as
    // outside every region rather than failing while parsing it, or a hostile
    // fixture could crash the check instead of failing it.
    const [position] = positionsInXmlText('<trkpt lat="91.0000000" lon="0.0000000"></trkpt>');
    expect(position && isInsideSyntheticTestRegion(position)).toBe(false);
  });
});
