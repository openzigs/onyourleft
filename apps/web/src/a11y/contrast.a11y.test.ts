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

import { AA_LARGE_TEXT_OR_NON_TEXT, contrastRatio } from '../design/contrast';
import {
  COLOUR_TOKENS,
  CONTRAST_REQUIREMENTS,
  LINK_STATE_TOKENS,
  LINK_SURFACES,
  PLATFORM_CHECK_MARK,
  THEMES,
  paletteColours,
} from '../design/tokens';

/*
 * #672: every pair below is walked in BOTH palettes. The owner's ruling is that
 * every colour pair passes in both themes, and a pair is a pair of values — so
 * the dark palette is not "the light one, inverted", it is a second set of
 * measurements, each held to its own threshold and its own recorded margin.
 */
describe.each(THEMES)('every declared pair meets WCAG 2.2 AA — the %s palette', (theme) => {
  const colours = paletteColours(theme);
  for (const requirement of CONTRAST_REQUIREMENTS) {
    it(`${requirement.foreground} on ${requirement.background} — ${requirement.where}`, () => {
      const ratio = contrastRatio(colours[requirement.foreground], colours[requirement.background]);
      expect(
        Number(ratio.toFixed(2)),
        `${theme}: ${requirement.foreground} (${colours[requirement.foreground]}) on ` +
          `${requirement.background} (${colours[requirement.background]}) is ` +
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
describe.each(THEMES)(
  'no pair has eroded since the margin was last recorded — the %s palette',
  (theme) => {
    const colours = paletteColours(theme);
    for (const requirement of CONTRAST_REQUIREMENTS) {
      it(`${requirement.foreground} on ${requirement.background} still measures ${String(
        requirement.measured[theme],
      )}`, () => {
        const recorded = requirement.measured[theme];
        const ratio = Number(
          contrastRatio(colours[requirement.foreground], colours[requirement.background]).toFixed(
            2,
          ),
        );
        expect(
          ratio,
          `${theme}: this pair now measures ${String(ratio)}:1 where ${String(recorded)}:1 was ` +
            'recorded. That is erosion: the pair may still clear its threshold, but the margin ' +
            'it had is gone and #307 forbids spending it silently.',
        ).toBeGreaterThanOrEqual(recorded);
        expect(
          ratio,
          `${theme}: this pair now measures ${String(ratio)}:1 where ${String(recorded)}:1 was ` +
            'recorded — an improvement, which is welcome and has to be written down. Update ' +
            '`measured` in tokens.ts so the next change is checked against the new margin and ' +
            'not the old one.',
        ).toBeLessThanOrEqual(recorded);
      });
    }

    it('records a margin that is itself above the threshold', () => {
      // Without this, `measured` could be set below `minimum` and the erosion
      // floor would sit under the standard — a floor that permits a failure.
      for (const requirement of CONTRAST_REQUIREMENTS) {
        expect(
          requirement.measured[theme],
          `${theme}: ${requirement.foreground} on ${requirement.background} records a margin ` +
            'below its own threshold',
        ).toBeGreaterThanOrEqual(requirement.minimum);
      }
    });
  },
);

/**
 * The check mark on a checked box is the platform's glyph, not a token (#667,
 * #672 — #744's review found the dark palette's is Chromium's own grey, not
 * `accentInk`), so it is not in `CONTRAST_REQUIREMENTS`. It is held here the
 * same way: its ratio on the palette's `accent`, exactly, and at least 3:1.
 * `browser/shell.browser.spec.ts` §"#667" reads the colour off the pixels.
 */
describe.each(THEMES)('the platform check mark on the %s accent', (theme) => {
  it('measures what was recorded, in both directions, and clears SC 1.4.11', () => {
    const { colour, measured } = PLATFORM_CHECK_MARK[theme];
    const ratio = Number(contrastRatio(colour, paletteColours(theme).accent).toFixed(2));
    expect(ratio).toBe(measured);
    expect(measured).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_NON_TEXT);
  });
});

describe('the HUD measures the same in both palettes (#672)', () => {
  it('records one margin for a pair whose colours are both HUD tokens', () => {
    // The HUD is theme-independent, so a HUD pair recorded differently in the
    // two palettes is a HUD token that moved with the page.
    const hud = CONTRAST_REQUIREMENTS.filter(
      (requirement) =>
        requirement.foreground.startsWith('hud') && requirement.background.startsWith('hud'),
    );
    expect(hud.length).toBeGreaterThan(0);
    for (const requirement of hud) {
      expect(requirement.measured.dark, requirement.where).toBe(requirement.measured.light);
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
