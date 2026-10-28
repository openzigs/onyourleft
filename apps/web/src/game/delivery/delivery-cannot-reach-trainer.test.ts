// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Delivery's code cannot reach the trainer** — the owner's ruling DL5 of
 * 2026-10-27, recorded as ADR 0059 D-2, held as a red test (#1807).
 *
 * A smart trainer applies resistance to a person who is pedalling (CLAUDE.md
 * §6), and DL5 says no Delivery event — a hit, a miss, an obstacle, a
 * delivery — may ever change what the trainer is sent. `check:wiring` cannot
 * hold that: it proves a module is *reached*, never that one is *not*
 * (`docs/agents/wiring-gate.md` §4j). So this walks the static import graph
 * from every module under `game/delivery/` and fails, naming the chain, when
 * it reaches any of {@link forbiddenModules}: the trainer-command seam **as
 * `scripts/check-wiring.mjs` §`TRAINER_COMMAND_SEAM` lists it** (read off that
 * file, never copied), the game's trainer port, the gradient driver and the
 * ride's trainer opener. `tools/demo/forbidden-modules.ts` (#1645) is the
 * precedent, over the demo's bundle rather than its sources.
 *
 * ## What the walk follows
 *
 * - Every non-test module under `game/delivery/`, derived from the directory,
 *   so a module a later sub-issue adds there is walked the day it lands. A
 *   `*.test.ts` and a `*-testing.ts` (test support, never shipped) are not.
 * - Relative imports, and workspace imports (`@onyourleft/*`) into the
 *   package's source by its `package.json` `exports`, transitively, through
 *   every spelling: `import`, `export … from`, a dynamic `import('…')` with a
 *   literal, and `import x = require('…')`. A third-party package (`react`,
 *   `three`) is not followed: it cannot import this repository's modules.
 * - ⚠️ **Type-only imports are skipped**, as #1645's check skips them (the
 *   bundler erases them before it sees the module): `import type`,
 *   `export type … from`, a type's `import('…')`, and an element written
 *   `type` inside braces. A type cannot write to a trainer. `import { type A }`
 *   with nothing else in the braces is **not** skipped: under this
 *   repository's `verbatimModuleSyntax` it is emitted as `import {} from '…'`,
 *   which still runs the module.
 * - A module's own imports are always followed — its code runs. **Its
 *   re-exports are followed only for the names asked of it**: a module that
 *   takes `{ a }` from a barrel reaches what provides `a`, not every module the
 *   barrel re-exports. Without this, one value from `@onyourleft/domain` would
 *   "reach" `trainer/simulation.ts`, because the domain barrel re-exports
 *   #90's setpoint driver beside everything else, and the test would be red
 *   for a module that cannot call a line of it — and the town modules #1808's
 *   targets come from (`mapped-buildings.ts`, `footprint-buildings.ts`,
 *   `streets.ts`, `decorations.ts`) all take values from that barrel. A
 *   namespace import, a dynamic import and `export *` are followed for every
 *   name asked, whether or not the target has it: conservative, never short.
 * - Anything the walk cannot resolve — a relative or workspace specifier that
 *   names no module, a query other than `?url` or `?raw`, an import whose
 *   specifier is not a literal — is an error, never a module left out.
 * - Each Delivery module is walked on its own, so a failure's chain starts at
 *   the module that began it.
 *
 * ## What it cannot see
 *
 * A module that reaches a trainer **at run time**: through a platform global
 * (`navigator.bluetooth`), or through a value a caller hands it — a function or
 * a port passed in when a round is built. No import names either. That half of
 * DL5 is behavioural: a whole game ride with Delivery on must write exactly
 * what the same ride without it writes, and it is #1816's test, because it
 * needs the round wired into a ride.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** The repository root, on disk. */
const REPOSITORY = fileURLToPath(new URL('../../../../../', import.meta.url));

/** Delivery's code, as a path from the repository root. */
const DELIVERY_ROOT = 'apps/web/src/game/delivery';

/** A module's source by its path from the repository root, or `undefined` when there is none. */
type ReadSource = (path: string) => string | undefined;

const readFromDisk: ReadSource = (path) => {
  const file = join(REPOSITORY, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

/**
 * `scripts/check-wiring.mjs` §`TRAINER_COMMAND_SEAM`, read off its source — the
 * same reading `tools/demo/forbidden-modules.test.ts` does.
 */
function trainerCommandSeam(wiringSource: string): string[] {
  const list = /^const TRAINER_COMMAND_SEAM = \[([\s\S]*?)\];/m.exec(wiringSource)?.[1] ?? '';
  return [...list.matchAll(/^\s*'([^']+)',/gm)].map((match) => match[1] ?? '');
}

/** What the game holds to drive a trainer, beside the seam itself. */
const GAME_TRAINER_MODULES = [
  'apps/web/src/game/trainer-port.ts',
  'apps/web/src/game/gradient.ts',
  'apps/web/src/ride/trainer.ts',
] as const;

/**
 * Every module Delivery may not reach. ⚠️ **Every path must exist**: a renamed
 * file would leave the list naming nothing, and a check over nothing passes
 * for ever — the shape `scripts/check-wiring.mjs` §`missingSeamFiles` refuses.
 */
function forbiddenModules(wiringSource: string, read: ReadSource = readFromDisk): string[] {
  const forbidden = [...trainerCommandSeam(wiringSource), ...GAME_TRAINER_MODULES];
  const missing = forbidden.filter((path) => read(path) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `these forbidden modules name no file, so the walk would pass over nothing:\n  - ${missing.join('\n  - ')}`,
    );
  }
  return forbidden;
}

/** Every non-test module under `directory`, as a path from the repository root. */
function modulesUnder(directory: string): string[] {
  return readdirSync(join(REPOSITORY, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      return modulesUnder(path);
    }
    return /\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !/(?:^|-)testing\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** `@onyourleft/<name>[/<subpath>]` → the source file its `package.json` exports it from. */
function workspaceExports(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const tree of ['apps', 'packages']) {
    for (const entry of readdirSync(join(REPOSITORY, tree), { withFileTypes: true })) {
      const manifest = posix.join(tree, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(join(REPOSITORY, manifest))) {
        continue;
      }
      const { name, exports } = JSON.parse(readFileSync(join(REPOSITORY, manifest), 'utf8')) as {
        name?: string;
        exports?: Record<string, unknown>;
      };
      for (const [subpath, target] of Object.entries(exports ?? {})) {
        if (name !== undefined && typeof target === 'string') {
          found.set(
            posix.join(name, subpath),
            posix.normalize(posix.join(tree, entry.name, target)),
          );
        }
      }
    }
  }
  return found;
}

/** The names a module asks of another: specific ones, or all of them. */
type Names = ReadonlySet<string> | 'whole';

/** One module's static edges, type-only ones already dropped. */
interface ModuleEdges {
  /** What the module imports for its own code. Always followed. */
  readonly imports: readonly { readonly specifier: string; readonly names: Names }[];
  /** What it re-exports. Followed only for a name somebody asked of it. */
  readonly reexports: readonly {
    readonly specifier: string;
    /** The name it is exported as, `'*'` for `export * from`. */
    readonly exported: string;
    /** What it takes from the specifier for that name. */
    readonly imported: Names;
  }[];
}

/** Every value edge in `code`, read by the TypeScript parser. */
function edgesIn(code: string, path: string): ModuleEdges {
  const source = ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.Latest,
    false,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports: { specifier: string; names: Names }[] = [];
  const reexports: { specifier: string; exported: string; imported: Names }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) {
        return;
      }
      const bindings = clause?.namedBindings;
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        imports.push({ specifier: node.moduleSpecifier.text, names: 'whole' });
      } else {
        const names = new Set<string>(clause?.name === undefined ? [] : ['default']);
        for (const element of bindings?.elements ?? []) {
          if (!element.isTypeOnly) {
            names.add((element.propertyName ?? element.name).text);
          }
        }
        imports.push({ specifier: node.moduleSpecifier.text, names });
      }
      return;
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      if (node.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)) {
        return;
      }
      const specifier = node.moduleSpecifier.text;
      const clause = node.exportClause;
      if (clause === undefined) {
        reexports.push({ specifier, exported: '*', imported: 'whole' });
      } else if (ts.isNamespaceExport(clause)) {
        reexports.push({ specifier, exported: clause.name.text, imported: 'whole' });
      } else {
        for (const element of clause.elements) {
          if (!element.isTypeOnly) {
            reexports.push({
              specifier,
              exported: element.name.text,
              imported: new Set([(element.propertyName ?? element.name).text]),
            });
          }
        }
      }
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const reference = node.moduleReference.expression;
      if (!node.isTypeOnly && ts.isStringLiteral(reference)) {
        imports.push({ specifier: reference.text, names: 'whole' });
      }
      return;
    }
    if (ts.isImportTypeNode(node)) {
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument === undefined || !ts.isStringLiteralLike(argument)) {
        throw new Error(`${path} imports a module the walk cannot name: ${node.getText(source)}`);
      }
      imports.push({ specifier: argument.text, names: 'whole' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { imports, reexports };
}

/** What a walk found. */
interface Closure {
  readonly modules: ReadonlySet<string>;
  /** The chain of imports a module was first reached by, root first. */
  readonly chainTo: (path: string) => readonly string[];
}

const RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'] as const;

/** Every module reached from `roots`, over `read`. */
function walk(roots: readonly string[], read: ReadSource = readFromDisk): Closure {
  const workspace = workspaceExports();
  const edges = new Map<string, ModuleEdges>();
  const asked = new Map<string, Set<string> | 'whole'>();
  const parent = new Map<string, string | undefined>();
  const queue: { path: string; names: Names; from: string | undefined }[] = roots.map((path) => ({
    path,
    names: 'whole',
    from: undefined,
  }));
  const chainTo = (path: string): string[] => {
    const chain: string[] = [];
    for (let at: string | undefined = path; at !== undefined; at = parent.get(at)) {
      chain.unshift(at);
    }
    return chain;
  };

  /** `specifier` as written in `from`, resolved to a module path, or `undefined` for one not followed. */
  const resolve = (specifier: string, from: string): string | undefined => {
    if (specifier.startsWith('@onyourleft/')) {
      const target = workspace.get(specifier);
      if (target === undefined || read(target) === undefined) {
        throw new Error(`${from} imports ${specifier}, which no workspace package exports`);
      }
      return target;
    }
    if (!specifier.startsWith('.')) {
      // A third-party package: it cannot import this repository's modules.
      return undefined;
    }
    // A `?url` or `?raw` import hands over a string, and runs nothing.
    if (/^[^?]+\?(?:url|raw)$/.test(specifier)) {
      return undefined;
    }
    const base = posix.normalize(posix.join(posix.dirname(from), specifier));
    const file = RESOLUTION_SUFFIXES.map((suffix) => `${base}${suffix}`).find(
      (candidate) => /\.tsx?$/.test(candidate) && read(candidate) !== undefined,
    );
    if (file !== undefined) {
      return file;
    }
    if (/\.(?:css|json)$/.test(base) && read(base) !== undefined) {
      return undefined;
    }
    throw new Error(`${from} imports ${specifier}, which the walk cannot resolve`);
  };

  const enqueue = (specifier: string, names: Names, from: string): void => {
    const path = resolve(specifier, from);
    if (path !== undefined) {
      queue.push({ path, names, from });
    }
  };

  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const { path, names, from } = next;
    const before = asked.get(path);
    if (before === 'whole') {
      continue;
    }
    const fresh: Names =
      names === 'whole' ? 'whole' : new Set([...names].filter((name) => !before?.has(name)));
    if (before !== undefined && fresh !== 'whole' && fresh.size === 0) {
      continue;
    }
    asked.set(path, fresh === 'whole' ? 'whole' : new Set([...(before ?? []), ...fresh]));
    let found = edges.get(path);
    if (found === undefined) {
      const code = read(path);
      if (code === undefined) {
        throw new Error(`the walk was asked for ${path}, which is not there`);
      }
      found = edgesIn(code, path);
      edges.set(path, found);
    }
    if (before === undefined) {
      parent.set(path, from);
      for (const edge of found.imports) {
        enqueue(edge.specifier, edge.names, path);
      }
    } else if (from !== undefined && !chainTo(from).includes(path)) {
      // Asked for new names by another importer: what those names reach is
      // reached through this one, so the chain a failure names goes through it.
      parent.set(path, from);
    }
    for (const edge of found.reexports) {
      if (edge.exported === '*') {
        // `export *` passes on every name but `default`, and which ones the
        // target has is not read here: ask it for all of them that were asked.
        const passed: Names =
          fresh === 'whole' ? 'whole' : new Set([...fresh].filter((name) => name !== 'default'));
        if (passed === 'whole' || passed.size > 0) {
          enqueue(edge.specifier, passed, path);
        }
      } else if (fresh === 'whole' || fresh.has(edge.exported)) {
        enqueue(edge.specifier, edge.imported, path);
      }
    }
  }

  return { modules: new Set(parent.keys()), chainTo };
}

/**
 * Every forbidden module reached from `roots`, each as the chain that reached
 * it. Each root is walked on its own, so a chain starts at the module that
 * began it rather than at whichever root the walk met first — `entry → hop →
 * port` and `hop → port` both, when both are Delivery modules.
 */
function seamViolations(
  roots: readonly string[],
  forbidden: readonly string[],
  read: ReadSource = readFromDisk,
): string[] {
  return roots.flatMap((root) => {
    const { modules, chainTo } = walk([root], read);
    return forbidden.filter((path) => modules.has(path)).map((path) => chainTo(path).join(' → '));
  });
}

const WIRING_SOURCE = readFileSync(join(REPOSITORY, 'scripts/check-wiring.mjs'), 'utf8');

/** A tree that is the real one, with `planted` modules added over it. */
function plantedOver(planted: Readonly<Record<string, string>>): ReadSource {
  return (path) => planted[path] ?? readFromDisk(path);
}

describe('Delivery cannot reach the trainer-command seam (DL5, ADR 0059 D-2, #1807)', () => {
  it('reaches no trainer module from any Delivery module, by any static import chain', () => {
    expect(seamViolations(modulesUnder(DELIVERY_ROOT), forbiddenModules(WIRING_SOURCE))).toEqual(
      [],
    );
  });

  it('reads the seam off scripts/check-wiring.mjs, every module of it', () => {
    const seam = trainerCommandSeam(WIRING_SOURCE);
    // The five modules #363 named; more is a seam that grew, fewer is a lost entry.
    expect(seam.length).toBeGreaterThanOrEqual(5);
    expect(seam).toContain('packages/sensors/protocol/src/fitness-machine-control.ts');
    const forbidden = forbiddenModules(WIRING_SOURCE);
    for (const path of [...seam, ...GAME_TRAINER_MODULES]) {
      expect(forbidden).toContain(path);
    }
  });

  it('refuses a forbidden path that names no file, rather than passing over nothing', () => {
    const renamed = WIRING_SOURCE.replace(
      "'packages/sensors/protocol/src/erg-writer.ts',",
      "'packages/sensors/protocol/src/erg-writer-renamed.ts',",
    );
    expect(renamed).not.toBe(WIRING_SOURCE);
    expect(() => forbiddenModules(renamed)).toThrow(
      /name no file[\s\S]*packages\/sensors\/protocol\/src\/erg-writer-renamed\.ts/,
    );
    const lostPort = plantedOver({});
    expect(() =>
      forbiddenModules(WIRING_SOURCE, (path) =>
        path === 'apps/web/src/game/trainer-port.ts' ? undefined : lostPort(path),
      ),
    ).toThrow(/apps\/web\/src\/game\/trainer-port\.ts/);
  });

  it('reads files: every Delivery module is visited, so an empty or wrong root is red', () => {
    const roots = modulesUnder(DELIVERY_ROOT);
    expect(roots.length).toBeGreaterThan(0);
    const { modules } = walk(roots);
    for (const path of roots) {
      expect(modules, path).toContain(path);
    }
    // Past one hop on the real tree: the week's progress is built on the round.
    expect(walk([`${DELIVERY_ROOT}/delivery-progress.ts`]).modules).toContain(
      `${DELIVERY_ROOT}/round.ts`,
    );
    expect(() => walk([`${DELIVERY_ROOT}/no-such-module.ts`])).toThrow(/is not there/);
  });

  it('finds a planted violation through an intermediate module, and names both hops', () => {
    const read = plantedOver({
      [`${DELIVERY_ROOT}/planted-entry.ts`]: "import { hop } from './planted-hop';\nvoid hop;\n",
      [`${DELIVERY_ROOT}/planted-hop.ts`]:
        "import { gameTrainerPort } from '../trainer-port';\nexport const hop = gameTrainerPort;\n",
    });
    const found = seamViolations(
      [...modulesUnder(DELIVERY_ROOT), `${DELIVERY_ROOT}/planted-entry.ts`],
      forbiddenModules(WIRING_SOURCE),
      read,
    );
    expect(found).toContain(
      `${DELIVERY_ROOT}/planted-entry.ts → ${DELIVERY_ROOT}/planted-hop.ts → apps/web/src/game/trainer-port.ts`,
    );
  });

  it('follows a workspace import into the package, through its barrel, to the seam', () => {
    const read = plantedOver({
      [`${DELIVERY_ROOT}/planted-entry.ts`]:
        "import { chooseTrainerControl } from '@onyourleft/sensors/protocol';\nvoid chooseTrainerControl;\n",
    });
    expect(
      seamViolations([`${DELIVERY_ROOT}/planted-entry.ts`], forbiddenModules(WIRING_SOURCE), read),
    ).toEqual([
      `${DELIVERY_ROOT}/planted-entry.ts → packages/sensors/protocol/src/index.ts → packages/sensors/protocol/src/trainer-control-choice.ts`,
    ]);
  });

  it('lets Delivery take a value from @onyourleft/domain, but not #90’s setpoint driver', () => {
    // The town's mapped buildings, streets and doorsteps (#1808's targets) all
    // reach the domain barrel, and the barrel re-exports `trainer/simulation.ts`.
    const violations = (code: string): string[] =>
      seamViolations(
        [`${DELIVERY_ROOT}/planted-entry.ts`],
        forbiddenModules(WIRING_SOURCE),
        plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code }),
      );
    expect(violations("import { METRES_PER_MILE } from '@onyourleft/domain';")).toEqual([]);
    expect(violations("import { createSimulationDriver } from '@onyourleft/domain';")).toEqual([
      `${DELIVERY_ROOT}/planted-entry.ts → packages/domain/src/index.ts → packages/domain/src/trainer/simulation.ts`,
    ]);
    // A type from it is erased, so it is not a way in.
    expect(violations("import type { SimulationDriver } from '@onyourleft/domain';")).toEqual([]);
  });

  it('follows every value spelling of an import, and skips only the type-only ones', () => {
    const reaches = (code: string): boolean =>
      seamViolations(
        [`${DELIVERY_ROOT}/planted-entry.ts`],
        forbiddenModules(WIRING_SOURCE),
        plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code }),
      ).length > 0;
    // Value spellings: each reaches the port.
    for (const code of [
      "import { gameTrainerPort } from '../trainer-port';",
      "import * as port from '../trainer-port';",
      "import '../trainer-port';",
      "export { gameTrainerPort } from '../trainer-port';",
      "export * from '../trainer-port';",
      "export * as port from '../trainer-port';",
      "const port = await import('../trainer-port');",
      "import port = require('../trainer-port');",
      // Kept as `import {} from '…'` under verbatimModuleSyntax: the module still runs.
      "import { type GameTrainerPort } from '../trainer-port';",
    ]) {
      expect(reaches(code), code).toBe(true);
    }
    // Type-only spellings: erased before anything runs.
    for (const code of [
      "import type { GameTrainerPort } from '../trainer-port';",
      "export type { GameTrainerPort } from '../trainer-port';",
      "export type * from '../trainer-port';",
      "let port: import('../trainer-port').GameTrainerPort;",
      "import type port = require('../trainer-port');",
    ]) {
      expect(reaches(code), code).toBe(false);
    }
  });

  it('follows a barrel only for the names asked of it', () => {
    const read = plantedOver({
      [`${DELIVERY_ROOT}/planted-barrel.ts`]: [
        "export { hop } from './planted-hop';",
        "export { gameTrainerPort } from '../trainer-port';",
      ].join('\n'),
      [`${DELIVERY_ROOT}/planted-hop.ts`]: 'export const hop = 1;\n',
      [`${DELIVERY_ROOT}/planted-entry.ts`]: "import { hop } from './planted-barrel';\nvoid hop;\n",
      [`${DELIVERY_ROOT}/planted-whole.ts`]:
        "import * as all from './planted-barrel';\nvoid all;\n",
      // Meets the barrel first for nothing, then through a second module for the port.
      [`${DELIVERY_ROOT}/planted-later.ts`]: [
        "import './planted-barrel';",
        "import { viaOther } from './planted-other';",
      ].join('\n'),
      [`${DELIVERY_ROOT}/planted-other.ts`]:
        "export { gameTrainerPort as viaOther } from './planted-barrel';\n",
    });
    const forbidden = forbiddenModules(WIRING_SOURCE);
    expect(seamViolations([`${DELIVERY_ROOT}/planted-entry.ts`], forbidden, read)).toEqual([]);
    expect(walk([`${DELIVERY_ROOT}/planted-entry.ts`], read).modules).toContain(
      `${DELIVERY_ROOT}/planted-hop.ts`,
    );
    expect(seamViolations([`${DELIVERY_ROOT}/planted-whole.ts`], forbidden, read)).toContain(
      `${DELIVERY_ROOT}/planted-whole.ts → ${DELIVERY_ROOT}/planted-barrel.ts → apps/web/src/game/trainer-port.ts`,
    );
    // The chain named is the one that carried the port, not the first that met the barrel.
    expect(seamViolations([`${DELIVERY_ROOT}/planted-later.ts`], forbidden, read)).toContain(
      `${DELIVERY_ROOT}/planted-later.ts → ${DELIVERY_ROOT}/planted-other.ts → ${DELIVERY_ROOT}/planted-barrel.ts → apps/web/src/game/trainer-port.ts`,
    );
  });

  it('refuses what it cannot follow, rather than leaving it out', () => {
    const fails = (code: string): (() => void) => {
      const read = plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code });
      return () => walk([`${DELIVERY_ROOT}/planted-entry.ts`], read);
    };
    expect(fails("import { a } from './no-such-module';")).toThrow(/cannot resolve/);
    expect(fails("import { a } from '@onyourleft/no-such-package';")).toThrow(
      /no workspace package exports/,
    );
    expect(fails("import Worker from './round?worker';")).toThrow(/cannot resolve/);
    expect(fails('const lazy = await import(name);')).toThrow(/cannot name/);
  });
});
