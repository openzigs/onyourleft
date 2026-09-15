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

import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../design/contrast';
import { COLOUR_TOKENS, CONTRAST_REQUIREMENTS } from '../design/tokens';

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
