// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The stylesheet end of `fields.ts` §`HudReading.word` — #259.
 *
 * ## What breaks without it
 *
 * `hudReadings` marks a value that is a word, `HudPanel` turns that into
 * `oyl-hud__value--word`, and a class naming no rule does nothing at all. Every
 * other test of this feature would stay green: the flag is produced, the class
 * is on the element, and the word still spills across the field beside it on a
 * phone. A write that reports success while the read cannot see it, where the
 * read is a rider's eyes.
 *
 * ## Why a file read, and why not jsdom
 *
 * jsdom performs no layout and resolves no custom property, so a computed style
 * says nothing — the reason `a11y/theme.a11y.test.ts` and
 * `hud-surface.a11y.test.ts` both read this stylesheet as a file too. This one
 * is deliberately **not** in the accessibility gate: what it pins is type size
 * against a grid track, and `test:a11y`'s value is that its name says what
 * broke.
 *
 * ## What it cannot prove, stated rather than left to be assumed
 *
 * ⚠️ **Not that the word fits.** That is a pixel measurement and no Vitest
 * suite in this repository can take one. It was taken by hand in the pinned
 * Chromium and the numbers are in `theme.css` beside the rule; the bound below
 * is derived from them so that a later edit of the rule has to clear the same
 * arithmetic.
 *
 * ⚠️ **Since #266 a browser does take it on every run**, and this paragraph
 * used to end by saying that would need a HUD page in the browser gate — a
 * reader who remembers that is reading the old file.
 * `apps/web/browser/hud.browser.spec.ts` lays the real panel out in the real
 * ancestor chain at a phone's width and reads the overflow back off Chromium.
 * The two are not redundant: this one runs in the fast suite on every save and
 * fails with the arithmetic in front of it, and it is the only one that can
 * say the repair was not `overflow-wrap`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(
  fileURLToPath(new URL('../../design/theme.css', import.meta.url)),
  'utf8',
);

/** The stylesheet with comments stripped — a selector named in prose is not a rule. */
const declarations = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The `font-size`, in `rem`, of the last rule whose selector list names
 * `selector`.
 *
 * **The last one, because in CSS the later rule wins** — the lesson
 * `hud-surface.a11y.test.ts` §`rulesFor` records after a `.oyl-hud` rule
 * appended at the bottom of the file went unseen. A selector with no rule, or a
 * rule with no `font-size` in `rem`, returns `undefined` so the caller can fail
 * rather than compare against a default nobody chose.
 */
function fontSizeRem(selector: string): number | undefined {
  const occurrences = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*[,{])`,
    'g',
  );
  let found: number | undefined;
  for (const match of declarations.matchAll(occurrences)) {
    const opened = declarations.indexOf('{', match.index);
    const closed = declarations.indexOf('}', opened);
    if (opened === -1 || closed === -1) {
      continue;
    }
    const size = /font-size:\s*([\d.]+)rem/.exec(declarations.slice(opened + 1, closed));
    if (size?.[1] !== undefined) {
      found = Number(size[1]);
    }
  }
  return found;
}

/**
 * The narrowest a HUD field can be, in CSS pixels.
 *
 * `grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr))`. The `7rem` is a
 * **floor** rather than an `auto`, so the track never grows to fit its content
 * — which is the whole reason a word overflows one at all.
 */
const NARROWEST_TRACK_PIXELS = 112;

/**
 * How wide the widest of the three settled words is at 2.5 rem, in CSS pixels.
 *
 * Measured in the repository's pinned Chromium (`@playwright/test` 1.63.0)
 * against this stylesheet at a 390 px viewport: `Matched` 151 px, `Finished`
 * 144 px, `Beaten` 120 px. `Matched` is the widest despite being a character
 * shorter than `Finished`, which is why the bound is a measurement rather than
 * a character count.
 */
const WIDEST_WORD_PIXELS = 151;

describe('a HUD value that is a word is set small enough for its track (#259)', () => {
  it('declares the word rule at all, so the comparisons below are not vacuous', () => {
    // A renamed or deleted selector would otherwise make every assertion here
    // pass over nothing — the failure shape this repository has shipped
    // repeatedly, and the one `hud-surface.a11y.test.ts` opens with too.
    expect(fontSizeRem('.oyl-hud__value--word')).toBeDefined();
    expect(fontSizeRem('.oyl-hud__value')).toBeDefined();
  });

  it('sets a word smaller than the magnitude it replaces', () => {
    const word = fontSizeRem('.oyl-hud__value--word') ?? 0;
    const magnitude = fontSizeRem('.oyl-hud__value') ?? 0;

    expect(word).toBeLessThan(magnitude);
  });

  it('sets it small enough that the widest of the three fits the narrowest track', () => {
    const word = fontSizeRem('.oyl-hud__value--word') ?? 0;
    const magnitude = fontSizeRem('.oyl-hud__value') ?? 0;

    // Type scales linearly, so the measured width does too: the word's width at
    // `word` rem is `WIDEST_WORD_PIXELS × word / magnitude`.
    expect((WIDEST_WORD_PIXELS * word) / magnitude).toBeLessThanOrEqual(NARROWEST_TRACK_PIXELS);
  });

  it('does not break the word instead, which would read as a different word', () => {
    // `overflow-wrap` or `word-break` would contain the overflow and leave
    // `Finish`, `Beat` and `Match` on a line of their own — three different
    // words, on a panel #94 requires a rider to read in one glance. Containment
    // is the wrong repair here and this is what says so.
    const block = /\.oyl-hud__value(?:--word)?\s*\{([^}]*)\}/g;
    for (const [, body] of declarations.matchAll(block)) {
      expect(body).not.toMatch(/\b(overflow-wrap|word-break|hyphens)\s*:/);
    }
  });
});
