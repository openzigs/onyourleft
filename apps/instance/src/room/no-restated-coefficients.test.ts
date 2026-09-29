// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The room simulates with `@onyourleft/physics`' coefficient set and never a
 * copy of it — #779's second criterion, ADR 0028 D-1's "one physics".
 *
 * The drag areas, the rolling resistance and the bicycle's mass live in
 * `packages/physics/src/riding.ts` (#487, #779). A room that restated one
 * would ride a second set that can drift from the game's, and nothing else
 * would notice: both would still be plausible numbers. So this reads every
 * source file under `apps/instance` for the numbers and the names.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RIDING_POSITION_DRAG_AREAS,
  ROAD_ROLLING_RESISTANCE_COEFFICIENT,
} from '@onyourleft/physics';

const ROOT = join(import.meta.dirname, '..', '..');
const THIS_FILE = relative(ROOT, import.meta.filename);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(path);
    return /\.(ts|mjs|js|json)$/.test(entry.name) ? [path] : [];
  });
}

/** A number as it would be written, not as part of a longer one. */
function literal(value: number): RegExp {
  return new RegExp(`(?<![\\d.])${String(value).replace('.', '\\.')}(?!\\d)`);
}

describe('the room restates no coefficient — #779', () => {
  const files = sources(ROOT).filter((path) => relative(ROOT, path) !== THIS_FILE);

  it('reads the files it claims to', () => {
    expect(files.some((path) => path.endsWith(join('room', 'core', 'room.ts')))).toBe(true);
  });

  const NUMBERS = [
    ...Object.values(RIDING_POSITION_DRAG_AREAS),
    ROAD_ROLLING_RESISTANCE_COEFFICIENT,
  ];
  const NAMES = [/\bRIDING_POSITIONS\b/, /\bGAME_ROLLING_RESISTANCE_COEFFICIENT\b/];

  it('writes none of the drag areas or the rolling resistance as a literal, anywhere in apps/instance', () => {
    const found = files.flatMap((path) =>
      NUMBERS.filter((n) => literal(n).test(readFileSync(path, 'utf8'))).map(
        (n) => `${relative(ROOT, path)}: ${String(n)}`,
      ),
    );
    expect(found).toEqual([]);
  });

  it('names neither of the game’s own constants', () => {
    const found = files.filter((path) =>
      NAMES.some((name) => name.test(readFileSync(path, 'utf8'))),
    );
    expect(found.map((path) => relative(ROOT, path))).toEqual([]);
  });

  it('would catch one: the pattern matches a restated area and not a longer number', () => {
    expect(literal(0.36).test('const hoods = 0.36;')).toBe(true);
    expect(literal(0.36).test('const x = 10.365;')).toBe(false);
    expect(literal(ROAD_ROLLING_RESISTANCE_COEFFICIENT).test('crr: 0.005,')).toBe(true);
  });
});
