// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What `upload.sh` uploads from one release directory, and what it checks on
 * the public URL afterwards (#2320). One line per object, tab-separated:
 *
 * ```text
 * <key relative to the release>  <Content-Type>  <ETag or ->  <bytes>
 * ```
 *
 * `manifest.json` is always the **last** line: the SDK pins a session to the
 * manifest, so it goes up only once every object it names is there with the
 * ETag it says (`upload.sh`, upstream's object-storage guide).
 *
 * Refuses a directory whose name is not its manifest's `release` (the SDK
 * would refuse it as `DATASET_MISMATCH`), one that holds a file the manifest
 * does not account for, and one missing a file the manifest names: an upload
 * publishes exactly the release.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

import {
  ARCHIVE_FILE,
  CONFIG_FILE,
  MANIFEST_FILE,
  NOTICE_FILE,
  TILES_DIRECTORY,
} from './make-release';

/** One object to upload. */
export interface ReleaseObject {
  readonly key: string;
  readonly contentType: string;
  /** The ETag the manifest expects the public URL to answer with, for the graph's own objects. */
  readonly etag: string | undefined;
  readonly bytes: number;
}

interface ManifestShape {
  readonly release?: unknown;
  readonly archive?: { readonly etag?: unknown };
  readonly tiles?: Readonly<Record<string, { readonly path?: unknown; readonly etag?: unknown }>>;
}

function contentType(key: string): string {
  if (key.endsWith('.json')) return 'application/json';
  if (key.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

/** The release's objects, `manifest.json` last. */
export function releaseObjects(directory: string): ReleaseObject[] {
  const manifest = JSON.parse(
    readFileSync(join(directory, MANIFEST_FILE), 'utf8'),
  ) as ManifestShape;
  if (manifest.release !== basename(directory)) {
    throw new Error('release-objects: the directory is not named after its manifest’s release');
  }
  const expected = new Map<string, string | undefined>([
    [CONFIG_FILE, undefined],
    [NOTICE_FILE, undefined],
    [ARCHIVE_FILE, typeof manifest.archive?.etag === 'string' ? manifest.archive.etag : undefined],
  ]);
  for (const tile of Object.values(manifest.tiles ?? {})) {
    if (typeof tile.path !== 'string' || typeof tile.etag !== 'string') {
      throw new Error('release-objects: a tile in the manifest has no path or ETag');
    }
    expected.set(`${TILES_DIRECTORY}/${tile.path}`, tile.etag);
  }
  if (expected.get(ARCHIVE_FILE) === undefined)
    throw new Error('release-objects: the manifest gives graph.tar no ETag');
  const present = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((key) => key !== MANIFEST_FILE);
  for (const key of present) {
    if (!expected.has(key)) throw new Error(`release-objects: ${key} is not part of the release`);
  }
  for (const key of expected.keys()) {
    if (!present.includes(key)) throw new Error(`release-objects: ${key} is missing`);
  }
  return [...[...expected.keys()].sort(), MANIFEST_FILE].map((key) => ({
    key,
    contentType: contentType(key),
    etag: expected.get(key),
    bytes: statSync(join(directory, key)).size,
  }));
}

if (process.argv[1]?.endsWith('release-objects.ts') === true) {
  try {
    const directory = process.argv[2];
    if (directory === undefined) throw new Error('usage: release-objects.ts <release-directory>');
    for (const object of releaseObjects(directory)) {
      console.log([object.key, object.contentType, object.etag ?? '-', object.bytes].join('\t'));
    }
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
