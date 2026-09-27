// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The transcoder plugin — #618. What a build does with it is `pnpm run build`'s
 * (the copied-into-build check and the precache log) and the browser gate's;
 * this holds the two things it decides without a build.
 */

import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REALISTIC_TRANSCODER_DIRECTORY } from '../../src/game/transcoder-files';

import { TRANSCODER_FILES, transcoderSource, withoutDefaultUrls } from './transcoder-plugin';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const loaderSource = (): string =>
  readFileSync(
    createRequire(join(WEB, 'package.json')).resolve('three/examples/jsm/loaders/KTX2Loader.js'),
    'utf8',
  );

describe('the Basis transcoder, from this app’s own origin — #618', () => {
  it('copies both files out of the installed three, the .wasm at the 527 333 bytes ADR 0026 D-8 read', () => {
    expect(TRANSCODER_FILES).toEqual(['basis_transcoder.js', 'basis_transcoder.wasm']);
    expect(statSync(transcoderSource(WEB, 'basis_transcoder.wasm')).size).toBe(527_333);
    expect(statSync(transcoderSource(WEB, 'basis_transcoder.js')).size).toBeGreaterThan(10_000);
    expect(REALISTIC_TRANSCODER_DIRECTORY).toBe('realistic/basis/');
  });

  it('takes KTX2Loader’s two default URLs out of the installed three, so no build emits a second copy', () => {
    const code = loaderSource();
    // Non-vacuity: the pinned three really does carry both.
    expect(code).toContain("new URL( '../libs/basis/basis_transcoder.wasm', import.meta.url )");
    expect(code).toContain("new URL( '../libs/basis/basis_transcoder.js', import.meta.url )");
    const rewritten = withoutDefaultUrls(code);
    expect(rewritten).not.toContain('import.meta.url');
    expect(rewritten.length).toBeLessThan(code.length);
  });

  it('refuses a KTX2Loader that spells them otherwise, rather than letting a copy into assets/', () => {
    const code = loaderSource().replace(
      "new URL( '../libs/basis/basis_transcoder.js', import.meta.url )",
      "new URL('../libs/basis/basis_transcoder.js', import.meta.url)",
    );
    expect(() => withoutDefaultUrls(code)).toThrow(/found 1/);
  });
});
