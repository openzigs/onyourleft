// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The pinned tree generator, loaded — #1283, ADR 0049 D-1.
 *
 * ## A tool, never a dependency of the product
 *
 * [EZ-Tree](https://github.com/dgreenheck/ez-tree) is a `devDependency` of this
 * app at ONE exact version (`sources.ts` §`PINNED_EZ_TREE`), and it is loaded
 * here and nowhere else: by `process-assets.ts` on the machine that makes the
 * committed trees, and by `generated-trees.test.ts`, which regenerates every
 * tree's numbers wherever the tests run. Nothing under `src/` may import it —
 * `generated-trees.test.ts` reads the tree for that — so it is in no bundle,
 * and its MIT licence is the tool's, not the trees' (ADR 0049 D-1).
 *
 * ## ⚠️ Its own images are asked for at load, and answered with nothing
 *
 * EZ-Tree's module builds a three.js texture for each of its bundled bark and
 * leaf pictures as it is imported, by asking the page for an image element.
 * ADR 0049 D-1 takes none of those pictures — their origin is not stated — and
 * Node has no page. So for the length of the import, and no longer, `document`
 * is a stand-in whose image element never loads: the generator's textures stay
 * empty, and `generated-trees.ts` reads only the numbers `generate()` makes.
 * {@link imagesAsked} says how many it asked for, which the test holds above
 * zero so that a release that stopped asking does not leave this note behind.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import {
  geometryDigest,
  levelGltf,
  levelPlan,
  runPlan,
  speciesOf,
  treeLevel,
  treeSize,
  type EzTree,
  type GeneratedLevel,
  type GeneratedTree,
  type RunPaths,
} from './generated-trees';
import { EZ_TREE_PACKAGE, EZ_TREE_VERSION, PINNED_EZ_TREE } from './sources';

/** What the pinned release exports that this pipeline uses. */
export interface EzTreeModule {
  readonly Tree: new () => EzTree;
}

let asked = 0;
let loading: Promise<EzTreeModule> | undefined;

/** How many image elements the generator's module asked for while it loaded. */
export function imagesAsked(): number {
  return asked;
}

/** The version of the generator that is installed, read from its own manifest. */
export function installedEzTreeVersion(): string {
  const require = createRequire(import.meta.url);
  // The package's `exports` names only its entry, so its manifest is found beside that.
  const entry = require.resolve(EZ_TREE_PACKAGE);
  const manifest = JSON.parse(
    readFileSync(join(dirname(dirname(entry)), 'package.json'), 'utf8'),
  ) as { readonly version?: string };
  return manifest.version ?? '';
}

/** Why the installed generator is not the pinned one, or nothing. */
export function ezTreeFault(installed: string): string | undefined {
  return installed === EZ_TREE_VERSION
    ? undefined
    : `${EZ_TREE_PACKAGE} is ${installed === '' ? 'not installed' : installed}; the pipeline is pinned to ${PINNED_EZ_TREE}`;
}

/** An image element that never loads: what the generator's texture loader is handed. */
const neverLoads = (): Record<string, unknown> => ({
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  src: '',
});

/**
 * The pinned generator. Refuses any other version before loading it, as
 * `process-assets.ts` refuses another Blender: a different release may place a
 * limb differently, and the committed trees would then describe a run nobody
 * can repeat.
 */
export function loadEzTree(installed: string = installedEzTreeVersion()): Promise<EzTreeModule> {
  const fault = ezTreeFault(installed);
  if (fault !== undefined) return Promise.reject(new Error(fault));
  loading ??= (async () => {
    const scope = globalThis as { document?: unknown };
    const had = Object.getOwnPropertyDescriptor(scope, 'document');
    Object.defineProperty(scope, 'document', {
      configurable: true,
      value: {
        createElementNS: () => {
          asked += 1;
          return neverLoads();
        },
      },
    });
    try {
      // Read as the few members `generated-trees.ts` §`EzTree` names: the
      // package's own types describe three.js objects this never touches.
      const loaded: unknown = await import('@dgreenheck/ez-tree');
      return loaded as EzTreeModule;
    } finally {
      if (had === undefined) delete scope.document;
      else Object.defineProperty(scope, 'document', had);
    }
  })();
  return loading;
}

/** What {@link stageGeneratedLevel} wrote for one Blender run. */
export interface StagedLevel {
  /** The glTF the run imports, with its buffer beside it. */
  readonly gltf: string;
  /** What the run is told: `generated-trees.ts` §`runPlan`. */
  readonly plan: string;
  /** The digests of the geometry made, the full level's and this level's. */
  readonly geometry: { readonly full: string; readonly level: string };
}

/**
 * Generates one level of one tree and writes what its Blender run reads into
 * `stage`: the level as a glTF, and the run's plan.
 *
 * ⚠️ **Refuses a tree whose numbers are not the committed ones**, before a
 * byte is written: the full level and this level are each held to the digest
 * `generated-trees.ts` §`GENERATED_TREES` records. A different generator, a
 * different `three`, a Node that rounds differently or an edited parameter
 * makes a different tree, and a tree nobody recorded is not one ADR 0049 D-1
 * admits. The full level is always made, because every level of a tree
 * records the FULL level's size.
 *
 * `maps` is where each upstream map is on this machine.
 */
export function stageGeneratedLevel(
  generator: EzTreeModule,
  tree: GeneratedTree,
  level: GeneratedLevel,
  stage: string,
  maps: RunPaths,
): StagedLevel {
  const species = speciesOf(tree);
  const full = treeLevel(new generator.Tree(), species, tree.seed, levelPlan(species, 'full'));
  const made =
    level === 'full'
      ? full
      : treeLevel(new generator.Tree(), species, tree.seed, levelPlan(species, level));
  const geometry = { full: geometryDigest(full), level: geometryDigest(made) };
  for (const [which, digest] of [
    ['full', geometry.full],
    [level, geometry.level],
  ] as const) {
    if (digest !== tree.geometry[which]) {
      throw new Error(
        `${tree.name}: its ${which} level generated as ${digest}, not the ${tree.geometry[which]} generated-trees.ts records — a different generator, three or Node, or an edited parameter`,
      );
    }
  }
  const stem = `${tree.name}.${level}`;
  const { json, binary } = levelGltf(made, tree.name, `${stem}.bin`);
  const gltf = join(stage, `${stem}.gltf`);
  const plan = join(stage, `${stem}.plan.json`);
  writeFileSync(join(stage, `${stem}.bin`), binary);
  writeFileSync(gltf, json);
  writeFileSync(plan, JSON.stringify(runPlan(tree, level, made, treeSize(full), maps)));
  return { gltf, plan, geometry };
}
