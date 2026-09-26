// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The check behind ADR 0030 D-8's two machine-checkable rules** —
 * [#388](https://github.com/openzigs/onyourleft/issues/388), and #377's epic
 * criterion: *"a source scan, in the shape of `no-inline-units.test.ts`, fails
 * the build if any string in `apps/web/src` renders an absolute joint angle or
 * any frontal-plane quantity."*
 *
 * ## What it reads: the text a rider could be shown, and nothing else
 *
 * Every string literal, every template literal's text and every piece of JSX
 * text in a file, read with the TypeScript compiler's own parser — so an
 * identifier (`CAMERA_FIELD_OF_VIEW_DEGREES`, `fromDegrees`) and a comment are
 * never in scope, and a `°` escape is read as the degree sign it renders
 * as. `no-inline-units.ts` strips comments with a state machine and matches
 * lines; that would not do here, because the words this rule forbids are the
 * ones this repository's prose about the rule uses on every other line.
 *
 * ## What it forbids
 *
 * 1. **A degree sign** in any text — D-3: *"The scan is for a degree sign, the
 *    word `degrees`, and a formatter that renders one, anywhere under
 *    `apps/web/src`."* A degree sign followed by `C` or `F` is a temperature
 *    and is not an angle. ⚠️ **"A degree sign" is three characters, not one**
 *    (#561's review): `°` (U+00B0), and the two that render the same to a
 *    rider — `º` (U+00BA, the masculine ordinal, which some keyboards type in
 *    its place) and `˚` (U+02DA, the ring above). And the abbreviation: a
 *    number followed by `deg` (`142 deg`, `142deg`).
 * 2. **The word "degree" or "degrees"** in any text.
 * 3. **A formatter that renders one**: the string `'degree'` on its own, which
 *    is what `Intl.NumberFormat`'s `unit` option would be handed.
 * 4. **The frontal plane, as a word** — D-4, *"not as a number, not as a word"*,
 *    every term D-4's rule names (knee tracking, knee valgus or varus, hip
 *    drop, lateral sway, foot eversion, shoulder levelness) and D-8's list
 *    (`valgus`, `varus`, `abduction`, `adduction`, knee track, hip drop,
 *    `sway`), plus the forms a rider would read: pelvic drop, rocking, side to
 *    side, eversion or inversion, a tilt of the pelvis, hips or shoulders, and
 *    "frontal" itself.
 *
 * ## JSX is read as it renders, character references included
 *
 * ⚠️ **The parser hands JSX text and a JSX attribute's string back with its
 * HTML character references UNDECODED** — TypeScript decodes them only when it
 * emits — so `<p>Knee 142&deg;</p>`, which a rider reads as `142°`, used to
 * produce no finding at all (#561's review, the blocking one). Both are
 * decoded by {@link decodeCharacterReferences} before they are matched: named
 * references for the signs this rule is about, decimal (`&#176;`, `&#0176;`)
 * and hexadecimal (`&#xb0;`, `&#x00B0;`) references for every code point, in
 * any case. A plain string literal is not decoded, because nothing renders it
 * as HTML: `'&deg;'` in a `.ts` file reaches a rider as five characters.
 *
 * ## Why there is no exempt module, and what the exemptions are
 *
 * D-8 allows *"the one module that formats a difference"*. There is none
 * today: the owner's ruling on #388 renders no number until #385 measures a
 * spread (`side-report.ts` §`MEASURED_SPREAD_DEGREES`). The day there is one,
 * it is added to {@link EXEMPT} with its reason — a deliberate diff, not a
 * silent one. The three entries there now are not about a body: a wind
 * bearing, a wind bearing's refusal and a sky texture's bearing. Each is
 * pinned to **the whole of the text it excuses** — equality, not containment
 * (#561's review: containment excused `'Wind direction, degrees it blows
 * from; your knee is 142°'` because it began with an exempt sentence). A
 * template's interpolations are part of that whole, written `${…}`. And an
 * exemption that excuses nothing fails the gate, so the list cannot outlive
 * what it names (`LIC006`'s rule for `.spdx-exempt`, applied here).
 *
 * ## What it cannot see
 *
 * A number assembled at run time from pieces none of which is forbidden —
 * `String.fromCharCode(176)`, a sign built from its code point — and anything
 * a rider reads that does not come from this source tree. **A green scan is
 * not evidence that ADR 0030 was followed** (D-8's last paragraph); it is
 * evidence that the two violations it names are absent.
 */

import ts from 'typescript';

/** One piece of rendered text that breaks the rule. */
export interface AngleClaimFinding {
  readonly file: string;
  /** 1-based, so it matches what an editor shows. */
  readonly line: number;
  readonly text: string;
  readonly rule: 'degree sign' | 'degree word' | 'degree formatter' | 'frontal plane';
}

/**
 * A degree sign — or either of its two look-alikes, `º` (U+00BA) and `˚`
 * (U+02DA) — that is not the start of a temperature unit; or a number followed
 * by the abbreviation `deg`.
 */
const DEGREE_SIGN = /[\u00b0\u00ba\u02da](?![CF]\b)|\d\s*deg\b/i;

/** The word, singular or plural, whole. */
const DEGREE_WORD = /\bdegrees?\b/i;

/**
 * The frontal plane, in the words a sentence about it would use. Whole words,
 * case-insensitive; the list is every term ADR 0030 D-4's rule names and
 * D-8's word list, plus the forms a rider would read ("knees tracking", "hips
 * rocking", "side-to-side", "your shoulders were less level").
 */
const FRONTAL_PLANE = new RegExp(
  '\\b(?:' +
    [
      'valgus',
      'varus',
      'ab(?:duct(?:ion|ed|s)?)',
      'ad(?:duct(?:ion|ed|s)?)',
      'knees?\\s+track(?:s|ing|ed)?',
      '(?:hip|hips|pelvis|pelvic)\\s+drop(?:s|ping|ped)?',
      'sway(?:s|ing|ed)?',
      'rock(?:s|ing|ed)?\\s+hips?',
      'hips?\\s+rock(?:s|ing|ed)?',
      'side[\\s-]to[\\s-]side',
      // D-4: "foot eversion", and the other direction of the same rotation.
      'eversion',
      'inversion',
      'evert(?:s|ed|ing)?',
      'invert(?:s|ed|ing)?\\s+(?:foot|feet|ankles?)',
      '(?:foot|feet|ankles?)\\s+invert(?:s|ed|ing)?',
      // D-4: "shoulder levelness", in the shapes a sentence would take.
      // "shoulder levelness", "your shoulders were possibly less level":
      // up to three words between, so an adverb cannot walk it past.
      'shoulders?\\s+(?:[a-z]+\\s+){0,3}(?:un)?level(?:ness)?',
      'level\\s+shoulders?',
      'uneven\\s+shoulders?',
      '(?:pelvi[cs]|hips?|shoulders?)\\s+tilt(?:s|ing|ed)?',
      // D-4: "lateral sway", and any other lateral movement of a body.
      'lateral(?:ly)?\\s+(?:sway|movement|motion|shift|tilt|drop)',
      'frontal',
    ].join('|') +
    ')\\b',
  'i',
);

/**
 * The named character references this rule decodes — the signs it forbids and
 * their look-alikes, plus the few that could split a word it forbids. Looked
 * up in lower case, so `&DEG;` counts as `&deg;` does: a browser reads named
 * references case-sensitively, and this over-reads on purpose, because a ban
 * that errs is one a reviewer reads rather than one a rider does.
 */
const NAMED_REFERENCES: Readonly<Record<string, string>> = {
  deg: '\u00b0',
  ordm: '\u00ba',
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * `text` with its HTML character references decoded — named ones from
 * {@link NAMED_REFERENCES}, and decimal or hexadecimal ones for any code point,
 * in any case and with any number of leading zeros. A reference this cannot
 * decode is left as it was.
 */
export function decodeCharacterReferences(text: string): string {
  return text.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]*));/gi,
    (whole, hex: string | undefined, decimal: string | undefined, name: string | undefined) => {
      if (name !== undefined) {
        return NAMED_REFERENCES[name.toLowerCase()] ?? whole;
      }
      const code = hex !== undefined ? parseInt(hex, 16) : parseInt(decimal ?? '', 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    },
  );
}

/**
 * What is excused, where, and why — each entry names the file and the exact
 * text it excuses. Adding one is a decision a reviewer reads.
 */
export const EXEMPT: readonly {
  readonly file: string;
  readonly text: string;
  readonly why: string;
}[] = [
  {
    file: 'game/GameView.tsx',
    text: 'Wind direction, degrees it blows from',
    why: 'a compass bearing the rider types for the wind (#326) — about the weather, not a body',
  },
  {
    file: 'game/wind-choice.ts',
    text: 'a wind direction must be a compass bearing between 0 and ${…} degrees',
    why: 'the refusal for a wind bearing out of range (#326) — about the weather, not a body',
  },
  {
    file: 'game/realistic-light.ts',
    text: 'the sky has no texel between ${…}° and ${…}°',
    why: 'an error thrown about a sky texture’s bearings (ADR 0026) — about the sky, not a body, and never rendered',
  },
];

/** Every piece of rendered text in one file's source, with the line it starts on. */
export function textsIn(file: string, source: string): readonly { line: number; text: string }[] {
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      // One template is one piece of text: its parts are joined with a
      // marker where each value goes, so a sentence split by an interpolation
      // is read — and excused — whole. The values are still visited.
      const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
      const text =
        node.head.text + node.templateSpans.map((span) => `\${…}${span.literal.text}`).join('');
      found.push({ line: line + 1, text });
      for (const span of node.templateSpans) {
        visit(span.expression);
      }
      return;
    }
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isJsxText(node)
    ) {
      // A module specifier is a path, not something a rider reads.
      const specifier =
        ts.isStringLiteral(node) &&
        (ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent));
      if (!specifier) {
        const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
        // JSX is read as a rider reads it: references decoded, and a run of
        // white space — which JSX renders as one space — as one space.
        const jsx =
          ts.isJsxText(node) || (ts.isStringLiteral(node) && ts.isJsxAttribute(node.parent));
        const text = jsx ? decodeCharacterReferences(node.text).replace(/\s+/g, ' ') : node.text;
        found.push({ line: line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/** Every absolute-angle or frontal-plane claim in one file's rendered text. */
export function angleClaimsIn(file: string, source: string): readonly AngleClaimFinding[] {
  const findings: AngleClaimFinding[] = [];
  for (const { line, text } of textsIn(file, source)) {
    const rule: AngleClaimFinding['rule'] | undefined =
      text.trim().toLowerCase() === 'degree'
        ? 'degree formatter'
        : DEGREE_SIGN.test(text)
          ? 'degree sign'
          : DEGREE_WORD.test(text)
            ? 'degree word'
            : FRONTAL_PLANE.test(text)
              ? 'frontal plane'
              : undefined;
    if (rule !== undefined) {
      findings.push({ file, line, text: text.trim(), rule });
    }
  }
  return findings;
}

/**
 * Whether a finding is one {@link EXEMPT} excuses: the same file, and **the
 * same whole text** — never a text that merely contains an exempt one.
 */
export function isExempt(finding: AngleClaimFinding): boolean {
  return EXEMPT.some((entry) => entry.file === finding.file && finding.text === entry.text);
}
