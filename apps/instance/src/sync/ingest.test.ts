// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Ingestion of signed records (#37), through the real handler behind the real
 * listener, the real store on a SQLite file and a blob store the test reads
 * directly. Every "nothing was stored" is read back from BOTH stores, on a
 * fresh connection for the database — asserting against the response alone is
 * the wrong-harness shape `CLAUDE.md` §5 names.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { testDevice, type IdentityInstance } from '../auth/identity-testing.ts';
import { DEFAULT_BODY_LIMIT_BYTES } from '../config.ts';
import type { SqlStore } from '../store/sql-store.ts';
import { sha256Bytes, toBase64 } from './sync.ts';
import { corpusFile, longGpx, signedRecordOf, syncWorld, uploadBody } from './sync-testing.ts';
import { toHex } from '@onyourleft/domain';

let world: IdentityInstance | undefined;
afterEach(async () => {
  await world?.close();
  world = undefined;
});

const post = (instance: IdentityInstance, token: string, body: unknown) =>
  instance.call('POST', '/v1/sync/records', { token, body });

const codeOf = (body: unknown): unknown => (body as { error?: { code?: unknown } }).error?.code;

async function stored(instance: IdentityInstance, athleteId: string) {
  return instance.freshRead(async (store) => ({
    records: await store.listActivityRecords(athleteId),
    manifest: await store.listSyncManifest(athleteId, undefined, 100),
  }));
}

describe('ingesting a signed record (#37)', () => {
  it('stores a record whose signature and file verify, and the original file under its hash', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    const bytes = corpusFile('nominal-outdoor-ride.fit');
    const answer = await post(world, rider!.token, await uploadBody(rider!.device, bytes));
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    const sha = toHex(await sha256Bytes(bytes));
    expect(answer.body).toMatchObject({ contentSha256: sha, duplicate: false });

    const read = await stored(world, rider!.athleteId);
    expect(read.records.map((record) => record.contentSha256)).toEqual([sha]);
    expect(read.manifest.map((item) => [item.kind, item.key])).toEqual([['activity', sha]]);
    expect(world.blobs.get(sha)).toEqual(bytes);
  });

  it('answers the SAME file sent twice with the first record, and keeps one', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    const body = await uploadBody(rider!.device, corpusFile('nominal-outdoor-ride.fit'));
    const first = await post(world, rider!.token, body);
    world.clock.ms += 60_000;
    const second = await post(world, rider!.token, body);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ ...(first.body as object), duplicate: true });
    expect((await stored(world, rider!.athleteId)).records).toHaveLength(1);
  });

  it('keeps ONE record when the same file is sent twice at once', async () => {
    const setup = await syncWorld(1);
    world = setup.world;
    const [rider] = setup.riders;
    const body = await uploadBody(rider!.device, corpusFile('nominal-outdoor-ride.fit'));
    const answers = await Promise.all([
      post(world, rider!.token, body),
      post(world, rider!.token, body),
      post(world, rider!.token, body),
    ]);
    for (const each of answers) expect(each.status, JSON.stringify(each.body)).toBe(200);
    const duplicates = answers.map((each) => (each.body as { duplicate: boolean }).duplicate);
    expect(duplicates.filter((duplicate) => !duplicate)).toHaveLength(1);
    const ids = new Set(
      answers.map((each) => (each.body as { recordSha256: string }).recordSha256),
    );
    expect(ids.size).toBe(1);
    const read = await stored(world, rider!.athleteId);
    expect(read.records).toHaveLength(1);
    expect(read.manifest).toHaveLength(1);
  });

  it.each([
    ['a FIT header and nothing after it', 'header-only.fit'],
    ['a GPX cut off mid-trackpoint', 'truncated-mid-trackpoint.gpx'],
  ])(
    'leaves no record, no manifest row and no object for a file that does not decode: %s',
    async (_, name) => {
      const setup = await syncWorld(1);
      world = setup.world;
      const [rider] = setup.riders;
      const answer = await post(
        world,
        rider!.token,
        await uploadBody(rider!.device, corpusFile(name)),
      );
      expect(answer.status).toBe(422);
      expect(codeOf(answer.body)).toBe('file_undecodable');
      const read = await stored(world, rider!.athleteId);
      expect(read.records).toEqual([]);
      expect(read.manifest).toEqual([]);
      expect(world.blobs.size).toBe(0);
    },
  );

  it('removes the stored file again when the database write fails after it', async () => {
    const setup = await syncWorld(1, {
      syncStoreSeenBy: (store): SqlStore => ({
        ...store,
        ingestActivity: () => Promise.reject(new Error('the disk is full')),
      }),
    });
    world = setup.world;
    const [rider] = setup.riders;
    const answer = await post(
      world,
      rider!.token,
      await uploadBody(rider!.device, corpusFile('nominal-outdoor-ride.fit')),
    );
    expect(answer.status).toBe(500);
    expect(world.blobs.size, 'no orphaned object').toBe(0);
    expect((await stored(world, rider!.athleteId)).records).toEqual([]);
  });

  it('does not take a file another athlete holds when its own write fails', async () => {
    let failing = false;
    const setup = await syncWorld(2, {
      syncStoreSeenBy: (store): SqlStore => ({
        ...store,
        ingestActivity: (ingestion) =>
          failing ? Promise.reject(new Error('the disk is full')) : store.ingestActivity(ingestion),
      }),
    });
    world = setup.world;
    const [anna, ben] = setup.riders;
    const bytes = corpusFile('nominal-outdoor-ride.fit');
    expect((await post(world, ben!.token, await uploadBody(ben!.device, bytes))).status).toBe(200);
    failing = true;
    expect((await post(world, anna!.token, await uploadBody(anna!.device, bytes))).status).toBe(
      500,
    );
    expect(world.blobs.get(toHex(await sha256Bytes(bytes)))).toEqual(bytes);
  });

  describe('refuses a record that does not verify, names the check, and stores nothing', () => {
    const cases: readonly [
      string,
      string,
      (rider: Awaited<ReturnType<typeof setupOne>>) => Promise<unknown>,
    ][] = [
      [
        'a claim altered after signing',
        'record_signature_mismatch',
        async ({ device, bytes }) => {
          const record = await signedRecordOf(device, bytes);
          return {
            record: { ...record, claims: { ...record.claims, distance: 99_999 } },
            file: toBase64(bytes),
          };
        },
      ],
      [
        'a different file from the one signed',
        'record_content_mismatch',
        async ({ device, bytes }) => ({
          record: await signedRecordOf(device, corpusFile('nominal-ride.gpx')),
          file: toBase64(bytes),
        }),
      ],
      [
        'a member the format does not have',
        'record_malformed',
        async ({ device, bytes }) => ({
          record: { ...(await signedRecordOf(device, bytes)), latitude: 51.5 },
          file: toBase64(bytes),
        }),
      ],
      [
        'a version this instance does not know',
        'record_unsupported',
        async ({ device, bytes }) => ({
          record: { ...(await signedRecordOf(device, bytes)), version: 2 },
          file: toBase64(bytes),
        }),
      ],
      [
        'a good signature by somebody else’s key',
        'record_not_your_key',
        async ({ bytes }) => ({
          record: await signedRecordOf(await testDevice(), bytes),
          file: toBase64(bytes),
        }),
      ],
    ];

    async function setupOne() {
      const setup = await syncWorld(1);
      world = setup.world;
      return { ...setup.riders[0]!, bytes: corpusFile('nominal-outdoor-ride.fit') };
    }

    it.each(cases)('%s → %s', async (_, code, build) => {
      const rider = await setupOne();
      const answer = await post(world!, rider.token, await build(rider));
      expect(answer.status).toBe(422);
      expect(codeOf(answer.body)).toBe(code);
      const read = await stored(world!, rider.athleteId);
      expect(read.records).toEqual([]);
      expect(world!.blobs.size).toBe(0);
    });
  });

  describe('reads the file’s type from its bytes, never from what it claims to be', () => {
    it.each([
      ['GPX', 'nominal-ride.gpx'],
      ['TCX', 'nominal-ride.tcx'],
      ['FIT', 'nominal-outdoor-ride.fit'],
    ])('accepts %s by its content', async (_, name) => {
      const setup = await syncWorld(1);
      world = setup.world;
      const [rider] = setup.riders;
      const answer = await post(
        world,
        rider!.token,
        await uploadBody(rider!.device, corpusFile(name)),
      );
      expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    });

    it('refuses bytes that are no activity file, and garbage behind a FIT signature, cleanly', async () => {
      const setup = await syncWorld(1);
      world = setup.world;
      const [rider] = setup.riders;
      const noise = new TextEncoder().encode('this is not a ride, it is a shopping list');
      const pretending = new Uint8Array(64).fill(0xa5);
      pretending.set([0x0e, 0x10, 0, 0, 50, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54], 0);
      const refusals = [];
      for (const bytes of [noise, pretending]) {
        const answer = await post(world, rider!.token, await uploadBody(rider!.device, bytes));
        refusals.push([answer.status, codeOf(answer.body)]);
      }
      expect(refusals).toEqual([
        [415, 'file_type_unsupported'],
        [422, 'file_undecodable'],
      ]);
      expect(world.blobs.size).toBe(0);
    });

    // #893's review: the first time the GPX and TCX reader sits on a path a
    // network reaches. A DTD is where an entity is declared, so a document
    // carrying one is refused outright — XXE and entity expansion together —
    // and this pins it on the SERVER's path, so swapping the reader is red here.
    it.each([
      [
        'an entity-expansion ("billion laughs") GPX',
        `<?xml version="1.0"?>
<!DOCTYPE gpx [
  <!ENTITY a "aaaaaaaaaa">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
  <!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">
  <!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;">
  <!ENTITY f "&e;&e;&e;&e;&e;&e;&e;&e;&e;&e;">
  <!ENTITY g "&f;&f;&f;&f;&f;&f;&f;&f;&f;&f;">
  <!ENTITY h "&g;&g;&g;&g;&g;&g;&g;&g;&g;&g;">
]>
<gpx version="1.1" creator="&h;" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>&h;</name><trkseg>
    <trkpt lat="51.5" lon="-0.12"><time>2026-09-01T08:00:00Z</time></trkpt>
    <trkpt lat="51.5001" lon="-0.12"><time>2026-09-01T08:00:01Z</time></trkpt>
  </trkseg></trk>
</gpx>`,
      ],
      [
        'an external-entity (XXE) TCX',
        `<?xml version="1.0"?>
<!DOCTYPE TrainingCenterDatabase [ <!ENTITY secret SYSTEM "file:///etc/passwd"> ]>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Biking"><Id>&secret;</Id>
    <Lap StartTime="2026-09-01T08:00:00Z"><Track>
      <Trackpoint><Time>2026-09-01T08:00:00Z</Time></Trackpoint>
      <Trackpoint><Time>2026-09-01T08:00:01Z</Time></Trackpoint>
    </Track></Lap>
  </Activity></Activities>
</TrainingCenterDatabase>`,
      ],
    ])('refuses %s with a DOCTYPE, promptly, and stores nothing', async (_, text) => {
      const setup = await syncWorld(1);
      world = setup.world;
      const [rider] = setup.riders;
      const started = performance.now();
      const answer = await post(
        world,
        rider!.token,
        await uploadBody(rider!.device, new TextEncoder().encode(text)),
      );
      const took = performance.now() - started;
      expect([answer.status, codeOf(answer.body)]).toEqual([422, 'file_undecodable']);
      // Nothing expanded: a reader that resolved the entities would build
      // 10^8 characters before answering, or read the file it was pointed at.
      expect(JSON.stringify(answer.body)).not.toContain('aaaaaaaaaa');
      expect(JSON.stringify(answer.body)).not.toContain('root:');
      expect(took).toBeLessThan(2_000);
      const read = await stored(world, rider!.athleteId);
      expect(read.records).toEqual([]);
      expect(read.manifest).toEqual([]);
      expect(world.blobs.size).toBe(0);
    });
  });

  describe('a body over the limit is refused before it is read', () => {
    function counted(total: number, chunk: number) {
      let pulled = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull: (controller) => {
          if (pulled >= total) {
            controller.close();
            return;
          }
          pulled += chunk;
          controller.enqueue(new Uint8Array(chunk).fill(0x41));
        },
      });
      return { stream, pulled: () => pulled };
    }

    it('with no length declared, reading stops at the first chunk past the limit', async () => {
      const setup = await syncWorld(1, { bodyLimitBytes: 16_384 });
      world = setup.world;
      const [rider] = setup.riders;
      const body = counted(64 * 1024 * 1024, 4096);
      const response = await world.instance.handler(
        new Request(`${world.url}/v1/sync/records`, {
          method: 'POST',
          headers: { authorization: `Bearer ${rider!.token}`, 'content-type': 'application/json' },
          body: body.stream,
          duplex: 'half',
        }),
      );
      expect(response.status).toBe(413);
      // 16 KiB limit in this world, 4 KiB chunks: at most one past the limit,
      // plus the one the stream had queued ahead.
      expect(body.pulled()).toBeLessThanOrEqual(16_384 + 3 * 4096);
    });

    it('with a length over the limit declared, nothing is read at all', async () => {
      const setup = await syncWorld(1, { bodyLimitBytes: 16_384 });
      world = setup.world;
      const [rider] = setup.riders;
      const body = counted(64 * 1024 * 1024, 4096);
      const response = await world.instance.handler(
        new Request(`${world.url}/v1/sync/records`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${rider!.token}`,
            'content-type': 'application/json',
            'content-length': String(64 * 1024 * 1024),
          },
          body: body.stream,
          duplex: 'half',
        }),
      );
      expect(response.status).toBe(413);
      expect(body.pulled()).toBeLessThanOrEqual(4096);
    });
  });

  it('two athletes who send the same file each hold their own record of it (#776)', async () => {
    const setup = await syncWorld(3);
    world = setup.world;
    const [anna, ben, cara] = setup.riders;
    const bytes = corpusFile('nominal-outdoor-ride.fit');
    const sha = toHex(await sha256Bytes(bytes));
    for (const rider of [anna!, ben!]) {
      const answer = await post(world, rider.token, await uploadBody(rider.device, bytes));
      expect(answer.body).toMatchObject({ duplicate: false });
    }
    const anna_ = await world.freshRead((store) => store.getActivityRecord(anna!.athleteId, sha));
    const ben_ = await world.freshRead((store) => store.getActivityRecord(ben!.athleteId, sha));
    expect(anna_?.signedRecord).not.toEqual(ben_?.signedRecord);
    const file = (token: string) =>
      fetch(`${world!.url}/v1/sync/files/${sha}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await file(anna!.token)).status).toBe(200);
    expect(new Uint8Array(await (await file(ben!.token)).arrayBuffer())).toEqual(bytes);
    const stranger = await file(cara!.token);
    expect(stranger.status).toBe(404);
    expect(await stranger.text()).not.toContain(sha);
  });

  it('ingests a four-hour ride within its budget — measured, and printed', async () => {
    const setup = await syncWorld(1, { bodyLimitBytes: DEFAULT_BODY_LIMIT_BYTES * 8 });
    world = setup.world;
    const [rider] = setup.riders;
    const bytes = longGpx(4 * 60 * 60);
    const body = await uploadBody(rider!.device, bytes);
    const started = performance.now();
    const answer = await post(world, rider!.token, body);
    const took = performance.now() - started;
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    console.log(
      `#37 budget: a 4-hour ride (${String(bytes.length)} bytes of GPX, 14 400 points) ingested in ${took.toFixed(0)} ms, against ${String(INGEST_BUDGET_MS)} ms`,
    );
    expect(took).toBeLessThan(INGEST_BUDGET_MS);
  }, 30_000);
});

/**
 * #37's budget for a four-hour ride, end to end through the listener: 3 s for
 * the largest of the three formats — a 3.3 MB GPX with heart rate and cadence
 * on every point, which took about 0.1 s on a 2024 laptop — so a two-core CI
 * runner under coverage stays inside it. A FIT file of the same ride is
 * several times smaller. The figure each run measures is printed beside the
 * budget.
 */
const INGEST_BUDGET_MS = 3_000;
