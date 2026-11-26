// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Every committed 3D model, read through the code the Credits screen runs —
 * #3250, ADR 0099 D-3 and D-5.
 *
 * `scripts/check-repo-rules.sh` §`ASSET009` holds a model's row to the two
 * licences on a bare clone. This file holds the half that script cannot: that
 * a `CC-BY-4.0` model's credit REACHES the list the screen is obliged to show.
 * CC BY 4.0 §6(a) ends the licence when the credit is dropped, so a model that
 * is in the manifest and not in that list is a model shipped unlicensed.
 *
 * It reads the committed `ASSETS.toml`, not a fixture: the claim is about the
 * models in this repository today.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { creditsFrom } from './credits';
import { parseAssetManifest } from './manifest';

const manifest = parseAssetManifest(
  readFileSync(fileURLToPath(new URL('../../../../ASSETS.toml', import.meta.url)), 'utf8'),
);

/** `ASSET009`'s list of what a 3D model's file is called. */
const MODEL_FILE = /\.(?:glb|gltf|obj|fbx|dae|blend|stl|ply|3ds|usd[acz]?)$/i;

/** The two licences a model may be committed under — ADR 0049 D-10. */
const MODEL_LICENCES: readonly string[] = ['CC0-1.0', 'CC-BY-4.0'];

const models = manifest.entries.filter((entry) => MODEL_FILE.test(entry.path));

describe('every committed 3D model — #3250', () => {
  it('finds the models the manifest names, of both licences', () => {
    // Not vacuous: the stylised world's eleven and the realistic world's.
    expect(manifest.problems).toEqual([]);
    expect(models.length).toBeGreaterThan(50);
    expect(models.some((model) => model.licence === 'CC-BY-4.0')).toBe(true);
    expect(models.some((model) => model.licence === 'CC0-1.0')).toBe(true);
  });

  it('is under CC0-1.0 or CC-BY-4.0 and no other licence, under apps/', () => {
    // Under `packages/` the licence boundary admits a permissive licence alone
    // (`ASSET004`), so the two-licence list is `apps/`' own, as in `ASSET009`.
    expect(
      models
        .filter((model) => model.path.startsWith('apps/'))
        .filter((model) => !MODEL_LICENCES.includes(model.licence))
        .map((model) => `${model.path}: ${model.licence}`),
    ).toEqual([]);
  });

  it('records where it came from as a link that can be opened', () => {
    expect(
      models
        .filter(
          (model) =>
            ![model.source, model.url, model.input].some((value) => value?.includes('https://')),
        )
        .map((model) => model.path),
    ).toEqual([]);
  });

  it('is credited on the Credits screen, with its creator, link and changes, when it is CC-BY-4.0', () => {
    const { required, problems } = creditsFrom(manifest);
    expect(problems).toEqual([]);
    const owed = models.filter((model) => model.licence === 'CC-BY-4.0');
    for (const model of owed) {
      const credit = required.find((work) => work.files.includes(model.path));
      expect(credit, `${model.path} is in no required credit`).toBeDefined();
      expect(credit?.attributionRequired, model.path).toBe(true);
      expect(credit?.creator, model.path).toBe(model.creator);
      expect(credit?.creator, model.path).not.toBe('');
      expect(credit?.url, model.path).toMatch(/^https:\/\//);
      expect(credit?.modified ?? '', model.path).not.toBe('');
    }
  });
});
