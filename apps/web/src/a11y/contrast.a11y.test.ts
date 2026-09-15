// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #48's sixth acceptance criterion, contrast half: every pair of colours the
 * design system places together clears WCAG 2.2 Level AA, checked
 * automatically.
 *
 * The colour-is-not-the-only-signal half is asserted in
 * `../design/StatusMessage.test.tsx` and in `routes.a11y.test.tsx`, where the
 * current navigation item is required to carry `aria-current` and not only a
 * palette change.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../design/contrast';
import { COLOUR_TOKENS, CONTRAST_REQUIREMENTS } from '../design/tokens';

/** The stylesheet the HUD's own rule lives in. @see the last describe below. */
const themeCss = readFileSync(
  fileURLToPath(new URL('../design/theme.css', import.meta.url)),
  'utf8',
);

describe('every declared pair meets WCAG 2.2 AA', () => {
  for (const requirement of CONTRAST_REQUIREMENTS) {
    it(`${requirement.foreground} on ${requirement.background} — ${requirement.where}`, () => {
      const ratio = contrastRatio(
        COLOUR_TOKENS[requirement.foreground],
        COLOUR_TOKENS[requirement.background],
      );
      expect(
        Number(ratio.toFixed(2)),
        `${requirement.foreground} (${COLOUR_TOKENS[requirement.foreground]}) on ` +
          `${requirement.background} (${COLOUR_TOKENS[requirement.background]}) is ` +
          `${ratio.toFixed(2)}:1, below the ${String(requirement.minimum)}:1 this pair needs`,
      ).toBeGreaterThanOrEqual(requirement.minimum);
    });
  }
});

describe('the requirement list is worth checking', () => {
  it('covers every colour token, so none is unaccounted for', () => {
    // Without this, a token could be added, used in the CSS, and never appear
    // in a requirement — and the contrast suite would go on passing while the
    // new colour was untested. This is the assertion that makes the list above
    // a gate rather than a sample.
    const covered = new Set(
      CONTRAST_REQUIREMENTS.flatMap((requirement) => [
        requirement.foreground,
        requirement.background,
      ]),
    );
    const uncovered = Object.keys(COLOUR_TOKENS).filter((token) => !covered.has(token as never));
    expect(uncovered).toEqual([]);
  });

  it('names a real threshold for each pair, not an invented one', () => {
    for (const requirement of CONTRAST_REQUIREMENTS) {
      expect([3, 4.5]).toContain(requirement.minimum);
    }
  });
});

/**
 * The HUD panel is opaque, which is what makes its contrast checkable at all —
 * #94, re-asserted by #286.
 *
 * ⚠️ **This is prose in three files and was a gate in none of them.**
 * `tokens.ts` §`hudSurface`, `theme.css` and #94's own criterion all say the
 * panel is opaque *"whatever the world is doing"*, and every pair above is
 * computed against `hudSurface` on that premise. #286 is what made it worth
 * enforcing: the world behind the HUD now has a light direction, so the range
 * of colours that can appear behind the panel is wider than it was — and a
 * translucent panel would quietly turn #94's *measured* criterion into an
 * unmeasurable one, because there would be no second colour to check against.
 *
 * Two ways that could happen, and both are checked: the token could grow an
 * alpha channel, or the rule could be given an `opacity`.
 */
describe('the HUD panel is opaque, so the pairs above mean something', () => {
  const hudRule = /\.oyl-hud\s*\{([^}]*)\}/.exec(themeCss)?.[1] ?? '';

  it('finds the rule it is about to assert on', () => {
    // Without this the regex could stop matching — a rename, a reformat — and
    // every assertion below would pass over an empty string.
    expect(hudRule).toMatch(/background/);
  });

  it('gives the panel a colour with no alpha channel', () => {
    // Six hex digits, not eight: `#10161c` is opaque, `#10161cc0` is not, and
    // `contrastRatio` would go on reporting the ratio of the opaque one.
    expect(COLOUR_TOKENS.hudSurface).toMatch(/^#[0-9a-f]{6}$/i);
    expect(hudRule).toMatch(/background:\s*var\(--oyl-color-hud-surface\)/);
  });

  it('does not make the panel translucent some other way', () => {
    // `opacity` on the panel would fade the text with it; a background with an
    // alpha would let the world through behind the text. Either defeats the
    // premise, and neither would touch the token.
    expect(hudRule).not.toMatch(/\bopacity\s*:/);
    expect(hudRule).not.toMatch(/\b(?:rgba|hsla)\(/);
  });
});
