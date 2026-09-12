// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The gate.** No file in this client outside `src/units/` writes a unit
 * label by hand — #238's fifth acceptance criterion, checked against the files
 * on disk rather than left to review.
 *
 * Two suites here and they do different jobs, which is worth stating because
 * they look alike:
 *
 * - The **scan** cases fix what {@link inlineUnitsIn} counts as a violation,
 *   using fixtures rather than the real tree. Without them the whole-tree case
 *   below could pass because the detector had stopped detecting — the "rule
 *   that cannot fire" shape this repository has shipped several times.
 * - The **whole-tree** case is the gate itself.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { inlineUnitsIn, stripComments } from './no-inline-units';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * The one directory allowed to name a unit, and the test files.
 *
 * ⚠️ **Test files are exempt and that is not a hole.** A test asserting that
 * an imperial rider sees `mph` has to contain the string `mph` — that is the
 * assertion. What ships is the non-test source, and that is what is scanned.
 */
function scannable(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'units') {
          walk(path);
        }
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        continue;
      }
      // `.d.ts` files declare somebody else's API — `fit-file-parser.d.ts`
      // names `'km'` and `'mi'` because that library's options are spelled
      // that way, and rewriting a third-party declaration is not a thing this
      // rule may ask for.
      if (entry.name.endsWith('.d.ts')) {
        continue;
      }
      found.push(path);
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

describe('the scan itself can fire', () => {
  it('catches a quoted unit constant — the SPEED_UNIT shape', () => {
    expect(inlineUnitsIn('x.ts', "export const SPEED_UNIT = 'km/h';")).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', 'const u = "mi";')).toHaveLength(1);
  });

  it('catches a unit after an interpolation — the fields.ts shape', () => {
    expect(inlineUnitsIn('x.ts', 'return `${String(x)} km`;')).toHaveLength(1);
    expect(inlineUnitsIn('x.tsx', '<td>{Math.round(v)} m</td>')).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', "reading('speed', 'Speed', v, 'km/h', true, 1)")).toHaveLength(1);
  });

  it('catches a unit that is a JSX text node of its own', () => {
    // Neither QUOTED nor AFTER_INTERPOLATION can see this: there is no quote
    // and no `}` before the label. A review found it missing.
    expect(inlineUnitsIn('x.tsx', '<span className="u">km</span>')).toHaveLength(1);
    expect(inlineUnitsIn('x.tsx', '<span>{v}</span><span>mph</span>')).toHaveLength(1);
    expect(inlineUnitsIn('x.tsx', '<abbr title="feet">ft</abbr>')).toHaveLength(1);
  });

  it('catches the inline metres-per-second conversion', () => {
    expect(inlineUnitsIn('x.ts', 'const kmh = speed * 3.6;')).toHaveLength(1);
  });

  it('catches every imperial conversion factor, not only the metric one', () => {
    // ⚠️ The gap a review found. `3.6` is the factor `fields.ts` happened to
    // carry; a *new* screen reaching for miles reaches for one of these, and
    // with only `3.6` named it walked straight past the rule built to stop it.
    expect(inlineUnitsIn('x.ts', 'const mph = speed * 2.2369362920544;')).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', 'const mph = speed * 2.23694;')).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', 'const mi = metres / 1609.344;')).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', 'const mi = km / 1.609344;')).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', 'const mi = km * 0.621371;')).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', 'const ft = metres / 0.3048;')).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', 'const ft = metres * 3.28084;')).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', 'const ms = mph * 0.44704;')).toHaveLength(1);
    expect(inlineUnitsIn('x.ts', 'const feet = miles * 5280;')).toHaveLength(1);
  });

  it('does not fire on a bare division by a thousand, which is milliseconds here', () => {
    // ⚠️ Deliberate, and stated in the module note: thirteen non-test files in
    // this client divide by a thousand for milliseconds and none of them is a
    // unit conversion. A rule that fires thirteen times on arrival gets an
    // exemption list rather than obedience.
    expect(inlineUnitsIn('x.ts', 'const seconds = Date.now() / 1000;')).toEqual([]);
  });

  it('reports the line number an editor would show', () => {
    const findings = inlineUnitsIn('x.ts', ['const a = 1;', '', "const b = 'mph';"].join('\n'));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(3);
  });

  it('does not fire on prose in a comment, which this repository is full of', () => {
    expect(inlineUnitsIn('x.ts', '// 0.5 m/s is 1.8 km/h — slower than a walk.')).toEqual([]);
    expect(inlineUnitsIn('x.ts', '/*\n * A 200 km route at the 10 m grid.\n */')).toEqual([]);
    expect(inlineUnitsIn('x.tsx', '{/* nothing here is 3.6 km */}')).toEqual([]);
  });

  it('does not fire on a word that merely starts with a unit', () => {
    // `min`, `mid`, `format`, `kmeans`. A unit is a whole word.
    expect(inlineUnitsIn('x.ts', 'return `${name} — ${String(n)} min`;')).toEqual([]);
    expect(inlineUnitsIn('x.ts', 'const label = `${x} mixed`;')).toEqual([]);
  });

  it('does not fire on a number that merely contains 3.6', () => {
    expect(inlineUnitsIn('x.ts', 'const n = 13.62;')).toEqual([]);
    expect(inlineUnitsIn('x.ts', 'const n = 3.65;')).toEqual([]);
  });

  it('keeps line numbers across a stripped block comment', () => {
    const source = ['/*', ' * prose', ' */', "const b = 'mph';"].join('\n');
    expect(inlineUnitsIn('x.ts', source)[0]?.line).toBe(4);
  });
});

describe('stripComments', () => {
  it('leaves a string containing a slash-slash alone', () => {
    expect(stripComments('const u = "https://example.test";')).toBe(
      'const u = "https://example.test";',
    );
  });

  it('does not treat an apostrophe inside a comment as opening a string', () => {
    // If it did, everything after it would be read as string content and the
    // scan would go quiet for the rest of the file — a rule that cannot fire.
    expect(stripComments("// a rider's comment\nconst u = 'km';")).toBe("\nconst u = 'km';");
  });

  it('keeps an escaped quote inside a string', () => {
    expect(stripComments("const u = 'it\\'s';")).toBe("const u = 'it\\'s';");
  });
});

describe('no file outside src/units writes a unit label by hand (#238)', () => {
  it('finds files to scan at all, so a clean pass is not a vacuous one', () => {
    // The classic vacuous pass: a walker that returned nothing would make the
    // case below green forever.
    const files = scannable();
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((file) => file.endsWith('fields.ts'))).toBe(true);
  });

  it('has no findings', () => {
    const findings = scannable().flatMap((file) =>
      inlineUnitsIn(relative(SOURCE_ROOT, file), readFileSync(file, 'utf8')),
    );

    expect(
      findings.map((finding) => `${finding.file}:${String(finding.line)}  ${finding.text}`),
    ).toEqual([]);
  });
});
