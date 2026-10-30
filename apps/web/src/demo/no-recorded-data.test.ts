// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1646: `src/demo/` reaches no recorded data — not the store, not the FIT
 * codec, not the live ride, not any activity or ghost module.
 *
 * ADR 0007 D4 puts a bot outside the cited claims because "there is no
 * recorded ride behind it". A demo rider is authored (`script.ts`), and this
 * makes sure no module that could hand it a recording is even imported.
 *
 * Two walks, because they catch different things. Every import in every file
 * under `src/demo/`, type-only included, is checked directly. Then every
 * **runtime** relative import is followed through the rest of `src/`, because a
 * demo module that imported a game module that imported the store would carry
 * the store into the demo bundle. Type-only imports are erased at build time
 * and carry no data, so the transitive walk does not follow them: it would
 * otherwise reach `@onyourleft/store` through `game/bicycle.ts`'s `KitColour`,
 * a five-colour string union.
 *
 * ⚠️ What this cannot see: a module that reaches recorded data without
 * importing it — through a global, say. `src/demo/` names no platform object,
 * and the presets are walked key by key in `script.test.ts`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DEMO = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(DEMO, '..');

/**
 * A module specifier, or a path under `src/`, that a demo module may not reach.
 * #1652: nor `world-data/corridor-port.ts`, which keeps a rider's corridor in
 * IndexedDB and reads their privacy zones — the demo's map data is read into
 * memory (`baked-route.ts`) and stays there.
 */
function forbidden(target: string): boolean {
  return (
    /^@onyourleft\/(store|fit)(\/|$)/.test(target) ||
    /^world-data\/corridor-port(\.ts)?$/.test(target) ||
    /^ride\//.test(target) ||
    /ghost/i.test(target) ||
    /activit/i.test(target)
  );
}

interface Import {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

/** Every static and dynamic import in a source file. */
function importsOf(file: string): Import[] {
  const text = readFileSync(file, 'utf8');
  const found: Import[] = [];
  for (const match of text.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?from\s+'([^']+)'/gms)) {
    found.push({ specifier: match[3] ?? '', typeOnly: match[2] !== undefined });
  }
  for (const match of text.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g)) {
    found.push({ specifier: match[1] ?? '', typeOnly: false });
  }
  for (const match of text.matchAll(/^\s*import\s+'([^']+)'/gm)) {
    found.push({ specifier: match[1] ?? '', typeOnly: false });
  }
  return found;
}

/**
 * A relative specifier resolved to a file under `src/`, or `undefined` for a
 * package or for an asset Vite hands over as a URL (`./models/colormap.png?url`,
 * reached since #1647 through the game's scenery), which holds no code.
 */
function resolveRelative(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  if (/\?url$/.test(specifier)) return undefined;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this one
    }
  }
  throw new Error(`cannot resolve ${specifier} from ${relative(SOURCE, from)}`);
}

/** The name a target is checked under: a package specifier, or a path relative to `src/`. */
function nameOf(from: string, specifier: string): string {
  const file = resolveRelative(from, specifier);
  return file === undefined ? specifier : relative(SOURCE, file);
}

const DEMO_FILES = readdirSync(DEMO)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => join(DEMO, name));

describe('src/demo/ imports no recorded data', () => {
  it('has files to check', () => {
    expect(DEMO_FILES.map((file) => relative(DEMO, file))).toContain('runner.ts');
  });

  it.each(DEMO_FILES.map((file) => [relative(DEMO, file), file] as const))(
    '%s imports nothing from the store, the FIT codec, ride/, corridor-port.ts or an activity or ghost module',
    (_name, file) => {
      const reached = importsOf(file).map((each) => nameOf(file, each.specifier));
      expect(reached.filter(forbidden)).toEqual([]);
    },
  );

  it('reaches none of them through a runtime import, at any depth', () => {
    const seen = new Set<string>();
    const reached: string[] = [];
    const queue = DEMO_FILES.filter((file) => !file.endsWith('.test.ts'));
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      if (seen.has(file)) continue;
      seen.add(file);
      for (const each of importsOf(file)) {
        if (each.typeOnly) continue;
        reached.push(nameOf(file, each.specifier));
        const next = resolveRelative(file, each.specifier);
        if (next !== undefined) queue.push(next);
      }
    }
    expect(reached).toContain('@onyourleft/physics');
    expect(reached.filter(forbidden)).toEqual([]);
  });

  it('would catch each forbidden import', () => {
    // The predicate is the whole test, so it is pinned in both directions.
    for (const target of [
      '@onyourleft/store',
      '@onyourleft/store/testing',
      '@onyourleft/fit',
      'ride/controller.ts',
      'game/ghost-source.ts',
      'transfer/export-activity.ts',
      'world-data/corridor-port.ts',
    ]) {
      expect(forbidden(target), target).toBe(true);
    }
    for (const target of [
      '@onyourleft/domain',
      '@onyourleft/physics',
      'game/sensors.ts',
      'game/world-data/corridor.ts',
      'world-data/corridor-port.test.ts',
    ]) {
      expect(forbidden(target), target).toBe(false);
    }
  });
});
