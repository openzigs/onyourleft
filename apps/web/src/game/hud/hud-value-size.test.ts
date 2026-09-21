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
/**
 * ⚠️ **The WHOLE selector, since #423, and not merely its tail.** This used to
 * match `selector` wherever it was followed by `,` or `{` — which was exact
 * while no rule was written as a descendant of another. #423 added
 * `.oyl-hud__fields--secondary .oyl-hud__value`, whose tail *is*
 * `.oyl-hud__value`, so the old pattern read the secondary tier's 1.5 rem as
 * the primary magnitude and every comparison below was made against the wrong
 * number. The lookbehind requires the selector to OPEN its rule: start of
 * file, or straight after a `}`, a `{` (the first rule in a media block) or a
 * `,`.
 */
function fontSizeRem(selector: string): number | undefined {
  const occurrences = new RegExp(
    `(?<=(?:^|[{},])\\s*)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*[,{])`,
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

/** The root font size every rem here resolves against at the default zoom. */
const ROOT_PIXELS = 16;

/** The secondary tier's own selectors — `theme.css`, and `fields.ts` §`ReadingTier`. */
const SECONDARY_VALUE = '.oyl-hud__fields--secondary .oyl-hud__value';
const SECONDARY_WORD = '.oyl-hud__fields--secondary .oyl-hud__value--word';

/**
 * The narrowest a track of the SECONDARY tier can be, in CSS pixels — read out
 * of the stylesheet rather than typed here.
 *
 * `grid-template-columns: repeat(auto-fit, minmax(5.5rem, 1fr))`. The floor is
 * a **floor** rather than an `auto`, so the track never grows to fit its
 * content — which is the whole reason a word overflows one at all.
 *
 * ⚠️ **Re-derived for #423 rather than carried over**, and a reviewer who
 * remembers `NARROWEST_TRACK_PIXELS = 112` is reading the old file. That was
 * the `7rem` floor of the single grid every field used to share. The only
 * values that are ever words are the gap outcomes, every gap is a secondary
 * reading now, and the secondary tier has its own, narrower floor — so a hand
 * copy of `112` would have gone on passing against a track that no longer
 * holds a word. Parsed, so moving the floor in `theme.css` moves this bound in
 * the same edit.
 */
function narrowestSecondaryTrackPixels(): number | undefined {
  const rule = /\.oyl-hud__fields--secondary\s*\{([^}]*)\}/.exec(declarations)?.[1];
  const floor = /minmax\(\s*([\d.]+)rem\s*,/.exec(rule ?? '')?.[1];
  return floor === undefined ? undefined : Number(floor) * ROOT_PIXELS;
}

/**
 * How wide the widest of the three settled words is, in CSS pixels, **at the
 * size it was measured at** — {@link MEASURED_AT_REM}.
 *
 * Measured in the repository's pinned Chromium (`@playwright/test` 1.63.0)
 * against this stylesheet at a 390 px viewport: `Matched` 151 px, `Finished`
 * 144 px, `Beaten` 120 px. `Matched` is the widest despite being a character
 * shorter than `Finished`, which is why the bound is a measurement rather than
 * a character count.
 */
const WIDEST_WORD_PIXELS = 151;

/**
 * The type size {@link WIDEST_WORD_PIXELS} was taken at.
 *
 * ⚠️ A constant rather than `fontSizeRem('.oyl-hud__value')`, which is what the
 * scaling used to divide by. The two were the same number — 2.5 — and meant
 * different things: one is where a measurement was taken and the other is a
 * declaration somebody may change, and scaling by the declaration makes the
 * bound move when the primary tier's size does, which has nothing to do with
 * how wide a word is.
 */
const MEASURED_AT_REM = 2.5;

/**
 * How much larger a primary reading must be than a secondary one — #423.
 *
 * *"Primary readings are visibly larger than secondary ones"* is the criterion,
 * and "visibly" is a ratio or it is nothing: 2.5 rem over 2.4 rem satisfies
 * *larger*. One and a half is a step and a bit on a major-third scale, which is
 * the smallest difference this design system treats as a change of level at
 * all (`design/tokens.ts` §`TYPE_SCALE_RATIO` is 1.25).
 */
const MINIMUM_TIER_RATIO = 1.5;

describe('the HUD is a hierarchy, not a grid of equals (#423)', () => {
  it('declares both tiers, so the ratio below is not taken over nothing', () => {
    expect(fontSizeRem('.oyl-hud__value')).toBeDefined();
    expect(fontSizeRem(SECONDARY_VALUE)).toBeDefined();
  });

  it('sets a primary reading visibly larger than a secondary one', () => {
    const primary = fontSizeRem('.oyl-hud__value') ?? 0;
    const secondary = fontSizeRem(SECONDARY_VALUE) ?? Number.POSITIVE_INFINITY;

    expect(primary / secondary).toBeGreaterThanOrEqual(MINIMUM_TIER_RATIO);
  });
});

describe('a HUD value that is a word is set small enough for its track (#259)', () => {
  it('declares the word rule at all, so the comparisons below are not vacuous', () => {
    // A renamed or deleted selector would otherwise make every assertion here
    // pass over nothing — the failure shape this repository has shipped
    // repeatedly, and the one `hud-surface.a11y.test.ts` opens with too.
    expect(fontSizeRem('.oyl-hud__value--word')).toBeDefined();
    expect(fontSizeRem(SECONDARY_WORD)).toBeDefined();
    expect(fontSizeRem(SECONDARY_VALUE)).toBeDefined();
    expect(narrowestSecondaryTrackPixels()).toBeDefined();
  });

  it('sets a word smaller than the magnitude it replaces', () => {
    // ⚠️ The SECONDARY magnitude, since #423: every value that can be a word is
    // a gap, and every gap is a secondary reading. Comparing against the
    // primary 2.5 rem would pass for a word set LARGER than the numbers beside
    // it.
    const word = fontSizeRem(SECONDARY_WORD) ?? 0;
    const magnitude = fontSizeRem(SECONDARY_VALUE) ?? 0;

    expect(word).toBeLessThan(magnitude);
  });

  it('sets the word the same size wherever the class lands', () => {
    // One declaration serves both selectors today. If they are ever split, a
    // word outside the secondary list must not be the larger of the two — that
    // is the one that would be laid out unchecked.
    expect(fontSizeRem('.oyl-hud__value--word')).toBe(fontSizeRem(SECONDARY_WORD));
  });

  it('sets it small enough that the widest of the three fits the narrowest track', () => {
    const word = fontSizeRem(SECONDARY_WORD) ?? Number.POSITIVE_INFINITY;
    const track = narrowestSecondaryTrackPixels() ?? 0;

    // Type scales linearly, so the measured width does too: the word's width at
    // `word` rem is `WIDEST_WORD_PIXELS × word / MEASURED_AT_REM`.
    expect((WIDEST_WORD_PIXELS * word) / MEASURED_AT_REM).toBeLessThanOrEqual(track);
  });

  it('does not break the word instead, which would read as a different word', () => {
    // `overflow-wrap` or `word-break` would contain the overflow and leave
    // `Finish`, `Beat` and `Match` on a line of their own — three different
    // words, on a panel #94 requires a rider to read in one glance. Containment
    // is the wrong repair here and this is what says so.
    const block = /\.oyl-hud__value(?:--word)?\s*\{([^}]*)\}/g;
    let seen = 0;
    for (const [, body] of declarations.matchAll(block)) {
      seen += 1;
      expect(body).not.toMatch(/\b(overflow-wrap|word-break|hyphens)\s*:/);
    }
    // Four since #423: the value, the word, and each again under the secondary
    // tier. A loop over nothing asserts nothing.
    expect(seen).toBeGreaterThanOrEqual(4);
  });
});

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
    // #423. The secondary tier sets its units smaller so that `144 km/h` fits a
    // 5.5 rem track, and "smaller" is exactly what this floor is for.
    '.oyl-hud__fields--secondary .oyl-hud__unit',
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
      `(?<=(?:^|[{},])\\s*)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s*[,{])`,
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
