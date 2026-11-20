// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Hostile tiles for the open-world read** — #2890's synthetic fixtures,
 * committed beside `area-reads.test.ts`, which names each one.
 *
 * ⚠️ **A `-testing.ts` file** (`check-wiring.mjs` §`isTestSupport`): imported
 * by tests, never by anything that ships. Every fixture is arithmetic — zeros
 * or a few hand-written bytes — and none holds OpenStreetMap data. They are
 * built on demand rather than held, because the largest is 32 MiB once
 * decompressed (the point of it); gzipped by the synthetic archive
 * (`archive-testing.ts` §`buildArchive`) it is some 32 KiB.
 */

import { MAX_TILE_BYTES } from '@onyourleft/map-features';

import type { CorridorFailure } from '../game/world-data/corridor';

export interface HostileTile {
  /** What the fixture is, as the test names it. */
  readonly name: string;
  /** Whether the archive stores its tiles gzipped (the bomb must be) or plain (the oversize tile). */
  readonly gzip: boolean;
  /** The tile's bytes as the archive is built from them, before any gzip. */
  readonly bytes: () => Uint8Array;
  /** How the read refuses it, in `describeCorridorFailure`'s terms. */
  readonly refusedAs: CorridorFailure;
}

export const HOSTILE_TILES: readonly HostileTile[] = [
  {
    name: 'an oversize tile: one byte over MAX_TILE_BYTES, stored uncompressed',
    gzip: false,
    bytes: () => new Uint8Array(MAX_TILE_BYTES + 1),
    // `archiveSource` refuses a range longer than a tile may be before it asks.
    refusedAs: { kind: 'not-a-range' },
  },
  {
    name: 'a malformed protobuf: a length-delimited field whose length varint is cut off',
    gzip: true,
    bytes: () => Uint8Array.of(0x1a, 0x80),
    refusedAs: { kind: 'refusal', refusal: { reason: 'malformed', layer: null } },
  },
  {
    name: 'a compression bomb: 32 MiB of zeros, some 32 KiB gzipped',
    gzip: true,
    bytes: () => new Uint8Array(8 * MAX_TILE_BYTES),
    refusedAs: { kind: 'too-large', limit: MAX_TILE_BYTES },
  },
];
