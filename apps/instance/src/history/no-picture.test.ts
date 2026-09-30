// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **#799's no-picture gate, on the server path** (#835, ADR 0040 D-2 item 1).
 *
 * The device's gate (`apps/web/src/camera/no-picture-reachable.test.ts`) walks
 * the client's imports and holds that no module sending a model request can
 * reach a picture type. The instance has no picture type at all — it never
 * holds a frame — so what can reach one here is DATA: a synced item that is,
 * or carries, a picture or the pose summary. So this holds three things:
 *
 * 1. no module that writes or reads the index imports, however indirectly,
 *    anything about a camera, a pose, a frame or an image — and the walk is
 *    shown to find one when one is there (the control);
 * 2. the kinds the index is cut from leave the side-camera report out, and
 *    nothing but those kinds is ever read for it;
 * 3. an item carrying a `data:` URL is refused whole (`passages.test.ts`
 *    holds the cases; here, through the real catch-up).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { openSqlStore } from '../store/open-sql-store.ts';
import { createStoreHarness, registrationFixture } from '../store/testing/index.ts';
import { createHistory } from './history.ts';
import { scriptedEmbedder } from './history-testing.ts';
import { INDEXED_KINDS } from './passages.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** A module path that names a picture or a body, in any directory or file name. */
const PICTURE = /camera|pose|picture|frame|image|photo|video/i;

/** Every module `entry` reaches through relative imports, `entry` included. */
function reachable(entry: string, read: (path: string) => string): Set<string> {
  const seen = new Set<string>();
  const visit = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    for (const match of read(path).matchAll(/(?:from|import)\s*\(?\s*'(\.{1,2}\/[^']+)'/g)) {
      visit(resolve(dirname(path), match[1] ?? ''));
    }
  };
  visit(entry);
  return seen;
}

const onDisk = (path: string): string => readFileSync(path, 'utf8');

/** The index's own modules: everything in this directory that ships. */
const INDEX_MODULES = readdirSync(HERE)
  .filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts') && !file.endsWith('-testing.ts'),
  )
  .map((file) => join(HERE, file));

describe('the history index reaches no picture (#799, on the server)', () => {
  it('imports nothing about a camera, a pose, a frame or an image, however indirectly', () => {
    expect(INDEX_MODULES.length).toBeGreaterThanOrEqual(5);
    for (const module of INDEX_MODULES) {
      const found = [...reachable(module, onDisk)].filter((path) =>
        PICTURE.test(path.slice(resolve(HERE, '..').length)),
      );
      expect(found, module).toStrictEqual([]);
    }
  });

  it('finds such an import when there is one — the control', () => {
    const tree: Record<string, string> = {
      '/src/history/history.ts': "import { x } from '../store/sql-store.ts';",
      '/src/store/sql-store.ts': "import { frame } from '../camera/frame.ts';",
      '/src/camera/frame.ts': '',
    };
    const found = [...reachable('/src/history/history.ts', (path) => tree[path] ?? '')];
    expect(found.filter((path) => PICTURE.test(path))).toStrictEqual(['/src/camera/frame.ts']);
  });

  it('is cut from none of the side-camera report, whose pose summary it may never hold', () => {
    expect(INDEXED_KINDS).not.toContain('side-camera-report');
    expect(INDEXED_KINDS).not.toContain('activity');
  });

  it('keeps no passage of an item that carries a picture, through the real catch-up', async () => {
    const harness = await createStoreHarness();
    try {
      await harness.write(async (store) => {
        await store.registerAthlete(registrationFixture('a'));
        await store.putSyncItem({
          athleteId: 'a',
          kind: 'document',
          key: 'd1',
          body: new TextEncoder().encode('My position: data:image/jpeg;base64,/9j/4AAQ'),
          digest: 'd'.repeat(64),
          now: 1,
        });
        await store.putSyncItem({
          athleteId: 'a',
          kind: 'side-camera-report',
          key: 'r1',
          body: new TextEncoder().encode('{"sentences":["Possibly more upright."]}'),
          digest: 'e'.repeat(64),
          now: 1,
        });
      });
      const store = await openSqlStore(harness.path);
      try {
        const embedder = scriptedEmbedder();
        const history = createHistory({ store, embedder });
        expect(await history.catchUp()).toEqual({ indexed: 1, stopped: null });
        expect(embedder.calls).toStrictEqual([]);
        expect(await store.summariseHistoryIndex('a')).toStrictEqual([]);
      } finally {
        await store.close();
      }
    } finally {
      await harness.destroy();
    }
  });
});
