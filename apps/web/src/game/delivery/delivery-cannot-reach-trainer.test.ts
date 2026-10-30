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
 * file, never copied), the game's trainer port, the gradient driver, the
 * ride's trainer opener, and **every module that writes to a trainer**, found
 * by {@link writesToATrainer} over the whole tree rather than written down
 * (ADR 0059 §Amendments, 2026-10-28). `tools/demo/forbidden-modules.ts`
 * (#1645) is the precedent, over the demo's bundle rather than its sources.
 *
 * ## The trainer-control writers, and how they are found
 *
 * The seam is the protocol's half. A Delivery module could still reach a
 * trainer through the half below it — the GATT write that carries the bytes —
 * without touching a seam module, because that half imports the protocol's
 * *types* only. So every non-test module under `apps/` and `packages/` is read
 * by the parser, and one is forbidden when it does any of these:
 *
 * - **W1, a GATT write**: a call to `writeValue…` (Web Bluetooth) or to
 *   `BleClient.write…` (the Android plugin).
 * - **W2, a control-point write**: a call to `.write(…)` or
 *   `.writeWithoutResponse(…)` that names a control point.
 * - **W3, a trainer command**: a method, or a property holding a function,
 *   named for one — `setTargetPower`, `setTargetResistance`,
 *   `setTargetResistanceLevel`, `setSimulationParameters`, `letGo`,
 *   `requestControl` or `writeControlPoint`.
 * - **W4, a control point's implementation**: a `write` defined in a module
 *   that declares an interface named `…ControlPoint` with a `write` member,
 *   which is how the #44 simulator serves FTMS and #90's vendor control point.
 *
 * On 2026-10-28 that finds the ten modules {@link KNOWN_TRAINER_CONTROL_WRITERS}
 * lists, and two browser-gate harnesses that script a trainer
 * (`apps/web/browser/ride-harness.tsx`, `reflow-harness.tsx`). A test holds
 * that it still finds every one of the ten: fewer is a lost rule.
 * A writer a later change adds is forbidden the day it lands, with no edit
 * here. There is no vendor-control writer under `packages/sensors/protocol`:
 * `fitness-machine-control.ts` records why this program writes to none, and
 * `trainer-control-choice.ts`, which picks between the two, is a seam module.
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
 * - A worker, exactly: `new Worker(new URL('…', import.meta.url))` and the
 *   same for `SharedWorker` are followed into the module the URL names, and so
 *   is any `new URL('…', import.meta.url)` that names a module, because that is
 *   how Vite is told to bundle one. A URL naming a file that is not a module
 *   (an image) runs nothing and is not followed.
 * - Anything the walk cannot resolve — a relative or workspace specifier that
 *   names no module, a query other than `?url` or `?raw`, an import whose
 *   specifier is not a literal, **any `import.meta.glob`** in any spelling, any
 *   `import.meta` member but `url`, `env` and `hot`, a worker built from
 *   anything but a literal module URL — is an error, never a module left out.
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

/**
 * Every file this test has read, by path. The tree does not change while the
 * file runs, and the walks below read the same few hundred modules again and
 * again, which under coverage was most of what a case cost (#1849).
 */
const DISK = new Map<string, string | undefined>();

const readFromDisk: ReadSource = (path) => {
  if (!DISK.has(path)) {
    const file = join(REPOSITORY, path);
    DISK.set(path, existsSync(file) ? readFileSync(file, 'utf8') : undefined);
  }
  return DISK.get(path);
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

/** The trainer commands a module may define (W3), as `TrainerControl` and its channel name them. */
const TRAINER_COMMANDS = new Set([
  'setTargetPower',
  'setTargetResistance',
  'setTargetResistanceLevel',
  'setSimulationParameters',
  'letGo',
  'requestControl',
  'writeControlPoint',
]);

/** `code`, parsed. */
function parse(code: string, path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    code,
    ts.ScriptTarget.Latest,
    false,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The name `node` defines a function under, as a method or a property, or `undefined`. */
function definedFunctionName(node: ts.Node): string | undefined {
  const defines =
    (ts.isMethodDeclaration(node) && node.body !== undefined) ||
    ((ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
      node.initializer !== undefined &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)));
  return defines && ts.isIdentifier(node.name) ? node.name.text : undefined;
}

/** Whether `code` writes to a trainer, by rules W1–W4 in the header. */
function writesToATrainer(code: string, path: string): boolean {
  const source = parse(code, path);
  let writes = false;
  let controlPointInterface = false;
  let definesWrite = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      const receiver = node.expression.expression.getText(source);
      // W1: a GATT write.
      if (/^writeValue/.test(name) || (receiver === 'BleClient' && /^write/.test(name))) {
        writes = true;
      }
      // W2: a write that names a control point.
      if (
        /^write(?:WithoutResponse)?$/.test(name) &&
        /control_?point/i.test(node.getText(source))
      ) {
        writes = true;
      }
    }
    const defined = definedFunctionName(node);
    // W3: a trainer command.
    if (defined !== undefined && TRAINER_COMMANDS.has(defined)) {
      writes = true;
    }
    definesWrite ||= defined === 'write';
    if (
      ts.isInterfaceDeclaration(node) &&
      /ControlPoint$/.test(node.name.text) &&
      node.members.some(
        (member) =>
          member.name !== undefined && ts.isIdentifier(member.name) && member.name.text === 'write',
      )
    ) {
      controlPointInterface = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  // W4: a control point's own implementation.
  return writes || (controlPointInterface && definesWrite);
}

/** Every non-test module under `apps/` and `packages/` that writes to a trainer. */
function trainerControlWriters(read: ReadSource = readFromDisk): string[] {
  return ['apps', 'packages']
    .flatMap((tree) => modulesUnder(tree))
    .filter((path) => {
      const code = read(path);
      return code !== undefined && writesToATrainer(code, path);
    });
}

/**
 * What {@link trainerControlWriters} found on 2026-10-28. A lower bound, never
 * the list: the forbidden set is what the rules find today, and this only
 * proves they have not stopped finding one of these.
 */
const KNOWN_TRAINER_CONTROL_WRITERS = [
  // W1: Web Bluetooth's FTMS control-point writer, `createFitnessMachineChannel`.
  'packages/sensors/web-bluetooth/src/fitness-machine-channel.ts',
  // W1: the validation capture, which forwards every GATT write to the device.
  'apps/web/src/validation/capture.ts',
  // W1: the Android shell's only `BleClient.write`, reached from apps/web through `@onyourleft/mobile`.
  'apps/mobile/src/ble/ble-client.ts',
  // W2, W3: the Android FTMS control-point writer, `createCapacitorFitnessMachineChannel`.
  'apps/mobile/src/ble/fitness-machine-channel.ts',
  // W3: the protocol's FTMS client, `createTrainerControl` (also a seam module).
  'packages/sensors/protocol/src/fitness-machine-control.ts',
  // W2, W3: the simulator bridge's control-point writer, `connectSimulatedTrainer`.
  'packages/sensors/protocol/src/simulator-bridge.ts',
  // W4: the simulated FTMS control point.
  'packages/sensors/src/simulator/ftms.ts',
  // W4: #90's simulated vendor control point, `createVendorControlPoint`.
  'packages/sensors/src/simulator/vendor-control.ts',
  // W3: the ride's trainer commands, `setTargetPower`, `simulationControl` and `letGo`.
  'apps/web/src/ride/controller.ts',
  // W3: the game's gradient driver (also in GAME_TRAINER_MODULES).
  'apps/web/src/game/gradient.ts',
] as const;

/** {@link trainerControlWriters} over the real tree, read once. */
const WRITERS_ON_DISK = trainerControlWriters();

/**
 * Every module Delivery may not reach. ⚠️ **Every path must exist**: a renamed
 * file would leave the list naming nothing, and a check over nothing passes
 * for ever — the shape `scripts/check-wiring.mjs` §`missingSeamFiles` refuses.
 */
function forbiddenModules(
  wiringSource: string,
  read: ReadSource = readFromDisk,
  writers: readonly string[] = WRITERS_ON_DISK,
): string[] {
  const forbidden = [
    ...new Set([...trainerCommandSeam(wiringSource), ...GAME_TRAINER_MODULES, ...writers]),
  ];
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
      return entry.name === 'node_modules' || entry.name === 'dist' ? [] : modulesUnder(path);
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
  workspaceExportsOnDisk ??= readWorkspaceExports();
  return workspaceExportsOnDisk;
}

/** {@link workspaceExports}, read once: the manifests are the real ones in every case. */
let workspaceExportsOnDisk: ReadonlyMap<string, string> | undefined;

function readWorkspaceExports(): ReadonlyMap<string, string> {
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
  readonly imports: readonly {
    readonly specifier: string;
    readonly names: Names;
    /** Named by `new URL('…', import.meta.url)`, so it may be a file that is not a module. */
    readonly url?: true;
  }[];
  /** What it re-exports. Followed only for a name somebody asked of it. */
  readonly reexports: readonly {
    readonly specifier: string;
    /** The name it is exported as, `'*'` for `export * from`. */
    readonly exported: string;
    /** What it takes from the specifier for that name. */
    readonly imported: Names;
  }[];
}

/** `import.meta`. */
function isImportMeta(node: ts.Node): node is ts.MetaProperty {
  return ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword;
}

/** `new URL(…, import.meta.url)`: how Vite is told to bundle a file and hand over its URL. */
function isModuleUrl(node: ts.Node): node is ts.NewExpression {
  const base = ts.isNewExpression(node) ? node.arguments?.[1] : undefined;
  return (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'URL' &&
    base !== undefined &&
    ts.isPropertyAccessExpression(base) &&
    isImportMeta(base.expression) &&
    base.name.text === 'url'
  );
}

/** The `import.meta` members that load nothing. */
const IMPORT_META_LOADS_NOTHING = new Set(['url', 'env', 'hot']);

/** Every value edge in `code`, read by the TypeScript parser. */
function edgesIn(code: string, path: string): ModuleEdges {
  // Parsing is the cost of a walk. The edges are a pure function of the path and
  // the source, so a module read again, unchanged, is not parsed again; a
  // planted module has other source and so is parsed.
  const known = EDGES.get(path);
  if (known?.code === code) {
    return known.edges;
  }
  const edges = readEdges(code, path);
  EDGES.set(path, { code, edges });
  return edges;
}

/** {@link edgesIn}'s results, by path, each with the source it was read from. */
const EDGES = new Map<string, { readonly code: string; readonly edges: ModuleEdges }>();

function readEdges(code: string, path: string): ModuleEdges {
  const source = parse(code, path);
  const cannotFollow = (node: ts.Node, what: string): Error =>
    new Error(`${path} ${what}, which the walk cannot follow: ${node.getText(source)}`);
  const imports: { specifier: string; names: Names; url?: true }[] = [];
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
    if (ts.isPropertyAccessExpression(node) && isImportMeta(node.expression)) {
      // `import.meta.glob` and anything else that may load a module: refused.
      if (!IMPORT_META_LOADS_NOTHING.has(node.name.text)) {
        throw cannotFollow(node, `uses import.meta.${node.name.text}`);
      }
      return;
    }
    if (isImportMeta(node)) {
      // Reached other than as `import.meta.<member>`: `import.meta['glob']`, or handed on.
      throw cannotFollow(node, 'uses import.meta other than by a member name');
    }
    if (ts.isNewExpression(node)) {
      const constructor = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : node.expression.getText(source);
      const script = node.arguments?.[0];
      if (
        (constructor === 'Worker' || constructor === 'SharedWorker') &&
        (script === undefined || !isModuleUrl(script))
      ) {
        throw cannotFollow(node, `starts a ${constructor} from a script it cannot name`);
      }
      if (isModuleUrl(node)) {
        const named = node.arguments?.[0];
        if (named === undefined || !ts.isStringLiteralLike(named)) {
          throw cannotFollow(node, 'names a URL by a value');
        }
        imports.push({ specifier: named.text, names: 'whole', url: true });
      }
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
  const resolve = (specifier: string, from: string, url: boolean): string | undefined => {
    if (url && !specifier.startsWith('.')) {
      throw new Error(`${from} names ${specifier} by URL, which the walk cannot resolve`);
    }
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
    if (!url && /^[^?]+\?(?:url|raw)$/.test(specifier)) {
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
    // A URL to a file that is not a script (an image, a model) runs nothing.
    if (url && !/\.[cm]?[jt]sx?$/.test(base) && /\.\w+$/.test(base) && read(base) !== undefined) {
      return undefined;
    }
    throw new Error(`${from} imports ${specifier}, which the walk cannot resolve`);
  };

  const enqueue = (specifier: string, names: Names, from: string, url = false): void => {
    const path = resolve(specifier, from, url);
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
        enqueue(edge.specifier, edge.names, path, edge.url === true);
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

/**
 * {@link forbiddenModules} over the real tree and the real wiring script,
 * worked out on first use and not again: it reads the seam and checks that
 * every path of it names a file, which is the same answer every time.
 */
let forbiddenOnDisk: string[] | undefined;
function forbiddenInTheTree(): string[] {
  forbiddenOnDisk ??= forbiddenModules(WIRING_SOURCE);
  return forbiddenOnDisk;
}

/** A tree that is the real one, with `planted` modules added over it. */
function plantedOver(planted: Readonly<Record<string, string>>): ReadSource {
  return (path) => planted[path] ?? readFromDisk(path);
}

describe('Delivery cannot reach the trainer-command seam (DL5, ADR 0059 D-2, #1807)', () => {
  it('reaches no trainer module from any Delivery module, by any static import chain', () => {
    expect(seamViolations(modulesUnder(DELIVERY_ROOT), forbiddenInTheTree())).toEqual([]);
  });

  it('reads the seam off scripts/check-wiring.mjs, every module of it', () => {
    const seam = trainerCommandSeam(WIRING_SOURCE);
    // The five modules #363 named; more is a seam that grew, fewer is a lost entry.
    expect(seam.length).toBeGreaterThanOrEqual(5);
    expect(seam).toContain('packages/sensors/protocol/src/fitness-machine-control.ts');
    const forbidden = forbiddenInTheTree();
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
      forbiddenInTheTree(),
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
      seamViolations([`${DELIVERY_ROOT}/planted-entry.ts`], forbiddenInTheTree(), read),
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
        forbiddenInTheTree(),
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
        forbiddenInTheTree(),
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
    const forbidden = forbiddenInTheTree();
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

  it('passes a named ask on through an `export *` barrel', () => {
    // `packages/domain/src/index.ts` has `export * from './workout'`: a seam
    // module re-exported by star must still be seen when a name is asked of it.
    const read = plantedOver({
      [`${DELIVERY_ROOT}/planted-star.ts`]: "export * from '../trainer-port';\n",
      [`${DELIVERY_ROOT}/planted-entry.ts`]:
        "import { gameTrainerPort } from './planted-star';\nvoid gameTrainerPort;\n",
      // Conservative: the walk does not read which names the target has.
      [`${DELIVERY_ROOT}/planted-unknown.ts`]:
        "import { nothingThere } from './planted-star';\nvoid nothingThere;\n",
      // `export *` never passes `default` on, so asking for it alone reaches nothing.
      [`${DELIVERY_ROOT}/planted-default.ts`]: "import port from './planted-star';\nvoid port;\n",
    });
    const forbidden = forbiddenInTheTree();
    const chain = (entry: string): string =>
      `${DELIVERY_ROOT}/${entry} → ${DELIVERY_ROOT}/planted-star.ts → apps/web/src/game/trainer-port.ts`;
    expect(seamViolations([`${DELIVERY_ROOT}/planted-entry.ts`], forbidden, read)).toContain(
      chain('planted-entry.ts'),
    );
    expect(seamViolations([`${DELIVERY_ROOT}/planted-unknown.ts`], forbidden, read)).toContain(
      chain('planted-unknown.ts'),
    );
    expect(seamViolations([`${DELIVERY_ROOT}/planted-default.ts`], forbidden, read)).toEqual([]);
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

  it('refuses import.meta.glob in every spelling, and any import.meta member that may load', () => {
    const fails = (code: string): (() => void) => {
      const read = plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code });
      return () => walk([`${DELIVERY_ROOT}/planted-entry.ts`], read);
    };
    for (const code of [
      // Vite inlines an eager glob as a static import of the same module instance.
      "const all = import.meta.glob('../trainer-port.ts', { eager: true });",
      "const lazy = import.meta.glob('./*.ts');",
      "const lazy = import.meta.glob(['../*.ts', '!../gradient.ts'], { import: 'gameTrainerPort' });",
      'const glob = import.meta.glob;',
      "const eager = import.meta.globEager('../trainer-port.ts');",
    ]) {
      expect(fails(code), code).toThrow(/uses import\.meta\.glob/);
    }
    for (const code of [
      "const all = import.meta['glob']('../trainer-port.ts', { eager: true });",
      'const meta = import.meta;\nmeta.glob("../trainer-port.ts");',
    ]) {
      expect(fails(code), code).toThrow(/import\.meta other than by a member name/);
    }
    expect(fails("const r = import.meta.resolve('../trainer-port');")).toThrow(
      /uses import\.meta\.resolve/,
    );
    // The members that load nothing are not refused.
    expect(
      fails(
        'const here = import.meta.url;\nconst dev = import.meta.env.DEV;\nimport.meta.hot?.accept();',
      ),
    ).not.toThrow();
  });

  it('follows a worker into the module it runs, and refuses one it cannot name', () => {
    const plant = (code: string): ReadSource =>
      plantedOver({
        [`${DELIVERY_ROOT}/planted-entry.ts`]: code,
        [`${DELIVERY_ROOT}/planted-picture.png`]: 'not a module',
      });
    const violations = (code: string): string[] =>
      seamViolations([`${DELIVERY_ROOT}/planted-entry.ts`], forbiddenInTheTree(), plant(code));
    const port = `${DELIVERY_ROOT}/planted-entry.ts → apps/web/src/game/trainer-port.ts`;
    for (const code of [
      "const w = new Worker(new URL('../trainer-port.ts', import.meta.url), { type: 'module' });",
      "const w = new SharedWorker(new URL('../trainer-port', import.meta.url));",
      "const w = new globalThis.Worker(new URL('../trainer-port.ts', import.meta.url));",
      // A module's URL is how Vite is told to bundle it, whoever uses it later.
      "const script = new URL('../trainer-port.ts', import.meta.url);",
    ]) {
      expect(violations(code), code).toContain(port);
    }
    // A URL to a file that is not a module runs nothing.
    expect(violations("const p = new URL('./planted-picture.png', import.meta.url);")).toEqual([]);
    const fails =
      (code: string): (() => void) =>
      () =>
        walk([`${DELIVERY_ROOT}/planted-entry.ts`], plant(code));
    for (const code of [
      'const w = new Worker(script);',
      "const w = new Worker('/assets/worker.js');",
      'const w = new SharedWorker(new URL(name, import.meta.url));',
      'const w = new Worker(new URL(`../${name}.ts`, import.meta.url));',
      'const w = new window.SharedWorker(url);',
    ]) {
      expect(fails(code), code).toThrow(/cannot follow|by a value/);
    }
    for (const code of [
      "const w = new Worker(new URL('./no-such-worker.ts', import.meta.url));",
      "const w = new Worker(new URL('/public/worker.js', import.meta.url));",
      "const p = new URL('./no-such-picture.png', import.meta.url);",
    ]) {
      expect(fails(code), code).toThrow(/cannot resolve/);
    }
  });

  it('finds every trainer-control writer by rule, and has lost none it found on 2026-10-28', () => {
    for (const path of KNOWN_TRAINER_CONTROL_WRITERS) {
      expect(WRITERS_ON_DISK, path).toContain(path);
    }
    const forbidden = forbiddenInTheTree();
    for (const path of WRITERS_ON_DISK) {
      expect(forbidden, path).toContain(path);
    }
    // Each rule on its own, so a rule deleted is red here and not only above.
    const finds = (code: string): boolean => writesToATrainer(code, 'planted.ts');
    for (const [rule, code] of [
      ['W1', 'await characteristic.writeValueWithResponse(bytes);'],
      ['W1', 'void handle.writeValueWithoutResponse(bytes);'],
      ['W1', 'await BleClient.write(id, service, characteristic, view);'],
      ['W2', 'await port.write(id, FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT, view);'],
      ['W2', 'controlPoint.write(request);'],
      ['W3', 'export const c = { setTargetPower: async (watts) => send(watts) };'],
      ['W3', 'export class C { letGo() { return send(); } }'],
      ['W3', 'export const c = { writeControlPoint: async (bytes) => send(bytes) };'],
      [
        'W4',
        'export interface VendorControlPoint { write(r: R): void }\nexport const p = { write(r) { log.push(r); } };',
      ],
    ] as const) {
      expect(finds(code), `${rule}: ${code}`).toBe(true);
    }
    // Neither a declared shape nor a function that is not a trainer command.
    for (const code of [
      'export interface Channel { writeControlPoint(bytes: Uint8Array): Promise<void>; setTargetPower(w: number): Promise<void> }',
      'function letGo(peer) { peer.close(); }',
      'export const store = { write(record) { rows.push(record); } };',
      'keep.current.write(draft);',
    ]) {
      expect(finds(code), code).toBe(false);
    }
  });

  it('refuses every trainer-control writer when a Delivery module imports it', () => {
    const violations = (code: string): string[] =>
      seamViolations(
        [`${DELIVERY_ROOT}/planted-entry.ts`],
        forbiddenInTheTree(),
        plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code }),
      );
    // Each by the specifier its real consumers use, and the module the chain must end at.
    for (const [code, writer] of [
      [
        "import { createFitnessMachineChannel } from '@onyourleft/sensors/web-bluetooth';",
        'packages/sensors/web-bluetooth/src/fitness-machine-channel.ts',
      ],
      [
        // The transport opens the control point and builds the channel above.
        "import { createWebBluetoothTransport } from '@onyourleft/sensors/web-bluetooth';",
        'packages/sensors/web-bluetooth/src/fitness-machine-channel.ts',
      ],
      [
        "import { createCapacitorFitnessMachineChannel } from '@onyourleft/mobile';",
        'apps/mobile/src/ble/fitness-machine-channel.ts',
      ],
      [
        "import { capacitorBlePort } from '@onyourleft/mobile';",
        'apps/mobile/src/ble/ble-client.ts',
      ],
      [
        "import { createTrainerControl } from '@onyourleft/sensors/protocol';",
        'packages/sensors/protocol/src/fitness-machine-control.ts',
      ],
      [
        "import { connectSimulatedTrainer } from '@onyourleft/sensors/protocol/testing';",
        'packages/sensors/protocol/src/simulator-bridge.ts',
      ],
      [
        "import { createSimulator } from '@onyourleft/sensors/simulator';",
        'packages/sensors/src/simulator/ftms.ts',
      ],
      [
        "import { createVendorControlPoint } from '@onyourleft/sensors/simulator';",
        'packages/sensors/src/simulator/vendor-control.ts',
      ],
      [
        "import { recordingBluetooth } from '../../validation/capture';",
        'apps/web/src/validation/capture.ts',
      ],
      [
        "import { rideInProgress } from '../../ride/controller';",
        'apps/web/src/ride/controller.ts',
      ],
      ["import { createGradientSession } from '../gradient';", 'apps/web/src/game/gradient.ts'],
    ] as const) {
      const found = violations(code);
      expect(
        found.some(
          (chain) =>
            chain.startsWith(`${DELIVERY_ROOT}/planted-entry.ts → `) &&
            chain.endsWith(` → ${writer}`),
        ),
        `${code}\n${found.join('\n')}`,
      ).toBe(true);
    }
  });
});
