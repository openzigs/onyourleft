// SPDX-License-Identifier: AGPL-3.0-or-later

import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ODBL_LICENCE_URL, ODBL_NOTICE, OSM_ATTRIBUTION } from '../../src/map/basemap';

import { SYNTHETIC_TILE_PATHS, syntheticGraphTar, syntheticTile } from './graph-tar-testing';
import {
  coverageOf,
  extractDateFromName,
  makeRelease,
  parseArguments,
  readGraphArchive,
  runtimeConfig,
  tileIdFromPath,
  type MakeReleaseOptions,
} from './make-release';

const RUNTIME = {
  sdk: 'valhalla-browser@0.2.1',
  versions: { valhalla: 'a60c7cbfc83e073f50887cd27e0109d02e6b64e5', valhallaRelease: '3.8.3' },
};

/** What `valhalla_build_config` writes, cut to the keys the release touches. */
const NATIVE_CONFIG = {
  mjolnir: {
    tile_dir: '/work/tiles',
    tile_extract: '/work/graph.tar',
    traffic_extract: '/data/valhalla/traffic.tar',
    admin: '/work/admins.sqlite',
    timezone: '/work/timezones.sqlite',
    max_cache_size: 1_000_000_000,
    use_lru_mem_cache: false,
    lru_mem_cache_hard_control: false,
    global_synchronized_cache: false,
  },
  loki: { use_connectivity: true, actions: ['route'] },
  thor: {},
};

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const md5 = (bytes: Buffer): string => createHash('md5').update(bytes).digest('hex');

let scratch: string | undefined;
afterEach(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function workDirectory(tar: Buffer = syntheticGraphTar(SYNTHETIC_TILE_PATHS)): {
  work: string;
  out: string;
  pbf: string;
  options: MakeReleaseOptions;
} {
  scratch = mkdtempSync(join(tmpdir(), 'oyl-valhalla-'));
  const work = join(scratch, 'work');
  const out = join(scratch, 'out');
  const pbf = join(scratch, 'somewhere-261030.osm.pbf');
  writeFileSync(pbf, 'an extract');
  mkdirSync(work);
  writeFileSync(join(work, 'graph.tar'), tar);
  writeFileSync(join(work, 'native-config.json'), JSON.stringify(NATIVE_CONFIG));
  return {
    work,
    out,
    pbf,
    options: {
      work,
      out,
      pbf,
      image: 'ghcr.io/valhalla/valhalla:3.8.3@sha256:test',
      valhallaVersion: '3.8.3\n',
      runtimeJson: RUNTIME,
      prefix: 'oyl-bicycle',
      extractDate: undefined,
    },
  };
}

describe('readGraphArchive', () => {
  it('reads every tile with the offset, size and hashes of its bytes in the archive', () => {
    const { work } = workDirectory();
    const archive = readGraphArchive(join(work, 'graph.tar'));
    const bytes = readFileSync(join(work, 'graph.tar'));
    expect(archive.tiles.map((tile) => tile.path)).toEqual([...SYNTHETIC_TILE_PATHS]);
    for (const tile of archive.tiles) {
      const body = bytes.subarray(tile.offset, tile.offset + tile.size);
      expect(body).toEqual(syntheticTile(tile.path));
      expect(tile.sha256).toBe(sha256(body));
      expect(tile.md5).toBe(md5(body));
      expect(tile.id).toBe(tileIdFromPath(tile.path));
    }
    expect(archive.size).toBe(bytes.length);
    expect(archive.md5).toBe(md5(bytes));
    expect(archive.headerSha256).toBe(sha256(bytes.subarray(0, 512)));
    expect(archive.index.length).toBe(16 * SYNTHETIC_TILE_PATHS.length);
  });

  it('refuses an archive that does not begin with index.bin', () => {
    const { work } = workDirectory(syntheticGraphTar(SYNTHETIC_TILE_PATHS, { tileFirst: true }));
    expect(() => readGraphArchive(join(work, 'graph.tar'))).toThrow(
      'does not begin with index.bin',
    );
  });

  it('refuses an index entry whose size is not its tile’s', () => {
    const tar = syntheticGraphTar(SYNTHETIC_TILE_PATHS, {
      index: (entries) =>
        entries.map((entry, at) => (at === 1 ? { ...entry, size: entry.size + 1 } : entry)),
    });
    const { work } = workDirectory(tar);
    expect(() => readGraphArchive(join(work, 'graph.tar'))).toThrow('does not match its tiles');
  });

  it('refuses an index that leaves a tile out', () => {
    const { work } = workDirectory(
      syntheticGraphTar(SYNTHETIC_TILE_PATHS, { index: (entries) => entries.slice(1) }),
    );
    expect(() => readGraphArchive(join(work, 'graph.tar'))).toThrow(
      'cover every tile exactly once',
    );
  });

  it('refuses a tile whose own header names another tile', () => {
    const path = '2/000/519/120.gph';
    const tar = syntheticGraphTar(SYNTHETIC_TILE_PATHS, {
      bodies: { [path]: syntheticTile('2/000/519/121.gph') },
    });
    const { work } = workDirectory(tar);
    expect(() => readGraphArchive(join(work, 'graph.tar'))).toThrow('header names another tile');
  });

  it('refuses an archive with a corrupt header', () => {
    const tar = syntheticGraphTar(SYNTHETIC_TILE_PATHS);
    tar[3] = 0x41;
    const { work } = workDirectory(tar);
    expect(() => readGraphArchive(join(work, 'graph.tar'))).toThrow('checksum is wrong');
  });
});

describe('coverageOf', () => {
  it('is the box of the local-road tiles, not the 4° highway tile around them', () => {
    // 2/000/519/120: tile 519120 at level 2, 1440 columns of 0.25°: row 360, column 720.
    expect(coverageOf(SYNTHETIC_TILE_PATHS.map(tileIdFromPath))).toEqual([0, 0, 0.5, 0.25]);
  });

  it('falls back to the finest level a graph has', () => {
    // 0/002/025: tile 2025 at level 0, 90 columns of 4°: row 22, column 45.
    expect(coverageOf([tileIdFromPath('0/002/025.gph')])).toEqual([0, -2, 4, 2]);
  });
});

describe('runtimeConfig', () => {
  it('turns loki.use_connectivity off and empties every local path', () => {
    const config = runtimeConfig(NATIVE_CONFIG);
    expect(config['loki']).toMatchObject({ use_connectivity: false, actions: ['route'] });
    const mjolnir = config['mjolnir'] as Record<string, unknown>;
    expect(mjolnir).toMatchObject({ tile_dir: '', tile_url: '', admin: '', timezone: '' });
    expect(mjolnir).not.toHaveProperty('tile_extract');
    expect(mjolnir).not.toHaveProperty('traffic_extract');
    expect(mjolnir).toMatchObject({ use_lru_mem_cache: true, lru_mem_cache_hard_control: true });
  });

  it('does not change the configuration it was given', () => {
    runtimeConfig(NATIVE_CONFIG);
    expect(NATIVE_CONFIG.loki.use_connectivity).toBe(true);
  });

  it('refuses a configuration with no mjolnir section', () => {
    expect(() => runtimeConfig({ loki: {} })).toThrow('no mjolnir or loki section');
  });
});

describe('extractDateFromName', () => {
  it('reads a Geofabrik dated extract and nothing else', () => {
    expect(extractDateFromName('anywhere-261030.osm.pbf')).toBe('2026-10-30');
    expect(extractDateFromName('anywhere-latest.osm.pbf')).toBeUndefined();
    expect(extractDateFromName('anywhere-261399.osm.pbf')).toBeUndefined();
  });
});

describe('makeRelease', () => {
  it('writes a release the manifest describes byte for byte, read back from the files', () => {
    const { out, options } = workDirectory();
    const made = makeRelease(options);
    const release = join(out, made.id);
    const manifest = JSON.parse(readFileSync(join(release, 'manifest.json'), 'utf8')) as {
      release: string;
      schema: number;
      costings: string[];
      valhallaRevision: string;
      valhallaVersion: string;
      config: { url: string; sha256: string };
      archive: {
        url: string;
        size: string;
        etag: string;
        indexSize: string;
        indexSha256: string;
        headerSha256: string;
      };
      tiles: Record<
        string,
        { path: string; offset: string; size: string; sha256: string; etag: string }
      >;
      source: Record<string, string>;
    };
    expect(manifest.release).toBe(made.id);
    expect(made.id).toMatch(/^oyl-bicycle-20261030-[0-9a-f]{12}$/);
    expect(manifest.schema).toBe(1);
    expect(manifest.costings).toEqual(['bicycle']);
    expect(manifest.valhallaRevision).toBe(RUNTIME.versions.valhalla);
    expect(manifest.valhallaVersion).toBe('3.8.3');

    const config = readFileSync(join(release, manifest.config.url));
    expect(sha256(config)).toBe(manifest.config.sha256);
    expect(JSON.parse(config.toString())).toMatchObject({ loki: { use_connectivity: false } });

    const archive = readFileSync(join(release, manifest.archive.url));
    expect(String(archive.length)).toBe(manifest.archive.size);
    expect(manifest.archive.etag).toBe(`"${md5(archive)}"`);
    expect(manifest.archive.headerSha256).toBe(sha256(archive.subarray(0, 512)));
    expect(manifest.archive.indexSha256).toBe(
      sha256(archive.subarray(512, 512 + Number(manifest.archive.indexSize))),
    );

    expect(Object.keys(manifest.tiles)).toHaveLength(SYNTHETIC_TILE_PATHS.length);
    for (const [id, tile] of Object.entries(manifest.tiles)) {
      expect(id).toBe(String(tileIdFromPath(tile.path)));
      const file = readFileSync(join(release, 'tiles', tile.path));
      expect(sha256(file)).toBe(tile.sha256);
      expect(tile.etag).toBe(`"${md5(file)}"`);
      const slice = archive.subarray(Number(tile.offset), Number(tile.offset) + Number(tile.size));
      expect(slice).toEqual(file);
    }
    expect(manifest.source).toMatchObject({
      attribution: OSM_ATTRIBUTION,
      licence: 'ODbL-1.0',
      licenceUrl: ODBL_LICENCE_URL,
      extractDate: '2026-10-30',
    });
  });

  it('carries the ODbL notice beside the graph', () => {
    const { out, options } = workDirectory();
    const made = makeRelease(options);
    const notice = readFileSync(join(out, made.id, 'NOTICE.txt'), 'utf8');
    expect(notice).toContain(ODBL_NOTICE);
    expect(notice).toContain(ODBL_LICENCE_URL);
    expect(notice).toContain(`${OSM_ATTRIBUTION}.`);
    expect(notice).toContain('graph.tar is the entire derived database');
  });

  it('never writes the extract’s name into the release, only into the local build record', () => {
    const { out, options } = workDirectory();
    const made = makeRelease(options);
    const release = join(out, made.id);
    const files = readdirSync(release, { recursive: true, withFileTypes: true }).filter((entry) =>
      entry.isFile(),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(join(file.parentPath, file.name)).includes('somewhere')).toBe(false);
    }
    expect(readFileSync(join(out, `${made.id}.build.json`), 'utf8')).toContain(
      'somewhere-261030.osm.pbf',
    );
  });

  it('names the same build the same release, and a different graph another', () => {
    const first = workDirectory();
    const a = makeRelease(first.options).id;
    const second = workDirectory();
    expect(makeRelease(second.options).id).toBe(a);
    const third = workDirectory(syntheticGraphTar(SYNTHETIC_TILE_PATHS.slice(0, 2)));
    expect(makeRelease(third.options).id).not.toBe(a);
  });

  it('refuses to write over a release that exists', () => {
    const { options } = workDirectory();
    makeRelease(options);
    expect(() => makeRelease(options)).toThrow('already exists');
  });

  it('refuses tiles built by another Valhalla than the SDK’s', () => {
    const { out, options } = workDirectory();
    expect(() => makeRelease({ ...options, valhallaVersion: '3.9.0' })).toThrow(
      'built by Valhalla 3.9.0, and valhalla-browser@0.2.1 runs 3.8.3',
    );
    expect(() => readdirSync(out)).toThrow();
  });

  it('takes an explicit extract date over the file name', () => {
    const { options } = workDirectory();
    expect(makeRelease({ ...options, extractDate: '2026-11-01' }).id).toMatch(
      /^oyl-bicycle-20261101-/,
    );
  });

  it('refuses a prefix that is not a plain name', () => {
    const { options } = workDirectory();
    expect(() => makeRelease({ ...options, prefix: '../up' })).toThrow('--prefix must be');
  });
});

describe('parseArguments', () => {
  const required = [
    '--work',
    'w',
    '--out',
    'o',
    '--pbf',
    'p',
    '--image',
    'i',
    '--valhalla-version',
    'v',
  ];

  it('reads every flag', () => {
    expect(parseArguments([...required, '--prefix', 'x']).get('--prefix')).toBe('x');
  });

  it('refuses a missing, repeated, empty or unknown flag', () => {
    expect(() => parseArguments(required.slice(2))).toThrow('--work is required');
    expect(() => parseArguments([...required, '--work', 'again'])).toThrow('--work given twice');
    expect(() => parseArguments([...required, '--prefix'])).toThrow('--prefix needs a value');
    expect(() => parseArguments([...required, '--state', 'x'])).toThrow('unknown argument --state');
  });
});
