// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The activity read endpoints (#38): list, detail and streams, through the
 * real handler, every one of them the caller's own and nobody else's.
 *
 * The revision on #38 says the reads a device cannot answer for itself are
 * OTHER athletes' — a feed (#80), cross-athlete leaderboards (#68). No such
 * read exists on this instance yet, because nothing records who may see whose
 * ride; so every route here answers the caller's own activities only, another
 * athlete's is `not_found`, and the coordinate rule is held on the raw bytes
 * of every body these routes send.
 */

import { toHex } from '@onyourleft/domain';
import { decodeFitActivity } from '@onyourleft/fit';
import { afterEach, describe, expect, it } from 'vitest';

import type { IdentityInstance } from '../auth/identity-testing.ts';
import { createMemoryBlobStore } from '../blob/memory-blob-store.ts';
import { openSqlStore } from '../store/open-sql-store.ts';
import { createSync, sha256Bytes } from './sync.ts';
import {
  authorised,
  corpusFile,
  longGpx,
  signedRecordOf,
  syncWorld,
  uploadBody,
} from './sync-testing.ts';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

type Rider = Awaited<ReturnType<typeof syncWorld>>['riders'][number];

/**
 * `count` rides for `rider`, written through the store rather than the route:
 * a list needs records, not files, and a thousand decodes would be the slow
 * part of a test about reading.
 */
async function seedRecords(instance: IdentityInstance, rider: Rider, count: number, from = 0) {
  const records: { bytes: Uint8Array; record: Awaited<ReturnType<typeof signedRecordOf>> }[] = [];
  for (let index = from; index < from + count; index += 1) {
    const bytes = new TextEncoder().encode(`ride ${String(index)} of ${rider.athleteId}`);
    records.push({
      bytes,
      record: await signedRecordOf(rider.device, bytes, `ride-${String(index)}`),
    });
  }
  await instance.freshRead(async (store) => {
    for (const { bytes, record } of records) {
      const signedRecord = new TextEncoder().encode(JSON.stringify(record));
      await store.ingestActivity({
        athleteId: rider.athleteId,
        contentSha256: toHex(await sha256Bytes(bytes)),
        signedRecord,
        recordSha256: toHex(await sha256Bytes(signedRecord)),
        now: Math.floor(instance.clock.ms / 1000),
      });
    }
  });
}

async function upload(instance: IdentityInstance, rider: Rider, bytes: Uint8Array) {
  const answer = await authorised(
    instance,
    rider.token,
    'POST',
    '/v1/sync/records',
    await uploadBody(rider.device, bytes),
  );
  expect(answer.status).toBe(200);
  return ((await answer.json()) as { contentSha256: string }).contentSha256;
}

const READS = (content: string): readonly string[] => [
  '/v1/activities',
  `/v1/activities/${content}`,
  `/v1/activities/${content}/streams`,
  `/v1/activities/${content}/streams?points=50`,
];

describe('the activity reads (#38)', () => {
  it('a ride sent through #37 reads back through the list and the detail, on a fresh connection', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    const body = await uploadBody(rider!.device, corpusFile('nominal-outdoor-ride.fit'), 'ridden');
    const sent = await authorised(world, rider!.token, 'POST', '/v1/sync/records', body);
    const { contentSha256 } = (await sent.json()) as { contentSha256: string };

    // Through the route, and then through a SECOND sync over a fresh
    // connection to the same file and the same blobs: nothing the first cached.
    const list = await authorised(world, rider!.token, 'GET', '/v1/activities');
    const listed = (await list.json()) as { items: { contentSha256: string; claims: unknown }[] };
    expect(listed.items).toEqual([
      expect.objectContaining({ contentSha256, claims: body.record.claims }),
    ]);
    const fresh = await openSqlStore(world.path);
    try {
      const sync = createSync({ store: fresh, blobs: createMemoryBlobStore(world.blobs) });
      const caller = {
        athleteId: rider!.athleteId,
        deviceKey: rider!.device.publicKey,
        tokenSha256: '',
      };
      const page = await sync.activities(caller, new URLSearchParams());
      expect(page.ok && page.value.items.map((item) => item.claims)).toEqual([body.record.claims]);
      const detail = await sync.activity(caller, contentSha256);
      expect(detail.ok && detail.value.record).toEqual(body.record);
      const streams = await sync.streams(caller, contentSha256, new URLSearchParams());
      expect(streams.ok && streams.value.samples).toBe(120);
    } finally {
      await fresh.close();
    }
  });

  it('refuses every read of another athlete’s ride — the stream read included — with not_found', async () => {
    const setup = await syncWorld(3);
    world = setup.world;
    const [anna, ben, cara] = setup.riders;
    const content = await upload(world, anna!, corpusFile('nominal-outdoor-ride.fit'));
    await upload(world, cara!, corpusFile('nominal-ride.gpx'));

    for (const path of READS(content).slice(1)) {
      const own = await authorised(world, anna!.token, 'GET', path);
      expect(own.status, `${path} as its owner`).toBe(200);
      for (const stranger of [ben!, cara!]) {
        const answer = await authorised(world, stranger.token, 'GET', path);
        expect(answer.status, `${path} as another athlete`).toBe(404);
        expect(await answer.text()).not.toContain(content);
      }
    }
    const bens = (await (await authorised(world, ben!.token, 'GET', '/v1/activities')).json()) as {
      items: unknown[];
    };
    expect(bens.items).toEqual([]);
    const caras = (await (
      await authorised(world, cara!.token, 'GET', '/v1/activities')
    ).json()) as {
      items: { contentSha256: string }[];
    };
    expect(caras.items.map((item) => item.contentSha256)).not.toContain(content);
  });

  it('lists 100 rides in ONE store query a page, not one per ride', async () => {
    const setup = await syncWorld(2);
    world = setup.world;
    const [anna, ben] = setup.riders;
    await seedRecords(world, anna!, 100);
    await seedRecords(world, ben!, 10);
    const queries: string[] = [];
    const counted = await openSqlStore(world.path, { onQuery: (sql) => queries.push(sql) });
    try {
      queries.length = 0;
      const sync = createSync({ store: counted, blobs: createMemoryBlobStore() });
      const page = await sync.activities(
        { athleteId: anna!.athleteId, deviceKey: anna!.device.publicKey, tokenSha256: '' },
        new URLSearchParams('limit=100'),
      );
      expect(page.ok && page.value.items.length).toBe(100);
      expect(queries, queries.join('\n')).toHaveLength(1);
    } finally {
      await counted.close();
    }
  });

  it('pages stably while rides are added: every ride present at the start comes back exactly once', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    await seedRecords(world, rider!, 10);
    const before = new Set<string>();
    {
      const all = (await (
        await authorised(world, rider!.token, 'GET', '/v1/activities?limit=200')
      ).json()) as { items: { contentSha256: string }[] };
      for (const item of all.items) before.add(item.contentSha256);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let added = 10;
    do {
      const query: string = cursor === null ? '' : `&cursor=${cursor}`;
      const page = (await (
        await authorised(world, rider!.token, 'GET', `/v1/activities?limit=3${query}`)
      ).json()) as { items: { contentSha256: string }[]; next: string | null };
      seen.push(...page.items.map((item) => item.contentSha256));
      cursor = page.next;
      // Two new rides land between every page.
      await seedRecords(world, rider!, 2, added);
      added += 2;
    } while (cursor !== null);
    expect(new Set(seen).size, 'no ride twice').toBe(seen.length);
    for (const content of before)
      expect(seen, 'no ride present at the start skipped').toContain(content);
  });

  it('serves a chart’s resolution for a fraction of the full series — the ratio asserted', async () => {
    const setup = await syncWorld(1, { bodyLimitBytes: 8 * 1024 * 1024 });
    world = setup.world;
    const [rider] = setup.riders;
    const content = await upload(world, rider!, longGpx(4 * 60 * 60));
    const full = await authorised(world, rider!.token, 'GET', `/v1/activities/${content}/streams`);
    const chart = await authorised(
      world,
      rider!.token,
      'GET',
      `/v1/activities/${content}/streams?points=400`,
    );
    const fullBytes = (await full.arrayBuffer()).byteLength;
    const chartBytes = (await chart.arrayBuffer()).byteLength;
    const fullBody = (await (
      await authorised(world, rider!.token, 'GET', `/v1/activities/${content}/streams`)
    ).json()) as { samples: number; points: number };
    expect(fullBody).toMatchObject({ samples: 14_400, points: 14_400 });
    console.log(
      `#38 transfer: full series ${String(fullBytes)} bytes, 400 points ${String(chartBytes)} bytes, ratio ${(fullBytes / chartBytes).toFixed(1)}`,
    );
    expect(fullBytes / chartBytes).toBeGreaterThan(10);
  }, 30_000);

  it('keeps a gap a gap when it downsamples, and refuses a resolution out of range', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    const content = await upload(world, rider!, corpusFile('sensor-dropout-30s.fit'));
    const full = (await (
      await authorised(world, rider!.token, 'GET', `/v1/activities/${content}/streams`)
    ).json()) as { channels: { heartRate: (number | null)[] } };
    expect(full.channels.heartRate).toContain(null);
    // Two samples a point: a thirty-second dropout is still a run of gaps.
    const half = Math.floor(full.channels.heartRate.length / 2);
    const chart = (await (
      await authorised(
        world,
        rider!.token,
        'GET',
        `/v1/activities/${content}/streams?points=${String(half)}`,
      )
    ).json()) as { channels: { heartRate: (number | null)[] } };
    expect(chart.channels.heartRate.filter((value) => value === null).length).toBeGreaterThan(5);
    for (const points of ['1', '10001', 'ten', '4.5']) {
      const answer = await authorised(
        world,
        rider!.token,
        'GET',
        `/v1/activities/${content}/streams?points=${points}`,
      );
      expect(answer.status, points).toBe(400);
    }
  });

  it('sends no position in any read body — asserted on the raw bytes, not a rendering', async () => {
    const setup = await syncWorld(2);
    world = setup.world;
    const [anna, ben] = setup.riders;
    const bytes = corpusFile('nominal-outdoor-ride.fit');
    const content = await upload(world, anna!, bytes);
    const positions = decodeFitActivity(bytes)
      .activity.records.flatMap((record) =>
        record.position === undefined ? [] : [record.position],
      )
      .slice(0, 20);
    expect(positions.length, 'the fixture has positions to leak').toBeGreaterThan(0);
    for (const reader of [anna!, ben!]) {
      for (const path of READS(content)) {
        const text = await (await authorised(world, reader.token, 'GET', path)).text();
        expect(text).not.toMatch(/"(?:lat|lon|lng|latitude|longitude|position)s?"/i);
        for (const position of positions) {
          const { latitude, longitude } = position as unknown as {
            latitude: number;
            longitude: number;
          };
          expect(text).not.toContain(latitude.toFixed(4));
          expect(text).not.toContain(longitude.toFixed(4));
        }
      }
    }
  });

  it('sends a private ride with no-store, and with nothing a shared cache may keep', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    const content = await upload(world, rider!, corpusFile('nominal-outdoor-ride.fit'));
    for (const path of [...READS(content), `/v1/sync/files/${content}`]) {
      const answer = await authorised(world, rider!.token, 'GET', path);
      expect(answer.status, path).toBe(200);
      const header = answer.headers.get('cache-control') ?? '';
      expect(header, path).toBe('no-store');
      expect(header, path).not.toMatch(/public|max-age|s-maxage/);
    }
  });

  it('answers the list and the detail within their budgets over 1 000 rides — measured, and printed', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    await seedRecords(world, rider!, 1000);
    const first = (await (
      await authorised(world, rider!.token, 'GET', '/v1/activities')
    ).json()) as {
      items: { contentSha256: string }[];
    };
    const timings: Record<string, number> = {};
    for (const [name, path] of [
      ['list', '/v1/activities?limit=50'],
      ['detail', `/v1/activities/${first.items[0]!.contentSha256}`],
    ] as const) {
      const runs: number[] = [];
      for (let run = 0; run < 7; run += 1) {
        const started = performance.now();
        const answer = await authorised(world, rider!.token, 'GET', path);
        await answer.arrayBuffer();
        runs.push(performance.now() - started);
      }
      timings[name] = runs.sort((left, right) => left - right)[3]!;
    }
    console.log(
      `#38 latency over 1 000 rides, median of 7: list ${timings.list!.toFixed(1)} ms, detail ${timings.detail!.toFixed(1)} ms, against ${String(READ_BUDGET_MS)} ms`,
    );
    expect(timings.list).toBeLessThan(READ_BUDGET_MS);
    expect(timings.detail).toBeLessThan(READ_BUDGET_MS);
  }, 60_000);
});

/**
 * #38's budget for a list page and a detail, over a thousand rides, through the
 * listener: 250 ms, the median of seven. Measured on a 2024 laptop at a few
 * milliseconds each; the budget has room for a two-core CI runner under
 * coverage, and each run prints what it measured.
 */
const READ_BUDGET_MS = 250;
