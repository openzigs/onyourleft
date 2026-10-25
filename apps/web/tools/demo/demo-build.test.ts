// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo build, run for real — #1645.
 *
 * The unit tests beside this hold each plugin's rule; this runs
 * `vite.demo.config.ts` itself, into a directory of its own, and reads back
 * what it wrote: the page with its policy and hash, the realistic world and
 * the licences, and no worker or manifest. Then it builds the same config from
 * a scratch entry that imports a trainer-command module, and from one that
 * imports only its types, and checks the first is refused and the second is
 * not — the forbidden-module check against Rolldown's real output.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { filesUnder, workerOrManifest } from './demo-output';
import { scriptHash } from './content-security';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const CONFIG = join(WEB, 'vite.demo.config.ts');
const SEAM_MODULE = join(WEB, '../../packages/sensors/protocol/src/fitness-machine-control.ts');

const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-build-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The demo config, built into `outDir` — from `input` in place of the page, if given. */
async function buildDemo(outDir: string, input?: string): Promise<void> {
  await build({
    configFile: CONFIG,
    logLevel: 'silent',
    build: {
      outDir,
      ...(input === undefined ? {} : { rollupOptions: { input } }),
    },
  });
}

describe('the demo build, as it is shipped — #1645', () => {
  const outDir = join(scratch, 'page');
  beforeAll(() => buildDemo(outDir), 60_000);

  it('writes the page, with its policy and the theme script’s hash in it', () => {
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    const theme = /<script id="oyl-theme-selection">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(theme).toBeDefined();
    expect(html).toContain(
      `script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' ${scriptHash(theme ?? '')}; worker-src`,
    );
    expect(html).toContain("connect-src 'self' blob:;");
    // `base: './'`: every reference is relative, so it works from any path.
    expect(html).toMatch(/<script type="module" crossorigin src="\.\/assets\/[^"]+\.js">/);
    expect(html).not.toMatch(/(?:src|href)="\/(?!\/)/);
  }, 60_000);

  it('ships the realistic world, its transcoder and the licence notices', () => {
    const files = filesUnder(outDir);
    expect(files).toContain('realistic/basis/basis_transcoder.wasm');
    expect(files).toContain('licences/third-party.txt');
    // #1683: the banners' glyph range, and the font's licence beside it.
    expect(files).toContain('glyphs/Roboto-Regular/0-255.pbf');
    expect(files).toContain('glyphs/Roboto-Regular/Apache-2.0.txt');
    const realistic = filesUnder(join(WEB, 'public/realistic'));
    expect(realistic.length).toBeGreaterThan(0);
    for (const file of realistic) expect(files).toContain(`realistic/${file}`);
  }, 60_000);

  it('ships no service worker and no web app manifest', () => {
    const files = filesUnder(outDir);
    expect(workerOrManifest(files)).toEqual([]);
    expect(existsSync(join(outDir, 'sw.js'))).toBe(false);
    // Nor anything else of public/ but the three directories.
    expect(
      files.filter((file) => !/^(?:assets|realistic|licences|glyphs)\/|^index\.html$/.test(file)),
    ).toEqual([]);
  }, 60_000);
});

describe('the demo build refuses a trainer module — #1645', () => {
  it('fails when the entry imports the trainer-command seam', async () => {
    const entry = join(scratch, 'imports-the-seam.ts');
    writeFileSync(
      entry,
      `import * as control from ${JSON.stringify(SEAM_MODULE)};\nconsole.log(control);\n`,
    );
    await expect(buildDemo(join(scratch, 'seam'), entry)).rejects.toThrow(
      /oyl-demo-forbidden-modules[\s\S]*packages\/sensors\/protocol\/src\/fitness-machine-control\.ts/,
    );
  }, 60_000);

  it('passes when the entry imports only its types, which are erased', async () => {
    const entry = join(scratch, 'imports-types.ts');
    writeFileSync(
      entry,
      `import type * as control from ${JSON.stringify(SEAM_MODULE)};\n` +
        `export const none: Partial<typeof control> = {};\n`,
    );
    await expect(buildDemo(join(scratch, 'types'), entry)).resolves.toBeUndefined();
  }, 60_000);
});
