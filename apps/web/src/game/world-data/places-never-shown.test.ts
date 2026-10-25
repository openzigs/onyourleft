// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A corridor's place points are read by `urban-class.ts` alone** — #1632,
 * ADR 0055 D-5.4 and D-5.5.
 *
 * A place point says what kind of settlement stands near the route and how
 * big. ADR 0055 lets it be a prior in `urban-class.ts` and nothing else: no
 * label, HUD line, toast, credit or log may name its kind, detail or rank. So
 * this walks every shipped module under `apps/web/src` for a read of a
 * `places` property, and admits two: `world-data/corridor.ts`, which reads,
 * packs and hands them over, and `urban-class.ts`, the prior.
 * `apps/web/browser/` is not walked: it is the browser gate's harness, which
 * counts the places a read kept and ships to no rider.
 *
 * A source scan, not a proof: a module could destructure the field under
 * another name. It holds the line where the field is named, as
 * `privacy/world-corridor-never-sent.test.ts` does for the store.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WEB_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TREES = [join(WEB_ROOT, 'src')] as const;

/** The modules that may read a corridor's places. */
const ADMITTED = ['src/game/urban-class.ts', 'src/game/world-data/corridor.ts'];

/** A read of a `places` property that is not a call: `vegetation.places()` is another thing. */
const READS_PLACES = /\.places\b(?!\s*\()|\{[^}]*\bplaces\b[^}]*\}\s*=/;

/** Shipped source: a test, a test-support module and build output are not shown to a rider. */
function shipped(root: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', 'testing'].includes(entry.name)) found.push(...shipped(path));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$|\.spec\.ts$|-testing\.ts$/.test(entry.name)
    ) {
      found.push(path);
    }
  }
  return found;
}

describe('place points are read by the urban class alone — #1632, ADR 0055 D-5.4', () => {
  it('reads the trees at all, and finds a planted read', () => {
    expect(TREES.flatMap(shipped).length).toBeGreaterThan(100);
    expect(READS_PLACES.test('hud.text = corridor.places[0].kindDetail;')).toBe(true);
    expect(READS_PLACES.test('const { places } = corridor;')).toBe(true);
    expect(READS_PLACES.test('return this.vegetation.places() ?? [];')).toBe(false);
  });

  it('finds a read only in the two modules admitted', () => {
    const readers = TREES.flatMap(shipped)
      .filter((file) => READS_PLACES.test(readFileSync(file, 'utf8')))
      .map((file) => relative(WEB_ROOT, file).split('\\').join('/'))
      .sort();
    expect(readers).toStrictEqual(ADMITTED);
  });
});
