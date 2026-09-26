// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Nothing on the side camera's report path can reach a trainer** — #388's
 * criterion: *"no trainer control point, no ERG target and no resistance
 * setpoint is reachable from anything on this path. A test asserts it."*
 *
 * The report is read off pictures, and a picture is attacker-influenceable: a
 * sign held up in front of the camera, a pattern on a jersey. CLAUDE.md §6
 * treats trainer control as a safety issue, so the path from a picture to a
 * sentence on a ride's page must not pass anything that can write to a
 * machine. `analysis-safety.test.ts` makes the same argument for #387's
 * answer; this is its twin for the report.
 *
 * Two holds:
 *
 * 1. **The module graph.** Walking every relative import from each module on
 *    the path, transitively, reaches no module through which a trainer is
 *    written — `ride/controller`, `ride/trainer`, `game/gradient`,
 *    `game/trainer-port`, anything under `workout/`, or `@onyourleft/sensors`.
 *    The keeper reads the ride controller's snapshot through an interface it
 *    declares itself for exactly this reason.
 * 2. **The page.** The section renders no control at all
 *    (`detail/SideCameraSection.test.tsx`), so there is nothing on it to press.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every module a side-camera report passes through, from pose numbers to the page. */
const REPORT_PATH = [
  'camera/side-report.ts',
  'camera/side-report-wording.ts',
  'camera/side-report-port.ts',
  'camera/side-report-keeper.ts',
  'detail/load.ts',
  'detail/SideCameraSection.tsx',
] as const;

/** The modules through which anything reaches a trainer's control point. */
const TRAINER_MODULE =
  /(?:^|\/)(?:ride\/(?:controller|trainer|RideSession)|game\/(?:gradient|trainer-port|GameView)|workout\/)|@onyourleft\/sensors/;

/** The relative imports of one module, resolved to files under `src`. */
function importsOf(path: string): { readonly local: string[]; readonly bare: string[] } {
  const code = stripComments(readFileSync(join(SOURCE_ROOT, path), 'utf8'));
  const specifiers = [...code.matchAll(/(?:from|import)\s+'([^']+)'/g)].map(
    (match) => match[1] ?? '',
  );
  const local: string[] = [];
  const bare: string[] = [];
  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) {
      bare.push(specifier);
      continue;
    }
    const base = resolve(dirname(join(SOURCE_ROOT, path)), specifier);
    const file = ['.ts', '.tsx', '/index.ts', '/index.tsx']
      .map((suffix) => `${base}${suffix}`)
      .find((candidate) => existsSync(candidate));
    if (file !== undefined) {
      local.push(relative(SOURCE_ROOT, file));
    }
  }
  return { local, bare };
}

/** Every module reachable from `roots`, and every bare specifier any of them imports. */
function closure(roots: readonly string[]): { modules: Set<string>; bare: Set<string> } {
  const modules = new Set<string>();
  const bare = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined || modules.has(next)) {
      continue;
    }
    modules.add(next);
    const found = importsOf(next);
    for (const specifier of found.bare) {
      bare.add(specifier);
    }
    queue.push(...found.local);
  }
  return { modules, bare };
}

describe('the report path reaches no trainer (#388, CLAUDE.md §6)', () => {
  it('has the modules it names, so the walk is not over nothing', () => {
    for (const path of REPORT_PATH) {
      expect(existsSync(join(SOURCE_ROOT, path)), path).toBe(true);
    }
    // The walk follows imports: the section reaches the wording file.
    expect(closure(['detail/SideCameraSection.tsx']).modules).toContain(
      'camera/side-report-wording.ts',
    );
  });

  it('imports, directly or through anything it imports, no module that writes to a trainer', () => {
    const { modules, bare } = closure(REPORT_PATH);
    const reaching = [...modules, ...bare].filter((path) =>
      TRAINER_MODULE.test(path.replace(/\.tsx?$/, '')),
    );
    expect(reaching).toStrictEqual([]);
  });

  it('would notice a module on the path that did', () => {
    // The pattern is the rule; a pattern that matched nothing would pass above.
    for (const specifier of [
      'ride/controller',
      'ride/trainer',
      'game/gradient',
      'game/trainer-port',
      'workout/session',
      '@onyourleft/sensors/protocol',
    ]) {
      expect(TRAINER_MODULE.test(specifier), specifier).toBe(true);
    }
  });

  it('would notice it through an import two steps away, not only a direct one', () => {
    // `side-analysis.ts` is NOT on the path — it holds pictures — and it
    // reaches the link, which is how a walk proves it goes past one level.
    expect(closure(['camera/side-analysis.ts']).modules.size).toBeGreaterThan(3);
  });
});
