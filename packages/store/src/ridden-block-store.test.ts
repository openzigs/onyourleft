// SPDX-License-Identifier: Apache-2.0

/**
 * The ridden-block cache — #2891, ADR 0090 D-6: what is kept, read back on a
 * fresh connection after every handle is closed; the bound and the
 * least-recently-ridden eviction, counted on disk through a raw connection;
 * what is refused; and that erasing the rider takes it.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openActivityStore } from './activity-store';
import { StoreReferentialError, StoreValidationError } from './errors';
import {
  RIDDEN_BLOCK_FEATURES_LIMIT_BYTES,
  RIDDEN_BLOCKS_LIMIT,
  type RiddenBlockRecord,
} from './records';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  ATHLETE_A,
  ATHLETE_B,
  createStoreHarness,
  resetFixtureIds,
  riddenBlockFor,
  seedAthletes,
  unpackWorldCorridorFeatures,
} from './testing';
import type { StoreHarness } from './testing';

let harness: StoreHarness;

beforeEach(async () => {
  resetFixtureIds();
  harness = createStoreHarness();
  await seedAthletes(harness);
});

afterEach(async () => {
  await harness.destroy();
});

/** Every row in `riddenBlocks`, read raw on a connection nothing wrote on. */
async function rowsOnDisk(): Promise<RiddenBlockRecord[]> {
  await harness.discard();
  const raw = new Dexie(harness.databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  try {
    return await raw.table<RiddenBlockRecord>(TABLE.riddenBlocks).toArray();
  } finally {
    raw.close();
  }
}

/** An ISO time `minutes` after a fixed start. */
const at = (minutes: number): string => new Date(Date.UTC(2026, 10, 20, 8, minutes)).toISOString();

describe('a ridden block round-trips', () => {
  it('reads back on a fresh connection, its features unpacked to what was packed and its streets byte for byte', async () => {
    const block = await riddenBlockFor(ATHLETE_A);
    await harness.write((store) => store.putRiddenBlock(block));
    const read = await harness.read((store) => store.getRiddenBlock(ATHLETE_A, block.block));
    expect(read).toMatchObject({
      owner: ATHLETE_A,
      block: block.block,
      archive: block.archive,
      readAt: block.readAt,
      riddenAt: block.riddenAt,
      tiles: block.tiles,
      licence: 'ODbL-1.0',
    });
    expect(read && (await unpackWorldCorridorFeatures(read.features))).toStrictEqual(
      await unpackWorldCorridorFeatures(block.features),
    );
    expect(read?.streets).toBeInstanceOf(Blob);
    expect(await read?.streets.text()).toBe(await block.streets.text());
  });

  it('marks a block ridden, and says when there is none to mark', async () => {
    const block = await riddenBlockFor(ATHLETE_A);
    await harness.write((store) => store.putRiddenBlock(block));
    await expect(
      harness.write((store) => store.markRiddenBlock(ATHLETE_A, block.block, at(59))),
    ).resolves.toBe(true);
    await expect(
      harness.write((store) => store.markRiddenBlock(ATHLETE_A, block.block + 1, at(59))),
    ).resolves.toBe(false);
    expect((await rowsOnDisk()).map((row) => row.riddenAt)).toStrictEqual([at(59)]);
  });
});

describe('the cache is bounded, and the least recently ridden go first (D-6.5)', () => {
  it('never holds more than the limit for one owner, and keeps the most recently ridden', async () => {
    const store = openActivityStore(harness.databaseName);
    try {
      // The first block written is ridden again last, so it is the most
      // recently ridden when the limit is passed: it must survive.
      const first = await riddenBlockFor(ATHLETE_A, { block: 0, riddenAt: at(0) });
      await store.putRiddenBlock(first);
      for (let index = 1; index < RIDDEN_BLOCKS_LIMIT; index++) {
        await store.putRiddenBlock({ ...first, block: index, riddenAt: at(index) });
      }
      await expect(store.markRiddenBlock(ATHLETE_A, 0, at(RIDDEN_BLOCKS_LIMIT + 5))).resolves.toBe(
        true,
      );
      // Over the limit by two: the two least recently ridden (blocks 1, 2) go.
      await store.putRiddenBlock({ ...first, block: 9_000, riddenAt: at(RIDDEN_BLOCKS_LIMIT + 6) });
      await store.putRiddenBlock({ ...first, block: 9_001, riddenAt: at(RIDDEN_BLOCKS_LIMIT + 7) });
    } finally {
      store.close();
    }
    const rows = await rowsOnDisk();
    const blocks = new Set(rows.map((row) => row.block));
    expect(rows).toHaveLength(RIDDEN_BLOCKS_LIMIT);
    expect(blocks.has(0)).toBe(true);
    expect(blocks.has(1)).toBe(false);
    expect(blocks.has(2)).toBe(false);
    expect(blocks.has(3)).toBe(true);
    expect(blocks.has(9_000)).toBe(true);
    expect(blocks.has(9_001)).toBe(true);
  });

  it('counts and evicts each owner on their own', async () => {
    const store = openActivityStore(harness.databaseName);
    try {
      const theirs = await riddenBlockFor(ATHLETE_B, { block: 77, riddenAt: at(0) });
      await store.putRiddenBlock(theirs);
      const mine = await riddenBlockFor(ATHLETE_A, { block: 0, riddenAt: at(1) });
      for (let index = 0; index <= RIDDEN_BLOCKS_LIMIT; index++) {
        await store.putRiddenBlock({ ...mine, block: index, riddenAt: at(index + 1) });
      }
    } finally {
      store.close();
    }
    const rows = await rowsOnDisk();
    // B's one block is the oldest on the device, and is still there.
    expect(rows.filter((row) => row.owner === ATHLETE_B).map((row) => row.block)).toStrictEqual([
      77,
    ]);
    expect(rows.filter((row) => row.owner === ATHLETE_A)).toHaveLength(RIDDEN_BLOCKS_LIMIT);
  });
});

describe('what is refused', () => {
  it.each([
    ['another licence', { licence: 'CC-BY-4.0' }],
    ['features that are not a Blob', { features: new Uint8Array(4) }],
    ['streets that are not a Blob', { streets: new Uint8Array(4) }],
    ['no streets at all', { streets: undefined }],
    ['a block that is not a non-negative integer', { block: -1 }],
    ['a fractional block', { block: 1.5 }],
  ])('refuses %s, and writes nothing', async (_name, change) => {
    const block = { ...(await riddenBlockFor(ATHLETE_A)), ...change } as RiddenBlockRecord;
    await expect(harness.write((store) => store.putRiddenBlock(block))).rejects.toBeInstanceOf(
      StoreValidationError,
    );
    expect(await rowsOnDisk()).toStrictEqual([]);
  });

  it('refuses features and streets over the limit together, though each is under it', async () => {
    const half = RIDDEN_BLOCK_FEATURES_LIMIT_BYTES / 2;
    const block = await riddenBlockFor(ATHLETE_A, {
      features: new Blob([new Uint8Array(half)]),
      streets: new Blob([new Uint8Array(half + 1)]),
    });
    await expect(harness.write((store) => store.putRiddenBlock(block))).rejects.toBeInstanceOf(
      StoreValidationError,
    );
    expect(await rowsOnDisk()).toStrictEqual([]);
  });

  it('refuses features over the limit, saying the sizes and never the block', async () => {
    const block = await riddenBlockFor(ATHLETE_A, {
      features: new Blob([new Uint8Array(RIDDEN_BLOCK_FEATURES_LIMIT_BYTES + 1)]),
    });
    const refused = await harness
      .write((store) => store.putRiddenBlock(block))
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(StoreValidationError);
    const message = (refused as Error).message;
    expect(message).toContain(String(RIDDEN_BLOCK_FEATURES_LIMIT_BYTES));
    expect(message).not.toContain(String(block.block));
    for (const tile of block.tiles) {
      expect(message).not.toContain(String(tile.x));
      expect(message).not.toContain(String(tile.y));
    }
    expect(await rowsOnDisk()).toStrictEqual([]);
  });

  it('refuses a block for an athlete there is not, so nothing outlives an erase', async () => {
    const block = await riddenBlockFor(ATHLETE_A);
    await harness.write((store) => store.deleteAthlete(ATHLETE_A));
    await expect(harness.write((store) => store.putRiddenBlock(block))).rejects.toBeInstanceOf(
      StoreReferentialError,
    );
    expect(await rowsOnDisk()).toStrictEqual([]);
  });
});

describe('erasing the rider takes their ridden blocks (D-6.6)', () => {
  it('reads nothing back afterwards, and leaves another athlete’s', async () => {
    const mine = await riddenBlockFor(ATHLETE_A);
    const theirs = await riddenBlockFor(ATHLETE_B);
    await harness.write(async (store) => {
      await store.putRiddenBlock(mine);
      await store.putRiddenBlock(theirs);
    });
    const counts = await harness.write((store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.riddenBlocks).toBe(1);
    await expect(
      harness.read((store) => store.getRiddenBlock(ATHLETE_A, mine.block)),
    ).resolves.toBeUndefined();
    expect((await rowsOnDisk()).map((row) => row.owner)).toStrictEqual([ATHLETE_B]);
  });
});
