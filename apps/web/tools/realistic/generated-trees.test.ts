// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The generated trees' numbers, made again wherever these tests run — #1283,
 * ADR 0049 D-1.
 *
 * ## The question ADR 0049 left open, and what was measured
 *
 * *"Whether EZ-Tree's output is byte-stable across machines and Node versions.
 * D-1 makes that a condition of committing a tree, to be measured by the
 * adopting issue."* Measured on 2026-10-12, EZ-Tree 1.1.0 on three 0.185.1,
 * every tree at both levels, by `geometryDigest` — the float32 bytes Blender
 * is handed. Twelve digests, because three seeds a species were measured; the
 * eight of the two seeds kept (`generated-trees.ts` §`GENERATED_TREES`) are
 * among them and did not move:
 *
 * | Machine | Node | Result |
 * |---|---|---|
 * | macOS, Darwin 25.6.0, arm64 (where the committed files were made) | 24.20.0 | the committed digests, all twelve |
 * | the same | 22.22.3 | the same twelve |
 * | the same | 20.14.0 | the same twelve |
 * | CI, `ubuntu-latest`, x64 (run 38256459138, #1283's own) | 24.21.0 | the same twelve — and this file, on every pull request since: a different digest is a red build |
 *
 * ⚠️ **Stable as float32, and not shown to be as float64**: on the
 * generator's own default tree, the doubles it computes hashed differently
 * under Node 20.14.0 than under 22.22.3 and 24.20.0 — why was not looked
 * for; the generator leans on `Math.sin` and `Math.cos`, which a JavaScript
 * engine is free to round either way — while the same numbers rounded to
 * float32 hashed alike under all three. A vertex is stored as
 * float32, so that is what is recorded and compared; a later Node or `three`
 * could still move one past a rounding boundary, and then this file is red
 * and the tree is refused before it is made (`ez-tree.ts`
 * §`stageGeneratedLevel`) — which is ADR 0049 D-1's "if it is not, the trees
 * are not committed", enforced rather than promised. The pipeline's Node is
 * the repository's (`.nvmrc`).
 *
 * ## The evergreen, measured again — #1294
 *
 * The fir is the generator's other branch: `type: 'evergreen'` tapers, forks
 * and shortens a bough by different arithmetic from a deciduous tree's, so
 * the broadleaves' table says nothing of it. Measured on 2026-10-12, the two
 * firs at both levels, four digests, by the same `geometryDigest`:
 *
 * | Machine | Node | Result |
 * |---|---|---|
 * | macOS, Darwin 25.6.0, arm64 (where the committed files were made) | 24.20.0 | the committed digests, all four |
 * | the same | 22.22.3 | the same four |
 * | the same | 20.14.0 | the same four |
 * | CI, `ubuntu-latest`, x64 | the workflow's | this file, on #1294's own pull request and every one since: a different digest is a red build. The run is named in that pull request |
 *
 * As float32, like the broadleaves'; whether the doubles agree was not looked
 * at again.
 *
 * Blender does not run in CI, so the half that dresses a tree and renders its
 * impostor is `realistic:process --check`, run by hand, as for every other
 * derived file. What these tests hold beyond the digests is that the committed
 * GLBs are OF this geometry: their triangles, read back off disk, are the
 * generated ones, none decimated and none thinned.
 */

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REALISTIC_BROADLEAVES, REALISTIC_CONIFERS } from '../../src/game/realistic-assets';
import { readGlb } from '../../src/game/model-bytes-testing';
import { modelFacts } from '../../src/game/realistic-bytes-testing';
import { REALISTIC_TRIANGLES } from '../../src/game/realistic-budget';

import {
  ezTreeFault,
  imagesAsked,
  installedEzTreeVersion,
  loadEzTree,
  stageGeneratedLevel,
  type EzTreeModule,
} from './ez-tree';
import {
  cellCount,
  fullPlan,
  GENERATED_MATERIALS,
  GENERATED_SPECIES,
  GENERATED_TREES,
  geometryDigest,
  levelGltf,
  levelPlan,
  runNumbers,
  runNumbersDigest,
  runPlan,
  speciesOf,
  sprigLeaves,
  treeLevel,
  treeSize,
  trianglesOf,
  type GeneratedTree,
  type MeshPart,
  type RunPaths,
  type TreeGeometry,
} from './generated-trees';
import {
  EZ_TREE_PACKAGE,
  EZ_TREE_THREE,
  EZ_TREE_VERSION,
  OUTPUT_DIRECTORY,
  PINNED_EZ_TREE,
} from './sources';

const WEB = fileURLToPath(new URL('../../', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));
const shipped = (file: string): string => join(REPOSITORY, OUTPUT_DIRECTORY, file);

let generator: EzTreeModule;
const made = new Map<string, TreeGeometry>();

/** One level of one tree, generated once for the whole file. */
function level(tree: GeneratedTree, which: 'full' | 'middle'): TreeGeometry {
  const key = `${tree.name}.${which}`;
  const cached = made.get(key);
  if (cached !== undefined) return cached;
  const species = speciesOf(tree);
  const geometry = treeLevel(new generator.Tree(), species, tree.seed, levelPlan(species, which));
  made.set(key, geometry);
  return geometry;
}

const PATHS: RunPaths = {
  barkColour: 'bark-colour.jpg',
  barkNormal: 'bark-normal.jpg',
  leafColour: 'leaf-colour.jpg',
  leafOpacity: 'leaf-opacity.jpg',
  leafNormal: 'leaf-normal.jpg',
};

/** A card's root: the middle of its first quad's lower edge, corners 1 and 2. */
function cardRoot(leaves: MeshPart, card: number, perCard: number): readonly number[] {
  const first = card * perCard;
  return [0, 1, 2].map(
    (axis) =>
      ((leaves.positions[(first + 1) * 3 + axis] ?? NaN) +
        (leaves.positions[(first + 2) * 3 + axis] ?? NaN)) /
      2,
  );
}

/** A card's length: from its root to the middle of its first quad's upper edge. */
function cardLength(leaves: MeshPart, card: number, perCard: number): number {
  const first = card * perCard;
  const root = cardRoot(leaves, card, perCard);
  const tip = [0, 1, 2].map(
    (axis) =>
      ((leaves.positions[first * 3 + axis] ?? NaN) +
        (leaves.positions[(first + 3) * 3 + axis] ?? NaN)) /
      2,
  );
  return Math.hypot(...tip.map((value, axis) => value - (root[axis] ?? NaN)));
}

/** Whether a generated tree stands where the world draws a conifer — #1294. */
const isConifer = (tree: GeneratedTree): boolean =>
  REALISTIC_CONIFERS.generated.some((model) => model.name === tree.name);

beforeAll(async () => {
  generator = await loadEzTree();
});

describe('the generator is a pinned tool — ADR 0049 D-1, ADR 0026 D-5', () => {
  const manifest = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
    readonly dependencies: Readonly<Record<string, string>>;
    readonly devDependencies: Readonly<Record<string, string>>;
  };

  it('is one exact release, in the manifest and installed, and never a dependency of the product', () => {
    expect(EZ_TREE_VERSION).toBe('1.1.0');
    expect(PINNED_EZ_TREE).toBe('EZ-Tree 1.1.0');
    // Exact: a range would let an install make a tree nobody recorded.
    expect(manifest.devDependencies[EZ_TREE_PACKAGE]).toBe(EZ_TREE_VERSION);
    expect(manifest.dependencies[EZ_TREE_PACKAGE]).toBeUndefined();
    expect(installedEzTreeVersion()).toBe(EZ_TREE_VERSION);
    // three computes every limb, so it is part of the pin.
    expect(manifest.dependencies['three']).toBe(EZ_TREE_THREE);
  });

  it('refuses any other release, by name, before it loads one', async () => {
    expect(ezTreeFault(EZ_TREE_VERSION)).toBeUndefined();
    expect(ezTreeFault('1.0.1')).toMatch(/is 1\.0\.1; the pipeline is pinned to EZ-Tree 1\.1\.0/);
    expect(ezTreeFault('')).toMatch(/is not installed/);
    // The call site, not only the sentence: a load told of another release rejects.
    await expect(loadEzTree('1.0.1')).rejects.toThrow(/pinned to EZ-Tree 1\.1\.0/);
    await expect(loadEzTree('1.1.1')).rejects.toThrow(/is 1\.1\.1/);
  });

  /**
   * Where the generator's package is named — #1289's review. Under `tools/`
   * it is loaded by one module, so every form of loading it is looked for;
   * under `src/` and `browser/`, which are what the product and its harness
   * build, nothing has a reason to NAME it at all, so the bare name in any
   * file is a finding. The first guard read `from '…'` and `import('…')` only,
   * and a side-effect `import '…'` or a double-quoted `import("…")` under
   * `src/` went past it.
   */
  const loadsGenerator = (source: string): boolean =>
    new RegExp(
      `(?:\\bimport|\\bfrom|\\brequire)\\s*\\(?\\s*['"\`]${EZ_TREE_PACKAGE.replace('/', '\\/')}['"\`]`,
    ).test(source);
  const namesGenerator = (source: string): boolean => source.includes(EZ_TREE_PACKAGE);
  const filesWhere = (roots: readonly string[], found: (source: string) => boolean): string[] => {
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
          continue;
        }
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        // Every file, whatever its extension: a package can be named in an
        // HTML page's script, a worker or a JSON import map as well.
        else if (found(readFileSync(path, 'latin1'))) files.push(path.slice(WEB.length));
      }
    };
    for (const root of roots) walk(join(WEB, root));
    return files;
  };

  it('is imported by one pipeline module, and named by nothing the product or its harness builds', () => {
    expect(filesWhere(['tools'], loadsGenerator)).toEqual(['tools/realistic/ez-tree.ts']);
    expect(filesWhere(['src', 'browser'], namesGenerator)).toEqual([]);
    // Non-vacuity: the walk reads these trees, and it reads more than scripts.
    expect(filesWhere(['src'], (source) => source.includes('three')).length).toBeGreaterThan(10);
    expect(
      filesWhere(['browser'], (source) => source.includes('<!doctype html>')).length,
    ).toBeGreaterThan(0);
  });

  it('sees every form of import, the two the first guard missed among them', () => {
    // Written from the constant, so this file names no import of its own.
    const name = EZ_TREE_PACKAGE;
    const forms = [
      `import { Tree } from '${name}';`,
      `import { Tree } from "${name}";`,
      `export * from '${name}';`,
      `const loaded = await import('${name}');`,
      // #1289's review: a side-effect import has no `from`…
      `import '${name}';`,
      `import "${name}";`,
      // …and the dynamic form was matched in single quotes only.
      `const loaded = await import("${name}");`,
      `const loaded = await import(\`${name}\`);`,
      `const loaded = await import(\n  '${name}'\n);`,
      `const { Tree } = require('${name}');`,
    ];
    for (const form of forms) {
      expect(loadsGenerator(form), form).toBe(true);
      expect(namesGenerator(form), form).toBe(true);
    }
    // A sentence about the generator loads nothing; under `src/` its package's
    // name is still refused, and its repository's address is not that name.
    expect(loadsGenerator(`// ${name} is pinned in sources.ts`)).toBe(false);
    expect(namesGenerator(`// ${name} is pinned in sources.ts`)).toBe(true);
    expect(namesGenerator('https://github.com/dgreenheck/ez-tree')).toBe(false);
    expect(loadsGenerator("import { Tree } from '@dgreenheck/ez-tree-fork';")).toBe(false);
  });

  it('takes none of the generator’s own images: each one it asks for at load is answered with nothing', () => {
    // It asked — so the stand-in was what answered, and a release that stops
    // asking does not leave a note behind that describes nothing.
    expect(imagesAsked()).toBeGreaterThan(0);
    // And the stand-in is gone once the module is loaded.
    expect('document' in globalThis).toBe(false);
    // No generated level names an image, a texture or a sampler.
    for (const tree of GENERATED_TREES) {
      const document = JSON.parse(
        levelGltf(level(tree, 'full'), tree.name, 'x.bin').json,
      ) as Record<string, unknown>;
      expect(Object.keys(document)).not.toContain('images');
      expect(Object.keys(document)).not.toContain('textures');
      expect(document['materials']).toEqual([
        { name: GENERATED_MATERIALS.bark },
        { name: GENERATED_MATERIALS.leaves },
      ]);
    }
  });
});

describe('every tree is reproducible from its committed numbers — ADR 0049 D-1', () => {
  it('generates every level of every tree to the digest recorded, on this machine too', () => {
    expect(GENERATED_TREES.length).toBeGreaterThan(0);
    for (const tree of GENERATED_TREES) {
      for (const which of ['full', 'middle'] as const) {
        expect(geometryDigest(level(tree, which)), `${tree.name} ${which}`).toBe(
          tree.geometry[which],
        );
        expect(tree.geometry[which]).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('makes the same tree twice, and a different one from a different seed', () => {
    const [tree] = GENERATED_TREES;
    if (tree === undefined) throw new Error('no generated tree');
    const species = speciesOf(tree);
    const again = treeLevel(new generator.Tree(), species, tree.seed, fullPlan(species));
    expect(geometryDigest(again)).toBe(tree.geometry.full);
    const other = treeLevel(new generator.Tree(), species, tree.seed + 1, fullPlan(species));
    expect(geometryDigest(other)).not.toBe(tree.geometry.full);
  });

  it('moves the digest when one number of the geometry moves, in either part', () => {
    const [tree] = GENERATED_TREES;
    if (tree === undefined) throw new Error('no generated tree');
    const full = level(tree, 'full');
    // Against the digest of THIS geometry as it is computed today, not the
    // recorded one: a digest that left an array out would differ from the
    // record and pass every comparison with it.
    const whole = geometryDigest(full);
    const nudged = (part: MeshPart, array: 'positions' | 'normals' | 'uvs'): MeshPart => {
      const copy = Float32Array.from(part[array]);
      copy[copy.length - 1] = (copy[copy.length - 1] ?? 0) + 1;
      return { ...part, [array]: copy };
    };
    for (const array of ['positions', 'normals', 'uvs'] as const) {
      expect(geometryDigest({ ...full, bark: nudged(full.bark, array) }), array).not.toBe(whole);
      expect(geometryDigest({ ...full, leaves: nudged(full.leaves, array) }), array).not.toBe(
        whole,
      );
    }
    for (const part of ['bark', 'leaves'] as const) {
      const turned = Uint32Array.from(full[part].indices);
      turned.reverse();
      expect(
        geometryDigest({ ...full, [part]: { ...full[part], indices: turned } }),
        part,
      ).not.toBe(whole);
    }
    // And the two parts are not interchangeable: the same numbers the other way round.
    expect(geometryDigest({ bark: full.leaves, leaves: full.bark })).not.toBe(whole);
  });
});

describe('two species, each several seeded shapes — #1283, #621', () => {
  it('names at least two species, and two trees of each, every one a seed of its own', () => {
    expect(GENERATED_SPECIES.length).toBeGreaterThanOrEqual(2);
    for (const species of GENERATED_SPECIES) {
      const trees = GENERATED_TREES.filter((tree) => tree.species === species.id);
      // Two, exactly: a third seed is three more draw calls a wood (#1289's review).
      expect(trees.length, species.id).toBe(2);
      expect(new Set(trees.map((tree) => tree.seed)).size, species.id).toBe(trees.length);
    }
    expect(new Set(GENERATED_TREES.map((tree) => tree.name)).size).toBe(GENERATED_TREES.length);
    for (const tree of GENERATED_TREES) expect(() => speciesOf(tree)).not.toThrow();
    expect(() => speciesOf({ ...GENERATED_TREES[0], species: 'elm' } as GeneratedTree)).toThrow(
      /no species elm/,
    );
  });

  it('gives two trees of a species different shapes, not one shape twice', () => {
    for (const species of GENERATED_SPECIES) {
      const trees = GENERATED_TREES.filter((tree) => tree.species === species.id);
      const digests = trees.map((tree) => tree.geometry.full);
      expect(new Set(digests).size, species.id).toBe(trees.length);
      // In SHAPE: the crown's reach differs by more than a rounding error.
      const widths = trees.map((tree) => treeSize(level(tree, 'full')).widthMetres);
      const sorted = [...widths].sort((a, b) => a - b);
      for (let at = 1; at < sorted.length; at += 1) {
        expect((sorted[at] ?? 0) - (sorted[at - 1] ?? 0), species.id).toBeGreaterThan(0.01);
      }
    }
  });

  it('makes the two species different shapes: one spreading, one tall and narrow', () => {
    const shape = (id: string): number => {
      const sizes = GENERATED_TREES.filter((tree) => tree.species === id).map((tree) =>
        treeSize(level(tree, 'full')),
      );
      return Math.min(...sizes.map((size) => size.widthMetres / size.heightMetres));
    };
    const narrowest = Math.max(
      ...GENERATED_TREES.filter((tree) => tree.species === 'hornbeam').map((tree) => {
        const size = treeSize(level(tree, 'full'));
        return size.widthMetres / size.heightMetres;
      }),
    );
    // Every oak is wider for its height than any hornbeam.
    expect(shape('oak')).toBeGreaterThan(narrowest);
    expect(shape('oak')).toBeGreaterThan(1);
    expect(narrowest).toBeLessThan(0.8);
  });

  it('draws every generated tree a ride loads, and loads nothing generated that is not here', () => {
    // #1294: as a broadleaf or as a conifer, and none as both.
    const drawn = [...REALISTIC_BROADLEAVES.generated, ...REALISTIC_CONIFERS.generated];
    expect(drawn.map((model) => model.name).sort()).toEqual(
      GENERATED_TREES.map((tree) => tree.name).sort(),
    );
    expect(new Set(drawn.map((model) => model.name)).size).toBe(drawn.length);
    // A fir stands where a conifer is placed, and nothing else does.
    expect(GENERATED_TREES.filter(isConifer).map((tree) => tree.species)).toEqual(['fir', 'fir']);
  });
});

describe('the fir is the generator’s evergreen — #1294', () => {
  const firs = (): GeneratedTree[] => GENERATED_TREES.filter((tree) => tree.species === 'fir');

  it('is one stem whose boughs carry the sprig cards themselves', () => {
    const species = GENERATED_SPECIES.find((each) => each.id === 'fir');
    if (species === undefined) throw new Error('there is a fir');
    expect(species.parameters.type).toBe('evergreen');
    expect(species.parameters.levels).toBe(1);
    // The broadleaves are not: the type is a species' own, never a default.
    for (const each of GENERATED_SPECIES.filter((other) => other.id !== 'fir')) {
      expect(each.parameters.type, each.id).toBe('deciduous');
    }
    for (const tree of firs()) {
      const { leaves } = level(tree, 'full');
      // One quad a card: a bough's cards, eleven to each of a hundred boughs.
      const cards = leaves.positions.length / 3 / 4;
      expect(cards, tree.name).toBe(
        (species.parameters.children[0] ?? 0) * species.parameters.leaves.count,
      );
      expect(leaves.indices.length / 3, tree.name).toBe(cards * 2);
    }
  });

  it('is a cone: much taller than wide, and its boughs shorten up the trunk', () => {
    expect(firs()).toHaveLength(2);
    for (const tree of firs()) {
      const full = level(tree, 'full');
      const size = treeSize(full);
      expect(size.heightMetres / size.widthMetres, tree.name).toBeGreaterThan(1.5);
      // The wood's furthest reach from the trunk, in each third of its height.
      const reach = [0, 0, 0];
      for (let at = 0; at < full.bark.positions.length; at += 3) {
        const third = Math.min(
          2,
          Math.floor(((full.bark.positions[at + 1] ?? 0) / size.heightMetres) * 3),
        );
        reach[third] = Math.max(
          reach[third] ?? 0,
          Math.hypot(full.bark.positions[at] ?? 0, full.bark.positions[at + 2] ?? 0),
        );
      }
      const [low, mid, high] = reach as [number, number, number];
      expect(low, tree.name).toBeGreaterThan(mid);
      expect(mid, tree.name).toBeGreaterThan(high);
      // A deciduous tree of the same numbers would not taper: the lowest
      // boughs reach more than twice as far as the highest.
      expect(low, tree.name).toBeGreaterThan(high * 2);
    }
  });

  it('keeps only the stem’s wood at the middle level, and one sprig card in three', () => {
    for (const tree of firs()) {
      const species = speciesOf(tree);
      expect(species.middle.deepestWood).toBe(0);
      const full = level(tree, 'full');
      const middle = level(tree, 'middle');
      // The stem alone: every sixth-sided ring of it, and no bough.
      const [sides] = species.middle.segments;
      const [sections] = species.parameters.sections;
      expect(middle.bark.indices.length / 3, tree.name).toBe(sides * sections * 2);
      expect(middle.leaves.indices.length, tree.name).toBe(
        Math.ceil(full.leaves.indices.length / 6 / species.middle.leafEvery) * 6,
      );
    }
  });
});

describe('each level is made to its budget, not cut down to it — #1283, #617', () => {
  it('commits the generated triangles exactly: none decimated, none thinned', () => {
    for (const tree of GENERATED_TREES) {
      const full = modelFacts(shipped(`${tree.name}.glb`));
      const middle = modelFacts(shipped(`${tree.name}-middle.glb`));
      expect(full.triangles, tree.name).toBe(trianglesOf(level(tree, 'full')));
      expect(middle.triangles, tree.name).toBe(trianglesOf(level(tree, 'middle')));
      // Under its class's ceiling with room, which is the point of generating.
      expect(full.triangles, tree.name).toBeLessThanOrEqual(
        REALISTIC_TRIANGLES[isConifer(tree) ? 'tree-conifer' : 'tree-broadleaf'],
      );
      expect(middle.triangles, tree.name).toBeLessThanOrEqual(REALISTIC_TRIANGLES['tree-middle']);
      expect(middle.triangles, tree.name).toBeLessThan(full.triangles / 2);
    }
  });

  it('records the FULL level’s size in every level of a tree, so they stand at one size', () => {
    for (const tree of GENERATED_TREES) {
      const size = treeSize(level(tree, 'full'));
      for (const file of [`${tree.name}.glb`, `${tree.name}-middle.glb`]) {
        const { extras } = modelFacts(shipped(file));
        expect(extras['oyl_scan_height'], file).toBe(size.heightMetres);
        expect(extras['oyl_scan_width'], file).toBe(size.widthMetres);
      }
      // A small tree, in metres — about the 4.4 m the world draws a broadleaf
      // at, or the 7 m it draws a conifer at (`three-renderer.ts`
      // §`sceneryFitMetres`), so the occlusion bake's reach is the reach it
      // has on the tree as drawn. The generator's own units would make it
      // sixty-odd metres.
      const extent = Math.max(size.heightMetres, size.widthMetres);
      const [least, most] = isConifer(tree) ? [6.3, 7.1] : [3.3, 5.5];
      expect(extent, tree.name).toBeGreaterThan(least);
      expect(extent, tree.name).toBeLessThan(most);
    }
  });

  it('keeps the middle level’s leaf cards where the full level’s are, one in every few, enlarged', () => {
    for (const tree of GENERATED_TREES) {
      const species = speciesOf(tree);
      const perCard = species.parameters.leaves.billboard === 'double' ? 8 : 4;
      const full = level(tree, 'full').leaves;
      const middle = level(tree, 'middle').leaves;
      const fullCards = full.positions.length / 3 / perCard;
      const middleCards = middle.positions.length / 3 / perCard;
      expect(middleCards, tree.name).toBe(Math.ceil(fullCards / species.middle.leafEvery));
      expect(middleCards, tree.name).toBeGreaterThan(10);
      for (let card = 0; card < middleCards; card += 1) {
        const from = card * species.middle.leafEvery;
        // The same seed made the same twigs: a kept card grows from the very
        // point the full level's does — to the float32 its corners are kept
        // at, which is a hundredth of a millimetre on a 15 m tree.
        const root = cardRoot(middle, card, perCard);
        cardRoot(full, from, perCard).forEach((value, axis) => {
          expect(root[axis], `${tree.name} card ${String(card)}`).toBeCloseTo(value, 4);
        });
        expect(cardLength(middle, card, perCard) / cardLength(full, from, perCard)).toBeCloseTo(
          species.middle.leafGrowth,
          3,
        );
      }
    }
  });

  it('leaves out the wood deeper than a plan keeps, and nothing else of it', () => {
    const [tree] = GENERATED_TREES;
    if (tree === undefined) throw new Error('no generated tree');
    const species = speciesOf(tree);
    const whole = level(tree, 'full');
    const limbs = treeLevel(new generator.Tree(), species, tree.seed, {
      ...fullPlan(species),
      deepestWood: species.parameters.levels - 1,
    });
    const trunk = treeLevel(new generator.Tree(), species, tree.seed, {
      ...fullPlan(species),
      deepestWood: 0,
    });
    // Fewer triangles each time, and the leaves untouched.
    expect(limbs.bark.indices.length).toBeLessThan(whole.bark.indices.length);
    expect(trunk.bark.indices.length).toBeLessThan(limbs.bark.indices.length);
    expect(trunk.bark.indices.length).toBeGreaterThan(0);
    expect(limbs.leaves.positions).toEqual(whole.leaves.positions);
    // What is kept is the full level's own wood, vertex for vertex, in order.
    expect(limbs.bark.positions).toEqual(
      whole.bark.positions.subarray(0, limbs.bark.positions.length),
    );
    expect(trunk.bark.positions).toEqual(
      whole.bark.positions.subarray(0, trunk.bark.positions.length),
    );
    // And no index reaches past the vertices kept.
    expect(Math.max(...limbs.bark.indices)).toBe(limbs.bark.positions.length / 3 - 1);
  });

  it('gives a leaf card its own face’s normal, and coordinates turned for glTF', () => {
    const [tree] = GENERATED_TREES;
    if (tree === undefined) throw new Error('no generated tree');
    const { leaves } = level(tree, 'full');
    const at = (vertex: number): readonly number[] =>
      [0, 1, 2].map((axis) => leaves.positions[vertex * 3 + axis] ?? NaN);
    for (const quad of [0, 1, 7, 100]) {
      const [a, b, c, d] = [0, 1, 2, 3].map((corner) => at(quad * 4 + corner));
      if (a === undefined || b === undefined || c === undefined || d === undefined) {
        throw new Error('a quad with fewer than four corners');
      }
      const normal = [0, 1, 2].map((axis) => leaves.normals[quad * 4 * 3 + axis] ?? NaN);
      expect(Math.hypot(...normal)).toBeCloseTo(1, 5);
      // Perpendicular to both of the quad's edges.
      for (const corner of [b, c, d]) {
        const edge = corner.map((value, axis) => value - (a[axis] ?? NaN));
        const dot = edge.reduce((sum, value, axis) => sum + value * (normal[axis] ?? NaN), 0);
        expect(Math.abs(dot)).toBeLessThan(1e-3);
      }
      // Corner 1 is the card's root: the FOOT of the picture, v = 1 in glTF.
      expect(leaves.uvs[(quad * 4 + 1) * 2 + 1]).toBe(1);
      expect(leaves.uvs[quad * 4 * 2 + 1]).toBe(0);
    }
  });

  it('repeats the bark a whole number of times round a branch, so it closes on itself', () => {
    for (const species of GENERATED_SPECIES) {
      expect(Number.isInteger(species.bark.repeat[0]), species.id).toBe(true);
      const tree = GENERATED_TREES.find((each) => each.species === species.id);
      if (tree === undefined) throw new Error(`no ${species.id}`);
      const { bark } = level(tree, 'full');
      let most = 0;
      for (let at = 0; at < bark.uvs.length; at += 2) most = Math.max(most, bark.uvs[at] ?? 0);
      // The seam's duplicated vertex is at the repeat itself.
      expect(most, species.id).toBe(species.bark.repeat[0]);
    }
  });
});

describe('what Blender baked into a committed tree, read back off its bytes', () => {
  /** One part of a committed GLB: its vertex count, and the red of its baked colour a vertex. */
  function partsOf(file: string): Map<string, { vertices: number; occlusion: number[] }> {
    const glb = readGlb(shipped(file));
    const json = glb.json as unknown as {
      meshes: { primitives: { attributes: Record<string, number>; material: number }[] }[];
      materials: { name: string; alphaMode?: string; doubleSided?: boolean }[];
      accessors: {
        count: number;
        bufferView: number;
        componentType: number;
        type: string;
        normalized?: boolean;
      }[];
      bufferViews: { byteOffset?: number; byteLength: number }[];
    };
    const parts = new Map<string, { vertices: number; occlusion: number[] }>();
    for (const primitive of json.meshes[0]?.primitives ?? []) {
      const name = json.materials[primitive.material]?.name ?? '';
      const colour = json.accessors[primitive.attributes['COLOR_0'] ?? -1];
      const position = json.accessors[primitive.attributes['POSITION'] ?? -1];
      if (colour === undefined || position === undefined) {
        throw new Error(`${file}: its ${name} carries no baked colour`);
      }
      expect(colour.count, `${file} ${name}`).toBe(position.count);
      const view = json.bufferViews[colour.bufferView];
      const start = glb.binary.byteOffset + (view?.byteOffset ?? 0);
      const bytes = glb.binary.buffer.slice(start, start + (view?.byteLength ?? 0));
      // Normalized UNSIGNED_SHORT RGBA, 8 bytes a vertex — what Blender 4.4.3
      // writes for the ACTIVE colour when no node reads it, as the rock's is
      // (#686's review). Wired into the material it is FLOAT RGB, 12 bytes.
      expect(colour.componentType, `${file} ${name}`).toBe(5123);
      expect(colour.type, `${file} ${name}`).toBe('VEC4');
      expect(colour.normalized, `${file} ${name}`).toBe(true);
      const values = new Uint16Array(bytes);
      const occlusion: number[] = [];
      for (let at = 0; at < values.length; at += 4) {
        occlusion.push((values[at] ?? Number.NaN) / 65_535);
        // An alpha of 1 everywhere: the colour makes nothing see-through.
        expect(values[at + 3], `${file} ${name}`).toBe(65_535);
      }
      parts.set(name, { vertices: position.count, occlusion });
    }
    return parts;
  }
  const mean = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length;

  it('bakes occlusion onto every vertex without splitting one the generator shared', () => {
    for (const tree of GENERATED_TREES) {
      for (const which of ['full', 'middle'] as const) {
        const file = which === 'full' ? `${tree.name}.glb` : `${tree.name}-middle.glb`;
        const parts = partsOf(file);
        expect([...parts.keys()].sort(), file).toEqual(['bark', 'leaves']);
        const generated = level(tree, which);
        // Per vertex, not per corner: a corner bake splits a vertex wherever
        // two faces round it differ, and would triple the wood's.
        expect(parts.get('bark')?.vertices, file).toBe(generated.bark.positions.length / 3);
        const leaves = parts.get('leaves')?.vertices ?? 0;
        expect(leaves, file).toBeGreaterThanOrEqual(generated.leaves.positions.length / 3);
        expect(leaves, file).toBeLessThan((generated.leaves.positions.length / 3) * 1.02);
      }
    }
  });

  it('shades the wood inside the crown, and never draws a leaf card black', () => {
    for (const tree of GENERATED_TREES) {
      for (const file of [`${tree.name}.glb`, `${tree.name}-middle.glb`]) {
        const parts = partsOf(file);
        const bark = parts.get('bark')?.occlusion ?? [];
        const leaves = parts.get('leaves')?.occlusion ?? [];
        // The wood is shaded by the leaves about it: darkened, and not to nothing.
        expect(mean(bark), `${file} bark`).toBeLessThan(0.8);
        expect(mean(bark), `${file} bark`).toBeGreaterThan(0.08);
        // ⚠️ A bake samples a card AT its corners, where the sprig is cut away,
        // and with the cut-out in place every leaf vertex read 0 — a canopy
        // drawn black. The script bakes the cards whole and scales what they
        // hide by the sprig's cover, so no card is darker than that leaves it.
        expect(Math.min(...leaves), `${file} leaves`).toBeGreaterThan(0.5);
        expect(mean(leaves), `${file} leaves`).toBeGreaterThan(0.6);
        // And it IS shaded: an inner card is darker than an outer one.
        expect(mean(leaves), `${file} leaves`).toBeLessThan(0.9);
        expect(Math.max(...leaves) - Math.min(...leaves), `${file} leaves`).toBeGreaterThan(0.1);
      }
    }
  });

  it('cuts the leaf cards and not the wood, and draws both sides of each', () => {
    for (const tree of GENERATED_TREES) {
      const json = readGlb(shipped(`${tree.name}.glb`)).json as unknown as {
        materials: { name: string; alphaMode?: string; doubleSided?: boolean }[];
      };
      const byName = new Map(json.materials.map((material) => [material.name, material]));
      // Opaque is glTF's default and is not written; a leaf card is cut out.
      expect(byName.get('bark')?.alphaMode, tree.name).toBeUndefined();
      expect(byName.get('leaves')?.alphaMode, tree.name).toBeDefined();
      expect(byName.get('leaves')?.doubleSided, tree.name).toBe(true);
      // Four maps: a colour and a normal map for each, the leaves' colour with its cut-out.
      const facts = modelFacts(shipped(`${tree.name}.glb`));
      expect(facts.ktx2, tree.name).toHaveLength(4);
      expect(
        facts.ktx2.filter((map) => map.alpha),
        tree.name,
      ).toHaveLength(1);
      expect(
        facts.ktx2.filter((map) => map.scheme === 'uastc'),
        tree.name,
      ).toHaveLength(2);
      const species = speciesOf(tree);
      const sides = facts.ktx2.map((map) => Math.max(map.width, map.height)).sort((a, b) => a - b);
      expect(sides, tree.name).toEqual(
        [
          species.sprig.normalPixels,
          species.sprig.pixels,
          species.bark.pixels,
          species.bark.pixels,
        ].sort((a, b) => a - b),
      );
    }
  });
});

describe('a tree’s size is about its trunk — #620', () => {
  const part = (positions: readonly number[]): MeshPart => ({
    positions: Float32Array.from(positions),
    normals: new Float32Array(positions.length),
    uvs: new Float32Array((positions.length / 3) * 2),
    indices: new Uint32Array(0),
  });

  it('is as tall as its highest point and twice as wide as its furthest reach from the axis', () => {
    // A crown leaning one way: 5 m out on +x, 1 m on -x, 3 m on -z.
    const size = treeSize({
      bark: part([0, 0, 0, 0.2, 9, 0]),
      leaves: part([5, 7, 0, -1, 6, 0, 0, 12, -3]),
    });
    expect(size.heightMetres).toBe(12);
    // Not the bounding box's 6 m: the impostor's frame is centred on the trunk.
    expect(size.widthMetres).toBe(10);
  });

  it('measures the reach as a radius, so a limb on the diagonal is inside the impostor’s frame', () => {
    // 3 m out on x AND 4 m on z is 5 m from the trunk, which neither axis alone says.
    expect(treeSize({ bark: part([0, 1, 0]), leaves: part([3, 2, 4]) }).widthMetres).toBe(10);
    expect(treeSize({ bark: part([0, 1, 0]), leaves: part([-3, 2, -4]) }).widthMetres).toBe(10);
  });

  it('reads the leaves as well as the wood, and the wood as well as the leaves', () => {
    expect(treeSize({ bark: part([0, 4, 0]), leaves: part([0, 1, 2]) })).toEqual({
      heightMetres: 4,
      widthMetres: 4,
    });
    expect(treeSize({ bark: part([-3, 1, 0]), leaves: part([0, 8, 0]) })).toEqual({
      heightMetres: 8,
      widthMetres: 6,
    });
  });
});

describe('what Blender is handed — the level as glTF, and its plan', () => {
  it('writes one mesh of two parts whose numbers read back exactly', () => {
    const [tree] = GENERATED_TREES;
    if (tree === undefined) throw new Error('no generated tree');
    const geometry = level(tree, 'middle');
    const { json, binary } = levelGltf(geometry, tree.name, 'tree.bin');
    const document = JSON.parse(json) as {
      readonly buffers: readonly { readonly uri: string; readonly byteLength: number }[];
      readonly bufferViews: readonly { readonly byteOffset: number; readonly byteLength: number }[];
      readonly accessors: readonly {
        readonly bufferView: number;
        readonly componentType: number;
        readonly count: number;
        readonly type: string;
        readonly min?: readonly number[];
        readonly max?: readonly number[];
      }[];
      readonly meshes: readonly {
        readonly primitives: readonly {
          readonly attributes: Readonly<Record<string, number>>;
          readonly indices: number;
          readonly material: number;
        }[];
      }[];
      readonly nodes: readonly { readonly name: string }[];
    };
    expect(document.buffers).toEqual([{ uri: 'tree.bin', byteLength: binary.byteLength }]);
    expect(document.nodes[0]?.name).toBe(tree.name);
    const primitives = document.meshes[0]?.primitives ?? [];
    expect(primitives.map((each) => each.material)).toEqual([0, 1]);
    const read = (accessor: number): Float32Array | Uint32Array => {
      const facts = document.accessors[accessor];
      const view = document.bufferViews[facts?.bufferView ?? -1];
      if (facts === undefined || view === undefined) throw new Error('a missing accessor');
      const bytes = binary.slice(view.byteOffset, view.byteOffset + view.byteLength);
      return facts.componentType === 5125
        ? new Uint32Array(bytes.buffer)
        : new Float32Array(bytes.buffer);
    };
    for (const [index, part] of [geometry.bark, geometry.leaves].entries()) {
      const primitive = primitives[index];
      if (primitive === undefined) throw new Error('a missing primitive');
      expect(read(primitive.attributes['POSITION'] ?? -1)).toEqual(part.positions);
      expect(read(primitive.attributes['NORMAL'] ?? -1)).toEqual(part.normals);
      expect(read(primitive.attributes['TEXCOORD_0'] ?? -1)).toEqual(part.uvs);
      expect(read(primitive.indices)).toEqual(part.indices);
      // glTF requires a position accessor's bounds, and an importer trusts them.
      const bounds = document.accessors[primitive.attributes['POSITION'] ?? -1];
      const xs = part.positions.filter((_, at) => at % 3 === 0);
      expect(bounds?.min?.[0]).toBe(Math.min(...xs));
      expect(bounds?.max?.[0]).toBe(Math.max(...xs));
      expect(bounds?.count).toBe(part.positions.length / 3);
    }
  });

  it('tells a run nothing of the species but the numbers its recorded input digests — #1289’s review', () => {
    // `sources.ts` §`generatedInputDigest` records `runNumbers`; this holds
    // that a plan is that, what the geometry measures and the machine's
    // paths, so a number added to the plan alone is a red test here rather
    // than a parameter that can be edited beside stale files.
    for (const tree of GENERATED_TREES) {
      const size = treeSize(level(tree, 'full'));
      for (const which of ['full', 'middle'] as const) {
        const geometry = level(tree, which);
        const plan = runPlan(tree, which, geometry, size, PATHS) as Record<string, unknown>;
        const { triangles, heightMetres, widthMetres, bark, sprig, ...rest } = plan;
        expect({ triangles, heightMetres, widthMetres }).toEqual({
          triangles: trianglesOf(geometry),
          ...size,
        });
        const {
          colour: barkColour,
          normal: barkNormal,
          ...barkNumbers
        } = bark as Record<string, unknown>;
        const { colour, opacity, normal, ...sprigNumbers } = sprig as Record<string, unknown>;
        expect({
          barkColour,
          barkNormal,
          leafColour: colour,
          leafOpacity: opacity,
          leafNormal: normal,
        }).toEqual(PATHS);
        expect({ ...rest, bark: barkNumbers, sprig: sprigNumbers }).toEqual(
          runNumbers(tree, which),
        );
      }
    }
    // Non-vacuity: the numbers Blender alone reads are in it.
    const [first] = GENERATED_TREES;
    if (first === undefined) throw new Error('there are generated trees');
    const numbers = runNumbers(first, 'full');
    expect(numbers.sprig.leaves.length).toBeGreaterThan(10);
    expect(Object.keys(numbers.sprig).sort()).toEqual(
      ['atlasTurn', 'grid', 'leaves', 'normalPixels', 'pixels', 'tone'].sort(),
    );
    // #1294: an atlas of rectangles hands Blender those, and no grid.
    const fir = GENERATED_TREES.find((tree) => tree.species === 'fir');
    if (fir === undefined) throw new Error('there is a generated fir');
    const firSprig = runNumbers(fir, 'full').sprig;
    const firAtlas = speciesOf(fir).sprig;
    expect(Object.keys(firSprig).sort()).toEqual(
      ['leaves', 'normalPixels', 'pixels', 'rects', 'tone'].sort(),
    );
    if (!('rects' in firSprig) || !('rects' in firAtlas)) {
      throw new Error('the fir’s atlas is rectangles');
    }
    expect(firSprig.rects).toEqual(firAtlas.rects);
    expect(firSprig.rects.length).toBeGreaterThan(0);
  });

  it('writes a grid’s numbers into a run’s digested JSON as #1283 wrote them — #1294', () => {
    // Sixteen committed rows record a digest of this JSON. Adding rectangles
    // must not move a byte of what a grid's species digests.
    const [oak] = GENERATED_TREES;
    if (oak === undefined) throw new Error('there are generated trees');
    const species = speciesOf(oak);
    if ('rects' in species.sprig) throw new Error('the oak’s atlas is a grid');
    expect(JSON.stringify(runNumbers(oak, 'full').sprig)).toBe(
      JSON.stringify({
        grid: species.sprig.grid,
        atlasTurn: species.sprig.atlasTurn,
        tone: species.sprig.tone,
        leaves: species.sprig.leaves,
        pixels: species.sprig.pixels,
        normalPixels: species.sprig.normalPixels,
      }),
    );
    expect(runNumbersDigest(oak, 'full')).toBe(
      'e614b8f694b20d934879f4a1d508181e0f4b205fc08f3de3aab17d7b47d672c3',
    );
  });

  it('asks a full level for its maps and its impostor, and a middle level for neither', () => {
    for (const tree of GENERATED_TREES) {
      const species = speciesOf(tree);
      const size = treeSize(level(tree, 'full'));
      const full = runPlan(tree, 'full', level(tree, 'full'), size, PATHS);
      const middle = runPlan(tree, 'middle', level(tree, 'middle'), size, PATHS);
      expect(full).toMatchObject({
        name: tree.name,
        level: 'full',
        maps: true,
        triangles: trianglesOf(level(tree, 'full')),
        impostor: species.impostor,
        ...size,
      });
      expect(middle).toMatchObject({
        level: 'middle',
        maps: false,
        impostor: null,
        triangles: trianglesOf(level(tree, 'middle')),
        // The FULL level's size, not its own.
        ...size,
      });
      // The species' own bark and leaves, and their sizes.
      expect(full['bark']).toEqual({
        colour: PATHS.barkColour,
        normal: PATHS.barkNormal,
        pixels: species.bark.pixels,
      });
      expect(full['sprig']).toMatchObject({
        colour: PATHS.leafColour,
        opacity: PATHS.leafOpacity,
        normal: PATHS.leafNormal,
        leaves: species.sprig.leaves,
        ...('rects' in species.sprig
          ? { rects: species.sprig.rects }
          : { grid: species.sprig.grid, atlasTurn: species.sprig.atlasTurn }),
      });
    }
  });
});

describe('a sprig’s leaves — arithmetic over its shoots', () => {
  const shoot = {
    from: [0.5, 0.1],
    heading: 0,
    length: 0.6,
    leaves: 3,
    splay: 50,
    leafLength: 0.25,
  } as const;

  it('sets a shoot’s leaves at even steps, leaning left then right, with one at its tip', () => {
    const leaves = sprigLeaves([shoot], 6);
    expect(leaves).toHaveLength(4);
    expect(leaves.map((leaf) => leaf.at)).toEqual([
      [0.5, 0.25],
      [0.5, 0.4],
      [0.5, 0.55],
      [0.5, 0.7],
    ]);
    expect(leaves.map((leaf) => leaf.turn)).toEqual([50, -50, 50, 0]);
    expect(leaves.every((leaf) => leaf.length === 0.25)).toBe(true);
  });

  it('grows a shoot the way it heads: anticlockwise from up the card', () => {
    const [, , tip] = sprigLeaves([{ ...shoot, heading: 90, leaves: 2 }], 6);
    // Heading 90° is to the LEFT of the card: x falls, y does not move.
    expect(tip?.at).toEqual([-0.1, 0.1]);
    expect(tip?.turn).toBe(90);
  });

  it('takes the atlas’s leaves in turn across every shoot, so neighbours are different scans', () => {
    const leaves = sprigLeaves([shoot, { ...shoot, heading: 40 }], 3);
    expect(leaves.map((leaf) => leaf.cell)).toEqual([0, 1, 2, 0, 1, 2, 0, 1]);
  });

  it('keeps every species’ sprig on its card, and names only leaves its atlas holds', () => {
    for (const species of GENERATED_SPECIES) {
      const cells = cellCount(species.sprig);
      // A grid's cell is one leaf and a sprig is many; a rectangle is a whole
      // sprig already (#1294), and a card is a few of those.
      expect(species.sprig.leaves.length, species.id).toBeGreaterThan(
        'rects' in species.sprig ? 0 : 8,
      );
      for (const leaf of species.sprig.leaves) {
        expect(Number.isInteger(leaf.cell) && leaf.cell >= 0, species.id).toBe(true);
        expect(leaf.cell, species.id).toBeLessThan(cells);
        for (const share of leaf.at) {
          expect(share, species.id).toBeGreaterThanOrEqual(0);
          expect(share, species.id).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('an atlas of rectangles — #1294', () => {
  const fir = GENERATED_SPECIES.find((each) => each.id === 'fir');
  if (fir === undefined || !('rects' in fir.sprig))
    throw new Error('the fir’s atlas is rectangles');
  const { rects } = fir.sprig;

  it('counts a grid’s cells by its columns and rows, and rectangles one by one', () => {
    expect(cellCount({ grid: [3, 2], atlasTurn: 0 })).toBe(6);
    expect(cellCount({ rects })).toBe(rects.length);
    expect(cellCount({ rects: [] })).toBe(0);
  });

  it('names each of the fir’s sprigs by a rectangle inside the 1K atlas, none over another', () => {
    expect(rects.length).toBeGreaterThanOrEqual(2);
    for (const rect of rects) {
      for (const value of [rect.x, rect.y, rect.width, rect.height]) {
        expect(Number.isInteger(value)).toBe(true);
      }
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(1024);
      expect(rect.y + rect.height).toBeLessThanOrEqual(1024);
    }
    // Two rectangles that overlap would draw one sprig's needles into another's card.
    rects.forEach((a, at) => {
      for (const b of rects.slice(at + 1)) {
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart, `${JSON.stringify(a)} and ${JSON.stringify(b)}`).toBe(true);
      }
    });
    // Every rectangle is drawn: none is named and left unused.
    expect([...new Set(fir.sprig.leaves.map((leaf) => leaf.cell))].sort()).toEqual(
      rects.map((_, at) => at),
    );
  });
});

describe('the pipeline refuses a tree whose numbers are not the committed ones — #1283, #1278', () => {
  let stage: string;
  beforeAll(() => {
    stage = mkdtempSync(join(tmpdir(), 'oyl-generated-'));
  });
  afterAll(() => {
    rmSync(stage, { recursive: true, force: true });
  });

  it('stages a level whose geometry is the recorded one: the glTF, its buffer and its plan', () => {
    const [tree] = GENERATED_TREES;
    if (tree === undefined) throw new Error('no generated tree');
    const staged = stageGeneratedLevel(generator, tree, 'middle', stage, PATHS);
    expect(staged.geometry).toEqual({ full: tree.geometry.full, level: tree.geometry.middle });
    expect(existsSync(staged.gltf)).toBe(true);
    const document = JSON.parse(readFileSync(staged.gltf, 'utf8')) as {
      readonly buffers: readonly { readonly uri: string; readonly byteLength: number }[];
    };
    const buffer = document.buffers[0];
    expect(readFileSync(join(stage, buffer?.uri ?? '')).byteLength).toBe(buffer?.byteLength);
    const plan = JSON.parse(readFileSync(staged.plan, 'utf8')) as Record<string, unknown>;
    // The plan a middle level is run with carries the FULL level's size.
    expect(plan).toMatchObject({ level: 'middle', ...treeSize(level(tree, 'full')) });
    expect(plan['triangles']).toBe(trianglesOf(level(tree, 'middle')));
  });

  it('refuses a level whose digest moved, naming both, and writes nothing for it', () => {
    const [tree] = GENERATED_TREES;
    if (tree === undefined) throw new Error('no generated tree');
    const into = mkdtempSync(join(tmpdir(), 'oyl-generated-refused-'));
    try {
      const wrong = 'f'.repeat(64);
      // The level asked for is not the recorded one.
      expect(() =>
        stageGeneratedLevel(
          generator,
          { ...tree, geometry: { ...tree.geometry, middle: wrong } },
          'middle',
          into,
          PATHS,
        ),
      ).toThrow(
        new RegExp(`its middle level generated as ${tree.geometry.middle}, not the ${wrong}`),
      );
      // Nor is the full level, which every level's size is read from.
      expect(() =>
        stageGeneratedLevel(
          generator,
          { ...tree, geometry: { ...tree.geometry, full: wrong } },
          'middle',
          into,
          PATHS,
        ),
      ).toThrow(/its full level generated as/);
      // A different seed is a different tree, and is refused as one.
      expect(() =>
        stageGeneratedLevel(generator, { ...tree, seed: tree.seed + 1 }, 'full', into, PATHS),
      ).toThrow(/generated-trees\.ts records/);
      expect(readdirSync(into)).toEqual([]);
    } finally {
      rmSync(into, { recursive: true, force: true });
    }
  });
});
