// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The gate.** No string in this client renders an absolute joint angle or
 * anything in the frontal plane — #388, #377's epic criterion, and ADR 0030
 * D-8's two machine-checkable rules, checked against the files on disk.
 *
 * Two suites, as in `units/no-inline-units.test.ts`, and for its reason: the
 * **scan** cases fix what {@link angleClaimsIn} counts, with fixtures, so the
 * whole-tree case cannot pass because the detector stopped detecting; the
 * **whole-tree** case is the gate itself.
 *
 * ⚠️ Test files are exempt, and that is not a hole: this file has to contain
 * the words it forbids in order to prove it forbids them. What ships is the
 * non-test source, and that is what is scanned.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { angleClaimsIn, EXEMPT, isExempt, textsIn } from './no-absolute-angles';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** The one file the walk leaves out: the rule itself. */
const RULE_MODULE = fileURLToPath(new URL('./no-absolute-angles.ts', import.meta.url));

function scannable(): readonly string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) {
        continue;
      }
      // The rule's own definition, which has to spell what it forbids.
      if (path === RULE_MODULE) {
        continue;
      }
      // Somebody else's API, declared; not text this client renders.
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
  it('catches an absolute angle in a string, a template and a JSX text node', () => {
    expect(angleClaimsIn('x.ts', "const s = 'Your knee angle is 142°';")).toHaveLength(1);
    expect(angleClaimsIn('x.ts', 'const s = `Knee ${String(k)}°`;')).toHaveLength(1);
    expect(angleClaimsIn('x.tsx', 'const e = <p>Knee: {k}°</p>;')).toHaveLength(1);
  });

  it('catches the sign written as an escape, because that is what renders', () => {
    expect(angleClaimsIn('x.ts', "const s = 'about 4\\u00b0';")).toHaveLength(1);
  });

  it('catches the word, singular or plural, in any case', () => {
    expect(angleClaimsIn('x.ts', "const s = 'Your knee bent 12 degrees';")).toHaveLength(1);
    expect(angleClaimsIn('x.tsx', 'const e = <span>Degrees</span>;')).toHaveLength(1);
  });

  it('catches a formatter asked to render one', () => {
    expect(
      angleClaimsIn('x.ts', "new Intl.NumberFormat('en', { style: 'unit', unit: 'degree' });"),
    ).toStrictEqual([expect.objectContaining({ rule: 'degree formatter', text: 'degree' })]);
  });

  it.each([
    'Your knees track inward',
    'knee tracking',
    'possible knee valgus',
    'a varus knee',
    'hip abduction',
    'adduction at the hip',
    'Your hip drops',
    'possible hip drop',
    'pelvic drop',
    'lateral sway',
    'swaying on the saddle',
    'rocking hips',
    'your hips rocking',
    'side-to-side movement',
    'side to side',
    'the frontal plane',
  ])('catches the frontal plane as a word: %s', (text) => {
    expect(angleClaimsIn('x.ts', `const s = ${JSON.stringify(text)};`)).toStrictEqual([
      expect.objectContaining({ rule: 'frontal plane' }),
    ]);
  });

  it('reports the line an editor would show', () => {
    const findings = angleClaimsIn('x.ts', ['const a = 1;', '', "const b = 'at 90°';"].join('\n'));
    expect(findings[0]?.line).toBe(3);
  });

  it('does not fire on an identifier, however it is spelled', () => {
    expect(
      angleClaimsIn('x.ts', 'const CAMERA_FIELD_OF_VIEW_DEGREES = 70; const fromDegrees = 1;'),
    ).toEqual([]);
  });

  it('does not fire on a comment, which this repository is full of', () => {
    expect(
      angleClaimsIn('x.ts', '// no knee valgus, no 142°, no degrees\n/* hip drop */ const a = 1;'),
    ).toEqual([]);
    expect(angleClaimsIn('x.tsx', 'const e = <p>{/* 142° */}fine</p>;')).toEqual([]);
  });

  it('does not fire on a temperature', () => {
    expect(angleClaimsIn('x.ts', "const unit = '°C';")).toEqual([]);
    expect(angleClaimsIn('x.ts', 'const s = `${String(t)} °F`;')).toEqual([]);
  });

  it('does not fire on words that merely contain a forbidden one', () => {
    expect(angleClaimsIn('x.ts', "const s = 'Swaziland, varuna, degreeless, frontally';")).toEqual(
      [],
    );
    expect(angleClaimsIn('x.ts', "const s = 'rockets and a swayback horse';")).toEqual([]);
  });

  it('does not read an import path as text', () => {
    expect(angleClaimsIn('x.ts', "import { a } from './frontal';")).toEqual([]);
  });

  it('reads every kind of string the parser has', () => {
    const texts = textsIn(
      'x.tsx',
      "const a = 'one'; const b = `two ${String(c)} three`; const d = <p>four</p>;",
    ).map((each) => each.text.trim());
    expect(texts).toEqual(['one', 'two ${…} three', 'four']);
  });
});

describe('no string in this client renders an absolute angle or the frontal plane (#388)', () => {
  it('finds files to scan at all, so a clean pass is not a vacuous one', () => {
    const files = scannable();
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((file) => file.endsWith('side-report-wording.ts'))).toBe(true);
    // Exactly one file is left out, and it is the rule's own definition.
    expect(files).not.toContain(RULE_MODULE);
  });

  it('has no findings', () => {
    const findings = scannable()
      .flatMap((file) => angleClaimsIn(relative(SOURCE_ROOT, file), readFileSync(file, 'utf8')))
      .filter((finding) => !isExempt(finding));
    expect(
      findings.map(
        (finding) => `${finding.file}:${String(finding.line)}  ${finding.rule}  ${finding.text}`,
      ),
    ).toEqual([]);
  });

  it('has no exemption that excuses nothing — a stale one fails, like LIC006', () => {
    const findings = scannable().flatMap((file) =>
      angleClaimsIn(relative(SOURCE_ROOT, file), readFileSync(file, 'utf8')),
    );
    for (const entry of EXEMPT) {
      expect(
        findings.some(
          (finding) => finding.file === entry.file && finding.text.includes(entry.text),
        ),
        `${entry.file}: ${entry.text}`,
      ).toBe(true);
    }
  });

  it('exempts nothing in the side camera, whose report is what this gate is for', () => {
    expect(EXEMPT.filter((entry) => entry.file.startsWith('camera/'))).toEqual([]);
    expect(EXEMPT.filter((entry) => entry.file.startsWith('detail/'))).toEqual([]);
  });
});
