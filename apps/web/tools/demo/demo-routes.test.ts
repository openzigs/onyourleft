// SPDX-License-Identifier: AGPL-3.0-or-later

/** The demo build's rules for the baked routes — #1651. `demo-build.test.ts` runs them in a real build. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DEMO_ROUTE_MAX_BYTES, routesFindings } from './demo-routes';

const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-routes-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function routes(name: string, files: Record<string, number>): string {
  const directory = join(scratch, name);
  mkdirSync(directory, { recursive: true });
  for (const [file, bytes] of Object.entries(files)) {
    writeFileSync(join(directory, file), new Uint8Array(bytes));
  }
  return directory;
}

describe('routesFindings — #1651', () => {
  it('passes a build with no routes at all, which is CI’s', () => {
    expect(routesFindings(join(scratch, 'none'))).toStrictEqual([]);
  });

  it('passes a route at the ceiling with its notice and manifest beside it', () => {
    const directory = routes('at', {
      'climb.ab.bin': 100,
      'LICENCE-ODbL.txt': 1,
      'routes.json': 1,
    });
    expect(routesFindings(directory, 100)).toStrictEqual([]);
  });

  it('fails a route one byte over the ceiling, naming it and its size', () => {
    const directory = routes('over', {
      'climb.ab.bin': 101,
      'flat.cd.bin': 10,
      'LICENCE-ODbL.txt': 1,
      'routes.json': 1,
    });
    expect(routesFindings(directory, 100)).toStrictEqual([
      'climb.ab.bin is 101 bytes, over the per-route ceiling of 100',
    ]);
  });

  it('fails map data with no notice file or no manifest beside it', () => {
    expect(routesFindings(routes('bare', { 'climb.ab.bin': 1 }))).toStrictEqual([
      'routes/ has map data and no LICENCE-ODbL.txt',
      'routes/ has map data and no routes.json',
    ]);
  });

  it('holds the ceiling at 8 MiB until the owner sets another', () => {
    expect(DEMO_ROUTE_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
