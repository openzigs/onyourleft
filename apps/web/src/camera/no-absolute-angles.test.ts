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

import {
  type AngleClaimFinding,
  angleClaimsIn,
  decodeCharacterReferences,
  EXEMPT,
  isExempt,
  jsxElementTextsIn,
  textsIn,
} from './no-absolute-angles';

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

  // #561's review, the blocking finding: the parser hands JSX text back with
  // its character references undecoded, so each of these used to pass.
  it.each([
    '<p>Knee 142&deg;</p>',
    '<p>Knee 142&DEG;</p>',
    '<p>Knee 142&#176;</p>',
    '<p>Knee 142&#0176;</p>',
    '<p>Knee 142&#xb0;</p>',
    '<p>Knee 142&#x00B0;</p>',
    '<p>Knee 142&#XB0;</p>',
    '<p>Knee 142&ordm;</p>',
    '<p>Knee 142&#730;</p>',
  ])('catches a character reference in JSX text: %s', (jsx) => {
    expect(angleClaimsIn('x.tsx', `const e = ${jsx};`)).toStrictEqual([
      expect.objectContaining({ rule: 'degree sign' }),
    ]);
  });

  it.each([
    '<img alt="Knee 142&deg;" />',
    '<abbr title="142&#176;">x</abbr>',
    '<span aria-label="Knee 142&#x00b0;" />',
  ])('catches a character reference in a JSX attribute: %s', (jsx) => {
    expect(angleClaimsIn('x.tsx', `const e = ${jsx};`)).toStrictEqual([
      expect.objectContaining({ rule: 'degree sign' }),
    ]);
  });

  it('catches the frontal plane spelled with a character reference in JSX', () => {
    expect(angleClaimsIn('x.tsx', 'const e = <p>possible hip&nbsp;drop</p>;')).toStrictEqual([
      expect.objectContaining({ rule: 'frontal plane' }),
    ]);
  });

  it('decodes every form of reference, and leaves what it cannot decode', () => {
    expect(decodeCharacterReferences('&deg;&Deg;&#176;&#0176;&#xb0;&#X00B0;')).toBe('°°°°°°');
    expect(decodeCharacterReferences('&ordm; &#730;')).toBe('º ˚');
    expect(decodeCharacterReferences('&unknownthing; &#xzz; plain')).toBe(
      '&unknownthing; &#xzz; plain',
    );
  });

  it.each([
    "'Knee 142º'",
    "'Knee 142˚'",
    "'Knee 142\\u00ba'",
    "'Knee 142 deg'",
    "'knee 142deg'",
    "'KNEE 142 DEG'",
  ])('catches a look-alike of the degree sign, and the abbreviation: %s', (literal) => {
    expect(angleClaimsIn('x.ts', `const s = ${literal};`)).toStrictEqual([
      expect.objectContaining({ rule: 'degree sign' }),
    ]);
  });

  it('does not read "deg" inside a word, or with no number before it, as the abbreviation', () => {
    expect(angleClaimsIn('x.ts', "const s = 'a degu, legs, deg';")).toEqual([]);
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
    // ADR 0030 D-4's own terms, which #561's review found missing.
    'Your foot eversion was possibly larger',
    'possible eversion at the ankle',
    'foot inversion',
    'your foot everted',
    'your feet inverted',
    'shoulder levelness',
    'Your shoulders were possibly less level',
    'your shoulder was not level',
    'level shoulders',
    'uneven shoulders',
    'a pelvic tilt',
    'your hips tilting',
    'lateral movement of the knee',
    'a lateral shift',
    // #564: the narrowed patterns still catch the body.
    'inversion of the foot',
    'inversion at the ankle',
    'ankle inversion',
    'their shoulders were less level',
    'the rider’s shoulder was level',
    'lateral shift of the hips',
    'lateral movement of the bike',
    // #587's review: a body's shoulder needs no possessive, and a bare
    // "frame" in a cycling app is the bicycle's.
    'Shoulders stayed level',
    'The shoulders were less level',
    'the shoulders were less level',
    'shoulders were level on the climb',
    'lateral movement of the frame',
    'lateral movement of the bike frame',
    'a lateral shift of your frame',
  ])('catches the frontal plane as a word: %s', (text) => {
    expect(angleClaimsIn('x.ts', `const s = ${JSON.stringify(text)};`)).toStrictEqual([
      expect.objectContaining({ rule: 'frontal plane' }),
    ]);
  });

  // #564: an invisible character splits a word for the regex and for nobody
  // reading it. Each of these renders as the banned word.
  it.each([
    ["'knee val\\u00adgus'", 'soft hyphen'],
    ["'knee val\\u200bgus'", 'zero-width space'],
    ["'knee val\\u200cgus'", 'zero-width non-joiner'],
    ["'knee val\\u200dgus'", 'zero-width joiner'],
    ["'knee val\\u2060gus'", 'word joiner'],
    ["'142 de\\u00adgrees'", 'soft hyphen in the degree word'],
    // #817's review: the Unicode classes a character list missed.
    ["'knee val\\u{e0020}gus'", 'tag character'],
    ["'knee val\\u034fgus'", 'combining grapheme joiner'],
    ["'knee val\\ufe0fgus'", 'variation selector'],
    ["'knee val\\u180egus'", 'Mongolian vowel separator'],
    ["'knee val\\u3164gus'", 'Hangul filler'],
  ])('catches a word split by an invisible character: %s (%s)', (literal) => {
    expect(angleClaimsIn('x.ts', `const s = ${literal};`)).toHaveLength(1);
  });

  it.each([
    '<p>knee val&shy;gus</p>',
    '<p>knee val&zwj;gus</p>',
    '<p>knee val&zwnj;gus</p>',
    '<p>knee val&#x200B;gus</p>',
    '<p>knee val&#8288;gus</p>',
    '<span title="knee val&shy;gus" />',
  ])('catches a word split by an invisible character reference in JSX: %s', (jsx) => {
    expect(angleClaimsIn('x.tsx', `const e = ${jsx};`)).toStrictEqual([
      expect.objectContaining({ rule: 'frontal plane' }),
    ]);
  });

  it('decodes the invisible characters’ named references', () => {
    expect(decodeCharacterReferences('a&shy;b&zwj;c&zwnj;d')).toBe('a­b‍c‌d');
  });

  // #564: a word split across JSX elements renders whole, so it is read whole.
  it.each([
    ['<p>de<b>grees</b></p>', 'degree word'],
    ['<p>knee val<i>gus</i></p>', 'frontal plane'],
    ["<p>de{'grees'}</p>", 'degree word'],
    ['<p>\n  de\n  <b>grees</b>\n</p>', 'degree word'],
    ['<>142<sup>&deg;</sup> </>', 'degree sign'],
    ['<p>hip <span>d<b>rop</b></span></p>', 'frontal plane'],
  ] as const)('catches a word split across JSX elements: %j', (jsx, rule) => {
    expect(angleClaimsIn('x.tsx', `const e = ${jsx};`)).toStrictEqual([
      expect.objectContaining({ rule }),
    ]);
  });

  it('reports a JSX element once when one of its own pieces already fires', () => {
    expect(angleClaimsIn('x.tsx', 'const e = <p>Knee 142° <b>now</b></p>;')).toStrictEqual([
      expect.objectContaining({ rule: 'degree sign', text: 'Knee 142°' }),
    ]);
  });

  it('does not let one firing piece hide a split word elsewhere in the element', () => {
    // #587's review: every piece that fired used to switch the whole-element
    // check off, so a degree sign in one paragraph hid `hip <b>drop</b>` in
    // the next.
    expect(
      angleClaimsIn('x.tsx', 'const e = <div><p>Knee 142°</p><p>hip <b>drop</b></p></div>;'),
    ).toStrictEqual([
      expect.objectContaining({ rule: 'degree sign', text: 'Knee 142°' }),
      expect.objectContaining({ rule: 'frontal plane', text: '${…} hip drop' }),
    ]);
  });

  it('does not let an EXEMPT piece hide a split word elsewhere in the element', () => {
    // The exempt wind label is a finding (then excused by `isExempt`); it must
    // not also excuse a split word beside it.
    const findings = angleClaimsIn(
      'game/GameView.tsx',
      'const e = <div><p>Wind direction, degrees it blows from</p><p>hip <b>drop</b></p></div>;',
    );
    expect(findings.filter((finding) => !isExempt(finding))).toStrictEqual([
      expect.objectContaining({ rule: 'frontal plane', text: '${…} hip drop' }),
    ]);
  });

  it.each([
    ['<p>hip<br/>drop</p>', 'frontal plane'],
    ['<p>hip<br />drop</p>', 'frontal plane'],
    ['<p>de<wbr/>grees</p>', 'degree word'],
  ] as const)('reads <br/> as a gap and <wbr/> as nothing: %j', (jsx, rule) => {
    expect(angleClaimsIn('x.tsx', `const e = ${jsx};`)).toStrictEqual([
      expect.objectContaining({ rule }),
    ]);
  });

  it('still reads any other self-closing element as a break', () => {
    expect(angleClaimsIn('x.tsx', 'const e = <p>de<img alt="" />grees</p>;')).toEqual([]);
  });

  it('does not join JSX text across an expression it cannot read — the stated limit', () => {
    // `{x}` renders whatever `x` is; the scan cannot know, so it does not guess.
    expect(angleClaimsIn('x.tsx', 'const e = <p>de{x}grees</p>;')).toEqual([]);
    expect(angleClaimsIn('x.tsx', 'const e = <p>de<b>fine</b> text</p>;')).toEqual([]);
  });

  it('reads a JSX element’s text the way JSX renders its line breaks', () => {
    expect(jsxElementTextsIn('x.tsx', 'const e = <p>\n  one\n  two <b>three</b>\n</p>;')).toEqual([
      { line: 1, text: 'one two three', pieces: ['one two ', 'three'] },
    ]);
  });

  // #564: three more characters a rider reads as a degree sign.
  it.each([
    "'Knee 142⁰'",
    "'Knee 142ᵒ'",
    "'Knee 142∘'",
    "'Knee 142\\u2070'",
    "'Knee 142\\u1d52'",
    "'Knee 142\\u2218'",
  ])('catches a further look-alike of the degree sign: %s', (literal) => {
    expect(angleClaimsIn('x.ts', `const s = ${literal};`)).toStrictEqual([
      expect.objectContaining({ rule: 'degree sign' }),
    ]);
  });

  it.each(['<p>Knee 142&#x2070;</p>', '<p>Knee 142&#8304;</p>', '<p>Knee 142&#x1D52;</p>'])(
    'catches a further look-alike written as a reference in JSX: %s',
    (jsx) => {
      expect(angleClaimsIn('x.tsx', `const e = ${jsx};`)).toStrictEqual([
        expect.objectContaining({ rule: 'degree sign' }),
      ]);
    },
  );

  it('reads only a capital C or F after the sign as a temperature', () => {
    expect(angleClaimsIn('x.ts', "const s = 'Knee 142°c';")).toStrictEqual([
      expect.objectContaining({ rule: 'degree sign' }),
    ]);
    expect(angleClaimsIn('x.ts', "const s = 'Knee 142°f';")).toHaveLength(1);
    expect(angleClaimsIn('x.ts', "const s = 'It was 21°C and 70°F';")).toEqual([]);
  });

  // #564: words that are not about a body, and must not fire.
  it.each([
    'a temperature inversion',
    'colour inversion',
    'Inversion of the picture',
    'the road shoulder is level with the verge',
    'the hard shoulder was level',
    'lateral shift of the camera',
    'a lateral movement of the tablet',
    'lateral motion of the picture',
    // #587's review: the road is still excused, and so is the picture's frame.
    'the road shoulder was less level than the lane',
    'the road shoulders were level',
    'lateral movement of the camera frame',
    'lateral shift of the picture frame',
  ])('does not fire on a word that is not about a body: %s', (text) => {
    expect(angleClaimsIn('x.ts', `const s = ${JSON.stringify(text)};`)).toEqual([]);
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

  it('does not decode a plain string, which nothing renders as HTML', () => {
    // Five characters reach a rider, not a degree sign.
    expect(textsIn('x.ts', "const s = '142&deg;';").map((each) => each.text)).toEqual(['142&deg;']);
  });

  it('excuses only the exact text an exemption names, never a text that contains it', () => {
    const entry = EXEMPT.find((each) => each.file === 'game/GameView.tsx');
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    const exact = { file: entry.file, line: 1, text: entry.text, rule: 'degree word' } as const;
    expect(isExempt(exact)).toBe(true);
    // #561's review's own probe.
    expect(
      isExempt({ ...exact, text: 'Wind direction, degrees it blows from; your knee is 142°' }),
    ).toBe(false);
    expect(isExempt({ ...exact, text: `${entry.text} ` })).toBe(false);
    expect(isExempt({ ...exact, file: 'camera/side-report.ts' })).toBe(false);
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

/**
 * Every finding in the tree, exemptions not applied — computed ONCE for the
 * two cases that read it, because a walk that parses every file in the client
 * is the slowest thing in this file and ran twice (#564's first CI run timed
 * both out at Vitest's default five seconds on a loaded runner).
 */
let treeFindings: readonly AngleClaimFinding[] | undefined;
function everyFinding(): readonly AngleClaimFinding[] {
  treeFindings ??= scannable().flatMap((file) =>
    angleClaimsIn(relative(SOURCE_ROOT, file), readFileSync(file, 'utf8')),
  );
  return treeFindings;
}

/** A bound for the tree walk: about 0.4 s locally, so this is room for a busy runner. */
const TREE_WALK_TIMEOUT_MILLISECONDS = 30_000;

describe('no string in this client renders an absolute angle or the frontal plane (#388)', () => {
  it('finds files to scan at all, so a clean pass is not a vacuous one', () => {
    const files = scannable();
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((file) => file.endsWith('side-report-wording.ts'))).toBe(true);
    // Exactly one file is left out, and it is the rule's own definition.
    expect(files).not.toContain(RULE_MODULE);
  });

  it(
    'has no findings',
    () => {
      const findings = everyFinding().filter((finding) => !isExempt(finding));
      expect(
        findings.map(
          (finding) => `${finding.file}:${String(finding.line)}  ${finding.rule}  ${finding.text}`,
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

  it('exempts nothing in the side camera, whose report is what this gate is for', () => {
    expect(EXEMPT.filter((entry) => entry.file.startsWith('camera/'))).toEqual([]);
    expect(EXEMPT.filter((entry) => entry.file.startsWith('detail/'))).toEqual([]);
  });
});
