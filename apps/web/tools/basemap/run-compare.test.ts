// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `basemap:compare` as `package.json` names it really loads (#1557). No gate
 * runs the tool on an archive (a region's archive is built off the repo), so a
 * graph `node` cannot load would otherwise only show when the owner ran it:
 * `@onyourleft/map-features` uses parameter properties, which `node`'s
 * strip-only mode refuses.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../..', import.meta.url));

function command(): string[] {
  const manifest = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  return manifest.scripts['basemap:compare']!.split(/\s+/);
}

describe('basemap:compare — #1557', () => {
  it('loads the whole graph through the decoder and answers a bad call with its usage', () => {
    const [program, ...args] = command();
    expect(program).toBe('node');
    const run = spawnSync(process.execPath, [...args, '--', 'only-one.pmtiles'], {
      cwd: WEB,
      encoding: 'utf8',
    });
    expect(run.stderr).not.toContain('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX');
    expect(run.stderr).toContain('usage: compare-archives');
    expect(run.status).toBe(2);
  });
});
