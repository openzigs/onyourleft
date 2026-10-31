// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A game mode's code cannot reach the trainer**: the static-import walk that
 * holds it, shared by every mode that makes the promise (#1898). Delivery's
 * `delivery/delivery-cannot-reach-trainer.test.ts` (#1807, ADR 0059 D-2) wrote
 * it, and the lap race's `lap-race/lap-race-cannot-reach-trainer.test.ts`
 * (ADR 0060 D-2.2) calls the same functions with its own roots, so a seam
 * module or a trainer-control writer added later is forbidden to both the day
 * it lands. Test support (`*-testing.ts`): never shipped, never walked.
 *
 * The forbidden set, {@link forbiddenModules}: the trainer-command seam **as
 * `scripts/check-wiring.mjs` §`TRAINER_COMMAND_SEAM` lists it** (read off that
 * file, never copied), the game's trainer port, the gradient driver, the
 * ride's trainer opener, and **every module that writes to a trainer**, found
 * by {@link writesToATrainer} over the whole tree rather than written down
 * (ADR 0059 §Amendments, 2026-10-28). `tools/demo/forbidden-modules.ts`
 * (#1645) is the precedent, over the demo's bundle rather than its sources.
 *
 * ## The trainer-control writers, and how they are found
 *
 * The seam is the protocol's half. A mode's module could still reach a
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
 * - Every non-test module under each root directory a caller names, derived
 *   from the directory, so a module a later sub-issue adds there is walked
 *   the day it lands. A root that is not there is an error, never no modules. A
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
 * - Each root module is walked on its own, so a failure's chain starts at the
 *   module that began it.
 *
 * ## What it cannot see
 *
 * A module that reaches a trainer **at run time**: through a platform global
 * (`navigator.bluetooth`), or through a value a caller hands it — a function or
 * a port passed in when a round is built. No import names either. That half is
 * behavioural, and each mode holds it with a ride: Delivery's is #1816, the
 * lap race's #1906.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/** The repository root, on disk. */
const REPOSITORY = fileURLToPath(new URL('../../../../', import.meta.url));

/** A module's source by its path from the repository root, or `undefined` when there is none. */
export type ReadSource = (path: string) => string | undefined;

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
export function trainerCommandSeam(wiringSource: string): string[] {
  const list = /^const TRAINER_COMMAND_SEAM = \[([\s\S]*?)\];/m.exec(wiringSource)?.[1] ?? '';
  return [...list.matchAll(/^\s*'([^']+)',/gm)].map((match) => match[1] ?? '');
}

/** What the game holds to drive a trainer, beside the seam itself. */
export const GAME_TRAINER_MODULES = [
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
export function writesToATrainer(code: string, path: string): boolean {
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
export function trainerControlWriters(read: ReadSource = readFromDisk): string[] {
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
export const KNOWN_TRAINER_CONTROL_WRITERS = [
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
export const WRITERS_ON_DISK = trainerControlWriters();

/**
 * Every module a mode may not reach. ⚠️ **Every path must exist**: a renamed
 * file would leave the list naming nothing, and a check over nothing passes
 * for ever — the shape `scripts/check-wiring.mjs` §`missingSeamFiles` refuses.
 */
export function forbiddenModules(
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
export function modulesUnder(directory: string): string[] {
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
export function walk(roots: readonly string[], read: ReadSource = readFromDisk): Closure {
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
 * port` and `hop → port` both, when both are the mode's modules.
 */
export function seamViolations(
  roots: readonly string[],
  forbidden: readonly string[],
  read: ReadSource = readFromDisk,
): string[] {
  return roots.flatMap((root) => {
    const { modules, chainTo } = walk([root], read);
    return forbidden.filter((path) => modules.has(path)).map((path) => chainTo(path).join(' → '));
  });
}

export const WIRING_SOURCE = readFileSync(join(REPOSITORY, 'scripts/check-wiring.mjs'), 'utf8');

/**
 * {@link forbiddenModules} over the real tree and the real wiring script,
 * worked out on first use and not again: it reads the seam and checks that
 * every path of it names a file, which is the same answer every time.
 */
let forbiddenOnDisk: string[] | undefined;
export function forbiddenInTheTree(): string[] {
  forbiddenOnDisk ??= forbiddenModules(WIRING_SOURCE);
  return forbiddenOnDisk;
}

/** A tree that is the real one, with `planted` modules added over it. */
export function plantedOver(planted: Readonly<Record<string, string>>): ReadSource {
  return (path) => planted[path] ?? readFromDisk(path);
}
