// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The check behind #238's fifth acceptance criterion — *"`format.ts`'s
 * constants stop being the only mechanism, so a future screen cannot hard-code
 * a literal the way `fields.ts` does today and pass review."*
 *
 * ## Why a source scan and not a review note
 *
 * The structural half of that criterion is that `units/format.ts` returns a
 * value and its label together, so a caller cannot obtain `mi` without also
 * obtaining the number of miles. That stops the *accidental* version. It does
 * not stop somebody writing `` `${x} km` `` in a new component, which is
 * exactly what `game/hud/fields.ts` did for four months while `format.ts`'s
 * constants sat one directory away — the file that most needed the shared
 * mechanism was the one that did not use it, and nothing said so.
 *
 * So this walks the client's own source and refuses a unit label written by
 * hand. It is the same shape as `scripts/check-a11y-suite.mjs`: a convention
 * that would otherwise rest on somebody remembering, checked against the files
 * on disk.
 *
 * ## What it looks for, and what it deliberately does not
 *
 * Two shapes, because they are the two this issue found in the wild:
 *
 * 1. **A quoted unit** — `'km/h'`, `"mi"` — which is the `SPEED_UNIT` shape.
 * 2. **A unit immediately after a template or JSX interpolation** — `` `${x}
 *    km` ``, `<td>{x} m</td>` — which is the `fields.ts` shape.
 *
 * And one arithmetic constant, `3.6`, because that is the specific inline
 * conversion `fields.ts` carried and it is cheap to name.
 *
 * It reads **comment-stripped** source, so the prose in this repository — which
 * talks about kilometres and metres constantly, including in this very
 * paragraph — is not the thing being checked. {@link stripComments} is exported
 * and tested separately for that reason: a stripper that quietly stopped
 * stripping would make this whole check fire everywhere, and one that stripped
 * too much would make it fire nowhere, which is the worse failure.
 *
 * It does **not** try to find a conversion with no label. Nothing needs it to:
 * the only way to get a label is from `units/format.ts`, which supplies the
 * converted number in the same object.
 */

/** The unit labels only `units/` may write. */
export const UNIT_TOKENS = ['km/h', 'mph', 'km', 'mi', 'ft', 'm'] as const;

/** A quoted unit label — the `SPEED_UNIT = 'km/h'` shape. */
const QUOTED = /['"`]\s*(km\/h|mph|km|mi|ft)\s*['"`]/;

/**
 * A unit label right after an interpolation — the `fields.ts` shape.
 *
 * `m` is included here and not in {@link QUOTED} because a bare `'m'` is a
 * variable name, a format code and a regular expression flag far more often
 * than it is a metre, whereas `${x} m` is a metre essentially always.
 */
const AFTER_INTERPOLATION = /\}\s*(km\/h|mph|km|mi|ft|m)\b/;

/** The metres-per-second to kilometres-per-hour factor, written out. */
const INLINE_CONVERSION = /(?<![\w.])3\.6(?![\d\w])/;

/** One place a unit was written by hand. */
export interface InlineUnitFinding {
  readonly file: string;
  /** 1-based, so it matches what an editor shows. */
  readonly line: number;
  readonly text: string;
}

/**
 * Strip `//` and block comments, leaving string and template contents alone.
 *
 * A small state machine rather than a regular expression, because the two
 * cases that matter both need context: a `//` inside a string is not a
 * comment, and a `'` inside a comment does not open a string. It does not try
 * to understand regular-expression literals — a `//` cannot appear inside one
 * (it would be an empty regex), and a quote inside one is rare enough in this
 * codebase that the scan's own test corpus is what would catch it.
 */
export function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let quote: string | undefined;
  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (quote !== undefined) {
      out += character;
      if (character === '\\') {
        out += next;
        index += 2;
        continue;
      }
      if (character === quote) {
        quote = undefined;
      }
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      out += character;
      index += 1;
      continue;
    }
    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        // Newlines are kept so that a finding's line number still matches the
        // file a person opens.
        if (source[index] === '\n') {
          out += '\n';
        }
        index += 1;
      }
      index += 2;
      continue;
    }
    if (character === '{' && next === '/' && source[index + 2] === '*') {
      // A JSX comment, `{/* … */}`. The opening brace is consumed with it so
      // that `AFTER_INTERPOLATION` does not read the `}` that closes it as an
      // interpolation followed by whatever comes next.
      index += 3;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        if (source[index] === '\n') {
          out += '\n';
        }
        index += 1;
      }
      index += 3;
      continue;
    }
    out += character;
    index += 1;
  }
  return out;
}

/** Every hand-written unit label in one file's source. */
export function inlineUnitsIn(file: string, source: string): readonly InlineUnitFinding[] {
  const findings: InlineUnitFinding[] = [];
  const lines = stripComments(source).split('\n');
  for (const [index, line] of lines.entries()) {
    if (QUOTED.test(line) || AFTER_INTERPOLATION.test(line) || INLINE_CONVERSION.test(line)) {
      findings.push({ file, line: index + 1, text: line.trim() });
    }
  }
  return findings;
}
