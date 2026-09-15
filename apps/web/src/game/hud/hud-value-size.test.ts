// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The stylesheet end of `fields.ts` §`HudReading.word` — #259 — and, since
 * #307's review, the floor under the HUD's *supporting* text as well.
 *
 * Two questions about HUD type size, in the one file that already reads this
 * stylesheet for one of them. The second block at the bottom says what it is
 * for; it is deliberately a **floor** where the first is a ceiling, because the
 * two failures are opposite: a word too large spills out of its track, and a
 * label too small is simply unreadable and spills out of nothing.
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

import { FONT_SIZE_TOKENS } from '../../design/tokens';

const themeCss = readFileSync(
  fileURLToPath(new URL('../../design/theme.css', import.meta.url)),
  'utf8',
);

/** `'0.8rem'` → `0.8`. Anything not in `rem` throws rather than being guessed at. */
function remOf(value: string): number {
  const match = /^([\d.]+)rem$/.exec(value.trim());
  if (match?.[1] === undefined) {
    throw new Error(
      `"${value}" is not a rem. A px value does not scale with the reader's own font size, ` +
        'which is the first thing somebody with poor eyesight changes.',
    );
  }
  return Number(match[1]);
}

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

/**
 * The floor under the HUD's *supporting* text — #307's review.
 *
 * ## Why this did not exist and had to
 *
 * Everything above is about the HUD's big numbers. The small text beside them
 * had no floor of any kind, and #307 moved it: adopting a 1.25 type scale took
 * `--oyl-font-size-sm` from 0.875 rem (14px) to 0.8 rem (12.8px), which is step
 * −1 of the stated ratio. That token is what `.oyl-hud__label`,
 * `.oyl-hud__stale`, `.oyl-hud__detail` and `.oyl-hud__profile-text` are all
 * set in, so every one of them shrank, and nothing in the repository said so —
 * `hud.browser.spec.ts` measures overflow, and overflow only gets *easier* as
 * text shrinks, so the browser gate goes greener rather than redder.
 *
 * ⚠️ `.oyl-hud__stale` is the one that matters most. It is the mark that tells
 * a rider a sensor has **dropped** rather than read zero — `game/hud/fields.ts`
 * §`NO_READING` — and it is read at arm's length on a handlebar. A size it can
 * be reduced to without anything noticing is the wrong arrangement for that
 * particular piece of text.
 *
 * ## What the floor is, and what it is not
 *
 * It is the size that ships, so this test is a ratchet rather than a
 * retrospective judgement: the 14px → 12.8px step is recorded as the deliberate
 * cost of putting the scale on a ratio (#307's second acceptance criterion),
 * and a *further* reduction is a red build. It is not a claim that 12.8px is
 * the right size for a handlebar — nobody in the loop has ridden with this, and
 * `docs/validation/0001-trainer-and-sensors.md` is where that would be settled.
 */
describe('the HUD’s supporting text has a floor (#307 review)', () => {
  /**
   * The smallest a HUD label, detail or staleness mark may be set, in rem.
   *
   * ⚠️ Deliberately NOT written as `FONT_SIZE_TOKENS.sm`. A floor defined as
   * "whatever the token currently is" is the vacuous test this repository keeps
   * finding: it moves with the thing it is meant to constrain and can never go
   * red. This is a number, and changing it is a diff somebody has to justify.
   */
  const MINIMUM_HUD_SUPPORTING_REM = 0.8;

  /** Every HUD rule that takes its size from the shared small-text token. */
  const SUPPORTING = [
    '.oyl-hud__label',
    '.oyl-hud__stale',
    '.oyl-hud__detail',
    '.oyl-hud__profile-text',
  ];

  /**
   * The size a selector is set in, resolving one `var(--oyl-font-size-*)`.
   *
   * ⚠️ `fontSizeRem` above reads a **literal** `rem`, and not one of these four
   * rules has one — every one is `font-size: var(--oyl-font-size-sm)`. A floor
   * built on that helper reports `undefined` for all four and, with a `?? 0`,
   * fails on every run for the wrong reason; without one it would have passed
   * on every run for the wrong reason. Resolving the token is also what makes
   * this check the **join**: a rule re-pointed at a different token is read
   * here as the size that token holds, not as the size it used to.
   */
  function resolvedFontSizeRem(selector: string): number | undefined {
    const literal = fontSizeRem(selector);
    if (literal !== undefined) {
      return literal;
    }
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
      const reference = /font-size:\s*var\(\s*--oyl-font-size-([a-z]+)\s*\)/.exec(
        declarations.slice(opened + 1, closed),
      );
      const token = reference?.[1];
      if (token !== undefined && token in FONT_SIZE_TOKENS) {
        found = remOf(FONT_SIZE_TOKENS[token as keyof typeof FONT_SIZE_TOKENS]);
      }
    }
    return found;
  }

  it.each(SUPPORTING)(
    '%s is declared, so the floor below is not applied to nothing',
    (selector) => {
      expect(
        resolvedFontSizeRem(selector),
        `theme.css gives ${selector} no font-size this test can resolve, so this floor checks ` +
          'nothing. A renamed selector and a size written in px both land here',
      ).toBeDefined();
    },
  );

  it.each(SUPPORTING)('%s is at or above the floor', (selector) => {
    expect(resolvedFontSizeRem(selector) ?? 0).toBeGreaterThanOrEqual(MINIMUM_HUD_SUPPORTING_REM);
  });

  it('is a floor the shared token cannot slide under', () => {
    // The four selectors above are all set in `--oyl-font-size-sm`, so the
    // assertions above are really assertions about that token. Saying so here
    // means a palette-wide edit fails with the reason attached, rather than
    // four selector names and no mention of the thing that actually moved.
    expect(
      remOf(FONT_SIZE_TOKENS.sm),
      'the `sm` type token is what the HUD’s labels, its detail line and its dropped-sensor ' +
        'mark are all set in. Reducing it reduces all four at once, on the one screen that is ' +
        'read at arm’s length on a handlebar.',
    ).toBeGreaterThanOrEqual(MINIMUM_HUD_SUPPORTING_REM);
  });
});
