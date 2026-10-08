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
 * ⚠️ **The matchers are in `angle-claims.ts` since #798**, which imports
 * nothing so that the model write-up screen (`write-up-screen.ts`) can ship
 * them without shipping the TypeScript compiler this file needs. Both are in
 * `@onyourleft/analysis` (`packages/analysis/src/screen/`) since #1094. The list
 * below is what they match; change it THERE, and both uses move together.
 *
 * 1. **A degree sign** in any text — D-3: *"The scan is for a degree sign, the
 *    word `degrees`, and a formatter that renders one, anywhere under
 *    `apps/web/src`."* A degree sign followed by `C` or `F` is a temperature
 *    and is not an angle. ⚠️ **"A degree sign" is three characters, not one**
 *    (#561's review): `°` (U+00B0), and the two that render the same to a
 *    rider — `º` (U+00BA, the masculine ordinal, which some keyboards type in
 *    its place) and `˚` (U+02DA, the ring above) — and since #564 three more:
 *    `⁰` (U+2070, superscript zero), `ᵒ` (U+1D52, modifier small o) and `∘`
 *    (U+2218, the ring operator). Only a CAPITAL `C` or `F` after the sign is
 *    a temperature: `142°c` is an angle with a typo, not a unit (#564). And
 *    the abbreviation: a number followed by `deg` (`142 deg`, `142deg`).
 * 2. **The word "degree" or "degrees"** in any text.
 * 3. **A formatter that renders one**: the string `'degree'` on its own, which
 *    is what `Intl.NumberFormat`'s `unit` option would be handed.
 * 4. **The frontal plane, as a word** — D-4, *"not as a number, not as a word"*,
 *    every term D-4's rule names (knee tracking, knee valgus or varus, hip
 *    drop, lateral sway, foot eversion, shoulder levelness) and D-8's list
 *    (`valgus`, `varus`, `abduction`, `adduction`, knee track, hip drop,
 *    `sway`), plus the forms a rider would read: pelvic drop, rocking, side to
 *    side, eversion or inversion, a tilt of the pelvis, hips or shoulders, and
 *    "frontal" itself. ⚠️ **Narrowed to a body since #564**, each with a
 *    fixture that must NOT fire: inversion only of a foot or an ankle (not a
 *    temperature or a colour inversion), shoulders that are level unless they
 *    are a road's ("the road shoulder", "the hard shoulder"), and a lateral shift or
 *    movement of anything but the camera, its stand, the picture or the road.
 *
 * ## Invisible characters are removed before anything is matched
 *
 * A soft hyphen (U+00AD), a zero-width space, non-joiner or joiner
 * (U+200B–U+200D) or a word joiner (U+2060) inside a word renders as nothing
 * and splits the word for `\b` — `'val\u00adgus'` reads as a banned word and
 * used to pass (#564). Since #798 the directional marks, embeddings,
 * overrides and isolates and the byte-order mark are removed too
 * (`angle-claims.ts` §`INVISIBLE`). Every text is matched with them removed,
 * and `&shy;`, `&zwj;` and `&zwnj;` are decoded so the same rule reaches them
 * in JSX.
 *
 * ## A JSX element is also read whole
 *
 * `<p>de<b>grees</b></p>` renders `degrees`, and a node-by-node read sees
 * `de` and `grees` (#564). {@link jsxElementTextsIn} joins every outermost
 * element's text as JSX renders it, line-break rule included, and
 * {@link angleClaimsIn} reports it once — only when none of its pieces is a
 * finding already, so a sentence is never reported twice.
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
 * `String.fromCharCode(176)`, a sign built from its code point, or JSX text
 * split around an expression it cannot read (`<p>de{x}grees</p>`, where the
 * middle is whatever `x` is; a fixture pins this as a limit) — and anything
 * a rider reads that does not come from this source tree. **A green scan is
 * not evidence that ADR 0030 was followed** (D-8's last paragraph); it is
 * evidence that the two violations it names are absent.
 */

import ts from 'typescript';

import {
  type AngleClaimKind,
  angleClaimKinds,
  decodeCharacterReferences,
  visibleText,
} from '@onyourleft/analysis';

export { decodeCharacterReferences };

/** One piece of rendered text that breaks the rule. */
export interface AngleClaimFinding {
  readonly file: string;
  /** 1-based, so it matches what an editor shows. */
  readonly line: number;
  readonly text: string;
  readonly rule: 'degree sign' | 'degree word' | 'degree formatter' | 'frontal plane';
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
    file: 'game/StageChooser.tsx',
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
  return textsOf(parse(file, source));
}

/**
 * One file's source, parsed once — {@link angleClaimsIn} walks the same tree
 * twice, node by node and element by element, because a second parse of
 * every file in the client made the whole-tree gate slow enough to time out
 * on a loaded CI runner (#564's first CI run).
 */
function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function textsOf(parsed: ts.SourceFile): readonly { line: number; text: string }[] {
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

/**
 * JSX text as React renders it: a line break and the white space around it
 * vanish, the lines that are left are joined with one space, and a line with
 * no break is kept as written. The rule is JSX's own, the one Babel and
 * TypeScript both apply when they emit.
 */
function renderedJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) {
    return raw;
  }
  return lines
    .map((line, index) => {
      let kept = line.replace(/\t/g, ' ');
      if (index > 0) {
        kept = kept.replace(/^ +/, '');
      }
      if (index < lines.length - 1) {
        kept = kept.replace(/ +$/, '');
      }
      return kept;
    })
    .filter((line) => line.length > 0)
    .join(' ');
}

/** A JSX element's text, joined as it renders, and the pieces it was joined from. */
export interface JsxElementText {
  readonly line: number;
  readonly text: string;
  readonly pieces: readonly string[];
}

/**
 * The whole text of every outermost JSX element or fragment in one file,
 * with its descendants' text joined as it renders — so `<p>de<b>grees</b></p>`
 * is read as `degrees`, which is what a rider sees (#564). {@link textsIn}
 * reads the same text node by node, and {@link angleClaimsIn} reports an
 * element's whole text only when none of its pieces is already a finding.
 *
 * ⚠️ **An expression the scan cannot read is a break, not a guess**: in
 * `<p>de{x}grees</p>` the middle is whatever `x` is at run time, so the two
 * sides are not joined. A string literal in braces (`{'grees'}`) is text and
 * is joined. A JSX attribute is read on its own by {@link textsIn}, not here.
 */
export function jsxElementTextsIn(file: string, source: string): readonly JsxElementText[] {
  return jsxElementTextsOf(parse(file, source)).map(({ line, text, pieces }) => ({
    line,
    text,
    pieces,
  }));
}

/** Where an element's text is broken by something the scan cannot read. */
const BREAK = '\u0000';

/** An element's parts, breaks included, joined as they render. */
function joinedParts(parts: readonly string[]): string {
  return parts.join('').split(BREAK).join(' ${…} ').replace(/\s+/g, ' ').trim();
}

/** {@link JsxElementText}, with the parts it was joined from, breaks included. */
interface JsxElementParts extends JsxElementText {
  readonly parts: readonly string[];
}

/** {@link jsxElementTextsIn} over a tree already parsed. A `.ts` file holds no JSX. */
function jsxElementTextsOf(parsed: ts.SourceFile): readonly JsxElementParts[] {
  const found: JsxElementParts[] = [];
  const collect = (children: ts.NodeArray<ts.JsxChild>, pieces: string[]): void => {
    for (const child of children) {
      if (ts.isJsxText(child)) {
        pieces.push(renderedJsxText(decodeCharacterReferences(child.text)));
      } else if (ts.isJsxElement(child) || ts.isJsxFragment(child)) {
        collect(child.children, pieces);
      } else if (ts.isJsxExpression(child)) {
        const inner = child.expression;
        if (inner === undefined) {
          // `{/* a comment */}` renders nothing, and breaks nothing.
          continue;
        }
        pieces.push(
          ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)
            ? inner.text
            : BREAK,
        );
      } else {
        // A self-closing element renders no text of its own — except the two
        // that render as a gap and as nothing, which join the words beside
        // them rather than break them (#587's review): `<p>hip<br/>drop</p>`
        // is "hip" and "drop" on adjacent lines.
        const tag = child.tagName.getText(parsed);
        pieces.push(tag === 'br' ? ' ' : tag === 'wbr' ? '' : BREAK);
      }
    }
  };
  const visit = (node: ts.Node): void => {
    // Only an OUTERMOST element is a text of its own: one nested in another's
    // children is part of that one's text. One inside an expression or an
    // attribute is outermost again, because its parent is not an element.
    const outermost =
      (ts.isJsxElement(node) || ts.isJsxFragment(node)) &&
      !ts.isJsxElement(node.parent) &&
      !ts.isJsxFragment(node.parent);
    if (outermost) {
      const pieces: string[] = [];
      collect(node.children, pieces);
      const { line } = parsed.getLineAndCharacterOfPosition(node.getStart(parsed));
      found.push({
        line: line + 1,
        text: joinedParts(pieces),
        pieces: pieces.filter((piece) => piece !== BREAK && piece.length > 0),
        parts: pieces,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

/** The scan's name for each kind of claim `angle-claims.ts` finds. */
const RULE_OF_KIND: Readonly<Record<AngleClaimKind, AngleClaimFinding['rule']>> = {
  'angle-sign': 'degree sign',
  'angle-word': 'degree word',
  'body-sideways': 'frontal plane',
};

/**
 * The rule `text` breaks, if any — matched with the invisible characters
 * removed. The matchers are `angle-claims.ts`'s, shared with the run-time
 * write-up screen (#798); the formatter is this scan's own, because only
 * source hands `Intl.NumberFormat` a unit.
 */
function ruleBroken(text: string): AngleClaimFinding['rule'] | undefined {
  if (visibleText(text).trim().toLowerCase() === 'degree') {
    return 'degree formatter';
  }
  const [first] = angleClaimKinds(text);
  return first === undefined ? undefined : RULE_OF_KIND[first];
}

/** Every absolute-angle or frontal-plane claim in one file's rendered text. */
export function angleClaimsIn(file: string, source: string): readonly AngleClaimFinding[] {
  const findings: AngleClaimFinding[] = [];
  const parsed = parse(file, source);
  for (const { line, text } of textsOf(parsed)) {
    const rule = ruleBroken(text);
    if (rule !== undefined) {
      findings.push({ file, line, text: text.trim(), rule });
    }
  }
  // A word split across elements: the element is read whole with every piece
  // that is a finding of its own taken out — so a sentence is never reported
  // twice, and one piece that fires (or is exempt) cannot switch the check
  // off for the rest of the element (#587's review: an exempt label beside
  // `hip <b>drop</b>` hid the split word).
  for (const { line, parts } of jsxElementTextsOf(parsed)) {
    const rest = joinedParts(
      parts.map((part) => (part !== BREAK && ruleBroken(part) !== undefined ? BREAK : part)),
    );
    const rule = ruleBroken(rest);
    if (rule !== undefined) {
      findings.push({ file, line, text: rest, rule });
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
