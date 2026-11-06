// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **Nothing of the rider's own music player leaves the device** — #2073's
 * fourth criterion, spike 0034 §4, CLAUDE.md §1 and ADR 0036 D-3.
 *
 * Another app's track is personal data. By the owner's ruling 1 of
 * 2026-11-05 the plugin reads none (no Notification access), so the strongest
 * form of "it stays on the device" holds: it never reaches the device's
 * JavaScript. This holds that from both ends.
 *
 * - **What crosses the bridge.** A hostile plugin answers with a title, an
 *   artist and an app name beside `active`; composed as `main.tsx` composes
 *   it, the client is handed one boolean and keeps two.
 * - **What a consumer reads back.** After the control has been used against
 *   that plugin, a ride's record, its streams and laps (the store's own
 *   reads), every row of every table, the device's `localStorage`, the
 *   account export in FIT, GPX and TCX, the single-ride export, and every
 *   request `instance/sync.ts` sends a scripted instance, are scanned for the
 *   plugin's words. The last case plants them, so the scan is seen to go red.
 * - **What imports it.** No module that writes a ride down, exports one or
 *   talks to an instance names the player's modules. Direct imports only:
 *   `privacy/delivery-targets-never-sent.test.ts` is the transitive walk for
 *   a case where a reach is plausible; here none of those trees imports the
 *   shell at all.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { unixSeconds } from '@onyourleft/domain';
import { capacitorOtherPlayer, type OtherPlayerPlugin } from '@onyourleft/mobile';
import { ensureDeviceSigningKey, webCryptoSha256, webCryptoVerifier } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  resetFixtureIds,
  rideFor,
  seedAthletes,
  streamSetFor,
} from '@onyourleft/store/testing';

import { athleteKeysFrom, syncWithInstance, type SyncTransport } from '../instance/sync';
import { rideSummaryOf, type RideSummaryStore } from '../ride-analysis/ride-summary';
import { OtherPlayer } from '../shell/other-player';
import { manualOtherPlayerClock } from '../shell/other-player-testing';
import { exportActivity } from '../transfer/export-activity';
import { exportEverything } from '../transfer/export-everything';
import type { DownloadableFile } from '../transfer/store-port';

/** What a plugin that read the player would have handed over: synthetic, and distinctive. */
const MARKERS = [
  'Synthetic Track Quokka',
  'Synthetic Artist Narwhal',
  'dev.example.synthetic.player',
] as const;

/** A plugin that says more than it should, recording the keys it is sent. */
function hostilePlugin(): OtherPlayerPlugin {
  return {
    sendKey: () => Promise.resolve(),
    otherAudioActive: () =>
      Promise.resolve({
        active: true,
        title: MARKERS[0],
        artist: MARKERS[1],
        packageName: MARKERS[2],
      } as unknown as { active: boolean }),
  };
}

/** The player as `main.tsx` composes it, used the way a rider uses it. */
async function usedPlayer(): Promise<OtherPlayer> {
  const player = new OtherPlayer(
    capacitorOtherPlayer(hostilePlugin()),
    manualOtherPlayerClock().clock,
  );
  await player.poll();
  await player.poll();
  expect(player.getSnapshot().seen).toBe(true);
  await player.press('play-pause');
  await player.press('next');
  await player.press('previous');
  await player.press('play-pause');
  return player;
}

/** `value` as text, its bytes as Latin-1 so a marker inside a file's bytes is found too. */
function textOf(value: unknown): string {
  return JSON.stringify(value, (_key, each: unknown) =>
    Object.prototype.toString.call(each) === '[object Uint8Array]'
      ? new TextDecoder('latin1').decode(each as Uint8Array)
      : each,
  );
}

/** The markers found in `text`, each named with `where`. */
function tracesIn(where: string, text: string): string[] {
  return MARKERS.filter((marker) => text.includes(marker)).map((marker) => `${where}: ${marker}`);
}

function tracesInFiles(files: readonly DownloadableFile[]): string[] {
  return files.flatMap((file) =>
    tracesIn(file.fileName, new TextDecoder('latin1').decode(file.bytes)),
  );
}

/** Every row of every table in the database, Blobs read as bytes. */
async function everyRow(databaseName: string): Promise<{ table: string; rows: unknown[] }[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('the database did not open'));
  });
  try {
    const tables: { table: string; rows: unknown[] }[] = [];
    for (const table of Array.from(database.objectStoreNames)) {
      const rows = await new Promise<unknown[]>((resolve, reject) => {
        const request = database.transaction(table, 'readonly').objectStore(table).getAll();
        request.onsuccess = () => resolve(request.result as unknown[]);
        request.onerror = () => reject(request.error ?? new Error('the table did not read'));
      });
      tables.push({ table, rows: await Promise.all(rows.map(blobsAsBytes)) });
    }
    return tables;
  } finally {
    database.close();
  }
}

/** `value` with every Blob in it replaced by its bytes. */
async function blobsAsBytes(value: unknown): Promise<unknown> {
  if (value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (Array.isArray(value)) return Promise.all(value.map(blobsAsBytes));
  if (typeof value === 'object' && value !== null && !ArrayBuffer.isView(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, each] of Object.entries(value)) out[key] = await blobsAsBytes(each);
    return out;
  }
  return value;
}

/** A sync instance that holds nothing and takes everything, keeping every request it was sent. */
function scriptedInstance(): { readonly sealed: SyncTransport; readonly sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    sealed: {
      json: (method, path, body) => {
        sent.push({ method, path, body });
        if (method === 'GET' && path.startsWith('/v1/sync/manifest')) {
          return Promise.resolve({ status: 200, body: { items: [], next: null } });
        }
        if (method === 'GET' && path === '/v1/auth/devices') {
          return Promise.resolve({ status: 200, body: { devices: [] } });
        }
        if (method === 'GET') return Promise.resolve({ status: 404, body: {} });
        return Promise.resolve({ status: 200, body: {} });
      },
      bytes: (path) => {
        sent.push({ method: 'GET', path });
        return Promise.resolve({ status: 404, bytes: new Uint8Array() });
      },
    },
  };
}

const NOW = unixSeconds(1_790_000_000);

let harness: ReturnType<typeof createStoreHarness>;

beforeEach(() => {
  resetFixtureIds();
  localStorage.clear();
  harness = createStoreHarness();
});

afterEach(async () => {
  await harness.destroy();
});

/** A stored ride with a track, and the player used beside it. */
async function rideAndPlayer() {
  await seedAthletes(harness);
  const ride = rideFor(ATHLETE_A, { hasPosition: true });
  await harness.write(async (store) => {
    await store.putActivity(ride);
    await store.putStreamSet(streamSetFor(ride, { sampleCount: 60 }));
  });
  const player = await usedPlayer();
  return { ride, player };
}

describe('the rider’s own music player keeps nothing of the track — #2073', () => {
  it('is handed one boolean across the bridge, and holds two', async () => {
    const answer: unknown = await capacitorOtherPlayer(hostilePlugin()).otherAudioActive();
    expect(answer).toBe(true);
    const player = await usedPlayer();
    expect(tracesIn('the player', textOf(player.getSnapshot()))).toStrictEqual([]);
    expect(Object.keys(player.getSnapshot()).sort()).toStrictEqual(['playing', 'seen']);
  });

  it('stores none of it with the ride, its streams, its laps or anywhere on the device', async () => {
    const { ride } = await rideAndPlayer();
    const [activity, streams, laps] = await harness.read(async (store) => [
      await store.getActivity(ATHLETE_A, ride.id),
      await store.getStreamSet(ATHLETE_A, ride.id),
      await store.listLaps(ATHLETE_A, ride.id),
    ]);
    // Not vacuous: the ride is there, with its samples.
    expect(activity?.id).toBe(ride.id);
    expect(streams?.sampleCount).toBe(60);
    const stored: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index) ?? '';
      stored.push(...tracesIn(`localStorage ${key}`, `${key}=${localStorage.getItem(key) ?? ''}`));
    }
    await harness.discard();
    const tables = await everyRow(harness.databaseName);
    expect(tables.reduce((sum, each) => sum + each.rows.length, 0)).toBeGreaterThan(1);
    expect([
      ...tracesIn('the ride', textOf(activity)),
      ...tracesIn('its streams', textOf(streams)),
      ...tracesIn('its laps', textOf(laps)),
      ...stored,
      ...tables.flatMap(({ table, rows }) => tracesIn(`table ${table}`, textOf(rows))),
    ]).toStrictEqual([]);
  });

  it.each(['fit', 'gpx', 'tcx'] as const)('exports none of it, %s', async (format) => {
    const { ride } = await rideAndPlayer();
    const files: DownloadableFile[] = [];
    const report = await harness.read((store) =>
      exportEverything({
        store,
        athleteId: ATHLETE_A,
        format,
        onFile: (file) => {
          files.push(file);
        },
      }),
    );
    const single = await harness.read((store) =>
      exportActivity({ store, athleteId: ATHLETE_A, activityId: ride.id, format }),
    );
    expect(report.exported).toBe(1);
    expect(files.some((file) => file.fileName.endsWith(`.${format}`))).toBe(true);
    expect(tracesInFiles([...files, single.file])).toStrictEqual([]);
  });

  it('sends none of it in what sync sends an instance', async () => {
    await rideAndPlayer();
    const instance = scriptedInstance();
    const report = await harness.write((store) =>
      syncWithInstance({
        sealed: instance.sealed,
        store,
        athleteId: ATHLETE_A,
        signingKey: () => ensureDeviceSigningKey(store, ATHLETE_A, { now: () => NOW }),
        sha256: webCryptoSha256,
        verifier: webCryptoVerifier,
        now: () => NOW,
        timeZone: 'Europe/London',
        rideSummary: rideSummaryOf(store as unknown as RideSummaryStore, ATHLETE_A),
        athleteKeys: () => athleteKeysFrom(instance.sealed),
        newDocumentId: () => crypto.randomUUID(),
      }),
    );
    // Not vacuous: the ride was pushed.
    expect(report.pushed).toBe(1);
    expect(report.failures).toStrictEqual([]);
    expect(tracesIn('sync', textOf(instance.sent))).toStrictEqual([]);
  });

  it('would find them, so the scan can go red', () => {
    const planted: DownloadableFile = {
      fileName: 'manifest.json',
      mediaType: 'application/json',
      bytes: new TextEncoder().encode(JSON.stringify({ nowPlaying: MARKERS[0] })),
    };
    expect(tracesInFiles([planted])).toStrictEqual([`manifest.json: ${MARKERS[0]}`]);
    localStorage.setItem('oyl.planted', MARKERS[2]);
    expect(tracesIn('localStorage', localStorage.getItem('oyl.planted') ?? '')).toHaveLength(1);
    expect(tracesIn('sync', textOf([{ body: { artist: MARKERS[1] } }]))).toHaveLength(1);
  });
});

/** The trees a ride is written down, exported or sent to an instance from. */
const LEAVING_TREES = [
  join(import.meta.dirname, '../instance'),
  join(import.meta.dirname, '../transfer'),
  join(import.meta.dirname, '../recording'),
  join(import.meta.dirname, '../ride'),
  join(import.meta.dirname, '../../../instance/src'),
] as const;

function sourcesUnder(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') found.push(...sourcesUnder(path));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

/** Whether `source` imports a module of the rider's own player, or names its Android half. */
const importsThePlayer = (source: string): boolean =>
  /\bfrom\s*['"][^'"]*(?:other-player|OtherPlayer)[^'"]*['"]|\bimport\s*\(\s*['"][^'"]*other-player/.test(
    source,
  ) || /\b(?:capacitorOtherPlayer|capacitorOtherPlayerPlugin)\b/.test(source);

describe('nothing that leaves the device imports the player — #2073', () => {
  it.each(LEAVING_TREES)('no module under %s names it', (tree) => {
    const files = sourcesUnder(tree);
    expect(files.length).toBeGreaterThan(0);
    const reaching = files.filter((file) => importsThePlayer(readFileSync(file, 'utf8')));
    expect(reaching).toStrictEqual([]);
  });

  it('would find one', () => {
    expect(importsThePlayer("import { OtherPlayer } from '../shell/other-player';")).toBe(true);
    expect(importsThePlayer("import { capacitorOtherPlayer } from '@onyourleft/mobile';")).toBe(
      true,
    );
    expect(importsThePlayer("import { exportEverything } from './export-everything';")).toBe(false);
  });
});
