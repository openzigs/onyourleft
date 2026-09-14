#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Assert that the client's own seams are wired to something that ships.
 *
 * ## The failure this exists to stop
 *
 * Five defects in one week shared a single shape, and no gate in this
 * repository could see any of them (#278):
 *
 * | Issue | What was unwired | How it presented |
 * | --- | --- | --- |
 * | #230 | `BleClient.initialize()`, called only inside `availability()`, which nothing calls | no device could be paired on Android at all |
 * | #236 | `.oyl-game__world`, a canvas class with no rule anywhere | the renderer drew a correct scene at 300×150 |
 * | #237 | `advanceBot`, no caller; `SceneInput.botDistance` declared, optional, never supplied | there was no pacer |
 * | #252 | the ghost's gap — `gapTo: 'ghost'` had no caller | the ghost's gap was never quoted |
 * | #259 | `ghostFinished`, exported from `scene.ts`, unit-tested, green | a rider who beat their own best was never told |
 *
 * In every case the unit was **correct, unit-tested, typechecked, linted and
 * shipped**. The defect was only ever in the wiring, and every gate here looks
 * *inside* a unit: CLAUDE.md §5's mutation requirement asks that a test fail
 * without the change, and `advanceBot` had exactly that; the typechecker cannot
 * help, because ⚠️ **an exported function nobody calls and an optional
 * parameter nobody supplies are both perfectly well typed**; `no-unused-vars`
 * is scoped within a module and an `export` is a use as far as it is concerned.
 *
 * ## What this checks, and what it deliberately does not
 *
 * **Not a general dead-code rule.** `knip`, `ts-prune` and friends report every
 * test-only helper, every barrel re-export and every deliberately-unused port
 * sibling — including `writeWithoutResponse`, which `plugin-port.ts` declares
 * *specifically so that nothing calls it*. A noisy rule gets an allowlist, and
 * an allowlist that grows is how a rule stops firing.
 *
 * So the question asked is narrow: **is this reachable from the code the
 * product actually loads?** The entry point is read out of each app's own
 * `index.html` — the page Vite builds — and the module graph is walked from
 * there, through
 * relative imports, workspace `exports` maps and `import()` calls written with
 * a literal. Test files are not entry points, and neither is
 * `apps/web/browser/`: a harness page is a gate, and #236 is what happens when
 * a harness's own canvas is mistaken for the product's.
 *
 * Three rules, over `apps/web/src/game/`, `apps/web/src/ride/` and every
 * `*-port.ts` under `apps/` — the places the five defects were:
 *
 * - **WIRE001** — a watched module no production module imports.
 * - **WIRE002** — an exported symbol in a watched module that no production
 *   declaration names.
 * - **WIRE003** — a method declared on a port interface that no production
 *   declaration calls. This is #230's shape: a method is not reached merely
 *   because some other method's body names it, because *that* method may itself
 *   be called by nothing. `initialize()` was named inside `availability()`, and
 *   `availability()` was named nowhere.
 *
 * ## How reachability is computed
 *
 * Each production module is split into declarations: every top-level binding,
 * and separately every method-like member of an object literal or a class. A
 * declaration is credited with the names its body uses. The seeds are what runs
 * when a module is imported — its side-effecting statements, and any top-level
 * binding whose initialiser is not a function — and reachability is the closure
 * of that over the names each reached declaration uses.
 *
 * ⚠️ **The split at a method boundary is the load-bearing part**, and it is why
 * this is not a usage count. A property value is evaluated when its object
 * literal is built; a method body runs only when something calls it. So a
 * method's contents are credited to the method, which is what makes an
 * unreached `availability()` fail to keep `initialize()` alive.
 *
 * Names are matched as names — `member:initialize` is one node however many
 * types declare it. That is deliberate: it makes the analysis wrong in the
 * direction of reporting **too little**, never too much, which is the only way
 * round that keeps a gate believable.
 *
 * ## §Limits — what this cannot see
 *
 * Read these before concluding something is wired because the gate is green.
 * It **cannot** see:
 *
 * - a call made through a **string key** — `handlers[name]()`, a lookup table
 *   built from data, a method named only in a template literal;
 * - a **dynamic import** whose specifier is not a literal;
 * - a **prop threaded through JSX** it does not follow. That is #252: the
 *   ghost's gap was a `'ghost'` branch of a union `GameView` never passed to
 *   `HudPanel`, and both the branch and the prop are perfectly reachable names.
 *   Measured against `05b3fcf^`, the tree as it actually was: this gate is
 *   silent there, and `check-wiring.test.sh` pins that silence so it stays a
 *   known limit rather than a surprise;
 * - a **CSS class with no rule**, which is #236 and a different search
 *   altogether — see #266 and `apps/web/browser/`;
 * - a **collision**, because a name is matched as a name and nothing here is
 *   resolved to the declaration it came from. An export is held alive by any
 *   *identifier* of the same name anywhere in reached production code — a
 *   local, an import from elsewhere, a callback parameter whose body reads it.
 *   An `export function update` in `game/world.ts` is silent for exactly that
 *   reason: `onProgress: (update) => …` in `transfer/TransferView.tsx` names
 *   `update`. A port method is held alive the same way by any `.name` member
 *   access, whoever declared it. ⚠️ A member access is **not** what silences an
 *   export: `x.create` contributes `member:create` and an exported `create` is
 *   looked up as `value:create`, so that one is still reported. Measured, both
 *   ways round, in #283's review.
 *
 * ## The exemption, and why it is not a list
 *
 * Something may legitimately have no production caller — a threshold a test
 * asserts against, a port sibling declared so that nothing calls it. Say so
 * **at the declaration**, in a doc comment: `@unwired` followed by the reason.
 * The tag on its own is refused. It lives at the declaration rather than in a
 * config file because a list in a config file is read by nobody and grows until
 * the rule stops firing, and because the reader who needs the reason is the one
 * looking at the declaration.
 *
 * Usage: node scripts/check-wiring.mjs [--root <dir>]
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

/**
 * Where the defects of #278 were, and where a new one would be.
 *
 * The client's own seams, not the libraries underneath. A library export with
 * no consumer is a much larger and much noisier question — CLAUDE.md §4b
 * records that `packages/physics` has no production consumer for most of what
 * it exports, by design — and a rule reporting those would be the
 * allowlist-that-grows this one exists to avoid. ⚠️ The cost is stated rather
 * than hidden: #237's `advanceBot` lived in `packages/physics/src/pacer.ts` and
 * is not named here. What this gate reports on that tree is the client half of
 * the same missing wiring, `game/hud/fields.ts` §`gapAgainst`.
 */
const WATCHED_PREFIXES = ['apps/web/src/game/', 'apps/web/src/ride/'];
const WATCHED_SUFFIX = /-port\.ts$/;

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', '.git', 'android']);

/** A test, or a double a test builds from. Neither is product code. */
const isTestSupport = (path) =>
  /\.(test|spec)\.tsx?$/.test(path) ||
  /(^|[/-])testing\.tsx?$/.test(path) ||
  path.includes('/testing/');

const slash = (path) => path.split(sep).join('/');

// --------------------------------------------------------------- module graph

/** Every workspace package, by name, with the `exports` map a specifier resolves through. */
export function workspacePackages(root) {
  const found = new Map();
  for (const area of ['apps', 'packages']) {
    let entries;
    try {
      entries = readdirSync(join(root, area), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = join(root, area, entry.name, 'package.json');
      if (!existsSync(manifest)) continue;
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof parsed.name !== 'string') continue;
      found.set(parsed.name, { dir: join(root, area, entry.name), exports: parsed.exports ?? {} });
    }
  }
  return found;
}

function fileFor(base) {
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => join(base, 'index' + extension)),
  ];
  if (base.endsWith('.js')) {
    candidates.push(...SOURCE_EXTENSIONS.map((extension) => base.slice(0, -3) + extension));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/** The file a specifier names, or nothing for a dependency this repository does not own. */
export function resolveSpecifier(fromFile, specifier, packages) {
  if (specifier.startsWith('.')) return fileFor(resolve(dirname(fromFile), specifier));
  for (const [name, pkg] of packages) {
    if (specifier !== name && !specifier.startsWith(name + '/')) continue;
    const subpath = specifier === name ? '.' : '.' + specifier.slice(name.length);
    const target = pkg.exports[subpath];
    return typeof target === 'string' ? fileFor(resolve(pkg.dir, target)) : undefined;
  }
  return undefined;
}

export function parseFile(file) {
  return ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/**
 * Every module specifier a file names, including an `import()` written with a
 * literal — which is how `main.tsx` reaches the Android shell and the renderer.
 */
export function specifiersOf(source) {
  const found = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/**
 * The module scripts every app's own `index.html` loads.
 *
 * Read from the page rather than written down here, so a client that stops
 * mounting `main.tsx` cannot leave this checking a file nothing loads. ⚠️
 * `apps/web/browser/`'s harness pages are deliberately NOT entry points: they
 * are a gate, built by a second Vite config, and treating one as production is
 * how a symbol reachable only from a harness passes for wired — #236's shape.
 */
export function entryPoints(root) {
  const found = [];
  let apps;
  try {
    apps = readdirSync(join(root, 'apps'), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const app of apps) {
    if (!app.isDirectory()) continue;
    const page = join(root, 'apps', app.name, 'index.html');
    if (!existsSync(page)) continue;
    for (const match of readFileSync(page, 'utf8').matchAll(
      /<script[^>]*\ssrc=["']([^"']+)["']/g,
    )) {
      const source = match[1];
      if (/^[a-z]+:\/\//.test(source)) continue;
      const appDirectory = join(root, 'apps', app.name);
      const base = source.startsWith('/')
        ? join(appDirectory, source.slice(1))
        : resolve(appDirectory, source);
      const file = fileFor(base);
      if (file !== undefined) found.push(file);
    }
  }
  return found;
}

/** Every module the entry points can reach. */
export function productionModules(entries, packages) {
  const reached = new Set();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (reached.has(file) || isTestSupport(slash(file))) continue;
    reached.add(file);
    for (const specifier of specifiersOf(parseFile(file))) {
      const target = resolveSpecifier(file, specifier, packages);
      if (target !== undefined && !reached.has(target)) queue.push(target);
    }
  }
  return reached;
}

// ------------------------------------------------------------- the name graph

const isFunctionLike = (node) =>
  node !== undefined &&
  (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isClassExpression(node));

/**
 * The name of a member whose body runs only when something calls it.
 *
 * A method, an accessor, or a property holding a function. A property holding
 * anything else is evaluated when its object literal is built, so it belongs to
 * whatever built it.
 */
function methodLikeName(node) {
  const bodied =
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ((ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) &&
      isFunctionLike(node.initializer));
  if (!bodied || node.name === undefined) return undefined;
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return undefined;
}

/** Nodes whose `name` declares something rather than referring to something. */
function declaresItsName(node) {
  return (
    ts.isParameter(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isBindingElement(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isEnumMember(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isImportSpecifier(node) ||
    ts.isExportSpecifier(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isJsxAttribute(node)
  );
}

/**
 * Whether `expression` is a module namespace, so `expression.x` names the
 * export `x` rather than a property of some object.
 *
 * `import * as ns`, `const ns = await import('…')`, and the inline
 * `(await import('./game/three-renderer')).threeGameRenderer` that `main.tsx`
 * loads the renderer with, are all the same read.
 */
export function namespaceRead(expression, namespaces) {
  if (ts.isIdentifier(expression)) return namespaces.has(expression.text);
  if (ts.isParenthesizedExpression(expression)) {
    return namespaceRead(expression.expression, namespaces);
  }
  if (ts.isAwaitExpression(expression)) return namespaceRead(expression.expression, namespaces);
  return (
    ts.isCallExpression(expression) && expression.expression.kind === ts.SyntaxKind.ImportKeyword
  );
}

/** Identifiers in this module that are bound to a module namespace. */
export function namespaceBindings(source) {
  const found = new Set();
  const visit = (node) => {
    if (ts.isNamespaceImport(node)) found.add(node.name.text);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      namespaceRead(node.initializer, found)
    ) {
      found.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/**
 * Add every name `node` refers to into `into`, pushing one entry per
 * method-like member onto `members` rather than crediting its body to `node`.
 */
export function collectReferences(node, into, members, namespaces = new Set()) {
  const memberName = methodLikeName(node);
  if (memberName !== undefined) {
    const refs = new Set();
    ts.forEachChild(node, (child) => {
      if (child === node.name) return;
      collectReferences(child, refs, members, namespaces);
    });
    members.push({ key: `member:${memberName}`, refs });
    return;
  }
  if (ts.isObjectBindingPattern(node)) {
    // `const { controller } = props` reads `.controller`, exactly as
    // `props.controller` does. Without this every destructured consumer reads
    // as no consumer at all — which is most React props in this tree.
    for (const element of node.elements) {
      const read = element.propertyName ?? element.name;
      if (ts.isIdentifier(read)) into.add(`member:${read.text}`);
      if (ts.isObjectBindingPattern(element.name) || ts.isArrayBindingPattern(element.name)) {
        collectReferences(element.name, into, members, namespaces);
      }
      if (element.initializer !== undefined) {
        collectReferences(element.initializer, into, members, namespaces);
      }
    }
    return;
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.name)) {
      into.add(
        `${namespaceRead(node.expression, namespaces) ? 'value' : 'member'}:${node.name.text}`,
      );
    }
    collectReferences(node.expression, into, members, namespaces);
    return;
  }
  if (ts.isElementAccessExpression(node)) {
    if (ts.isStringLiteral(node.argumentExpression)) {
      into.add(`member:${node.argumentExpression.text}`);
    }
    collectReferences(node.expression, into, members, namespaces);
    return;
  }
  if (ts.isQualifiedName(node)) {
    into.add(`${namespaceRead(node.left, namespaces) ? 'value' : 'member'}:${node.right.text}`);
    collectReferences(node.left, into, members, namespaces);
    return;
  }
  if (ts.isShorthandPropertyAssignment(node)) {
    into.add(`value:${node.name.text}`);
    return;
  }
  if (ts.isIdentifier(node)) {
    into.add(`value:${node.text}`);
    return;
  }
  if (declaresItsName(node)) {
    ts.forEachChild(node, (child) => {
      // ⚠️ A destructuring pattern in the name position is a READ of the
      // object's properties rather than a declaration of them, so it is walked
      // rather than skipped. Missing this was worth ten false findings here.
      const pattern = ts.isObjectBindingPattern(child) || ts.isArrayBindingPattern(child);
      if (child === node.name && !pattern) return;
      collectReferences(child, into, members, namespaces);
    });
    return;
  }
  ts.forEachChild(node, (child) => collectReferences(child, into, members, namespaces));
}

/**
 * One module's declarations, and what runs the moment it is imported.
 *
 * `nodes` is keyed `value:<name>` for a binding and `member:<name>` for a
 * property; `eager` is what seeds reachability.
 */
export function moduleGraph(source) {
  const nodes = [];
  const eager = new Set();
  const members = [];
  const namespaces = namespaceBindings(source);

  const bodyOf = (node) => {
    const refs = new Set();
    ts.forEachChild(node, (child) => {
      if (child === node.name) return;
      collectReferences(child, refs, members, namespaces);
    });
    return refs;
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) continue;
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      nodes.push({ key: `value:${statement.name.text}`, refs: bodyOf(statement) });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const refs = new Set();
        if (declaration.initializer !== undefined) {
          collectReferences(declaration.initializer, refs, members, namespaces);
        }
        if (declaration.type !== undefined) {
          collectReferences(declaration.type, refs, members, namespaces);
        }
        if (ts.isIdentifier(declaration.name) && isFunctionLike(declaration.initializer)) {
          nodes.push({ key: `value:${declaration.name.text}`, refs });
          continue;
        }
        // Evaluated when the module loads, so whatever it names is live.
        for (const ref of refs) eager.add(ref);
        if (ts.isIdentifier(declaration.name)) {
          nodes.push({ key: `value:${declaration.name.text}`, refs: new Set() });
        }
      }
      continue;
    }
    const refs = new Set();
    collectReferences(statement, refs, members, namespaces);
    for (const ref of refs) eager.add(ref);
  }

  return { nodes: [...nodes, ...members], eager };
}

/** Every name the entry points can reach, as `value:x` / `member:x` keys. */
export function reachableNames(sources) {
  const byKey = new Map();
  const queue = [];
  for (const source of sources) {
    const { nodes, eager } = moduleGraph(source);
    for (const node of nodes) {
      const bodies = byKey.get(node.key) ?? [];
      bodies.push(node.refs);
      byKey.set(node.key, bodies);
    }
    for (const seed of eager) queue.push(seed);
  }
  const reached = new Set();
  while (queue.length > 0) {
    const key = queue.pop();
    if (reached.has(key)) continue;
    reached.add(key);
    for (const refs of byKey.get(key) ?? []) {
      for (const ref of refs) if (!reached.has(ref)) queue.push(ref);
    }
  }
  return reached;
}

// -------------------------------------------- what is watched, and what it has

export function isWatched(relativePath) {
  if (!/\.tsx?$/.test(relativePath) || isTestSupport(relativePath)) return false;
  return (
    WATCHED_PREFIXES.some((prefix) => relativePath.startsWith(prefix)) ||
    (relativePath.startsWith('apps/') && WATCHED_SUFFIX.test(relativePath))
  );
}

/**
 * The entries of `WATCHED_PREFIXES` that name no directory in `root`.
 *
 * ⚠️ **A selector written down here fails closed against deleting the thing it
 * names and OPEN against renaming it.** Rename `apps/web/src/ride/` to
 * `riding/` and the walk below simply finds nothing under the old prefix: every
 * rule then passes over an empty population and the success line says every
 * watched seam is reachable, having read none. That is #142's shape exactly
 * (CLAUDE.md §4e, where a directory-name filter silently dropped a third of the
 * accessibility suite), one gate later — so a prefix whose directory is not
 * there is a failure, and moving a watched directory means editing this file in
 * the same commit.
 */
export function missingPrefixes(root) {
  return WATCHED_PREFIXES.filter((prefix) => {
    const dir = join(root, ...prefix.split('/').filter((part) => part.length > 0));
    return !existsSync(dir) || !statSync(dir).isDirectory();
  });
}

/** Every watched source file on disk, whether or not anything reaches it. */
export function watchedFiles(root) {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) walk(full);
      } else if (isWatched(slash(relative(root, full)))) {
        found.push(full);
      }
    }
  };
  walk(join(root, 'apps'));
  return found.sort();
}

/**
 * The reason a declaration is deliberately wired to nothing.
 *
 * `undefined` when there is no `@unwired` tag at all, `null` when the tag is
 * there with no reason — which is refused, because an exemption nobody can read
 * is the config-file list with extra steps.
 */
export function unwiredReason(text) {
  // The comment's own furniture first: `/**`, a trailing `*/`, the `*` down the
  // left margin and a `//` prefix. ⚠️ Without this the `*/` that closes a
  // one-line `@unwired` doc comment reads as the reason, and a tag with no
  // reason at all passes — which this suite has a case for.
  const stripped = text
    .replace(/\/\*+|\*+\//g, ' ')
    .replace(/^[ \t]*\*[ \t]?/gm, '')
    .replace(/^[ \t]*\/\/[ \t]?/gm, '');
  const match = /@unwired\b[ \t:]*(.*)/.exec(stripped);
  if (match === null) return undefined;
  const reason = match[1].trim();
  return reason.length < 3 || !/[a-zA-Z0-9]/.test(reason) ? null : reason;
}

function leadingCommentOf(source, node) {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [];
  return ranges.map((range) => source.text.slice(range.pos, range.end)).join('\n');
}

/** Whatever comment sits above the first statement — a file's own doc block. */
function fileCommentOf(source) {
  const first = source.statements[0];
  return first === undefined ? source.text : leadingCommentOf(source, first);
}

/**
 * Exported names declared in this file.
 *
 * A re-export (`export { x } from './x'`) is deliberately not one: it is not a
 * declaration, and reporting it would name a barrel where the fix is in the
 * file that declares the symbol.
 */
export function exportedDeclarations(source) {
  const found = [];
  const isExported = (node) =>
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true;
  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      found.push({ name: statement.name.text, node: statement, doc: statement });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          found.push({ name: declaration.name.text, node: declaration, doc: statement });
        }
      }
    }
  }
  return found;
}

/** Call-shaped members of every interface in a port file. */
export function portMethods(source) {
  const found = [];
  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;
    for (const member of statement.members) {
      if (member.name === undefined || !ts.isIdentifier(member.name)) continue;
      const callable =
        ts.isMethodSignature(member) ||
        (ts.isPropertySignature(member) &&
          member.type !== undefined &&
          ts.isFunctionTypeNode(member.type));
      if (!callable) continue;
      found.push({ owner: statement.name.text, name: member.name.text, node: member });
    }
  }
  return found;
}

const lineOf = (source, node) =>
  source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

// ------------------------------------------------------------------- the gate

/**
 * Everything wired to nothing, in the terms a fixer needs.
 *
 * An empty `problems` means every seam in the watched set is reachable from a
 * page the product actually loads.
 */
export function wiringProblems(root) {
  const packages = workspacePackages(root);
  const missing = missingPrefixes(root);
  if (missing.length > 0) {
    throw new Error(
      `watched directory missing: ${missing.join(', ')}. WATCHED_PREFIXES names it and nothing ` +
        'on disk does, so every rule below would pass over an empty population — the failure ' +
        'mode #142 shipped. Move the prefix with the directory.',
    );
  }
  const entries = entryPoints(root);
  if (entries.length === 0) {
    throw new Error(
      'no entry point: apps/*/index.html names no module script this could resolve. A ' +
        'reachability check with no root would pass vacuously, so it fails instead.',
    );
  }
  const watched = watchedFiles(root);
  if (watched.length === 0) {
    throw new Error(
      'nothing watched: the watched directories are present and hold no source file this ' +
        'reads, so a clean run would assert nothing at all.',
    );
  }
  const modules = productionModules(entries, packages);
  const sources = [...modules].sort().map((file) => parseFile(file));
  const reached = reachableNames(sources);
  const parsed = new Map(sources.map((source) => [source.fileName, source]));
  const problems = [];

  /**
   * True when a declaration says why it has no caller; a reasonless tag is a problem.
   *
   * ⚠️ **Every rule goes through this one function, and that is the point.**
   * `unwiredReason` returns `undefined` for no tag and `null` for a bare one, so
   * a branch testing only `=== undefined` reads a reasonless tag as *exempt*.
   * `WIRE001` did exactly that until #283's review, and it is the broadest
   * exemption of the three — a bare `@unwired` in a file's doc comment silenced
   * a whole module with no `WIRE000`. Three call sites, one decision.
   */
  const exempted = (comment, what, where) => {
    const reason = unwiredReason(comment);
    if (reason !== null) return reason !== undefined;
    problems.push(
      `WIRE000 ${where} — ${what} carries \`@unwired\` with no reason. ` +
        'Say what makes it deliberate: an exemption nobody can read is a list in a config ' +
        'file with extra steps.',
    );
    return true;
  };

  for (const file of watched) {
    const rel = slash(relative(root, file));
    const source = parsed.get(file);
    if (source === undefined) {
      const onDisk = parseFile(file);
      if (!exempted(fileCommentOf(onDisk), 'this file', rel)) {
        problems.push(
          `WIRE001 ${rel} — no module the client's entry point can reach imports this file. ` +
            'It is built, it may well be tested, and none of it ships.',
        );
      }
      continue;
    }
    for (const declaration of exportedDeclarations(source)) {
      if (reached.has(`value:${declaration.name}`)) continue;
      const at = `${rel}:${lineOf(source, declaration.doc)}`;
      if (exempted(leadingCommentOf(source, declaration.doc), `\`${declaration.name}\``, at)) {
        continue;
      }
      problems.push(
        `WIRE002 ${rel}:${lineOf(source, declaration.node)} — \`${declaration.name}\` is ` +
          'exported and no production declaration names it. Wire it up, or say at the ' +
          'declaration why nothing does: `@unwired <reason>`.',
      );
    }
    if (!WATCHED_SUFFIX.test(rel)) continue;
    for (const method of portMethods(source)) {
      if (reached.has(`member:${method.name}`)) continue;
      const at = `${rel}:${lineOf(source, method.node)}`;
      if (
        exempted(leadingCommentOf(source, method.node), `\`${method.owner}.${method.name}\``, at)
      ) {
        continue;
      }
      problems.push(
        `WIRE003 ${rel}:${lineOf(source, method.node)} — \`${method.owner}.${method.name}\` is ` +
          'declared on a port and nothing in production calls it. ⚠️ A call from a method ' +
          'that is itself never called does not count — that is #230 exactly. Wire it up, or ' +
          'say at the declaration why nothing does: `@unwired <reason>`.',
      );
    }
  }
  return { problems, modules: modules.size, watched: watched.length };
}

// ----------------------------------------------------------------------- main

// Compared through `realpathSync` for the reason check-a11y-suite.mjs records:
// every fixture tree this repository's suites build sits behind the `/var` →
// `/private/var` symlink on macOS, and the simpler predicates are false there —
// which would make this exit 0 having checked nothing.
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.filename === realpathSync(invoked)) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const root = resolve(flag('--root') ?? process.cwd());

  let result;
  try {
    result = wiringProblems(root);
  } catch (error) {
    console.error(`check-wiring: ${error.message}`);
    process.exit(1);
  }

  if (result.problems.length > 0) {
    console.error('check-wiring: something is built, tested, and wired to nothing.\n');
    for (const problem of result.problems) console.error(`  - ${problem}`);
    console.error('\nSee CLAUDE.md §4j and scripts/check-wiring.mjs §Limits.');
    process.exit(1);
  }
  // ⚠️ Both counts, and the watched one first. A success line naming only the
  // population it WALKED reads like coverage of the population it CHECKED, and
  // the two are different numbers: the watched set is the client's seams, not
  // every module the entry point reaches.
  console.log(
    'check-wiring: every watched seam is reachable from the client’s entry point ' +
      `(${String(result.watched)} watched files, ${String(result.modules)} production modules).`,
  );
}
