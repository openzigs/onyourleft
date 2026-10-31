// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `pnpm --filter @onyourleft/web basemap:compare -- <ours.pmtiles> <theirs.pmtiles> [--strict] [--build-year YYYY]`
 *
 * `run-compare.mjs` runs {@link main}: this file reaches
 * `@onyourleft/map-features`, whose TypeScript `node`'s strip-only mode refuses
 * (parameter properties), so it is loaded through Vite's module runner.
 *
 * Walks every tile inside the two archives' bounds, at every zoom either holds,
 * and prints `compare.ts`'s summary as JSON. `--strict` is for `build.sh
 * --compare`'s pair (the same extract through upstream's profile): it exits 1
 * on any differing tile, malformed tile, refused field value or decoder
 * disagreement. Without it, the schema is the comparison and the counts are a
 * record. Meant for a region: a US archive has millions of z15 tiles.
 */

import { open, type FileHandle } from 'node:fs/promises';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import { compareTile, emptySummary, strictPasses, type Summary } from './compare';

class FileHandleSource implements Source {
  private constructor(
    private readonly handle: FileHandle,
    private readonly path: string,
  ) {}

  static async open(path: string): Promise<FileHandleSource> {
    return new FileHandleSource(await open(path, 'r'), path);
  }

  getKey(): string {
    return this.path;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const buffer = new Uint8Array(length);
    const { bytesRead } = await this.handle.read(buffer, 0, length, offset);
    return { data: buffer.buffer.slice(0, bytesRead) };
  }

  close(): Promise<void> {
    return this.handle.close();
  }
}

function tileRange(z: number, minLon: number, minLat: number, maxLon: number, maxLat: number) {
  const n = 2 ** z;
  const x = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const y = (lat: number) => {
    const rad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
    return Math.min(
      n - 1,
      Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(rad)) / Math.PI) / 2) * n)),
    );
  };
  return { x0: x(minLon), x1: x(maxLon), y0: y(maxLat), y1: y(minLat) };
}

function printable(summary: Summary): unknown {
  return {
    ...summary,
    layers: Object.fromEntries(
      [...summary.layers].map(([name, layer]) => [
        name,
        {
          ...layer,
          keysOurs: [...layer.keysOurs].sort(),
          keysTheirs: [...layer.keysTheirs].sort(),
          keysOnlyOurs: [...layer.keysOurs].filter((key) => !layer.keysTheirs.has(key)).sort(),
          keysOnlyTheirs: [...layer.keysTheirs].filter((key) => !layer.keysOurs.has(key)).sort(),
        },
      ]),
    ),
    fieldFill: Object.fromEntries(summary.fieldFill),
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  const paths = argv.filter((arg, i) => !arg.startsWith('--') && argv[i - 1] !== '--build-year');
  const strict = argv.includes('--strict');
  const yearAt = argv.indexOf('--build-year');
  const buildYear = yearAt >= 0 ? Number(argv[yearAt + 1]) : new Date().getUTCFullYear();
  if (paths.length !== 2 || !Number.isInteger(buildYear)) {
    process.stderr.write(
      'usage: compare-archives <ours.pmtiles> <theirs.pmtiles> [--strict] [--build-year YYYY]\n',
    );
    return 2;
  }
  const sources = await Promise.all(paths.map((path) => FileHandleSource.open(path)));
  try {
    const [ours, theirs] = sources.map((source) => new PMTiles(source)) as [PMTiles, PMTiles];
    const [a, b] = await Promise.all([ours.getHeader(), theirs.getHeader()]);
    const summary = emptySummary();
    const minZoom = Math.min(a.minZoom, b.minZoom);
    const maxZoom = Math.max(a.maxZoom, b.maxZoom);
    for (let z = minZoom; z <= maxZoom; z++) {
      const r = tileRange(
        z,
        Math.min(a.minLon, b.minLon),
        Math.min(a.minLat, b.minLat),
        Math.max(a.maxLon, b.maxLon),
        Math.max(a.maxLat, b.maxLat),
      );
      for (let x = r.x0; x <= r.x1; x++) {
        for (let y = r.y0; y <= r.y1; y++) {
          const [mine, other] = await Promise.all([ours.getZxy(z, x, y), theirs.getZxy(z, x, y)]);
          compareTile(
            summary,
            { z, x, y },
            mine ? new Uint8Array(mine.data) : null,
            other ? new Uint8Array(other.data) : null,
            buildYear,
          );
        }
      }
    }
    process.stdout.write(`${JSON.stringify(printable(summary), null, 2)}\n`);
    if (strict && !strictPasses(summary)) {
      process.stderr.write('compare-archives: the strict pair differs; see the summary\n');
      return 1;
    }
    return 0;
  } finally {
    await Promise.all(sources.map((source) => source.close()));
  }
}
