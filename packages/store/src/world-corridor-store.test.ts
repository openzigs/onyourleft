// SPDX-License-Identifier: Apache-2.0

/**
 * World corridors (#1545, ADR 0054 D-3): the map features in one route's
 * corridor, kept in an ODbL store of their own — one row per owner and route,
 * deleted with the route and with the account, bounded at 16 MiB.
 *
 * Every read here is on a connection the write never touched (the harness's
 * `read`), and the features are decoded and compared, not the row's key
 * fields: a row that came back with somebody else's blob, or an empty one,
 * would pass a key comparison.
 */

import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openActivityStore } from './activity-store';
import { StoreReferentialError, StoreValidationError, WorldCorridorTooLargeError } from './errors';
import { WORLD_CORRIDOR_FEATURES_LIMIT_BYTES, type WorldCorridorRecord } from './records';
import { SCHEMA_VERSIONS, TABLE } from './schema';
import {
  ATHLETE_A,
  ATHLETE_B,
  ATHLETE_C,
  createStoreHarness,
  memoryWriteStoreFactory,
  resetFixtureIds,
  routeFor,
  seedAthletes,
  unpackWorldCorridorFeatures,
  worldCorridorFeaturesFor,
  worldCorridorFor,
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

/** Every row in `worldCorridors`, read raw on a connection of its own. */
async function rowsOnDisk(): Promise<WorldCorridorRecord[]> {
  await harness.discard();
  const raw = new Dexie(harness.databaseName);
  SCHEMA_VERSIONS.forEach((stores, index) => {
    raw.version(index + 1).stores(stores);
  });
  try {
    return await raw.table<WorldCorridorRecord>(TABLE.worldCorridors).toArray();
  } finally {
    raw.close();
  }
}

describe('a world corridor round trip — #1545', () => {
  it('reads the features back, feature by feature, on a fresh ActivityStore', async () => {
    const route = routeFor(ATHLETE_A);
    const corridor = await worldCorridorFor(ATHLETE_A, route.id);
    await harness.write(async (store) => {
      await store.putRoute(route);
      await store.putWorldCorridor(corridor);
    });
    // Close every connection, then a NEW ActivityStore on the same database —
    // not the harness's handle, the class the consumer opens.
    await harness.discard();
    const fresh = openActivityStore(harness.databaseName);
    const read = await fresh.getWorldCorridor(ATHLETE_A, route.id);
    fresh.close();

    expect(read).toBeDefined();
    if (read === undefined) return;
    expect({ ...read, features: undefined }).toStrictEqual({ ...corridor, features: undefined });
    expect(read.features.size).toBe(corridor.features.size);
    const decoded = await unpackWorldCorridorFeatures(read.features);
    const input = worldCorridorFeaturesFor(ATHLETE_A);
    // Feature by feature, so a failure names which one did not come back.
    expect(decoded.buildings).toStrictEqual(input.buildings);
    expect(decoded.landuse).toStrictEqual(input.landuse);
    expect(decoded.water).toStrictEqual(input.water);
    expect(decoded.footways).toStrictEqual(input.footways);
    expect(read.licence).toBe('ODbL-1.0');
  });

  it('goes red against a store that answers the write and keeps nothing', async () => {
    const broken = createStoreHarness({ factory: memoryWriteStoreFactory() });
    try {
      await seedAthletes(broken);
      const route = routeFor(ATHLETE_A);
      await broken.write(async (store) => store.putRoute(route));
      const corridor = await worldCorridorFor(ATHLETE_A, route.id);
      const read = await broken.roundTrip(
        async (store) => store.putWorldCorridor(corridor),
        async (store) => store.getWorldCorridor(ATHLETE_A, route.id),
      );
      expect(read).toBeUndefined();
    } finally {
      await broken.destroy();
    }
  });

  it('replaces the corridor kept for an owner and route, rather than adding one', async () => {
    const route = routeFor(ATHLETE_A);
    await harness.write(async (store) => {
      await store.putRoute(route);
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_A, route.id));
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_A, route.id, { seed: 1 }));
    });
    const read = await harness.read(async (store) => store.getWorldCorridor(ATHLETE_A, route.id));
    expect(read && (await unpackWorldCorridorFeatures(read.features))).toStrictEqual(
      worldCorridorFeaturesFor(ATHLETE_A, 1),
    );
    await expect(rowsOnDisk()).resolves.toHaveLength(1);
  });
});

describe('a world corridor is the owner’s — #1545', () => {
  it('two owners holding a corridor for the SAME route id string each read only their own', async () => {
    // A route id is unique on the device, so the public write cannot make
    // this state (it refuses a corridor for a route the owner does not have).
    // It is written raw here — a hand edit, or a future sync — because the
    // key is `[owner+routeId]` exactly so that it can never matter.
    const route = routeFor(ATHLETE_A);
    const mine = await worldCorridorFor(ATHLETE_A, route.id);
    await harness.write(async (store) => {
      await store.putRoute(route);
      await store.putWorldCorridor(mine);
    });
    await harness.discard();
    const raw = new Dexie(harness.databaseName);
    SCHEMA_VERSIONS.forEach((stores, index) => {
      raw.version(index + 1).stores(stores);
    });
    await raw.table(TABLE.worldCorridors).put(await worldCorridorFor(ATHLETE_B, route.id));
    raw.close();

    const [a, b, c] = await harness.read(async (store) =>
      Promise.all([
        store.getWorldCorridor(ATHLETE_A, route.id),
        store.getWorldCorridor(ATHLETE_B, route.id),
        store.getWorldCorridor(ATHLETE_C, route.id),
      ]),
    );
    expect(a?.owner).toBe(ATHLETE_A);
    expect(a && (await unpackWorldCorridorFeatures(a.features))).toStrictEqual(
      worldCorridorFeaturesFor(ATHLETE_A),
    );
    expect(b?.owner).toBe(ATHLETE_B);
    expect(b && (await unpackWorldCorridorFeatures(b.features))).toStrictEqual(
      worldCorridorFeaturesFor(ATHLETE_B),
    );
    expect(c).toBeUndefined();
  });

  it('refuses a corridor for a route the owner does not have, and writes nothing', async () => {
    const route = routeFor(ATHLETE_A);
    await harness.write(async (store) => store.putRoute(route));
    const theirs = await worldCorridorFor(ATHLETE_B, route.id);
    await expect(harness.write(async (store) => store.putWorldCorridor(theirs))).rejects.toThrow(
      StoreReferentialError,
    );
    await expect(rowsOnDisk()).resolves.toStrictEqual([]);
  });

  it('refuses a record that does not say it is ODbL 1.0', async () => {
    const route = routeFor(ATHLETE_A);
    await harness.write(async (store) => store.putRoute(route));
    const corridor = await worldCorridorFor(ATHLETE_A, route.id);
    const unlicensed = { ...corridor, licence: 'Apache-2.0' } as unknown as WorldCorridorRecord;
    await expect(
      harness.write(async (store) => store.putWorldCorridor(unlicensed)),
    ).rejects.toThrow(StoreValidationError);
    await expect(rowsOnDisk()).resolves.toStrictEqual([]);
  });
});

describe('a world corridor goes with its route and with the account — #1545', () => {
  it('deleting the route, through the call the Routes screen makes, deletes its corridor', async () => {
    const route = routeFor(ATHLETE_A);
    const kept = routeFor(ATHLETE_A);
    const others = routeFor(ATHLETE_B);
    await harness.write(async (store) => {
      await store.putRoute(route);
      await store.putRoute(kept);
      await store.putRoute(others);
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_A, route.id));
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_A, kept.id, { seed: 1 }));
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_B, others.id));
    });

    await expect(
      harness.write(async (store) => store.deleteRoute(ATHLETE_A, route.id)),
    ).resolves.toBe(true);

    const [gone, stays, theirs] = await harness.read(async (store) =>
      Promise.all([
        store.getWorldCorridor(ATHLETE_A, route.id),
        store.getWorldCorridor(ATHLETE_A, kept.id),
        store.getWorldCorridor(ATHLETE_B, others.id),
      ]),
    );
    expect(gone).toBeUndefined();
    expect(stays?.routeId).toBe(kept.id);
    expect(theirs?.routeId).toBe(others.id);
  });

  it('deleting a route that is not the owner’s deletes nobody’s corridor', async () => {
    const theirs = routeFor(ATHLETE_B);
    await harness.write(async (store) => {
      await store.putRoute(theirs);
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_B, theirs.id));
    });
    await expect(
      harness.write(async (store) => store.deleteRoute(ATHLETE_A, theirs.id)),
    ).resolves.toBe(false);
    await expect(
      harness.read(async (store) => store.getWorldCorridor(ATHLETE_B, theirs.id)),
    ).resolves.toBeDefined();
  });

  it('deleting the account deletes every corridor of that owner and no other', async () => {
    const first = routeFor(ATHLETE_A);
    const second = routeFor(ATHLETE_A);
    const others = routeFor(ATHLETE_B);
    await harness.write(async (store) => {
      await store.putRoute(first);
      await store.putRoute(second);
      await store.putRoute(others);
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_A, first.id));
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_A, second.id, { seed: 1 }));
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_B, others.id));
    });

    const counts = await harness.write(async (store) => store.deleteAthlete(ATHLETE_A));
    expect(counts.worldCorridors).toBe(2);

    const left = await rowsOnDisk();
    expect(left.map((row) => [row.owner, row.routeId])).toStrictEqual([[ATHLETE_B, others.id]]);
  });

  it('deleteWorldCorridor drops the corridor and leaves the route', async () => {
    const route = routeFor(ATHLETE_A);
    await harness.write(async (store) => {
      await store.putRoute(route);
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_A, route.id));
      await store.deleteWorldCorridor(ATHLETE_A, route.id);
    });
    const [corridor, kept] = await harness.read(async (store) =>
      Promise.all([
        store.getWorldCorridor(ATHLETE_A, route.id),
        store.getRoute(ATHLETE_A, route.id),
      ]),
    );
    expect(corridor).toBeUndefined();
    expect(kept?.id).toBe(route.id);
  });
});

describe('a world corridor is bounded at 16 MiB — #1545', () => {
  it('keeps a features blob of exactly the limit', async () => {
    expect(WORLD_CORRIDOR_FEATURES_LIMIT_BYTES).toBe(16 * 1024 * 1024);
    const route = routeFor(ATHLETE_A);
    const features = new Blob([new Uint8Array(WORLD_CORRIDOR_FEATURES_LIMIT_BYTES)]);
    await harness.write(async (store) => {
      await store.putRoute(route);
      await store.putWorldCorridor(await worldCorridorFor(ATHLETE_A, route.id, { features }));
    });
    const read = await harness.read(async (store) => store.getWorldCorridor(ATHLETE_A, route.id));
    expect(read?.features.size).toBe(WORLD_CORRIDOR_FEATURES_LIMIT_BYTES);
  });

  it('refuses one byte more, naming the limit and the size and no coordinate, and changes nothing', async () => {
    const route = routeFor(ATHLETE_A);
    const kept = await worldCorridorFor(ATHLETE_A, route.id);
    await harness.write(async (store) => {
      await store.putRoute(route);
      await store.putWorldCorridor(kept);
    });
    const size = WORLD_CORRIDOR_FEATURES_LIMIT_BYTES + 1;
    const over = await worldCorridorFor(ATHLETE_A, route.id, {
      seed: 1,
      features: new Blob([new Uint8Array(size)]),
    });

    const refusal: unknown = await harness
      .write(async (store) => store.putWorldCorridor(over))
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(refusal).toBeInstanceOf(WorldCorridorTooLargeError);
    expect(refusal).toBeInstanceOf(StoreValidationError);
    const error = refusal as WorldCorridorTooLargeError;
    expect(error.limitBytes).toBe(WORLD_CORRIDOR_FEATURES_LIMIT_BYTES);
    expect(error.sizeBytes).toBe(size);
    expect(error.message).toBe(
      `worldCorridors.features: ${String(size)} bytes is over the limit of ${String(WORLD_CORRIDOR_FEATURES_LIMIT_BYTES)} bytes`,
    );
    // ADR 0004 D: no number in the message but the two it names — no tile's
    // x or y, no feature coordinate.
    const numbers = error.message.match(/\d+(?:\.\d+)?/g) ?? [];
    expect(numbers).toStrictEqual([String(size), String(WORLD_CORRIDOR_FEATURES_LIMIT_BYTES)]);

    // The store is unchanged: the corridor kept before is the one on disk.
    const read = await harness.read(async (store) => store.getWorldCorridor(ATHLETE_A, route.id));
    expect(read?.readAt).toBe(kept.readAt);
    expect(read && (await unpackWorldCorridorFeatures(read.features))).toStrictEqual(
      worldCorridorFeaturesFor(ATHLETE_A),
    );
    await expect(rowsOnDisk()).resolves.toHaveLength(1);
  });
});
