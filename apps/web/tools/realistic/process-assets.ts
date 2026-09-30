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
 * each file's size, SHA-256 and the report its script wrote. With `--check`
 * the report is held too: `sources.ts` §`EXPECTED_REPORTS` (#900). `BLENDER`
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
 * ## KTX-Software is a tool too — #618
 *
 * Every committed texture is KTX2, made by the pinned `ktx` (`KTX` names it;
 * `sources.ts` §`PINNED_KTX` says how it was installed) from what the Blender
 * step or the upstream wrote — `encode-ktx2.ts` is that step. Any other
 * version is refused, for Blender's reason.
 *
 * ## Some maps are drawn, not downloaded — #624
 *
 * The realistic bicycle's four maps have no upstream: `draw-bicycle-maps.ts`
 * draws them from arithmetic, this writes each as a PNG into the scratch
 * stage, and the pinned `ktx` encodes it like any other picture.
 *
 * ## The rider reads a second source and a drawn mark — #623
 *
 * `process_rider.py` reads MakeHuman's repository AND MakeHuman's CC0 system
 * assets pack (a recipe's `alsoReads`), and the app's own two chevrons, which
 * this draws with `tools/icons/generate-icons.ts` §`drawMark` and hands it as a
 * PNG (a recipe's `mark`). `--only <file>` makes one output and whatever its
 * run also writes, for working on one asset; a pull request quotes a full run.
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
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drawMark, encodePng } from '../icons/generate-icons';

import { drawBicycleMap, pixelDigest } from './draw-bicycle-maps';
import { encodeKtx2, pinnedImageEncoder, requirePinnedKtx, withKtx2Images } from './encode-ktx2';
import { LOCK, RAW } from './fetch-assets';
import {
  assetRecord,
  formatRecord,
  OUTPUT_DIRECTORY,
  OUTPUTS,
  PINNED_BLENDER,
  PINNED_KTX,
  reportFaults,
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
  if (output.from.startsWith('makehuman')) return join(RAW, output.from);
  if (output.recipe.how === 'blender' && output.recipe.script === TEXTURE_SCRIPT) {
    return join(RAW, output.from);
  }
  return join(RAW, output.from, `${output.from}_1k.gltf`);
}

/**
 * Makes one output, and whatever else its run writes, into `into`.
 *
 * #618: a Blender run writes into `stage`, a directory of its own, the very
 * files it wrote before KTX2 — a GLB with JPEG and PNG maps, a PNG impostor, a
 * JPEG structure map — and the encoder turns each into what ships. So the
 * Blender half is the step `--check` already proved byte-stable, unchanged.
 */
function make(output: OutputSpec, into: string, stage: string): unknown {
  const recipe = output.recipe;
  if (recipe.how === 'verbatim') {
    copyFileSync(join(RAW, output.from, recipe.file), join(into, output.file));
    return undefined;
  }
  if (recipe.how === 'ktx2') {
    encodeKtx2(recipe.ktx2, join(RAW, output.from, recipe.file), join(into, output.file));
    return undefined;
  }
  if (recipe.how === 'drawn') {
    // #624: drawn here, written as a PNG into the scratch stage, and encoded.
    // The PNG's own bytes are never compared — zlib's may drift — only the
    // KTX2 the encoder makes of its pixels, and those pixels' digest.
    const drawn = drawBicycleMap(recipe.map);
    const picture = join(stage, `${output.file}.png`);
    writeFileSync(picture, encodePng(drawn.size, drawn.pixels));
    encodeKtx2(recipe.ktx2, picture, join(into, output.file));
    return { pixels: pixelDigest(drawn) };
  }
  const made = recipe.made ?? output.file;
  const report = join(stage, `${output.file}.report.json`);
  // #623: the other sources' downloads, and the app's mark drawn for the run.
  const extra = (recipe.alsoReads ?? []).map((id) => join(RAW, id));
  if (recipe.mark !== undefined) {
    const mark = join(stage, `${output.file}.mark.png`);
    writeFileSync(mark, encodePng(recipe.mark, drawMark(recipe.mark)));
    extra.push(mark);
  }
  blender(recipe.script, [inputFor(output), join(stage, made), report, ...recipe.args, ...extra]);
  if (recipe.ktx2 !== undefined) {
    encodeKtx2(recipe.ktx2, join(stage, made), join(into, output.file));
  } else if (recipe.images === 'ktx2') {
    writeFileSync(
      join(into, output.file),
      withKtx2Images(new Uint8Array(readFileSync(join(stage, made))), pinnedImageEncoder),
    );
  } else {
    copyFileSync(join(stage, made), join(into, output.file));
  }
  for (const also of recipe.alsoWrites ?? []) {
    encodeKtx2(also.ktx2, join(stage, also.made), join(into, also.file));
  }
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
  // `--only <file>`: make, and write or compare, only the output that ships
  // that file and whatever else its run writes. For working on one asset; a
  // pull request quotes a full `--check`.
  const onlyAt = process.argv.indexOf('--only');
  const only = onlyAt === -1 ? undefined : process.argv[onlyAt + 1];
  const outputs =
    only === undefined
      ? OUTPUTS
      : OUTPUTS.filter(
          (output) =>
            output.file === only ||
            (output.recipe.how === 'blender' &&
              (output.recipe.alsoWrites ?? []).some((also) => also.file === only)),
        );
  if (outputs.length === 0) throw new Error(`no output makes ${only ?? ''}`);
  const files = shippedFiles().filter((file) =>
    outputs.some(
      (output) =>
        output.file === file ||
        (output.recipe.how === 'blender' &&
          (output.recipe.alsoWrites ?? []).some((also) => also.file === file)),
    ),
  );
  const version = blenderVersion();
  if (version !== PINNED_BLENDER) {
    throw new Error(`${BLENDER} is ${version}; the pipeline is pinned to ${PINNED_BLENDER}`);
  }
  requirePinnedKtx();
  const scratch = mkdtempSync(join(tmpdir(), 'oyl-realistic-'));
  const stage = join(scratch, 'stage');
  mkdirSync(stage);
  const different: string[] = [];
  try {
    for (const output of outputs) {
      const started = Date.now();
      const report = make(output, scratch, stage);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `${output.file}: ${seconds} s ${report === undefined ? '' : JSON.stringify(report)}`,
      );
      // The run's report, as well as its bytes (#900 item 2): a run that made
      // the same bytes by a different road is not the run on record.
      if (check) different.push(...reportFaults(output.file, report));
    }
    for (const file of files) {
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
    console.log(`every file reproduced byte for byte by ${PINNED_BLENDER} and ${PINNED_KTX}`);
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
