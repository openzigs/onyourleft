// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * WCAG 2.2 contrast ratio, computed rather than eyeballed.
 *
 * #48's sixth acceptance criterion asks that contrast "meets the stated
 * standard, checked automatically". The standard this program states is
 * **WCAG 2.2 Level AA**, whose two thresholds are {@link AA_TEXT} for body text
 * and {@link AA_LARGE_TEXT_OR_NON_TEXT} for large text and for the boundaries of
 * user-interface components.
 *
 * ## Why this is computed here rather than delegated
 *
 * The obvious answer is a browser-driven checker, and every browser-driven
 * checker disables its contrast rule under a headless DOM — jsdom performs no
 * layout and resolves no CSS custom property, so the rule has nothing to read
 * and reports nothing. A suite that ran one and saw no violation would have
 * proved only that the rule never ran.
 *
 * So contrast is checked one level up, at the **tokens**, where the values are
 * known exactly and no layout is needed. `tokens.ts` declares which pairs are
 * actually placed against each other and what each pair must clear;
 * `theme.css` is asserted to carry the same values, so the numbers checked here
 * are the numbers the browser paints.
 *
 * The formulae are WCAG 2.2's, which are public specification text:
 * relative luminance from the sRGB channels, and `(L1 + 0.05) / (L2 + 0.05)`.
 */

/** Body text and any text below 18.66px bold / 24px regular. */
export const AA_TEXT = 4.5;

/**
 * Large text, and the visual boundary of a user-interface component.
 *
 * WCAG 2.2 SC 1.4.11 puts the borders of a control and the focus indicator on
 * this threshold rather than the text one.
 */
export const AA_LARGE_TEXT_OR_NON_TEXT = 3;

/** Thrown when a colour is not a form this module can read. */
export class ColourFormatError extends Error {
  override readonly name = 'ColourFormatError';

  constructor(value: string) {
    super(
      `"${value}" is not a six-digit #rrggbb colour. The design tokens are held in one ` +
        'notation on purpose: a contrast check that silently skipped a value it could not ' +
        'parse would report a palette as compliant without ever having looked at it.',
    );
  }
}

const SIX_DIGIT_HEX = /^#[0-9a-f]{6}$/i;

/**
 * The three sRGB channels of a `#rrggbb` colour, each 0–255.
 *
 * Deliberately narrow. Three- and eight-digit hex, `rgb()` and `color()` are all
 * rejected rather than approximated: an alpha channel in particular has no
 * defined contrast ratio without knowing what is behind it, and quietly
 * dropping it would turn a translucent overlay into a passing score it does not
 * have.
 */
export function parseHexColour(value: string): readonly [number, number, number] {
  if (!SIX_DIGIT_HEX.test(value)) {
    throw new ColourFormatError(value);
  }
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

/** WCAG 2.2's per-channel linearisation of an sRGB value. */
function linearise(channel: number): number {
  const proportion = channel / 255;
  return proportion <= 0.04045 ? proportion / 12.92 : Math.pow((proportion + 0.055) / 1.055, 2.4);
}

/** WCAG 2.2 relative luminance: 0 for black, 1 for white. */
export function relativeLuminance(colour: string): number {
  const [red, green, blue] = parseHexColour(colour);
  return 0.2126 * linearise(red) + 0.7152 * linearise(green) + 0.0722 * linearise(blue);
}

/**
 * The contrast ratio between two colours, from 1 (identical) to 21 (black on
 * white).
 *
 * Order-independent, as WCAG defines it: the lighter colour is always the
 * numerator. A caller that had to remember which argument was the foreground
 * would eventually pass them the other way round and read a ratio below 1 as a
 * failure of the palette rather than of the call.
 */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
