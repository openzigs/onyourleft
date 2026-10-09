// SPDX-License-Identifier: Apache-2.0

/**
 * **What an absolute angle or the frontal plane looks like in a piece of
 * text** — the matchers ADR 0030 D-8's two machine-checkable rules are made
 * of, in the one place both of their users read them from
 * ([#798](https://github.com/openzigs/onyourleft/issues/798)).
 *
 * ## Two users, one list
 *
 * - `no-absolute-angles.ts` scans this client's SOURCE at build time (#388,
 *   #564), reading string literals with the TypeScript compiler's parser.
 * - `write-up-screen.ts` screens a model's WRITE-UP at run time (epic #795,
 *   the owner's ruling 3: *"a write-up that fails is not shown"*).
 *
 * They used to be one file, and that file imports `typescript` — which shipped
 * code cannot import without putting the compiler in the bundle. The matchers
 * are plain regular expressions over a string, so they live here and the two
 * users import them: the scan and the screen cannot drift into two lists.
 *
 * ## ⚠️ This module imports NOTHING, and a test holds it to that
 *
 * `angle-claims.test.ts` reads this file and fails on any `import`, `require`
 * or re-export. It is imported by shipped code, so anything it imports ships.
 *
 * ## ⚠️ Why every pattern is a regular-expression LITERAL
 *
 * The source scan reads every string literal under `apps/web/src` except the
 * rule module itself, and this file is not that module. A pattern written as a
 * string — `'valgus'` — would be a finding against this file. A regular
 * expression literal is not text a rider can be shown and the scan does not
 * read it, so the frontal-plane list is written as literals and joined by
 * their `.source`. The same reason makes {@link NAMED_REFERENCES} a table of
 * code points rather than of strings, and gives {@link AngleClaimKind} names
 * that are not themselves the words they are about.
 *
 * ## What it matches — the rules, stated once
 *
 * 1. **A degree sign** that does not start a temperature unit: `°` (U+00B0)
 *    and the five that render like it to a rider — `º` (U+00BA), `˚` (U+02DA),
 *    `⁰` (U+2070), `ᵒ` (U+1D52) and `∘` (U+2218). Only a CAPITAL `C` or `F`
 *    after the sign is a temperature: `142°c` is an angle with a typo (#564).
 *    And a number followed by the abbreviation `deg`, spaced or not.
 * 2. **The word** "degree" or "degrees", whole, in any case.
 * 3. **The frontal plane, as a word** — ADR 0030 D-4 and D-8's lists and the
 *    forms a rider would read, narrowed to a body since #564: a road's
 *    shoulder, a temperature or colour inversion and a lateral shift of the
 *    camera are not findings.
 *
 * Every text is matched with its {@link INVISIBLE} characters removed, and
 * again in its compatibility form (NFKC), so neither a soft hyphen inside a
 * word nor a full-width letter walks one past.
 */

/** Which of the rules a text breaks. Named so that no name is a finding. */
export type AngleClaimKind = 'angle-sign' | 'angle-word' | 'body-sideways';

/**
 * A degree sign — or one of its look-alikes — that is not the start of a
 * temperature unit.
 */
export const DEGREE_SIGN = /[\u00b0\u00ba\u02da\u2070\u1d52\u2218](?![CF]\b)/;

/**
 * The abbreviation, after a number. Case-insensitive, unlike
 * {@link DEGREE_SIGN}: that one is case-SENSITIVE on purpose, so that only a
 * capital `C` or `F` after the sign reads as a temperature and `142°c` does
 * not slip past as one (#564).
 */
export const DEGREE_ABBREVIATION = /\d\s*deg\b/i;

/** The word, singular or plural, whole. */
export const DEGREE_WORD = /\bdegrees?\b/i;

/**
 * The characters a rider cannot see and a regular expression can — every
 * Unicode `Default_Ignorable_Code_Point` and every format character (`Cf`),
 * by PROPERTY rather than by list. One inside a word splits it for `\b` and
 * for nobody reading it (#564); a directional one can reorder what a rider
 * sees (#815's review).
 *
 * ⚠️ It was a list until #817's review, which found five classes the list
 * had missed getting `valgus` past the screen: the tag characters
 * (U+E0000–E007F), the combining grapheme joiner (U+034F), the variation
 * selectors (U+FE00–FE0F, U+E0100–E01EF), the Mongolian vowel separator
 * (U+180E) and the Hangul fillers (U+115F, U+1160, U+3164, U+FFA0). A list
 * fails open against the character nobody thought of; the two properties are
 * the standard's own answer to "renders as nothing", kept current by the
 * engine's Unicode tables. `Cf` also takes the few format characters that are
 * not default-ignorable (the interlinear annotation marks, U+FFF9–FFFB), which
 * over-reads on purpose. A control character (`Cc`) is in neither, so the
 * write-up screen still sees and withholds one. Every text is matched with
 * these removed.
 */
export const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/gu;

/**
 * The frontal plane, in the words a sentence about it would use: every term
 * ADR 0030 D-4's rule names and D-8's word list, plus the forms a rider would
 * read ("knees tracking", "hips rocking", "side-to-side", "your shoulders were
 * less level").
 */
const FRONTAL_PLANE_WORDS: readonly RegExp[] = [
  /valgus/,
  /varus/,
  /ab(?:duct(?:ion|ed|s)?)/,
  /ad(?:duct(?:ion|ed|s)?)/,
  /knees?\s+track(?:s|ing|ed)?/,
  /(?:hip|hips|pelvis|pelvic)\s+drop(?:s|ping|ped)?/,
  /sway(?:s|ing|ed)?/,
  /rock(?:s|ing|ed)?\s+hips?/,
  /hips?\s+rock(?:s|ing|ed)?/,
  /side[\s-]to[\s-]side/,
  // D-4: "foot eversion", and the other direction of the same rotation.
  /eversion/,
  // Inversion only of a foot or an ankle (#564): bare, it is a temperature
  // inversion or a colour inversion as often as a body.
  /(?:foot|feet|ankles?)\s+inversion/,
  /inversion\s+(?:of|at|in)\s+(?:the\s+|your\s+|their\s+)?(?:foot|feet|ankles?)/,
  /evert(?:s|ed|ing)?/,
  /invert(?:s|ed|ing)?\s+(?:foot|feet|ankles?)/,
  /(?:foot|feet|ankles?)\s+invert(?:s|ed|ing)?/,
  // D-4: "shoulder levelness", in the shapes a sentence would take — up to
  // three words between, so an adverb cannot walk it past. Only a ROAD's
  // shoulder is excused ("the road shoulder", "the hard shoulder"), because
  // that is tarmac (#564). A body's shoulder needs no possessive: an earlier
  // narrowing to "your|their|…" let "Shoulders stayed level" through (#587's
  // review).
  /(?<!(?:road|hard)\s+)shoulders?\s+(?:[a-z]+\s+){0,3}(?:un)?level(?:ness)?/,
  /level\s+shoulders?/,
  /uneven\s+shoulders?/,
  /(?:pelvi[cs]|hips?|shoulders?)\s+tilt(?:s|ing|ed)?/,
  // D-4: "lateral sway", and any other lateral movement of a body — but not
  // of the camera, its stand or the picture, which a framing instruction may
  // well describe (#564). The bicycle is NOT excused: a bike rocking under a
  // rider is the rider's frontal plane. ⚠️ Nor is a bare "frame", which in a
  // cycling app is the bicycle's as often as the picture's (#587's review).
  /lateral(?:ly)?\s+(?:sway|movement|motion|shift|tilt|drop)(?!\s+of\s+(?:the\s+|your\s+)?(?:camera|phone|tablet|tripod|stand|picture|image|view|screen|road))/,
  /frontal/,
];

/** {@link FRONTAL_PLANE_WORDS} as one pattern: any of them, whole, in any case. */
export const FRONTAL_PLANE = new RegExp(
  `\\b(?:${FRONTAL_PLANE_WORDS.map((word) => word.source).join('|')})\\b`,
  'i',
);

/** `text` with every {@link INVISIBLE} character taken out. */
export function visibleText(text: string): string {
  return text.replace(INVISIBLE, '');
}

/**
 * Every rule `text` breaks, each once, in the order of {@link AngleClaimKind}
 * — matched with the invisible characters removed, as written and in its
 * compatibility form. Empty when it breaks none.
 */
export function angleClaimKinds(text: string): readonly AngleClaimKind[] {
  const visible = visibleText(text);
  // NFKC folds a full-width or styled letter to the plain one, so the words
  // are matched there too. It also folds `⁰` to `0` and `º` to `o`, which is
  // why the text as written is matched as well rather than instead.
  const forms = [visible, visible.normalize('NFKC')];
  const breaks = (pattern: RegExp): boolean => forms.some((form) => pattern.test(form));
  const kinds: AngleClaimKind[] = [];
  if (breaks(DEGREE_SIGN) || breaks(DEGREE_ABBREVIATION)) {
    kinds.push('angle-sign');
  }
  if (breaks(DEGREE_WORD)) {
    kinds.push('angle-word');
  }
  if (breaks(FRONTAL_PLANE)) {
    kinds.push('body-sideways');
  }
  return kinds;
}

/**
 * The named character references {@link decodeCharacterReferences} decodes —
 * the signs these rules forbid and their look-alikes, plus the few that could
 * split a word they forbid — as code points. Looked up in lower case, so
 * `&DEG;` counts as `&deg;` does: a browser reads named references
 * case-sensitively, and this over-reads on purpose, because a ban that errs is
 * one a reviewer reads rather than one a rider does.
 */
const NAMED_REFERENCES: Readonly<Record<string, number>> = {
  deg: 0xb0,
  ordm: 0xba,
  nbsp: 0x20,
  amp: 0x26,
  lt: 0x3c,
  gt: 0x3e,
  quot: 0x22,
  apos: 0x27,
  // The invisible ones (#564): each renders as nothing, so each can split a
  // word. Decoded so that INVISIBLE removes them.
  shy: 0xad,
  zwj: 0x200d,
  zwnj: 0x200c,
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
        const named = NAMED_REFERENCES[name.toLowerCase()];
        return named === undefined ? whole : String.fromCodePoint(named);
      }
      const code = hex !== undefined ? parseInt(hex, 16) : parseInt(decimal ?? '', 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    },
  );
}
