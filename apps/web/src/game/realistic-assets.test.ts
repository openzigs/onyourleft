// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { shippedFiles } from '../../tools/realistic/sources';
import {
  isRealisticVegetation,
  REALISTIC_BROADLEAVES,
  REALISTIC_CONIFERS,
  REALISTIC_TREE_MAKING,
  REALISTIC_DIRECTORY,
  REALISTIC_TREE_SETS,
  REALISTIC_TREES_DEFAULT,
  REALISTIC_VEGETATION,
  REALISTIC_VEGETATION_KINDS,
  realisticFiles,
  realisticUrl,
  realisticVegetation,
  realisticWorldChosenText,
  realisticWorldNotice,
} from './realistic-assets';
import { SCATTER_KINDS } from './scatter';

const COMMITTED = readdirSync(fileURLToPath(new URL('../../public/realistic/', import.meta.url)));

describe('what the renderer loads is what the pipeline ships — #430', () => {
  it('names exactly the committed files, in both directions', () => {
    // A file the pipeline ships and the renderer never loads is APK weight for
    // nothing; a file the renderer loads and nothing ships is a 404 on the
    // tablet and a world that silently stays stylised.
    expect([...realisticFiles()].sort()).toEqual([...COMMITTED].sort());
    expect([...realisticFiles()].sort()).toEqual([...shippedFiles()].sort());
  });

  it('names each file once', () => {
    expect(new Set(realisticFiles()).size).toBe(realisticFiles().length);
  });

  it('serves them under one directory, which is what the precache excludes', () => {
    for (const file of realisticFiles()) {
      expect(realisticUrl(file)).toBe(`/${REALISTIC_DIRECTORY}${file}`);
    }
  });
});

describe('the kinds layer 2 replaces — ADR 0026 D-12, #474', () => {
  it('are the trees, the shrub and the rock, and not the post', () => {
    // ADR 0022 D-3's `post` stays procedural in both worlds (ADR 0026 D-3).
    expect([...REALISTIC_VEGETATION_KINDS].sort()).toEqual([
      'rock',
      'shrub',
      'tree-broadleaf',
      'tree-conifer',
    ]);
    expect(isRealisticVegetation('post')).toBe(false);
    expect(isRealisticVegetation('building')).toBe(false);
    for (const kind of REALISTIC_VEGETATION_KINDS) {
      expect(SCATTER_KINDS, kind).toContain(kind);
      expect(isRealisticVegetation(kind)).toBe(true);
      expect(REALISTIC_VEGETATION[kind].length, kind).toBeGreaterThan(0);
    }
  });

  it('gives every tree an impostor and nothing else one', () => {
    for (const trees of REALISTIC_TREE_SETS) {
      for (const kind of REALISTIC_VEGETATION_KINDS) {
        for (const model of realisticVegetation(trees)[kind]) {
          expect(model.impostor !== undefined, model.name).toBe(kind.startsWith('tree-'));
          // #630: and its normals, exactly when it has a strip.
          expect(model.impostorNormals !== undefined, model.name).toBe(
            model.impostor !== undefined,
          );
        }
      }
    }
  });

  it('gives every tree a middle level of detail and nothing else one — #617', () => {
    for (const trees of REALISTIC_TREE_SETS) {
      for (const kind of REALISTIC_VEGETATION_KINDS) {
        for (const model of realisticVegetation(trees)[kind]) {
          expect(model.middle !== undefined, model.name).toBe(kind.startsWith('tree-'));
          if (model.middle !== undefined) expect(model.middle).toBe(`${model.name}-middle.glb`);
        }
      }
    }
  });
});

describe('the sets of trees — #1283, #1294, ADR 0049 D-1', () => {
  it('draws a ride with the generated trees, and keeps the scans beside them', () => {
    expect(REALISTIC_TREES_DEFAULT).toBe('generated');
    expect([...REALISTIC_TREE_SETS].sort()).toEqual(['generated', 'scanned', 'scanned-conifers']);
    // What a ride draws is the default set's table, the very object.
    expect(REALISTIC_VEGETATION).toEqual(realisticVegetation(REALISTIC_TREES_DEFAULT));
    expect(REALISTIC_VEGETATION['tree-broadleaf']).toBe(REALISTIC_BROADLEAVES.generated);
    // #1294: and its conifers are the generated firs.
    expect(REALISTIC_VEGETATION['tree-conifer']).toBe(REALISTIC_CONIFERS.generated);
    expect(REALISTIC_CONIFERS.generated.map((model) => model.name)).toEqual([
      'generated_fir_a',
      'generated_fir_b',
    ]);
    // The scans are the trees every realistic world drew until #1283 and #1294.
    expect(REALISTIC_BROADLEAVES.scanned.map((model) => model.name)).toEqual([
      'island_tree_02',
      'tree_small_02',
    ]);
    expect(REALISTIC_CONIFERS.scanned.map((model) => model.name)).toEqual([
      'fir_sapling_medium_a',
      'fir_sapling_medium_b',
    ]);
    // Still committed, and still named for the precache rule and the budget —
    // every tree of either making.
    for (const model of [
      ...REALISTIC_BROADLEAVES.scanned,
      ...REALISTIC_CONIFERS.scanned,
      ...REALISTIC_BROADLEAVES.generated,
      ...REALISTIC_CONIFERS.generated,
    ]) {
      for (const file of [model.file, model.impostor, model.impostorNormals, model.middle]) {
        expect(realisticFiles(), model.name).toContain(file);
        expect(COMMITTED, model.name).toContain(file);
      }
    }
    // Each file once, though three sets name most of them twice.
    expect(new Set(realisticFiles()).size).toBe(realisticFiles().length);
  });

  it('differs between the sets in its trees alone, each set the making its name says', () => {
    expect(REALISTIC_TREE_MAKING).toEqual({
      generated: { broadleaves: 'generated', conifers: 'generated' },
      'scanned-conifers': { broadleaves: 'generated', conifers: 'scanned' },
      scanned: { broadleaves: 'scanned', conifers: 'scanned' },
    });
    for (const trees of REALISTIC_TREE_SETS) {
      const set = realisticVegetation(trees);
      expect(set['tree-broadleaf'], trees).toBe(
        REALISTIC_BROADLEAVES[REALISTIC_TREE_MAKING[trees].broadleaves],
      );
      expect(set['tree-conifer'], trees).toBe(
        REALISTIC_CONIFERS[REALISTIC_TREE_MAKING[trees].conifers],
      );
      // The shrubs and the rock are the same files in every set.
      for (const kind of ['shrub', 'rock'] as const) {
        expect(set[kind], `${trees} ${kind}`).toEqual(realisticVegetation('generated')[kind]);
      }
    }
    // No tree is in both makings of its kind.
    for (const table of [REALISTIC_BROADLEAVES, REALISTIC_CONIFERS]) {
      const names = (making: 'generated' | 'scanned'): string[] =>
        table[making].map((each) => each.name);
      expect(names('generated').some((name) => names('scanned').includes(name))).toBe(false);
    }
    // As many generated firs as scanned ones: a tree is a draw call a level a
    // SHAPE, and the firs add none (#1289's review, #1294).
    expect(REALISTIC_CONIFERS.generated).toHaveLength(REALISTIC_CONIFERS.scanned.length);
  });

  it('gives a rider more shapes than the scans did, two species turn about', () => {
    const names = REALISTIC_BROADLEAVES.generated.map((model) => model.name);
    expect(names.length).toBeGreaterThan(REALISTIC_BROADLEAVES.scanned.length);
    expect(new Set(names).size).toBe(names.length);
    // An item's variant picks modulo the count, so neighbouring slots are
    // different SPECIES: no two of one stand side by side in the table.
    const species = names.map((name) => name.split('_')[1]);
    expect(new Set(species).size).toBeGreaterThanOrEqual(2);
    species.forEach((each, at) => {
      expect(each, names[at]).not.toBe(species[(at + 1) % species.length]);
    });
    for (const name of names) expect(name).toMatch(/^generated_[a-z]+_[a-z]$/);
  });
});

describe('what a rider is told when the realistic world is not what they ride in — ADR 0026 D-7', () => {
  it('says nothing when it loaded', () => {
    expect(realisticWorldNotice({ loaded: true })).toBeUndefined();
  });

  it('says it is not kept offline, when the browser was offline — the expected case', () => {
    const notice = realisticWorldNotice({
      loaded: false,
      offline: true,
      detail: 'Failed to fetch',
    });
    expect(notice).toMatch(/offline/);
    expect(notice).toMatch(/standard world/);
  });

  it('says only that it could not load otherwise, and never the failure’s own words', () => {
    const notice = realisticWorldNotice({
      loaded: false,
      offline: false,
      detail: 'shrub_02_c.glb: 404 Not Found',
    });
    expect(notice).toMatch(/could not be loaded/);
    expect(notice).toMatch(/standard world/);
    expect(notice).not.toMatch(/404|shrub/);
  });
});

describe('what a rider is told inside the Android shell, where the set ships in the APK — #478', () => {
  const offline = { loaded: false, offline: true, detail: 'Failed to fetch' } as const;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never says it is not kept on the device, because in the shell it is', () => {
    const notice = realisticWorldNotice(offline, true);
    expect(notice).not.toMatch(/offline|not kept/);
    expect(notice).toMatch(/could not be loaded/);
    expect(notice).toMatch(/standard world/);
  });

  it('still says so in a browser, which is the case the sentence is for', () => {
    expect(realisticWorldNotice(offline, false)).toMatch(/not kept on this device/);
  });

  it('asks the shell question the way this client does — the Capacitor global', () => {
    // Inside the shell, with no second argument: the global decides.
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android' });
    expect(realisticWorldNotice(offline)).toMatch(/could not be loaded/);
    // Capacitor's WEB build defines the global too, and says it is not native.
    vi.stubGlobal('Capacitor', { isNativePlatform: () => false, getPlatform: () => 'web' });
    expect(realisticWorldNotice(offline)).toMatch(/not kept on this device/);
    vi.unstubAllGlobals();
    expect(realisticWorldNotice(offline)).toMatch(/not kept on this device/);
  });
});

describe('what a rider who chose the realistic world is told before a ride — #475', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('says in a browser that it is not kept for offline use, and what happens then', () => {
    const said = realisticWorldChosenText(false);
    expect(said).toMatch(/not kept on this device for use offline/);
    expect(said).toMatch(/standard world instead and the ride screen says so/);
  });

  it('says nothing about the network in the shell, where the set ships in the APK', () => {
    const said = realisticWorldChosenText(true);
    expect(said).not.toMatch(/offline|network|not kept/);
    expect(said).toMatch(/standard world instead and the ride screen says so/);
  });

  it('asks the shell question the way this client does — the Capacitor global', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'android' });
    expect(realisticWorldChosenText()).toBe(realisticWorldChosenText(true));
    vi.unstubAllGlobals();
    expect(realisticWorldChosenText()).toBe(realisticWorldChosenText(false));
  });
});
