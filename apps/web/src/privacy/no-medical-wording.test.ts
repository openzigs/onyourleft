// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The gate.** No string this client could show a rider carries one of ADR
 * 0048 D-12's banned words — #1245, the owner's Q12 on #1233, checked against
 * the files on disk.
 *
 * Two suites, as in `camera/no-absolute-angles.test.ts`, and for its reason:
 * the **scan** cases fix what {@link medicalWordingIn} counts, with fixtures,
 * so the whole-tree case cannot pass because the detector stopped detecting;
 * the **whole-tree** case is the gate itself.
 *
 * ⚠️ Test files are exempt, and that is not a hole: this file has to contain
 * the words it forbids in order to prove it forbids them. What ships is the
 * non-test source, and that is what is scanned.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  type BannedWord,
  BANNED_WORDS,
  bannedWordIn,
  EXEMPT,
  isExempt,
  type MedicalWordingFinding,
  medicalWordingIn,
} from './no-medical-wording';

const SOURCE_ROOT = fileURLToPath(new URL('..', import.meta.url));
/**
 * `@onyourleft/domain`'s `src`: a workout's own sentences and refusals, which
 * this client renders. `@onyourleft/analysis` is not walked: what it holds is
 * what a model is told, which uses one of these words to forbid it
 * (`no-medical-wording.ts` §"What it cannot see").
 */
const DOMAIN_SOURCE_ROOT = fileURLToPath(
  new URL('../../../../packages/domain/src/', import.meta.url),
);
/** Every tree the scan walks. A finding's file is named relative to `apps/web/src`. */
const SCAN_ROOTS = [SOURCE_ROOT, DOMAIN_SOURCE_ROOT] as const;
/** The one file the walk leaves out: the rule itself, which has to spell what it forbids. */
const RULE_MODULE = fileURLToPath(new URL('./no-medical-wording.ts', import.meta.url));

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
      // Somebody else's API, declared; not text this client renders.
      if (path === RULE_MODULE || entry.name.endsWith('.d.ts')) {
        continue;
      }
      found.push(path);
    }
  };
  for (const root of SCAN_ROOTS) {
    walk(root);
  }
  return found;
}

/**
 * The control (#1245): one sentence for each banned word, as a rider could be
 * shown it. Every case below reads this list, so a word added to
 * {@link BANNED_WORDS} with no sentence here fails the first case.
 */
const CONTROL: Readonly<Record<BannedWord, string>> = {
  cardiac: 'Lowered for cardiac drift',
  'heart condition': 'Not for a heart condition',
  rehabilitation: 'A rehabilitation ride',
  patient: 'Each patient chooses a range',
  therapy: 'Ride as therapy',
  'safe heart rate': 'Your safe heart rate',
  'protects your heart': 'The hold protects your heart',
  medical: 'A medical opinion',
  clinical: 'A clinical range',
};

const words = BANNED_WORDS.map(({ word }) => word);
const controls = words.map((word) => [word, CONTROL[word]] as const);

describe('the scan itself can fire', () => {
  it('has a control sentence for every banned word, and the list is D-12’s nine', () => {
    expect(words).toStrictEqual([
      'cardiac',
      'heart condition',
      'rehabilitation',
      'patient',
      'therapy',
      'safe heart rate',
      'protects your heart',
      'medical',
      'clinical',
    ]);
    expect(Object.keys(CONTROL).sort()).toStrictEqual([...words].sort());
  });

  it.each(controls)('goes red on %s in a string, a template and JSX text', (word, sentence) => {
    for (const [file, source] of [
      ['x.ts', `const s = ${JSON.stringify(sentence)};`],
      ['x.ts', `const s = \`\${String(n)} ${sentence}\`;`],
      ['x.tsx', `const e = <p>${sentence}</p>;`],
      ['x.tsx', `const e = <img alt="${sentence}" />;`],
    ] as const) {
      expect(medicalWordingIn(file, source), source).toStrictEqual([
        expect.objectContaining({ file, line: 1, word }),
      ]);
    }
  });

  it.each(controls)('goes red on %s in any case', (word, sentence) => {
    expect(bannedWordIn(sentence.toUpperCase())).toBe(word);
    expect(bannedWordIn(sentence.toLowerCase())).toBe(word);
  });

  it.each(controls)(
    'goes red on %s with an invisible character inside each of its words',
    (word, sentence) => {
      // A soft hyphen, then a zero-width space, after the second letter of every word.
      for (const invisible of ['­', '​', '⁠']) {
        const split = sentence.replaceAll(/\b(\w{2})(\w)/g, `$1${invisible}$2`);
        expect(split).not.toBe(sentence);
        expect(bannedWordIn(split), JSON.stringify(split)).toBe(word);
      }
    },
  );

  it.each(controls)('goes red on %s split across JSX elements', (word, sentence) => {
    // Every word's first two letters outside a <b>, the rest inside it.
    const split = sentence.replaceAll(/\b(\w{2})(\w+)/g, '$1<b>$2</b>');
    const findings = medicalWordingIn('x.tsx', `const e = <p>${split}</p>;`);
    expect(findings).toStrictEqual([expect.objectContaining({ word, text: sentence })]);
  });

  it('reads JSX as it renders: a reference, a line break, and a phrase across lines', () => {
    expect(medicalWordingIn('x.tsx', 'const e = <p>car&shy;diac</p>;')).toHaveLength(1);
    expect(medicalWordingIn('x.tsx', 'const e = <p>&#99;ardiac</p>;')).toHaveLength(1);
    expect(medicalWordingIn('x.tsx', 'const e = <p>heart&nbsp;condition</p>;')).toHaveLength(1);
    expect(
      medicalWordingIn('x.tsx', 'const e = (\n  <p>\n    your safe\n    heart rate\n  </p>\n);'),
    ).toStrictEqual([
      expect.objectContaining({ word: 'safe heart rate', text: 'your safe heart rate' }),
    ]);
    expect(medicalWordingIn('x.tsx', 'const e = <p>heart<br />condition</p>;')).toHaveLength(1);
  });

  it.each([
    ["const s = 'your safe ' + 'heart rate';", 'safe heart rate'],
    ["const s = 'Not for a heart ' + 'condition.';", 'heart condition'],
    ["const s = 'The hold protects ' + 'your heart.';", 'protects your heart'],
    ["const s = 'a ' + 'car' + 'diac';", 'cardiac'],
  ] as const)('reads a sentence wrapped across a + chain: %s', (source, word) => {
    expect(medicalWordingIn('x.ts', source)).toStrictEqual([expect.objectContaining({ word })]);
  });

  it('does not fold a + chain that holds a value', () => {
    expect(medicalWordingIn('x.ts', "const s = 'safe heart ' + n + ' rate';")).toStrictEqual([]);
  });

  it('reads a phrase parted by a hyphen, a line break or a non-breaking space', () => {
    expect(bannedWordIn('a heart-condition')).toBe('heart condition');
    expect(bannedWordIn('safe\nheart rate')).toBe('safe heart rate');
    expect(bannedWordIn('it protects your heart')).toBe('protects your heart');
  });

  it.each([
    ['rehab', 'rehabilitation'],
    ['rehabilitate', 'rehabilitation'],
    ['patients', 'patient'],
    ['therapies', 'therapy'],
    ['therapeutic', 'therapy'],
    ['a therapist', 'therapy'],
    ['heart conditions', 'heart condition'],
    ['safe heart rates', 'safe heart rate'],
    ['protect your heart', 'protects your heart'],
    ['protecting your heart', 'protects your heart'],
    ['medically', 'medical'],
    ['clinically', 'clinical'],
  ] as const)('reads %s as %s', (text, word) => {
    expect(bannedWordIn(text)).toBe(word);
  });

  it.each([
    'Target lowered to keep your heart rate in the range you chose.',
    'It is your choice, not a health limit.',
    'impatient, patiently, outpatients-free',
    'a safe place to stop',
    'your heart rate',
    'a condition of the road',
    'paramedical, biomedicalise',
    'rehabit, prehab',
  ])('does not fire on a sentence without one: %s', (text) => {
    expect(bannedWordIn(text)).toBeUndefined();
    expect(medicalWordingIn('x.ts', `const s = ${JSON.stringify(text)};`)).toEqual([]);
  });

  it('does not fire on an identifier, a comment or an import path', () => {
    expect(
      medicalWordingIn(
        'x.tsx',
        [
          "import { a } from './no-medical-wording';",
          '// never cardiac, never a patient',
          'const medicalClinicalTherapy = 1; /* rehabilitation */',
          'const e = <p>{/* a heart condition */}fine</p>;',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('reports the line an editor would show, and one finding for one sentence', () => {
    const findings = medicalWordingIn(
      'x.ts',
      ['const a = 1;', '', "const b = 'a medical and clinical opinion';"].join('\n'),
    );
    expect(findings).toStrictEqual([
      { file: 'x.ts', line: 3, text: 'a medical and clinical opinion', word: 'medical' },
    ]);
  });

  it('excuses only the same file and the same whole text, never a text that contains it', () => {
    const [entry] = EXEMPT;
    expect(EXEMPT).toHaveLength(1);
    if (entry === undefined) {
      return;
    }
    const exact = { file: entry.file, line: 1, text: entry.text, word: 'medical' } as const;
    expect(isExempt(exact)).toBe(true);
    expect(isExempt({ ...exact, text: `${entry.text} Ask a medical professional.` })).toBe(false);
    expect(isExempt({ ...exact, text: `${entry.text} ` })).toBe(false);
    expect(isExempt({ ...exact, file: 'workout/hold-text.ts' })).toBe(false);
  });

  it('exempts nothing about a workout, which is what this gate is for', () => {
    expect(
      EXEMPT.filter((entry) => /^(workout|workouts|workout-goals|ride)\//.test(entry.file)),
    ).toEqual([]);
  });
});

/** Every finding in the tree, exemptions not applied — computed once for the cases that read it. */
let treeFindings: readonly MedicalWordingFinding[] | undefined;
function everyFinding(): readonly MedicalWordingFinding[] {
  treeFindings ??= scannable().flatMap((file) =>
    medicalWordingIn(relative(SOURCE_ROOT, file), readFileSync(file, 'utf8')),
  );
  return treeFindings;
}

/** A bound for the tree walk, as `no-absolute-angles.test.ts` sets it: room for a busy runner. */
const TREE_WALK_TIMEOUT_MILLISECONDS = 30_000;

describe('no string in this client carries a word ADR 0048 D-12 bans (#1245)', () => {
  it('finds files to scan at all, so a clean pass is not a vacuous one', () => {
    const files = scannable();
    expect(files.length).toBeGreaterThan(200);
    // The modules that hold a workout's sentences, in each tree.
    for (const held of [
      join(SOURCE_ROOT, 'workout', 'hold-text.ts'),
      join(SOURCE_ROOT, 'workout', 'replan-disclosure.ts'),
      join(SOURCE_ROOT, 'workout-goals', 'wording.ts'),
      join(SOURCE_ROOT, 'views', 'RideView.tsx'),
      join(DOMAIN_SOURCE_ROOT, 'workout', 'goals.ts'),
    ]) {
      expect(files, held).toContain(held);
    }
    // Exactly one file is left out, and it is the rule's own definition.
    expect(files).not.toContain(RULE_MODULE);
  });

  it(
    'has no findings',
    () => {
      const findings = everyFinding().filter((finding) => !isExempt(finding));
      expect(
        findings.map(
          (finding) => `${finding.file}:${String(finding.line)}  ${finding.word}  ${finding.text}`,
        ),
      ).toEqual([]);
    },
    TREE_WALK_TIMEOUT_MILLISECONDS,
  );

  it(
    'has no exemption that excuses nothing — a stale one fails, like LIC006',
    () => {
      const findings = everyFinding();
      for (const entry of EXEMPT) {
        expect(
          findings.some((finding) => finding.file === entry.file && finding.text === entry.text),
          `${entry.file}: ${entry.text}`,
        ).toBe(true);
      }
    },
    TREE_WALK_TIMEOUT_MILLISECONDS,
  );

  it.each(controls)(
    'goes red on %s planted in the module that holds the hold’s sentences',
    (word, sentence) => {
      const target = join(SOURCE_ROOT, 'workout', 'hold-text.ts');
      const source = readFileSync(target, 'utf8');
      const planted = `${source}\nexport const PLANTED = ${JSON.stringify(sentence)};\n`;
      expect(medicalWordingIn('workout/hold-text.ts', source)).toEqual([]);
      expect(medicalWordingIn('workout/hold-text.ts', planted)).toStrictEqual([
        expect.objectContaining({ word, text: sentence }),
      ]);
    },
  );
});
