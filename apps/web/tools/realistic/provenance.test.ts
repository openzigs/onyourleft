// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What is committed, what the manifest says about it, and what the pipeline
 * says it made — held to one another — #430, ADR 0026 D-5.
 *
 * Blender does not run in CI, so the half of D-5 that re-makes the bytes is
 * `process-assets.ts --check`, run by hand. This is the half that runs on every
 * pull request: that every realistic file is one the pipeline makes, that its
 * `ASSETS.toml` entry is the one the pipeline's own table and the input lock
 * produce — upstream page, input digest, script, tool and what was changed —
 * and that the lock itself is well formed. A row edited by hand, a file added
 * without a recipe, or a lock re-based without the manifest moving is red here.
 */

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseAssetManifest } from '../../src/credits/manifest';
import {
  REALISTIC_BICYCLE_MAPS,
  REALISTIC_BICYCLE_MAP_NAMES,
} from '../../src/game/realistic-assets';
import { fileKtx2Facts } from '../../src/game/realistic-bytes-testing';

import { drawBicycleMap, pixelDigest } from './draw-bicycle-maps';
import {
  assetRecord,
  DRAW_SCRIPT,
  DRAWN_TOOL,
  inputDigest,
  KTX2_SCRIPT,
  KTX2_SCRIPT_PATH,
  OUTPUT_DIRECTORY,
  OUTPUTS,
  PINNED_BLENDER,
  PINNED_KTX,
  PIPELINE_DIRECTORY,
  RIDER_KIT,
  RIDER_SCRIPT,
  shippedFiles,
  SOURCES,
  sourcesDigest,
  type InputLock,
} from './sources';

const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const lock = JSON.parse(
  readFileSync(join(REPOSITORY, 'apps/web/tools/realistic/inputs.lock.json'), 'utf8'),
) as InputLock;
const manifest = parseAssetManifest(readFileSync(join(REPOSITORY, 'ASSETS.toml'), 'utf8'));
const committed = readdirSync(join(REPOSITORY, OUTPUT_DIRECTORY)).sort();

const digest = (file: string): string =>
  createHash('sha256')
    .update(readFileSync(join(REPOSITORY, OUTPUT_DIRECTORY, file)))
    .digest('hex');

describe('the realistic files and the pipeline that makes them', () => {
  it('commits exactly the files the pipeline makes, in both directions', () => {
    // A file dropped in by hand has no recipe; a recipe whose file is missing
    // ships nothing. Either is a derived asset nobody can make again.
    expect(committed).toEqual([...shippedFiles()].sort());
    expect(committed.length).toBeGreaterThan(10);
  });

  it('gives every file the ASSETS.toml entry its recipe and the lock produce', () => {
    expect(manifest.problems).toEqual([]);
    for (const file of committed) {
      const entry = manifest.entries.find((each) => each.path === `${OUTPUT_DIRECTORY}/${file}`);
      expect(entry, `${file} has no ASSETS.toml entry`).toBeDefined();
      const expected = Object.fromEntries(assetRecord(file, lock, digest(file)));
      const found = Object.fromEntries(
        Object.entries(entry ?? {}).filter(([, value]) => value !== undefined),
      );
      expect(found, file).toEqual(expected);
    }
  });

  it('records a derived file’s input as the digest of what the lock downloaded', () => {
    // The one number in a derived row nothing else in CI recomputes.
    for (const output of OUTPUTS) {
      // A drawn map has no download to digest: §"the bicycle's drawn maps".
      if (output.recipe.how === 'verbatim' || output.recipe.how === 'drawn') continue;
      const source = lock.sources.find((each) => each.id === output.from);
      const entry = manifest.entries.find(
        (each) => each.path === `${OUTPUT_DIRECTORY}/${output.file}`,
      );
      // #623: a run that reads a second source digests both, path by source.
      const also = output.recipe.how === 'blender' ? (output.recipe.alsoReads ?? []) : [];
      expect(entry?.inputsha256, output.file).toBe(
        also.length === 0
          ? inputDigest(source?.files ?? [])
          : sourcesDigest(
              [output.from, ...also].map((id) => ({
                id,
                files: lock.sources.find((each) => each.id === id)?.files ?? [],
              })),
            ),
      );
      // #618: a file that passed through the encoder names BOTH pinned tools
      // (or the encoder alone, for an upstream picture encoded); one that did
      // not — a tree's middle level, the rider — names Blender alone.
      const recipe = output.recipe;
      const encoded =
        recipe.how === 'ktx2' || recipe.ktx2 !== undefined || recipe.images === 'ktx2';
      expect(entry?.tool, output.file).toBe(
        recipe.how === 'ktx2'
          ? PINNED_KTX
          : encoded
            ? `${PINNED_BLENDER}, then ${PINNED_KTX}`
            : PINNED_BLENDER,
      );
    }
  });

  it('names BOTH scripts in a row made by Blender and then the encoder — #618’s review', () => {
    // ASSET007 checks one `script`, and the two manifest readers hold no list,
    // so the first step is `script` and the encoder is named in `modified`.
    // Without it, "can it be made again from the row" needs a reader to know
    // about a second file the row never mentions.
    const twoStep = manifest.entries.filter(
      (entry) => entry.tool === `${PINNED_BLENDER}, then ${PINNED_KTX}`,
    );
    expect(twoStep.length).toBeGreaterThan(0);
    expect(existsSync(join(REPOSITORY, KTX2_SCRIPT_PATH))).toBe(true);
    for (const entry of twoStep) {
      expect(entry.script, entry.path).toMatch(/\/blender\/[a-z_]+\.py$/);
      expect(entry.modified, entry.path).toContain(KTX2_SCRIPT_PATH);
    }
    // And a row that did not pass through the encoder does not claim it did.
    for (const entry of manifest.entries.filter((each) => each.tool === PINNED_BLENDER)) {
      expect(entry.modified ?? '', entry.path).not.toContain(KTX2_SCRIPT_PATH);
    }
  });

  it('names the kit’s numbers in every row the rider’s kit is drawn into — #623, #742’s review', () => {
    // ASSET007 checks one `script`, so `process_rider.py` is the rider's; the
    // kit's numbers live in a second committed file it imports, and every map
    // that file decides names it in `modified`, from the pipeline's own table.
    // `rider.glb` is not one of them: its helmet colours are the script's own.
    const rider = OUTPUTS.find(
      (output) => output.recipe.how === 'blender' && output.recipe.script === RIDER_SCRIPT,
    );
    if (rider?.recipe.how !== 'blender') throw new Error('no rider in the pipeline table');
    const maps = rider.recipe.alsoWrites ?? [];
    expect(maps).toHaveLength(3);
    expect(readFileSync(join(REPOSITORY, RIDER_KIT), 'utf8')).toMatch(
      /SPDX-License-Identifier: AGPL-3.0-or-later/,
    );
    for (const map of maps) {
      const entry = manifest.entries.find(
        (each) => each.path === `${OUTPUT_DIRECTORY}/${map.file}`,
      );
      expect(entry?.script, map.file).toBe(`${PIPELINE_DIRECTORY}${RIDER_SCRIPT}`);
      expect(entry?.modified, map.file).toContain(RIDER_KIT);
    }
  });

  it('ships no JPEG or PNG in the realistic set since #618: every texture is KTX2', () => {
    // The originals are REMOVED, not shipped beside the KTX2. The sky is the
    // one picture left, an HDR, out of #618's scope.
    const pictures = committed.filter((file) => /\.(?:jpe?g|png)$/i.test(file));
    expect(pictures).toEqual([]);
    expect(committed.filter((file) => file.endsWith('.ktx2')).length).toBeGreaterThanOrEqual(22);
  });

  it('names a committed script, carrying its header, for every derived file', () => {
    for (const output of OUTPUTS) {
      if (output.recipe.how === 'verbatim') continue;
      const recipe = output.recipe;
      const name =
        recipe.how === 'ktx2' ? KTX2_SCRIPT : recipe.how === 'drawn' ? DRAW_SCRIPT : recipe.script;
      const script = readFileSync(join(REPOSITORY, 'apps/web/tools/realistic', name), 'utf8');
      expect(script.split('\n').slice(0, 5).join('\n'), name).toContain(
        'SPDX-License-Identifier: AGPL-3.0-or-later',
      );
    }
  });

  it('holds every module a Blender script imports from beside it, and imports every scan through one — #885’s review', () => {
    // ASSET007 checks the ONE `script` a row names, so a sibling module that
    // script imports — `rider_kit.py`, `gltf_import.py` — is held here: it is
    // in the tree and carries this directory's header. And a glTF is imported
    // only through `gltf_import.py`, so a script that called the importer
    // itself would skip #696's stable rule for a repeated triangle and the
    // guard that stops a run `mesh.validate()` decided.
    const directory = join(REPOSITORY, PIPELINE_DIRECTORY, 'blender');
    const scripts = readdirSync(directory).filter((file) => file.endsWith('.py'));
    const imported = new Set<string>();
    for (const file of scripts) {
      const source = readFileSync(join(directory, file), 'utf8');
      for (const match of source.matchAll(/^(?:from|import) ([a-z_]+)/gm)) {
        const name = match[1] ?? '';
        if (!scripts.includes(`${name}.py`)) continue;
        imported.add(`${name}.py`);
        // A sibling import leaves a `__pycache__` beside it unless bytecode
        // is off before it — a binary ASSET001 refuses, found by this review's
        // own first `--check`.
        const before = source.slice(0, match.index);
        expect(before, `${file} imports ${name}`).toMatch(/^sys\.dont_write_bytecode = True$/m);
      }
      if (file !== 'gltf_import.py') {
        expect(source, file).not.toMatch(/import_scene\.gltf\(/);
      }
    }
    expect([...imported].sort()).toEqual(['gltf_import.py', 'rider_kit.py']);
    for (const file of imported) {
      const source = readFileSync(join(directory, file), 'utf8');
      expect(source.split('\n').slice(0, 5).join('\n'), file).toContain(
        'SPDX-License-Identifier: AGPL-3.0-or-later',
      );
    }
    for (const script of ['process_tree.py', 'process_rock.py']) {
      expect(readFileSync(join(directory, script), 'utf8'), script).toMatch(
        /^from gltf_import import import_scan/m,
      );
    }
  });
});

describe('the bicycle’s drawn maps — #624', () => {
  const rowOf = (file: string): Readonly<Record<string, string | undefined>> =>
    (manifest.entries.find((each) => each.path === `${OUTPUT_DIRECTORY}/${file}`) ??
      {}) as Readonly<Record<string, string | undefined>>;

  it('records, as each map’s input, the digest of the pixels the drawing script draws TODAY', () => {
    // The decoded-pixel comparison `tools/icons/generate-icons.test.ts` makes,
    // one step earlier: the picture the encoder reads is redrawn here, in CI,
    // and its digest must be the one the committed KTX2 was made from. A
    // drawing changed without the maps being made again is red here; the
    // KTX2 bytes themselves are `process-assets.ts --check`'s.
    for (const map of REALISTIC_BICYCLE_MAP_NAMES) {
      const row = rowOf(REALISTIC_BICYCLE_MAPS[map]);
      expect(row['inputsha256'], map).toBe(pixelDigest(drawBicycleMap(map)));
      expect(row['input'], map).toBe(`apps/web/tools/realistic/${DRAW_SCRIPT}#${map}`);
      expect(row['script'], map).toBe(`apps/web/tools/realistic/${DRAW_SCRIPT}`);
      expect(row['tool'], map).toBe(DRAWN_TOOL);
      expect(row['licence'], map).toBe('CC0-1.0');
      // It says what the encoder did, and names the encoder's script.
      expect(row['modified'], map).toContain(KTX2_SCRIPT_PATH);
      expect(row['modified'], map).toContain(PINNED_KTX);
      // …and that nothing was fetched, traced or generated (ADR 0009, D-4).
      expect(row['source'], map).toContain('Nothing was downloaded');
    }
  });

  it('commits each map at the size it is drawn, UASTC and linear, with its whole mipmap chain', () => {
    for (const map of REALISTIC_BICYCLE_MAP_NAMES) {
      const drawn = drawBicycleMap(map);
      const facts = fileKtx2Facts(join(REPOSITORY, OUTPUT_DIRECTORY, REALISTIC_BICYCLE_MAPS[map]));
      expect(facts, map).toMatchObject({
        width: drawn.size,
        height: drawn.size,
        scheme: 'uastc',
        transfer: 'linear',
        levels: Math.log2(drawn.size) + 1,
      });
    }
  });

  it('is in no source and no lock: nothing was downloaded for it', () => {
    for (const map of REALISTIC_BICYCLE_MAP_NAMES) {
      const output = OUTPUTS.find((each) => each.file === REALISTIC_BICYCLE_MAPS[map]);
      expect(output?.recipe.how, map).toBe('drawn');
      expect(
        SOURCES.map((source) => source.id),
        map,
      ).not.toContain(output?.from);
      expect(
        lock.sources.map((source) => source.id),
        map,
      ).not.toContain(output?.from);
    }
  });
});

describe('the input lock', () => {
  it('records every source the pipeline reads, and nothing else', () => {
    expect(lock.sources.map((source) => source.id).sort()).toEqual(
      SOURCES.map((source) => source.id).sort(),
    );
  });

  it('records, for every file, where it came from and a digest of it', () => {
    for (const source of lock.sources) {
      expect(source.files.length, source.id).toBeGreaterThan(0);
      expect(source.read, source.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(source.authors, source.id).not.toBe('');
      for (const file of source.files) {
        expect(file.sha256, `${source.id}/${file.path}`).toMatch(/^[0-9a-f]{64}$/);
        expect(new URL(file.url).protocol, file.url).toBe('https:');
        expect(file.bytes).toBeGreaterThan(0);
      }
    }
  });

  it('records the licence each source’s own page stated, and only the two D-4 admits', () => {
    for (const source of lock.sources) {
      const wanted = SOURCES.find((each) => each.id === source.id);
      expect(source.evidence, source.id).toBe(wanted?.licencePhrase);
      expect(source.licencePage, source.id).toBe(wanted?.licencePage);
      expect(['CC0-1.0', 'CC-BY-4.0']).toContain(source.licence);
    }
  });
});
