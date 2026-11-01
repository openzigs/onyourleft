// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `demo:bake`, against the browser gate's synthetic corridor archive — #1651.
 *
 * Never OpenStreetMap data (ADR 0056 D-9): the archive is
 * `browser/corridor-fixture.ts`'s, and the GPX is that fixture route's line
 * written out with the timestamps, sensor extensions and names a recorded
 * track carries, so that what the bake drops is shown dropped. Every check
 * reads the file back — from the bytes, or from disk where the bake wrote it.
 */

import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { POISON } from '@onyourleft/map-features/testing';
import { afterAll, describe, expect, it } from 'vitest';

import {
  buildCorridorFixtureArchive,
  corridorFixtureRoute,
  expectedCorridorCounts,
} from '../../browser/corridor-fixture';
import {
  CORRIDOR_READER_VERSION,
  packCorridorFeatures,
  planCorridor,
  readCorridorTiles,
  unpackCorridorFeatures,
} from '../../src/game/world-data/corridor';
import { ODBL_LICENCE_URL, ODBL_NOTICE } from '../../src/map/basemap';
import { buildArchive } from '../../src/world-data/archive-testing';
import { corridorArchiveFrom } from '../../src/world-data/corridor-source';
import { countingSource } from '../../src/world-data/archive-testing';

import {
  archiveOf,
  bakeRoute,
  parseBakeArguments,
  personalGpxFields,
  provenanceFindings,
  readBakeInput,
  recordDrift,
  recordOf,
  routeLineOf,
  settleRecord,
  stripPresetGpx,
  strippedGpx,
  writeBakedRoute,
  type ManifestEntry,
} from './bake-route';
import { ODBL_NOTICE_FILE, ROUTE_MANIFEST_FILE } from './demo-routes';
import {
  encodeRouteBundle,
  OSM_COPYRIGHT_URL,
  readRouteBundle,
  routeBundleText,
  timestampFields,
  type RouteBundle,
} from './route-bundle';

const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-bake-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** A heart rate no coordinate or elevation of the fixture route is near. */
const HEART_RATE = 187;
const ROUTE_NAME = 'Fixture Lane morning loop';

/** The fixture route as a recorded GPX: times, a heart rate, a name and metadata on it. */
function fixtureGpx(): string {
  const profile = corridorFixtureRoute();
  const points = profile.positions.map((position, index) => {
    const ele = profile.elevations[index];
    const time = new Date(Date.UTC(2026, 9, 1, 7, 0, index)).toISOString();
    return (
      `<trkpt lat="${String(position.latitude)}" lon="${String(position.longitude)}">` +
      (ele === undefined ? '' : `<ele>${String(ele)}</ele>`) +
      `<time>${time}</time>` +
      `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${String(HEART_RATE)}</gpxtpx:hr>` +
      `</gpxtpx:TrackPointExtension></extensions></trkpt>`
    );
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<gpx version="1.1" creator="A Watch" xmlns="http://www.topografix.com/GPX/1/1" ' +
    'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">' +
    `<metadata><name>${ROUTE_NAME}</name><time>2026-10-01T07:00:00Z</time></metadata>` +
    `<trk><name>${ROUTE_NAME}</name><trkseg>${points.join('')}</trkseg></trk></gpx>`
  );
}

async function fixtureArchive() {
  const bytes = await buildCorridorFixtureArchive();
  return { bytes, archive: corridorArchiveFrom(countingSource(bytes)) };
}

async function bakeFixture() {
  const { archive } = await fixtureArchive();
  return bakeRoute({
    routeId: 'fixture',
    gpx: fixtureGpx(),
    archive,
    archiveUrl: 'file:corridor-fixture.pmtiles',
  });
}

describe('demo:bake is reproducible — #1651', () => {
  it('bakes the same route against the same archive to the same bytes, named by their digest', async () => {
    const first = await bakeFixture();
    const second = await bakeFixture();
    expect(second.bytes).toStrictEqual(first.bytes);
    expect(second.entry).toStrictEqual(first.entry);
    const digest = createHash('sha256').update(first.bytes).digest('hex');
    expect(first.entry.sha256).toBe(digest);
    expect(first.entry.file).toBe(`fixture.${digest.slice(0, 16)}.bin`);
  });

  it('writes the gzip header with no time and an unknown OS, so any machine writes the same file', async () => {
    const { bytes } = await bakeFixture();
    expect([...bytes.slice(0, 3)]).toStrictEqual([0x1f, 0x8b, 8]);
    expect([...bytes.slice(4, 8)]).toStrictEqual([0, 0, 0, 0]);
    expect(bytes[9]).toBe(0xff);
  });
});

describe('demo:bake draws what a ride would get — #1651', () => {
  it('holds the features a ride reads for the fixture route, as the ride keeps them', async () => {
    const baked = await bakeFixture();
    const { bundle, features } = await readRouteBundle(baked.bytes);

    // The ride: the same plan, the same reader, the same pack and unpack the store takes.
    const plan = planCorridor(corridorFixtureRoute().positions, []);
    if (plan === undefined) throw new Error('no plan');
    const read = await readCorridorTiles({
      plan,
      archive: (await fixtureArchive()).archive,
      signal: new AbortController().signal,
      progress: () => undefined,
      yieldToIdle: () => Promise.resolve(),
    });
    if (read.kind !== 'read') throw new Error(read.kind);
    const ride = await unpackCorridorFeatures(await packCorridorFeatures(read.features));
    expect(features).toStrictEqual(ride);

    // And the browser gate's own counts for that route (`corridor.browser.spec.ts`).
    const expected = expectedCorridorCounts();
    expect({
      tiles: bundle.tiles.planned - bundle.tiles.uncovered.length,
      buildings: features.buildings.length,
      landUse: features.landUse.length,
      paths: features.paths.length,
      streets: features.streets.length,
      places: features.places.length,
    }).toStrictEqual(expected);
    expect(baked.entry.tiles).toStrictEqual({ planned: expected.tiles, covered: expected.tiles });
    expect(bundle.readerVersion).toBe(CORRIDOR_READER_VERSION);
  });

  it("keeps the GPX's line and its <ele>, the route's hills, and nothing else of a point", async () => {
    const { bundle } = await readRouteBundle((await bakeFixture()).bytes);
    const profile = corridorFixtureRoute();
    expect(bundle.route.points).toHaveLength(profile.positions.length);
    bundle.route.points.forEach((point, index) => {
      const position = profile.positions[index];
      expect(point).toStrictEqual([
        Number(position?.latitude),
        Number(position?.longitude),
        Number(profile.elevations[index]),
      ]);
    });
    expect(bundle.route.licence).toBe('CC0-1.0');
  });

  it('keeps a point with no <ele> as a null elevation, not a made-up height', () => {
    const line = routeLineOf(
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>' +
        '<trkpt lat="40" lon="-105"><ele>1600</ele></trkpt><trkpt lat="40.001" lon="-105"></trkpt>' +
        '</trkseg></trk></gpx>',
    );
    expect(line.points).toStrictEqual([
      [40, -105, 1600],
      [40.001, -105, null],
    ]);
  });

  it('refuses a GPX with a DOCTYPE, through the codec that refuses XXE', () => {
    expect(() =>
      routeLineOf(
        '<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
          '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>' +
          '<trkpt lat="40" lon="-105"><ele>&x;</ele></trkpt></trkseg></trk></gpx>',
      ),
    ).toThrow(/DOCTYPE/i);
  });
});

describe('demo:bake publishes no name, no id and no time — #1651, ADR 0056 D-2.1, D-7.2', () => {
  it('carries none of the fixture tiles’ poisoned names, pmap fields, addresses or ids', async () => {
    const text = await routeBundleText((await bakeFixture()).bytes);
    const keys: string[] = [];
    const strings: string[] = [];
    const numbers: number[] = [];
    // The map data and the route: `source.name` is the credit, OpenStreetMap's own.
    const { features, route, tiles } = JSON.parse(text) as RouteBundle;
    JSON.parse(
      JSON.stringify({ features, route, tiles }),
      function (this: unknown, key, value: unknown) {
        if (key !== '') keys.push(key);
        if (typeof value === 'string') strings.push(value);
        if (typeof value === 'number') numbers.push(value);
        return value;
      },
    );
    for (const key of keys) expect(key).not.toMatch(/^(?:name|id|addr)|pmap|osm/i);
    const poisonStrings = [POISON.name, POISON.nameEn, POISON.pmapKind, POISON.address];
    for (const value of strings) expect(poisonStrings).not.toContain(value);
    for (const value of numbers) expect(Math.abs(value - POISON.id)).toBeGreaterThan(1000);
    expect(text).not.toContain('Fixture Lane');
    expect(text).not.toContain('pmap');
  });

  it('carries none of the GPX’s times, heart rates, names or creator', async () => {
    const baked = await bakeFixture();
    const text = await routeBundleText(baked.bytes);
    expect(timestampFields(JSON.parse(text))).toStrictEqual([]);
    expect(text).not.toContain('2026-10-01');
    expect(text).not.toContain(ROUTE_NAME);
    expect(text).not.toContain('A Watch');
    // Every point is exactly three numbers, so no heart rate rides along.
    const { bundle } = await readRouteBundle(baked.bytes);
    expect(bundle.route.points.every((point) => point.length === 3)).toBe(true);
    expect(bundle.route.points.flat()).not.toContain(HEART_RATE);
  });

  it('refuses to write a file a timestamp survived in, naming the field and not the value', async () => {
    const { bytes } = await bakeFixture();
    const { bundle } = await readRouteBundle(bytes);
    const timed = { ...bundle, bakedAt: '2026-10-25T10:00:00Z' } as RouteBundle;
    await expect(encodeRouteBundle(timed)).rejects.toThrow(/\$\.bakedAt/);
    await expect(encodeRouteBundle(timed)).rejects.not.toThrow(/2026-10-25/);
    const inPoint = {
      ...bundle,
      route: { ...bundle.route, points: [[40, -105, 1600, '2026-10-01T07:00:00Z']] },
    } as unknown as RouteBundle;
    await expect(encodeRouteBundle(inPoint)).rejects.toThrow(/\$\.route\.points\[0\]\[3\]/);
    // A time as Unix seconds has no shape to find; the point's arity is held instead.
    const counted = {
      ...bundle,
      route: { ...bundle.route, points: [[40, -105, 1600, 1_790_000_000]] },
    } as unknown as RouteBundle;
    await expect(encodeRouteBundle(counted)).rejects.toThrow(/\$\.route\.points\[0\]/);
    await expect(encodeRouteBundle(counted)).rejects.not.toThrow(/1790000000|-105/);
  });
});

describe('demo:bake writes into the demo output, with the ODbL notice — #1651, ADR 0056 D-3.2', () => {
  it('writes the file, its manifest and the notice file, and the manifest describes the file on disk', async () => {
    const directory = join(scratch, 'routes');
    const baked = await bakeFixture();
    const path = writeBakedRoute(directory, baked);
    const onDisk = readFileSync(path);
    const manifest = JSON.parse(readFileSync(join(directory, ROUTE_MANIFEST_FILE), 'utf8')) as {
      licence: string;
      licenceUrl: string;
      noticeFile: string;
      routes: Record<string, ManifestEntry>;
    };
    const entry = manifest.routes['fixture'];
    expect(entry?.file).toBe(path.split(/[\\/]/).pop());
    expect(entry?.bytes).toBe(onDisk.byteLength);
    expect(entry?.sha256).toBe(createHash('sha256').update(onDisk).digest('hex'));
    expect(entry?.archiveUrl).toBe('file:corridor-fixture.pmtiles');
    expect(entry?.archiveIdentity).toBe('"fixture-1"');
    expect(entry?.readerVersion).toBe(CORRIDOR_READER_VERSION);
    expect(entry?.elevation).toBe('gpx-ele');
    expect(entry?.jsonBytes).toBeGreaterThan(onDisk.byteLength);
    expect(manifest.licence).toBe('ODbL-1.0');
    expect(manifest.licenceUrl).toBe(ODBL_LICENCE_URL);
    expect(manifest.noticeFile).toBe(ODBL_NOTICE_FILE);

    const notice = readFileSync(join(directory, ODBL_NOTICE_FILE), 'utf8');
    expect(notice).toContain(ODBL_NOTICE);
    expect(notice).toContain(ODBL_LICENCE_URL);
    expect(notice).toContain(OSM_COPYRIGHT_URL);

    // The licence travels inside the file too (§4.2 b).
    const { bundle } = await readRouteBundle(new Uint8Array(onDisk));
    expect([bundle.licence, bundle.licenceUrl, bundle.notice]).toStrictEqual([
      'ODbL-1.0',
      ODBL_LICENCE_URL,
      ODBL_NOTICE,
    ]);
    expect(bundle.source.url).toBe(OSM_COPYRIGHT_URL);
  });

  it('replaces an earlier bake of the same route, and keeps every other route', () => {
    const directory = join(scratch, 'replace');
    const fake = (routeId: string, file: string) => ({
      routeId,
      bytes: new Uint8Array([1, 2, 3]),
      entry: { file } as ManifestEntry,
    });
    writeBakedRoute(directory, fake('climb', 'climb.aaaa.bin'));
    writeBakedRoute(directory, fake('flat', 'flat.bbbb.bin'));
    writeBakedRoute(directory, fake('climb', 'climb.cccc.bin'));
    expect(
      readdirSync(directory)
        .filter((name) => name.endsWith('.bin'))
        .sort(),
    ).toStrictEqual(['climb.cccc.bin', 'flat.bbbb.bin']);
    const manifest = JSON.parse(readFileSync(join(directory, ROUTE_MANIFEST_FILE), 'utf8')) as {
      routes: Record<string, ManifestEntry>;
    };
    expect(Object.keys(manifest.routes)).toStrictEqual(['climb', 'flat']);
    expect(manifest.routes['climb']?.file).toBe('climb.cccc.bin');
  });
});

describe('demo:bake refuses what it cannot bake whole — #1651', () => {
  it('refuses a route outside the archive’s bounds, saying so without a coordinate', async () => {
    const { tiles } = { tiles: [] as never[] };
    const elsewhere = await buildArchive({
      tiles,
      bounds: { west: 10, south: 10, east: 11, north: 11 },
    });
    const bake = bakeRoute({
      routeId: 'fixture',
      gpx: fixtureGpx(),
      archive: corridorArchiveFrom(countingSource(elsewhere)),
      archiveUrl: 'file:elsewhere.pmtiles',
    });
    await expect(bake).rejects.toThrow(/outside the archive/);
    const latitude = String(corridorFixtureRoute().positions[0]?.latitude).slice(0, 5);
    await expect(bake).rejects.not.toThrow(latitude);
  });

  it('reads an archive from a file, recording its name and the header’s digest as its identity', async () => {
    const path = join(scratch, 'corridor-fixture.pmtiles');
    writeFileSync(path, (await fixtureArchive()).bytes);
    const { archive, archiveUrl } = archiveOf(path);
    expect(archiveUrl).toBe('file:corridor-fixture.pmtiles');
    const baked = await bakeRoute({ routeId: 'fixture', gpx: fixtureGpx(), archive, archiveUrl });
    expect(baked.entry.archiveIdentity).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await readRouteBundle(baked.bytes)).features.buildings).toHaveLength(
      expectedCorridorCounts().buildings,
    );
  });

  it('takes an https: archive or a file, and nothing else', () => {
    expect(archiveOf('https://tiles.example.invalid/a.pmtiles').archiveUrl).toBe(
      'https://tiles.example.invalid/a.pmtiles',
    );
    expect(() => archiveOf('http://tiles.example.invalid/a.pmtiles')).toThrow(/https/);
  });
});

describe('demo:bake’s arguments and its committed record — #1651, ADR 0056 D-5.2', () => {
  it('reads --route, --gpx, --archive and --record past pnpm’s --, defaulting to the published archive', () => {
    expect(parseBakeArguments(['--', '--route', 'climb'])).toStrictEqual({
      route: 'climb',
      gpx: undefined,
      archive: 'https://tiles.openzigs.com/basemap-us-oyl-20261030.pmtiles',
      record: false,
      strip: false,
    });
    expect(
      parseBakeArguments([
        '--route',
        'climb',
        '--gpx',
        'a.gpx',
        '--archive',
        'b.pmtiles',
        '--record',
      ]),
    ).toStrictEqual({
      route: 'climb',
      gpx: 'a.gpx',
      archive: 'b.pmtiles',
      record: true,
      strip: false,
    });
    expect(parseBakeArguments(['--route', 'climb', '--gpx', 'a.gpx', '--strip']).strip).toBe(true);
  });

  it('refuses a missing route, a route id that is a path, an unknown flag and a flag with no value', () => {
    expect(() => parseBakeArguments([])).toThrow(/--route/);
    expect(() => parseBakeArguments(['--route', '../escape'])).toThrow(/route id/);
    expect(() => parseBakeArguments(['--route', 'a', '--force'])).toThrow(/unknown/);
    expect(() => parseBakeArguments(['--route', '--record'])).toThrow(/needs a value/);
  });

  it('names each field a bake moved from its committed record, and none when it agrees', async () => {
    const record = recordOf((await bakeFixture()).entry);
    expect(recordDrift(record, record)).toStrictEqual([]);
    expect(
      recordDrift(record, { ...record, sha256: '0'.repeat(64), archiveIdentity: '"other"' }),
    ).toStrictEqual(['sha256', 'archiveIdentity']);
  });

  const provenance = {
    licence: 'CC0-1.0',
    source: 'the owner’s own ride, recorded on a head unit',
    confirmed: '2026-11-01',
  };

  it('refuses a preset route whose record does not say whose the GPX is, its licence and when', () => {
    expect(provenanceFindings(undefined)).toHaveLength(1);
    expect(provenanceFindings({ gpx: provenance })).toStrictEqual([]);
    expect(
      provenanceFindings({ gpx: { licence: 'CC-BY-4.0', source: ' ', confirmed: 'last week' } }),
    ).toStrictEqual([
      '"gpx.licence" is not CC0-1.0 (ADR 0056 D-7.5)',
      '"gpx.source" does not say where the track came from',
      '"gpx.confirmed" is not the date the owner confirmed it, as YYYY-MM-DD',
    ]);
  });

  it('settles a record: refuses none, writes the digests beside the provenance, refuses drift', async () => {
    const baked = recordOf((await bakeFixture()).entry);
    expect(() => settleRecord(undefined, baked, true)).toThrow(/bake\.json/);
    expect(() =>
      settleRecord({ gpx: { ...provenance, licence: 'ODbL-1.0' } }, baked, true),
    ).toThrow(/gpx\.licence/);
    const written = settleRecord({ gpx: provenance }, baked, true);
    expect(written).toStrictEqual({ gpx: provenance, ...baked });
    // Read back as the next bake would: it agrees, and a moved archive is named.
    expect(settleRecord(JSON.parse(JSON.stringify(written)), baked, false)).toBeUndefined();
    expect(() => settleRecord(written, { ...baked, archiveIdentity: '"replaced"' }, false)).toThrow(
      /in archiveIdentity;/,
    );
    // Provenance alone, before the first --record: baked, with nothing to write.
    expect(settleRecord({ gpx: provenance }, baked, false)).toBeUndefined();
  });

  it('strips a recorded GPX to the line it bakes, and a committed one may carry nothing else', () => {
    const recorded = fixtureGpx();
    expect(personalGpxFields(recorded)).toStrictEqual([
      '<time>',
      '<extensions>',
      '<metadata>',
      '<name>',
      'creator=',
    ]);
    const stripped = strippedGpx(routeLineOf(recorded).points);
    expect(personalGpxFields(stripped)).toStrictEqual([]);
    expect(routeLineOf(stripped).points).toStrictEqual(routeLineOf(recorded).points);
    expect(stripped).not.toContain('gpxtpx');
  });
});

describe('demo:bake’s preset-route inputs — #1651, ADR 0056 D-7', () => {
  const record = {
    gpx: {
      licence: 'CC0-1.0',
      source: 'my own ride, recorded on a head unit',
      confirmed: '2026-11-01',
    },
  };
  const strippedFixture = (): string => strippedGpx(routeLineOf(fixtureGpx()).points);
  const argumentsFor = (extra: string[] = []) => parseBakeArguments(['--route', 'climb', ...extra]);

  /** A directory standing in for `demo/routes/`, with the files given. */
  function presetDirectory(files: Record<string, string>): string {
    const directory = mkdtempSync(join(scratch, 'preset-'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), text);
    return directory;
  }

  it('reads a stripped GPX with its whole record, and CRLF line ends', () => {
    const directory = presetDirectory({
      'climb.gpx': strippedFixture().replace(/\n/g, '\r\n'),
      'climb.bake.json': JSON.stringify(record),
    });
    const input = readBakeInput(argumentsFor(), directory);
    expect(input.committed).toStrictEqual(record);
    expect(input.recordPath).toBe(join(directory, 'climb.bake.json'));
  });

  it('refuses a preset GPX that still carries a time, an extension or a name, naming them', () => {
    const directory = presetDirectory({
      'climb.gpx': fixtureGpx(),
      'climb.bake.json': JSON.stringify(record),
    });
    expect(() => readBakeInput(argumentsFor(), directory)).toThrow(
      /carries <time>, <extensions>, <metadata>, <name>, creator=/,
    );
  });

  it('refuses a preset GPX with a waypoint or a route beside its line', () => {
    for (const extra of ['<wpt lat="1" lon="2"></wpt>', '<rte><rtept lat="1" lon="2"/></rte>']) {
      const directory = presetDirectory({
        'climb.gpx': strippedFixture().replace('<trk>', `${extra}<trk>`),
        'climb.bake.json': JSON.stringify(record),
      });
      expect(() => readBakeInput(argumentsFor(), directory)).toThrow(/more than its line/);
    }
  });

  it('refuses a preset route with no record, or an incomplete one, before any archive is read', () => {
    const none = presetDirectory({ 'climb.gpx': strippedFixture() });
    expect(() => readBakeInput(argumentsFor(), none)).toThrow(/bake\.json/);
    const partial = presetDirectory({
      'climb.gpx': strippedFixture(),
      'climb.bake.json': JSON.stringify({ gpx: { ...record.gpx, licence: 'ODbL-1.0' } }),
    });
    expect(() => readBakeInput(argumentsFor(), partial)).toThrow(/gpx\.licence/);
  });

  it('takes a GPX named with --gpx with no record and makes none, and refuses --record with it', () => {
    const directory = presetDirectory({});
    const path = join(directory, 'trial.gpx');
    writeFileSync(path, fixtureGpx());
    const input = readBakeInput(argumentsFor(['--gpx', path]), directory);
    expect(input.committed).toBeUndefined();
    expect(input.gpx).toBe(fixtureGpx());
    expect(() => readBakeInput(argumentsFor(['--gpx', path, '--record']), directory)).toThrow(
      /--record is for a preset route/,
    );
  });

  it('--strip writes the line to the preset directory, and needs --gpx', () => {
    const directory = presetDirectory({});
    const path = join(directory, 'mine.gpx');
    writeFileSync(path, fixtureGpx());
    expect(() => stripPresetGpx(argumentsFor(['--strip']), directory)).toThrow(/needs --gpx/);
    const out = stripPresetGpx(argumentsFor(['--gpx', path, '--strip']), directory);
    expect(out).toBe(join(directory, 'climb.gpx'));
    expect(readFileSync(out, 'utf8')).toBe(strippedFixture());
  });
});
