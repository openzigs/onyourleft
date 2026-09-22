// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Turn the downloaded assets into what the realism page loads — #457.
 *
 * ```bash
 * node apps/web/tools/realism/fetch-assets.ts     # first
 * node apps/web/tools/realism/process-assets.ts
 * ```
 *
 * Runs headless Blender (`-b --factory-startup --python`) over each tree and
 * the rider, copies the sky and the surface textures across unchanged, and
 * writes `build/processed/manifest.json` — every file with its size and
 * SHA-256, and every report the Blender scripts wrote. `vite.browser.config.ts`
 * copies `build/processed/` into the harness build when it exists.
 *
 * Blender is a TOOL, never a dependency: nothing in the product or in any gate
 * runs it. `BLENDER` overrides the path; the default is where the macOS app
 * puts it. Blender 4.4.3 is what these scripts were written against.
 *
 * ## What this taught #430's pipeline
 *
 * The spike write-up §"What the pipeline taught #430" is the full list; the
 * short version is that every step is a script with its inputs on the command
 * line and a JSON report as its output, so a run is reproducible and its
 * numbers are data rather than a screenshot of Blender's status bar.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, 'build', 'raw');
const OUT = join(HERE, 'build', 'processed');
// An empty BLENDER (as `.env.example` leaves it) means unset, not "run nothing".
const BLENDER_FROM_ENV = process.env.BLENDER;
const BLENDER =
  BLENDER_FROM_ENV !== undefined && BLENDER_FROM_ENV !== ''
    ? BLENDER_FROM_ENV
    : '/Applications/Blender.app/Contents/MacOS/Blender';

/**
 * The three species and what each is cut down to. The product's two tree
 * kinds are drawn from these: broadleaf from the first two, conifer from the
 * third. `fir_sapling` holds three saplings; `_a` is the tallest.
 */
const TREES = [
  { id: 'island_tree_02', object: 'island_tree_02', triangles: 20_000 },
  { id: 'tree_small_02', object: 'tree_small_02', triangles: 20_000 },
  { id: 'fir_sapling', object: 'fir_sapling_a', triangles: 16_000 },
] as const;

const RIDER_TRIANGLES = 9_000;

/** Copied unchanged: Poly Haven already serves them at 1K and 2K. */
const COPIED = [
  'farm_field/farm_field_2k.hdr',
  ...['asphalt_02', 'sparse_grass'].flatMap((id) =>
    ['1k', '2k'].flatMap((resolution) =>
      ['diff', 'nor_gl', 'rough'].map((map) => `${id}/${id}_${map}_${resolution}.jpg`),
    ),
  ),
];

function blender(script: string, args: readonly string[]): void {
  const run = spawnSync(
    BLENDER,
    ['-b', '--factory-startup', '--python', join(HERE, 'blender', script), '--', ...args],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  if (run.status !== 0 || /Traceback|Error:/.test(run.stderr + run.stdout)) {
    throw new Error(
      `${script} ${args.join(' ')} failed:\n${run.stdout.slice(-4000)}\n${run.stderr.slice(-4000)}`,
    );
  }
}

function main(): void {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const reports: Record<string, unknown> = {};
  for (const tree of TREES) {
    const started = Date.now();
    blender('process_tree.py', [
      join(RAW, tree.id, `${tree.id}_1k.gltf`),
      join(OUT, `${tree.id}.glb`),
      join(OUT, `${tree.id}-impostor.png`),
      join(OUT, `${tree.id}.json`),
      tree.object,
      String(tree.triangles),
    ]);
    reports[tree.id] = {
      ...(JSON.parse(readFileSync(join(OUT, `${tree.id}.json`), 'utf8')) as object),
      blenderSeconds: (Date.now() - started) / 1000,
    };
    console.log(`${tree.id}: done`);
  }
  blender('process_rider.py', [
    join(RAW, 'makehuman'),
    join(OUT, 'rider.glb'),
    join(OUT, 'rider.json'),
    String(RIDER_TRIANGLES),
  ]);
  reports.rider = JSON.parse(readFileSync(join(OUT, 'rider.json'), 'utf8')) as object;
  for (const path of COPIED) {
    copyFileSync(join(RAW, path), join(OUT, path.slice(path.indexOf('/') + 1)));
  }
  // The per-frame renders are scaffolding for the strip; the reports are in the manifest.
  for (const name of readdirSync(OUT)) {
    if (/\.frame\d+\.png$/.test(name) || name.endsWith('.json')) rmSync(join(OUT, name));
  }
  const files = readdirSync(OUT)
    .sort()
    .map((name) => {
      const body = readFileSync(join(OUT, name));
      return {
        name,
        bytes: statSync(join(OUT, name)).size,
        sha256: createHash('sha256').update(body).digest('hex'),
      };
    });
  writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({ files, reports }, null, 2)}\n`);
  console.log(JSON.stringify({ files, reports }, null, 2));
}

if (process.argv[1]?.endsWith('process-assets.ts') === true) {
  main();
}
