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
import {
  COLOUR_TOKENS,
  CONTRAST_REQUIREMENTS,
  LINK_STATE_TOKENS,
  LINK_SURFACES,
} from '../design/tokens';

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

/**
 * #307's fifth criterion, which is a different question from the one above.
 *
 * *"No contrast pair's measured ratio falls, even where it stays above its
 * threshold — a change that quietly erodes margin is the one this gate would
 * let through."* Every pair in this palette clears AA with room, and a palette
 * edit that spends all of that room passes every assertion in the block above
 * while leaving the next edit nothing to spend. So the margin itself is
 * recorded, and it is checked in both directions.
 */
describe('no pair has eroded since the margin was last recorded', () => {
  for (const requirement of CONTRAST_REQUIREMENTS) {
    it(`${requirement.foreground} on ${requirement.background} still measures ${String(
      requirement.measured,
    )}`, () => {
      const ratio = Number(
        contrastRatio(
          COLOUR_TOKENS[requirement.foreground],
          COLOUR_TOKENS[requirement.background],
        ).toFixed(2),
      );
      expect(
        ratio,
        `this pair now measures ${String(ratio)}:1 where ${String(requirement.measured)}:1 was ` +
          'recorded. That is erosion: the pair may still clear its threshold, but the margin ' +
          'it had is gone and #307 forbids spending it silently.',
      ).toBeGreaterThanOrEqual(requirement.measured);
      expect(
        ratio,
        `this pair now measures ${String(ratio)}:1 where ${String(requirement.measured)}:1 was ` +
          'recorded — an improvement, which is welcome and has to be written down. Update ' +
          '`measured` in tokens.ts so the next change is checked against the new margin and ' +
          'not the old one.',
      ).toBeLessThanOrEqual(requirement.measured);
    });
  }

  it('records a margin that is itself above the threshold', () => {
    // Without this, `measured` could be set below `minimum` and the erosion
    // floor would sit under the standard — a floor that permits a failure.
    for (const requirement of CONTRAST_REQUIREMENTS) {
      expect(
        requirement.measured,
        `${requirement.foreground} on ${requirement.background} records a margin below its own ` +
          'threshold',
      ).toBeGreaterThanOrEqual(requirement.minimum);
    }
  });
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

  it('pairs every link state with every surface a link sits on, at the text threshold', () => {
    // #661's first criterion: each state, each surface. The pairs are built
    // from a table in tokens.ts, and a cell dropped from that table is a pair
    // dropped from the list with nothing else going red — `covers every colour
    // token` above is satisfied by any ONE pair per state. This is what counts
    // all thirty-two.
    const missing = LINK_STATE_TOKENS.flatMap((state) =>
      LINK_SURFACES.filter(
        (surface) =>
          !CONTRAST_REQUIREMENTS.some(
            (requirement) =>
              requirement.foreground === state &&
              requirement.background === surface &&
              requirement.minimum === 4.5,
          ),
      ).map((surface) => `${state} on ${surface}`),
    );
    expect(missing).toEqual([]);
  });

  it('pairs the focus ring with every surface a link sits on', () => {
    // A focused link draws the ring onto the surface behind it, so every
    // surface a link can sit on is a surface the ring lands on.
    const missing = LINK_SURFACES.filter(
      (surface) =>
        !CONTRAST_REQUIREMENTS.some(
          (requirement) => requirement.foreground === 'focus' && requirement.background === surface,
        ),
    );
    expect(missing).toEqual([]);
  });

  it('names a real threshold for each pair, not an invented one', () => {
    for (const requirement of CONTRAST_REQUIREMENTS) {
      expect([3, 4.5]).toContain(requirement.minimum);
    }
  });
});
