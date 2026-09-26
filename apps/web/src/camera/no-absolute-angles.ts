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
 *    and is not an angle.
 * 2. **The word "degree" or "degrees"** in any text.
 * 3. **A formatter that renders one**: the string `'degree'` on its own, which
 *    is what `Intl.NumberFormat`'s `unit` option would be handed.
 * 4. **The frontal plane, as a word** — D-4, *"not as a number, not as a word"*:
 *    `valgus`, `varus`, `abduction`, `adduction`, knee tracking, hip or pelvic
 *    drop, `sway`, rocking, side to side, and "frontal" itself.
 *
 * ## Why there is no exempt module, and what the exemptions are
 *
 * D-8 allows *"the one module that formats a difference"*. There is none
 * today: the owner's ruling on #388 renders no number until #385 measures a
 * spread (`side-report.ts` §`MEASURED_SPREAD_DEGREES`). The day there is one,
 * it is added to {@link EXEMPT} with its reason — a deliberate diff, not a
 * silent one. The three entries there now are not about a body: a wind bearing
 * a wind bearing's refusal and a sky texture's bearing. Each is pinned to the exact text it excuses, and
 * an exemption that excuses nothing fails the gate, so the list cannot outlive
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

/** A degree sign that is not the start of a temperature unit. */
const DEGREE_SIGN = /°(?![CF]\b)/;

/** The word, singular or plural, whole. */
const DEGREE_WORD = /\bdegrees?\b/i;

/**
 * The frontal plane, in the words a sentence about it would use. Whole words,
 * case-insensitive; the list is ADR 0030 D-4's own, plus the forms a rider
 * would read ("knees tracking", "hips rocking", "side-to-side").
 */
const FRONTAL_PLANE =
  /\b(?:valgus|varus|ab(?:duct(?:ion|ed|s)?)|ad(?:duct(?:ion|ed|s)?)|knees?\s+track(?:s|ing|ed)?|(?:hip|hips|pelvis|pelvic)\s+drop(?:s|ping|ped)?|sway(?:s|ing|ed)?|rock(?:s|ing|ed)?\s+hips?|hips?\s+rock(?:s|ing|ed)?|side[\s-]to[\s-]side|frontal)\b/i;

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
    text: 'a wind direction must be a compass bearing between 0 and',
    why: 'the refusal for a wind bearing out of range (#326) — about the weather, not a body',
  },
  {
    file: 'game/realistic-light.ts',
    text: 'the sky has no texel between',
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
        found.push({ line: line + 1, text: node.text });
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

/** Whether a finding is one {@link EXEMPT} excuses. */
export function isExempt(finding: AngleClaimFinding): boolean {
  return EXEMPT.some((entry) => entry.file === finding.file && finding.text.includes(entry.text));
}
