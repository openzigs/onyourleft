// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SYNTHETIC_TILE_PATHS, syntheticGraphTar } from './graph-tar-testing';
import { makeRelease } from './make-release';
import { releaseObjects } from './release-objects';

let scratch: string | undefined;
afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function release(): string {
  scratch = mkdtempSync(join(tmpdir(), 'oyl-objects-'));
  const work = join(scratch, 'work');
  mkdirSync(work);
  writeFileSync(join(work, 'graph.tar'), syntheticGraphTar(SYNTHETIC_TILE_PATHS));
  writeFileSync(join(work, 'native-config.json'), JSON.stringify({ mjolnir: {}, loki: {} }));
  writeFileSync(join(scratch, 'x.osm.pbf'), 'x');
  return makeRelease({
    work,
    out: join(scratch, 'out'),
    pbf: join(scratch, 'x.osm.pbf'),
    image: 'test',
    valhallaVersion: '3.8.3',
    runtimeJson: {
      sdk: 'valhalla-browser@0.2.1',
      versions: { valhalla: 'abc', valhallaRelease: '3.8.3' },
    },
    prefix: 'oyl-bicycle',
    extractDate: undefined,
  }).path;
}

const md5 = (path: string): string =>
  `"${createHash('md5').update(readFileSync(path)).digest('hex')}"`;

describe('releaseObjects', () => {
  it('lists every file once, with its type, size and the ETag the manifest expects, the manifest last', () => {
    const directory = release();
    const objects = releaseObjects(directory);
    expect(objects.map((object) => object.key)).toEqual([
      'NOTICE.txt',
      'config.json',
      'graph.tar',
      ...SYNTHETIC_TILE_PATHS.map((path) => `tiles/${path}`),
      'manifest.json',
    ]);
    for (const object of objects) {
      expect(object.bytes).toBe(statSync(join(directory, object.key)).size);
    }
    const byKey = new Map(objects.map((object) => [object.key, object]));
    expect(byKey.get('graph.tar')).toMatchObject({
      contentType: 'application/octet-stream',
      etag: md5(join(directory, 'graph.tar')),
    });
    const tile = `tiles/${SYNTHETIC_TILE_PATHS[1]}`;
    expect(byKey.get(tile)?.etag).toBe(md5(join(directory, tile)));
    expect(byKey.get('manifest.json')).toMatchObject({
      contentType: 'application/json',
      etag: undefined,
    });
    expect(byKey.get('NOTICE.txt')?.contentType).toBe('text/plain; charset=utf-8');
  });

  it('refuses a file the release does not account for', () => {
    const directory = release();
    writeFileSync(join(directory, 'tiles', 'extra.gph'), 'x');
    expect(() => releaseObjects(directory)).toThrow('tiles/extra.gph is not part of the release');
  });

  it('refuses a release missing a tile its manifest names', () => {
    const directory = release();
    rmSync(join(directory, 'tiles', SYNTHETIC_TILE_PATHS[0]));
    expect(() => releaseObjects(directory)).toThrow(`tiles/${SYNTHETIC_TILE_PATHS[0]} is missing`);
  });

  it('refuses a directory not named after its release', () => {
    const directory = release();
    renameSync(directory, `${directory}-copy`);
    expect(() => releaseObjects(`${directory}-copy`)).toThrow(
      'not named after its manifest’s release',
    );
  });
});
