// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The display face's subsetting step — #991, ADR 0043 D-5.
 *
 * `pnpm --filter @onyourleft/web run fonts:subset` cuts each committed Barlow
 * weight to the Latin range and writes it as WOFF2 under
 * `src/design/fonts/`, and writes the licence's text to
 * `public/licences/OFL-1.1.txt`. `--check` writes nothing and fails unless
 * every committed file is what it would have written, byte for byte.
 *
 * ⚠️ **A tool, like Blender: nothing in CI runs it.** It needs a Python with
 * fontTools and Brotli at exactly the versions `font-recipe.ts` pins
 * (`FONTTOOLS_PYTHON`, in `.env.example`, names that Python; empty means
 * `python3` on the PATH), and it refuses any other. What CI runs instead is
 * `fonts.test.ts`, which holds the committed inputs to their digests and reads
 * every committed WOFF2 back — its code points, its `tnum`, its weight and its
 * licence records — without the tool.
 *
 *     python3 -m venv .venv-fonts
 *     .venv-fonts/bin/pip install fonttools==4.66.1 brotli==1.2.0
 *     FONTTOOLS_PYTHON=.venv-fonts/bin/python pnpm --filter @onyourleft/web run fonts:subset --check
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FONT_WEIGHTS,
  LICENCE_BODY_STARTS,
  LICENCE_MEMBER,
  PINNED_BROTLI,
  PINNED_FONTTOOLS,
  subsetArguments,
} from './font-recipe';

/** Where the committed upstream files are. */
export const INPUT_DIRECTORY = new URL('./barlow/', import.meta.url);

/** Where the subsets are written: imported by `theme.css`, so Vite hashes and emits them. */
export const OUTPUT_DIRECTORY = new URL('../../src/design/fonts/', import.meta.url);

/** The licence text the credits screen links. */
export const LICENCE_COPY = new URL('../../public/licences/OFL-1.1.txt', import.meta.url);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A committed input's bytes, refused unless they are upstream's. */
export function readInput(member: string, expected: string): Uint8Array {
  const bytes = new Uint8Array(readFileSync(fileURLToPath(new URL(member, INPUT_DIRECTORY))));
  const digest = sha256(bytes);
  if (digest !== expected) {
    throw new Error(
      `tools/fonts/barlow/${member} digests to ${digest}, not ${expected}; font-recipe.ts ` +
        'records which upstream file this has to be',
    );
  }
  return bytes;
}

/**
 * The licence's text: the upstream `OFL.txt` from the licence's own first
 * line down. The copyright notice above that line is Barlow's, and travels in
 * the fonts' name tables and on the credits screen rather than in a file that
 * names a licence.
 */
export function licenceBody(upstream: string): string {
  const at = upstream.indexOf(LICENCE_BODY_STARTS);
  if (at < 0) {
    throw new Error('the upstream OFL.txt does not contain the licence’s own first line');
  }
  return upstream.slice(at);
}

/** The Python that runs fontTools, refused unless its two packages are the pinned ones. */
export function pinnedPython(python: string): string {
  const versions = execFileSync(
    python,
    ['-c', 'import fontTools, brotli; print(fontTools.version); print(brotli.__version__)'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  const [fonttools, brotli] = versions;
  if (fonttools !== PINNED_FONTTOOLS || brotli !== PINNED_BROTLI) {
    throw new Error(
      `${python} has fontTools ${String(fonttools)} and Brotli ${String(brotli)}; the committed ` +
        `fonts were written by fontTools ${PINNED_FONTTOOLS} and Brotli ${PINNED_BROTLI}, and a ` +
        'different version may write different bytes',
    );
  }
  return python;
}

/** Every file the step writes, by its URL, made fresh in a scratch directory. */
export function subsetFiles(python: string): ReadonlyMap<string, Uint8Array> {
  const scratch = mkdtempSync(join(tmpdir(), 'oyl-fonts-'));
  try {
    const files = new Map<string, Uint8Array>();
    for (const weight of FONT_WEIGHTS) {
      readInput(weight.member, weight.memberSha256);
      const output = join(scratch, weight.output);
      execFileSync(
        python,
        [
          '-m',
          'fontTools.subset',
          ...subsetArguments(fileURLToPath(new URL(weight.member, INPUT_DIRECTORY)), output),
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      );
      files.set(
        new URL(weight.output, OUTPUT_DIRECTORY).href,
        new Uint8Array(readFileSync(output)),
      );
    }
    const licence = readInput(LICENCE_MEMBER.member, LICENCE_MEMBER.sha256);
    files.set(
      LICENCE_COPY.href,
      new TextEncoder().encode(licenceBody(new TextDecoder().decode(licence))),
    );
    return files;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function main(argv: readonly string[]): number {
  const check = argv.includes('--check');
  const python = pinnedPython(process.env['FONTTOOLS_PYTHON'] || 'python3');
  const files = subsetFiles(python);
  let drift = 0;
  for (const [href, bytes] of files) {
    const path = fileURLToPath(href);
    if (check) {
      let committed: Uint8Array | undefined;
      try {
        committed = new Uint8Array(readFileSync(path));
      } catch {
        committed = undefined;
      }
      if (committed === undefined || sha256(committed) !== sha256(bytes)) {
        console.error(`${path} is not what fonts:subset writes`);
        drift += 1;
      }
    } else {
      writeFileSync(path, bytes);
      console.log(`${path}  ${String(bytes.byteLength)} bytes  sha256 ${sha256(bytes)}`);
    }
  }
  if (check && drift === 0) {
    console.log(`all ${String(files.size)} files are what fonts:subset writes`);
  }
  return drift === 0 ? 0 : 1;
}

// Run only when this file is the program, never when a test imports it.
if (process.argv[1]?.endsWith('subset-fonts.ts') === true) {
  process.exitCode = main(process.argv.slice(2));
}
