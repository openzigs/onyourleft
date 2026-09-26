// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import {
  POSE_DIRECTORY,
  POSE_MODEL_FILE,
  POSE_RUNTIME_WASM_FILE,
} from '../../src/camera/pose-files';
import { REALISTIC_DIRECTORY, realisticFiles } from '../../src/game/realistic-assets';
import { SCENERY_ATLAS, SCENERY_MODELS } from '../../src/game/scenery-models';
import { cacheVersion, precacheEntries, PRECACHE_EXCLUSIONS, type PrecacheFile } from './precache';

/** A stand-in hash: distinguishing, cheap, and obviously not cryptographic. */
function fakeDigest(input: string): string {
  let hash = 0;
  for (const character of input) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return hash.toString(16);
}

function file(name: string, digest = 'aa'): PrecacheFile {
  return { name, digest };
}

const BUILD: readonly PrecacheFile[] = [
  file('index.html'),
  file('assets/index-abc.js'),
  file('assets/index-def.css'),
  file('assets/three-renderer-ghi.js'),
  file('assets/maplibre-jkl.js'),
  file('assets/tree_oak-mno.glb'),
  file('manifest.webmanifest'),
  file('icon-192.png'),
];

describe('what the worker precaches', () => {
  it('takes the shell, the lazy chunks and the ?url assets, because it takes everything', () => {
    expect(precacheEntries(BUILD)).toEqual([
      'assets/index-abc.js',
      'assets/index-def.css',
      'assets/maplibre-jkl.js',
      'assets/three-renderer-ghi.js',
      'assets/tree_oak-mno.glb',
      'icon-192.png',
      'index.html',
      'manifest.webmanifest',
    ]);
  });

  it('caches an asset nobody has heard of, with no list to edit — #406, ADR 0024 D-2', () => {
    // ⚠️ **This is the criterion that fails if the list is hand-written.** A
    // twelfth scenery model, a new `lazy()` route, a second stylesheet: the
    // build emits it and the precache has it, because the precache IS the
    // build's output. Nothing in `precache.ts`, `sw.ts` or `worker-core.ts`
    // names an asset.
    const withNewModel = [...BUILD, file('assets/lighthouse-xyz.glb')];
    expect(precacheEntries(withNewModel)).toContain('assets/lighthouse-xyz.glb');
    expect(precacheEntries(withNewModel)).toHaveLength(precacheEntries(BUILD).length + 1);
  });

  it('leaves out the worker itself, which could only ever cache a stale worker', () => {
    expect(precacheEntries([...BUILD, file('sw.js')])).not.toContain('sw.js');
  });

  it('leaves out source maps, which no rider requests', () => {
    expect(precacheEntries([...BUILD, file('assets/index-abc.js.map')])).not.toContain(
      'assets/index-abc.js.map',
    );
  });

  it('states its exclusions as patterns rather than as names', () => {
    // The direction matters: a pattern nobody updates leaves a NEW file in the
    // precache, which is safe. A list of names nobody updates leaves a new file
    // out, which is #142.
    for (const pattern of PRECACHE_EXCLUSIONS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });

  it('is sorted, so a directory walk’s order cannot move the version', () => {
    const shuffled = [...BUILD].reverse();
    expect(precacheEntries(shuffled)).toEqual(precacheEntries(BUILD));
  });

  it('deduplicates, because `public/` and the bundle can name the same file', () => {
    expect(precacheEntries([...BUILD, file('index.html')])).toEqual(precacheEntries(BUILD));
  });
});

describe('the realistic world is not precached, and the stylised one all is — ADR 0026 D-7', () => {
  /**
   * The build as it really is: the stylised world's `?url` assets under
   * `assets/` with a content hash, and every realistic file copied verbatim
   * out of `public/realistic/`.
   */
  const stylised = [
    ...Object.values(SCENERY_MODELS).flatMap((models) => models.map((model) => model.name)),
    SCENERY_ATLAS.name,
  ].map((name) => file(`assets/${name}-h4sh.${name === SCENERY_ATLAS.name ? 'png' : 'glb'}`));
  const realistic = realisticFiles().map((name) => file(`${REALISTIC_DIRECTORY}${name}`));
  const build = [...BUILD, ...stylised, ...realistic];

  it('holds every stylised model and the atlas — the world a rider has offline', () => {
    expect(stylised.length).toBe(12);
    for (const each of stylised) {
      expect(precacheEntries(build), each.name).toContain(each.name);
    }
  });

  it('holds no realistic file, whatever it is called', () => {
    expect(realistic.length).toBeGreaterThan(10);
    for (const each of realistic) {
      expect(precacheEntries(build), each.name).not.toContain(each.name);
    }
  });

  it('excludes a realistic file added later, with no edit to the rule', () => {
    // ⚠️ The criterion that fails if the exclusion is a list of names: D-7's
    // *"never by a list of file names, which would fail open against adding
    // an asset"*.
    const added = file(`${REALISTIC_DIRECTORY}a_new_scan.glb`);
    expect(precacheEntries([...build, added])).not.toContain(added.name);
  });

  it('excludes by the directory, and nothing that merely mentions the word', () => {
    // A stylised chunk that happens to be called `realistic-…` is the product.
    const chunk = file('assets/realistic-assets-abc.js');
    expect(precacheEntries([...build, chunk])).toContain(chunk.name);
  });

  it('does not move the cache version when only the realistic set changes', () => {
    // A first visit's download and a rider's cache eviction are the stylised
    // world's business; a re-processed tree is not a reason to evict it.
    const changed = realistic.map((each) => file(each.name, 'zz'));
    expect(cacheVersion([...BUILD, ...stylised, ...changed], fakeDigest)).toBe(
      cacheVersion(build, fakeDigest),
    );
  });
});

describe('the side camera’s pose model is not precached — #530', () => {
  /** What a build emits for it: the weights out of `public/pose/`, the runtime by the plugin. */
  const pose = [POSE_MODEL_FILE, POSE_RUNTIME_WASM_FILE].map((name) =>
    file(`${POSE_DIRECTORY}${name}`),
  );

  it('holds neither the weights nor the runtime, so no rider downloads them unasked', () => {
    for (const each of pose) {
      expect(precacheEntries([...BUILD, ...pose]), each.name).not.toContain(each.name);
    }
  });

  it('excludes a file added there later, and nothing that merely mentions the word', () => {
    const added = file(`${POSE_DIRECTORY}pose_landmarker_full.task`);
    const chunk = file('assets/pose-estimator-abc.js');
    const entries = precacheEntries([...BUILD, ...pose, added, chunk]);
    expect(entries).not.toContain(added.name);
    expect(entries).toContain(chunk.name);
  });

  it('does not move the cache version when only the pose files change', () => {
    const changed = pose.map((each) => file(each.name, 'zz'));
    expect(cacheVersion([...BUILD, ...changed], fakeDigest)).toBe(
      cacheVersion([...BUILD, ...pose], fakeDigest),
    );
  });
});

describe('the cache version', () => {
  it('is stable for the same build', () => {
    expect(cacheVersion(BUILD, fakeDigest)).toBe(cacheVersion([...BUILD].reverse(), fakeDigest));
  });

  it('moves when a file’s CONTENTS change under an unchanged name', () => {
    // ⚠️ The case a name-only digest gets wrong, and it is not exotic:
    // `index.html`, `manifest.webmanifest` and the three icons all keep their
    // names for ever, because only chunks and emitted assets carry a content
    // hash. A version derived from names would leave a rider holding
    // yesterday's document with nothing able to notice.
    const edited = BUILD.map((entry) =>
      entry.name === 'index.html' ? file('index.html', 'bb') : entry,
    );
    expect(cacheVersion(edited, fakeDigest)).not.toBe(cacheVersion(BUILD, fakeDigest));
  });

  it('moves when a file is added, and when one is removed', () => {
    expect(cacheVersion([...BUILD, file('assets/new-pqr.js')], fakeDigest)).not.toBe(
      cacheVersion(BUILD, fakeDigest),
    );
    expect(cacheVersion(BUILD.slice(1), fakeDigest)).not.toBe(cacheVersion(BUILD, fakeDigest));
  });

  it('does not move when only an excluded file changes', () => {
    expect(cacheVersion([...BUILD, file('sw.js', 'zz')], fakeDigest)).toBe(
      cacheVersion([...BUILD, file('sw.js', 'yy')], fakeDigest),
    );
  });

  it('cannot be confused by a name and a digest that run together', () => {
    // `a` + `bc` and `ab` + `c` are different builds and must hash differently.
    // A join on a printable character would make them the same string.
    expect(cacheVersion([file('a', 'bc')], fakeDigest)).not.toBe(
      cacheVersion([file('ab', 'c')], fakeDigest),
    );
  });
});
