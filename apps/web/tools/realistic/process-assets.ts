// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Make the realistic world's shipped files from its locked inputs — #430.
 *
 * ```bash
 * pnpm --filter @onyourleft/web run realistic:fetch     # the inputs, verified against the lock
 * pnpm --filter @onyourleft/web run realistic:process   # writes apps/web/public/realistic/
 * pnpm --filter @onyourleft/web run realistic:process --check   # writes nothing; compares
 * ```
 *
 * Runs headless Blender (`-b --factory-startup --python`) for every derived
 * file in `sources.ts` §`OUTPUTS`, copies the verbatim ones across, and prints
 * each file's size, SHA-256 and the report its script wrote. `BLENDER`
 * overrides where Blender is; the default is where the macOS app puts it.
 *
 * ## Blender is a tool, never a dependency
 *
 * ADR 0026 D-5. Nothing in the product, and no gate in CI, runs it: the files
 * it makes are committed, with their digests in `ASSETS.toml`, and what CI
 * checks is that those digests reproduce (`ASSET003`) and that every derived
 * file's record names this pipeline (`ASSET007`, `provenance.test.ts`).
 * ⚠️ **The version is pinned and a different one is refused**, because a
 * different Blender may decimate differently and the committed bytes would
 * then describe a run nobody can repeat — `sources.ts` §`PINNED_BLENDER`.
 *
 * ## `--check`: the reproducibility assertion
 *
 * #430's criterion is that re-running the pipeline reproduces the committed
 * bytes, the way `fixtures:generate` leaves `git status` clean. `--check` makes
 * everything into a scratch directory and compares each file with the
 * committed one, byte for byte, and exits non-zero naming any that differ. It
 * cannot run in CI — no Blender there — so it is run before a pull request that
 * touches a script or the lock, and its output is quoted in that pull request.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCK, RAW } from './fetch-assets';
import {
  assetRecord,
  formatRecord,
  OUTPUT_DIRECTORY,
  OUTPUTS,
  PINNED_BLENDER,
  shippedFiles,
  TEXTURE_SCRIPT,
  type InputLock,
  type OutputSpec,
} from './sources';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY = join(HERE, '..', '..', '..', '..');
const SHIPPED = join(REPOSITORY, OUTPUT_DIRECTORY);

// An empty BLENDER (as `.env.example` leaves it) means unset, not "run nothing".
const BLENDER_FROM_ENV = process.env.BLENDER;
const BLENDER =
  BLENDER_FROM_ENV !== undefined && BLENDER_FROM_ENV !== ''
    ? BLENDER_FROM_ENV
    : '/Applications/Blender.app/Contents/MacOS/Blender';

function blenderVersion(): string {
  const run = spawnSync(BLENDER, ['--version'], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`${BLENDER} --version failed; set BLENDER to Blender`);
  return run.stdout.split('\n')[0]?.trim() ?? '';
}

function blender(script: string, args: readonly string[]): string {
  const run = spawnSync(
    BLENDER,
    ['-b', '--factory-startup', '--python', join(HERE, script), '--', ...args],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  const output = run.stdout + run.stderr;
  if (run.status !== 0 || /Traceback|^Error:/m.test(output)) {
    throw new Error(`${script} ${args.join(' ')} failed:\n${output.slice(-6000)}`);
  }
  return output;
}

/** The input a script reads: a Poly Haven glTF, MakeHuman's directory, or a texture's (#475). */
function inputFor(output: OutputSpec): string {
  if (output.from === 'makehuman') return join(RAW, 'makehuman');
  if (output.recipe.how === 'blender' && output.recipe.script === TEXTURE_SCRIPT) {
    return join(RAW, output.from);
  }
  return join(RAW, output.from, `${output.from}_1k.gltf`);
}

function make(output: OutputSpec, into: string): unknown {
  const recipe = output.recipe;
  if (recipe.how === 'verbatim') {
    copyFileSync(join(RAW, output.from, recipe.file), join(into, output.file));
    return undefined;
  }
  const report = join(into, `${output.file}.report.json`);
  blender(recipe.script, [inputFor(output), join(into, output.file), report, ...recipe.args]);
  return JSON.parse(readFileSync(report, 'utf8')) as unknown;
}

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

/** `--records`: print the `ASSETS.toml` entries for what is committed, and do nothing else. */
function printRecords(): void {
  const lock = JSON.parse(readFileSync(LOCK, 'utf8')) as InputLock;
  console.log(
    shippedFiles()
      .map((file) => formatRecord(assetRecord(file, lock, sha256(join(SHIPPED, file)))))
      .join('\n\n'),
  );
}

function main(): void {
  if (process.argv.includes('--records')) {
    printRecords();
    return;
  }
  const check = process.argv.includes('--check');
  const version = blenderVersion();
  if (version !== PINNED_BLENDER) {
    throw new Error(`${BLENDER} is ${version}; the pipeline is pinned to ${PINNED_BLENDER}`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'oyl-realistic-'));
  const different: string[] = [];
  try {
    for (const output of OUTPUTS) {
      const started = Date.now();
      const report = make(output, scratch);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `${output.file}: ${seconds} s ${report === undefined ? '' : JSON.stringify(report)}`,
      );
    }
    for (const file of shippedFiles()) {
      const made = join(scratch, file);
      const digest = sha256(made);
      const committed = join(SHIPPED, file);
      if (check) {
        const was = existsSync(committed) ? sha256(committed) : 'absent';
        if (was !== digest) different.push(`${file}: committed ${was}, made ${digest}`);
      } else {
        copyFileSync(made, committed);
      }
      console.log(`${file} ${String(readFileSync(made).length)} ${digest}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (check) {
    if (different.length > 0) {
      throw new Error(`not reproduced:\n${different.join('\n')}`);
    }
    console.log(`every file reproduced byte for byte by ${PINNED_BLENDER}`);
  }
}

if (process.argv[1]?.endsWith('process-assets.ts') === true) {
  try {
    main();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
