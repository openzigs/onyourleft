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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseAssetManifest } from '../../src/credits/manifest';
import {
  assetRecord,
  inputDigest,
  OUTPUT_DIRECTORY,
  OUTPUTS,
  PINNED_BLENDER,
  shippedFiles,
  SOURCES,
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
      if (output.recipe.how !== 'blender') continue;
      const source = lock.sources.find((each) => each.id === output.from);
      const entry = manifest.entries.find(
        (each) => each.path === `${OUTPUT_DIRECTORY}/${output.file}`,
      );
      expect(entry?.inputsha256, output.file).toBe(inputDigest(source?.files ?? []));
      expect(entry?.tool).toBe(PINNED_BLENDER);
    }
  });

  it('names a committed script, carrying its header, for every derived file', () => {
    for (const output of OUTPUTS) {
      if (output.recipe.how !== 'blender') continue;
      const script = readFileSync(
        join(REPOSITORY, 'apps/web/tools/realistic', output.recipe.script),
        'utf8',
      );
      expect(script.split('\n').slice(0, 5).join('\n'), output.recipe.script).toContain(
        'SPDX-License-Identifier: AGPL-3.0-or-later',
      );
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
