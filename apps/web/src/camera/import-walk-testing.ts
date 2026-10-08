// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Every module a module can reach**, by walking its relative imports
 * transitively. Test support, never shipped (the `-testing.ts` suffix).
 *
 * Two gates read it, and they ask opposite-facing questions of one graph:
 *
 * - `side-report-safety.test.ts` — nothing on the side camera's report path
 *   reaches a trainer (#388). The walker lived there until #799.
 * - `no-picture-reachable.test.ts` — nothing a model request is built from
 *   reaches a picture type (#799, #518).
 *
 * ⚠️ **The source is READ through a function**, never straight off the disk
 * inside the walk, so a gate's control can plant a chain of modules that do
 * not exist (`entry → helper → frame.ts`) and require the walk to find it.
 * A walker that could only read the tree could only ever be shown green.
 *
 * Paths are POSIX paths relative to `apps/web/src`, the way both gates name
 * their modules. A bare specifier (`react`, `@onyourleft/sensors`) is recorded
 * and not followed — **except `@onyourleft/analysis`**, which is followed into
 * its source under {@link ANALYSIS_ROOT}: #1094 moved the runner, the
 * templates, the screen and the mask out of this tree into that package, and
 * a walk that stopped at its name would no longer see what a model request is
 * built from (`no-picture-reachable.test.ts`) or what the runner can reach
 * (`runner-safety.test.ts`).
 *
 * A relative specifier whose query is exactly `?url` or `?raw` is an asset
 * handed over as a string and is not followed; one naming an existing
 * stylesheet or JSON file is not followed either. **Any other relative
 * specifier that does not resolve to a `.ts`/`.tsx` module is an error** —
 * a `?worker` or `?inline` query, an existing `.js` file — never a module
 * quietly left out of the walk (#822, #823).
 *
 * ## What it cannot see
 *
 * A specifier that is not a string literal (`import(name)`), and a module a
 * caller hands in at run time. The same limits `scripts/check-wiring.mjs`
 * §Limits states for its own walk.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/** `apps/web/src`, on disk. */
export const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * `@onyourleft/analysis`'s `src`, as a path from `apps/web/src` — how the walk
 * names that package's modules (#1094).
 */
export const ANALYSIS_ROOT = '../../../packages/analysis/src';

/** `apps/web/src` reached from {@link ANALYSIS_ROOT}'s side, so one module has one name. */
const SOURCE_FROM_ANALYSIS = '../../../apps/web/src/';

/** A path that climbed out of `src` and back in, named as a path under it. */
function underSource(path: string): string {
  return path.startsWith(SOURCE_FROM_ANALYSIS) ? path.slice(SOURCE_FROM_ANALYSIS.length) : path;
}

/** The workspace packages the walk follows rather than records, by entry point. */
const FOLLOWED_PACKAGES: Readonly<Record<string, string>> = {
  '@onyourleft/analysis': `${ANALYSIS_ROOT}/index.ts`,
  '@onyourleft/analysis/testing': `${ANALYSIS_ROOT}/testing.ts`,
};

/** A module's source, by its path under `src`, or `undefined` when there is none. */
export type ReadSource = (path: string) => string | undefined;

/** The real tree. */
export const readFromDisk: ReadSource = (path) => {
  const file = join(SOURCE_ROOT, path);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

/**
 * Every module specifier in `code`: `from '…'`, a bare `import '…'`, a dynamic
 * `import('…')` with a literal, `export … from '…'`, `import x = require('…')`
 * and a type's `import('…')` — in source order, in either quote.
 *
 * ⚠️ **Read by the TypeScript parser since #821, not by a pattern.** The
 * pattern it replaced took single quotes only and had to be kept in step by
 * hand with every spelling somebody remembered; the parser knows them all, and
 * it cannot mistake a specifier-shaped string inside a template or a comment
 * for an import. `fileName` decides only whether JSX is parsed.
 */
export function specifiersIn(code: string, fileName = 'module.tsx'): string[] {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const literal = (node: ts.Node | undefined): void => {
    if (node !== undefined && ts.isStringLiteralLike(node)) {
      found.push(node.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      literal(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      literal(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      literal(node.arguments[0]);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      literal(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * What a module takes from `specifier`: the names it imports or re-exports by
 * name (`import { a, type B } from '…'`, `export { c } from '…'`), or
 * `'whole'` when it refers to the module in ANY other spelling — a namespace
 * import, a default import, a side-effect import, `export *`, a dynamic
 * `import('…')`, a type's `import('…').T`, or `import x = require('…')`.
 *
 * ⚠️ `'whole'` is what keeps {@link specifiersThrough} conservative (#1184's
 * review): only a named import says WHICH declaration a module takes, so
 * every other spelling is read as taking everything the barrel re-exports,
 * the way the walk follows `index.ts` itself. Until then a namespace import of
 * `@onyourleft/analysis` came back as the bare package name, and the safety
 * gates that ask for `model-answer` or `model-step-port` by file did not see it.
 */
export function analysisImportsIn(
  code: string,
  specifier: string,
  fileName = 'module.tsx',
): readonly string[] | 'whole' {
  // A module that never spells the specifier cannot refer to it, and most do
  // not: the safety gates ask this of every source file in the client, and a
  // whole-tree walk of each was what took the importer check past its timeout
  // on CI (#1184's fix round).
  if (!code.includes(specifier)) {
    return [];
  }
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names: string[] = [];
  let whole = false;
  const isSpecifier = (literal: ts.Node | undefined): boolean =>
    literal !== undefined && ts.isStringLiteralLike(literal) && literal.text === specifier;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && isSpecifier(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (
        clause !== undefined &&
        clause.name === undefined &&
        bindings !== undefined &&
        ts.isNamedImports(bindings)
      ) {
        for (const element of bindings.elements) {
          names.push((element.propertyName ?? element.name).text);
        }
      } else {
        whole = true;
      }
    } else if (ts.isExportDeclaration(node) && isSpecifier(node.moduleSpecifier)) {
      if (node.exportClause !== undefined && ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          names.push((element.propertyName ?? element.name).text);
        }
      } else {
        whole = true;
      }
    } else if (
      (ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        isSpecifier(node.moduleReference.expression)) ||
      (ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        isSpecifier(node.arguments[0])) ||
      (ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        isSpecifier(node.argument.literal))
    ) {
      whole = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return whole ? 'whole' : names;
}

/** Every exported name a module declares itself (not one it re-exports from elsewhere). */
function declaredExports(code: string): string[] {
  const source = ts.createSourceFile('module.ts', code, ts.ScriptTarget.Latest, false);
  const names: string[] = [];
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false;
    if (!exported) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.push(declaration.name.text);
        }
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.push(statement.name.text);
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.push(element.name.text);
      }
    }
  }
  return names;
}

/**
 * Every module of `@onyourleft/analysis` that is not a test or test support, as
 * a path from `src` — or, with `withTestSupport`, its test support too (what
 * `@onyourleft/analysis/testing` can reach).
 */
export function analysisModules(directory = ANALYSIS_ROOT, withTestSupport = false): string[] {
  return readdirSync(join(SOURCE_ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      return analysisModules(path, withTestSupport);
    }
    const isModule = /\.ts$/.test(entry.name) && !/\.d\.ts$|\.test\.ts$/.test(entry.name);
    return isModule && (withTestSupport || !/(?:^|-)testing\.ts$/.test(entry.name)) ? [path] : [];
  });
}

let exportedBy: ReadonlyMap<string, string> | undefined;

/**
 * Which module of `@onyourleft/analysis` declares `name`, as a specifier-shaped
 * path (`../../../packages/analysis/src/screen/model-answer`), or `undefined`.
 *
 * #1094 moved modules the safety gates name by FILE — `model-answer.ts`,
 * `model-step-port.ts` — into that package, so a module here that imported
 * `UntrustedText` from `./model-answer` imports it from the package's barrel
 * now, and a gate that read only the specifier would no longer see it. This is
 * how {@link specifiersThrough} puts the file back.
 */
export function analysisModuleDeclaring(name: string): string | undefined {
  if (exportedBy === undefined) {
    const map = new Map<string, string>();
    for (const path of analysisModules()) {
      if (/\/(?:index|testing)\.ts$/.test(path)) {
        continue;
      }
      for (const declared of declaredExports(readFileSync(join(SOURCE_ROOT, path), 'utf8'))) {
        map.set(declared, path.replace(/\.ts$/, ''));
      }
    }
    exportedBy = map;
  }
  return exportedBy.get(name);
}

const reachableBy = new Map<string, readonly string[]>();

/** Every module `specifier`'s barrel can reach, specifier-shaped, read from disk once. */
function everyModuleOf(specifier: string): readonly string[] {
  let modules = reachableBy.get(specifier);
  if (modules === undefined) {
    modules = analysisModules(ANALYSIS_ROOT, specifier !== '@onyourleft/analysis').map((path) =>
      path.replace(/\.ts$/, ''),
    );
    reachableBy.set(specifier, modules);
  }
  return modules;
}

/**
 * {@link specifiersIn}, and for every name imported from `@onyourleft/analysis`
 * (or `/testing`) by name, the path of the package module that declares it
 * (#1094) — so a gate asking "does this module import `model-answer`?" gets the
 * answer it got before the module moved.
 *
 * ⚠️ A barrel referred to in any OTHER spelling — `import * as`, `export *`,
 * a dynamic `import()`, a type's `import('…').T` — names no declaration, so it
 * is read as an import of EVERY module that barrel can reach (#1184's review):
 * the package's modules for `@onyourleft/analysis`, and its test support as
 * well for `/testing`. Conservative, as following `index.ts` in the walk is.
 */
export function specifiersThrough(code: string, fileName = 'module.tsx'): string[] {
  const through = Object.keys(FOLLOWED_PACKAGES).flatMap((specifier): readonly string[] => {
    const taken = analysisImportsIn(code, specifier, fileName);
    if (taken === 'whole') {
      return everyModuleOf(specifier);
    }
    return taken.flatMap((name) => {
      const module = analysisModuleDeclaring(name);
      return module === undefined ? [] : [module];
    });
  });
  return [...specifiersIn(code, fileName), ...through];
}

/** One module's imports: relative ones resolved to paths under `src`, bare ones as written. */
export interface ModuleImports {
  readonly local: readonly string[];
  readonly bare: readonly string[];
}

/** What a walk found. */
export interface ImportClosure {
  /** Every module reached, the roots included. */
  readonly modules: ReadonlySet<string>;
  /** Every bare specifier any of them imports. */
  readonly bare: ReadonlySet<string>;
  /**
   * How a module was first reached: the chain of imports from a root to it,
   * root first. `undefined` for a module the walk never reached.
   */
  readonly chainTo: (path: string) => readonly string[] | undefined;
}

const RESOLUTION_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'] as const;

/** The only queries that hand a module over as a string: `?url` and `?raw`, alone. */
const ASSET_QUERY = /^[^?]+\?(?:url|raw)$/;

/** Files that are there and hold no code to walk: stylesheets and data. */
const INERT_EXTENSION = /\.(?:css|json)$/;

/** A walker over `read`. */
export function importWalk(read: ReadSource = readFromDisk): {
  readonly importsOf: (path: string) => ModuleImports;
  readonly closure: (roots: readonly string[]) => ImportClosure;
} {
  const resolveFile = (base: string): string | undefined =>
    RESOLUTION_SUFFIXES.map((suffix) => `${base}${suffix}`).find(
      (candidate) => /\.tsx?$/.test(candidate) && read(candidate) !== undefined,
    );

  const importsOf = (path: string): ModuleImports => {
    const source = read(path);
    if (source === undefined) {
      throw new Error(`the walk was asked for ${path}, which is not there`);
    }
    const local: string[] = [];
    const bare: string[] = [];
    // The parser skips comments itself. A `stripComments` pre-pass used to go
    // first, and its quote tracker does not know a regex literal: `/[/*]/`
    // opened a "comment" that swallowed the imports after it (#864).
    for (const specifier of specifiersIn(source, path)) {
      if (!specifier.startsWith('.')) {
        const followed = FOLLOWED_PACKAGES[specifier];
        if (followed !== undefined) {
          local.push(followed);
        } else {
          bare.push(specifier);
        }
        continue;
      }
      // A `?url` or `?raw` import is an asset handed over as a string, not a
      // module: there is nothing in it to walk. EXACTLY those two — `?worker`
      // names a module that runs, and `?inline` or `?url&worker` is not a
      // string either, so any other query falls through to the error (#823).
      if (ASSET_QUERY.test(specifier)) {
        continue;
      }
      const base = underSource(posix.normalize(posix.join(posix.dirname(path), specifier)));
      const file = resolveFile(base);
      if (file !== undefined) {
        local.push(file);
        continue;
      }
      // A stylesheet imported for its side effect, or JSON, is there and is
      // not code. A named list, so an existing `.js`, `.mjs` or `.jsx` — code
      // that can import a picture — is refused rather than skipped (#823).
      if (INERT_EXTENSION.test(base) && read(base) !== undefined) {
        continue;
      }
      // #822: a relative import that resolves to nothing used to be dropped
      // here in silence, so the walk passed over whatever it really named.
      throw new Error(`${path} imports ${specifier}, which the walk cannot resolve`);
    }
    return { local, bare };
  };

  const closure = (roots: readonly string[]): ImportClosure => {
    const parent = new Map<string, string | undefined>();
    const bare = new Set<string>();
    // Breadth first, so the chain a failure names is the shortest one.
    const queue: { path: string; from: string | undefined }[] = roots.map((path) => ({
      path,
      from: undefined,
    }));
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (parent.has(next.path)) {
        continue;
      }
      parent.set(next.path, next.from);
      const found = importsOf(next.path);
      for (const specifier of found.bare) {
        bare.add(specifier);
      }
      for (const path of found.local) {
        queue.push({ path, from: next.path });
      }
    }
    return {
      modules: new Set(parent.keys()),
      bare,
      chainTo: (path) => {
        if (!parent.has(path)) {
          return undefined;
        }
        const chain: string[] = [];
        for (let at: string | undefined = path; at !== undefined; at = parent.get(at)) {
          chain.unshift(at);
        }
        return chain;
      },
    };
  };

  return { importsOf, closure };
}
