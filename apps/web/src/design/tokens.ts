// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The design tokens, and the contrast requirements that constrain them.
 *
 * ## This file is the source of truth, and `theme.css` is checked against it
 *
 * The palette has to exist twice — once as CSS custom properties the browser
 * paints from, and once as values a test can read without a layout engine. Two
 * copies that can drift would make the contrast check in `contrast.a11y.test.ts`
 * a check on a file nobody renders. So `theme.css` is **parsed and compared to
 * this module** by `theme.a11y.test.ts`, and a colour changed in one place and
 * not the other fails the build.
 *
 * ## The palette is ours
 *
 * [ADR 0009](../../../../docs/adr/0009-clean-room-posture.md) rule L1 bars this
 * product from reproducing another product's "screen layout, colour palette and
 * icon set as a set", which is trade dress and is protected independently of
 * any mark. The hues below are a desaturated teal and a warm neutral, chosen
 * to clear WCAG AA against the two surfaces and for no other reason. There are
 * no brand oranges, no brand blues, and no imported icon set — the status
 * glyphs in `StatusMessage.tsx` are three characters of text.
 *
 * ## Colour is never the only signal
 *
 * Criterion 6 of #48. It is enforced one level up, in the primitives: a
 * `StatusMessage` renders a word ("Warning", "Error") and a glyph beside its
 * colour, and `StatusMessage.test.tsx` asserts the two variants differ in text
 * with the colour removed. A token file cannot enforce that on its own, which
 * is why the rule lives with the component and this note points at it.
 */

import { AA_LARGE_TEXT_OR_NON_TEXT, AA_TEXT } from './contrast';

/**
 * Every colour the product paints, in one notation.
 *
 * Six-digit hex without exception, because `contrast.ts` refuses anything else
 * rather than approximating an alpha channel it cannot resolve.
 */
export const COLOUR_TOKENS = {
  /** The page behind everything. */
  canvas: '#ffffff',
  /** A panel lifted off the canvas: cards, the header, the empty states. */
  surface: '#f2f5f4',
  /** The boundary of a control or a panel. A non-text contrast, not a text one. */
  border: '#767e7e',
  /** Body text. */
  ink: '#141b1a',
  /** Secondary text: captions, helper text, the "nothing here yet" line. */
  inkMuted: '#4a5b5c',
  /** The one accent: primary buttons, links, the active navigation item. */
  accent: '#0b5c55',
  /** The accent under a pointer or a press. */
  accentHover: '#07443f',
  /** Text and glyphs drawn on `accent` or `accentHover`. */
  accentInk: '#ffffff',
  /**
   * The focus indicator.
   *
   * Drawn with `outline-offset`, so it lands on `canvas` or `surface` and never
   * on the control's own fill — which is why the requirements below pair it
   * with those two and not with `accent`. A ring the same darkness as the
   * button it surrounds is invisible exactly when it matters, and offsetting it
   * is the fix rather than a second focus colour per component.
   */
  focus: '#141b1a',

  /** Neutral information. */
  infoSurface: '#e3f0f4',
  infoInk: '#0e4a57',
  infoBorder: '#2c7288',

  /** Something worked. */
  successSurface: '#e2f2e9',
  successInk: '#14513a',
  successBorder: '#2a7a58',

  /** Something is degraded but usable — the Linux-with-a-flag case. */
  warningSurface: '#fbefda',
  warningInk: '#654100',
  warningBorder: '#8a6212',

  /** Something cannot work here — the Safari and Firefox case. */
  dangerSurface: '#fbe8e8',
  dangerInk: '#7a1d1d',
  dangerBorder: '#a83232',
} as const satisfies Record<string, string>;

/** The name of a colour token. */
export type ColourToken = keyof typeof COLOUR_TOKENS;

/** Spacing, on a 4px base. Unitless names so a component never writes a pixel. */
export const SPACE_TOKENS = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2.5rem',
} as const satisfies Record<string, string>;

/** The type scale. `md` is body text. */
export const FONT_SIZE_TOKENS = {
  sm: '0.875rem',
  md: '1rem',
  lg: '1.25rem',
  xl: '1.75rem',
  /**
   * A live ride metric, read from two metres away while pedalling.
   *
   * #49's eighth acceptance criterion asks for a **stated** minimum size for
   * the primary metrics, and this is it. It is not a heading size with a
   * different name: `xl` is 1.75 rem and is what a section title uses, and a
   * power number at 1.75 rem is unreadable from a bike.
   * `ride/MetricGrid.tsx` states the floor and
   * `a11y/ride-legibility.a11y.test.ts` fails the build if this value drops
   * below it.
   */
  metric: '4rem',
} as const satisfies Record<string, string>;

/**
 * A pair of colours that end up against each other, and what it must clear.
 *
 * Declared rather than inferred. A check that tried every pair in the palette
 * would fail on combinations nothing renders — `inkMuted` on `accent` is not a
 * thing this product draws — and the usual response to that noise is to lower
 * the threshold until it passes, which is worse than not checking.
 */
export interface ContrastRequirement {
  readonly foreground: ColourToken;
  readonly background: ColourToken;
  /** {@link AA_TEXT} or {@link AA_LARGE_TEXT_OR_NON_TEXT}. */
  readonly minimum: number;
  /** Where this pair appears, so a failure names a screen and not a hex code. */
  readonly where: string;
}

/**
 * Every foreground/background pair the design system actually places together.
 *
 * `contrast.a11y.test.ts` walks this list. Adding a component that pairs two
 * tokens not listed here is the point at which a line gets added — and the
 * point at which somebody has to say what the pair is for.
 */
export const CONTRAST_REQUIREMENTS: readonly ContrastRequirement[] = [
  { foreground: 'ink', background: 'canvas', minimum: AA_TEXT, where: 'body text on the page' },
  { foreground: 'ink', background: 'surface', minimum: AA_TEXT, where: 'body text on a panel' },
  {
    foreground: 'inkMuted',
    background: 'canvas',
    minimum: AA_TEXT,
    where: 'helper and empty-state text on the page',
  },
  {
    foreground: 'inkMuted',
    background: 'surface',
    minimum: AA_TEXT,
    where: 'helper and empty-state text on a panel',
  },
  {
    foreground: 'border',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    where: 'the edge of a control on the page (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'border',
    background: 'surface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    where: 'the edge of a control on a panel (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'accentInk',
    background: 'accent',
    minimum: AA_TEXT,
    where: 'the label of a primary button',
  },
  {
    foreground: 'accentInk',
    background: 'accentHover',
    minimum: AA_TEXT,
    where: 'the label of a primary button under a pointer',
  },
  { foreground: 'accent', background: 'canvas', minimum: AA_TEXT, where: 'link text' },
  {
    foreground: 'accent',
    background: 'surface',
    minimum: AA_TEXT,
    where: 'link text and the active navigation item in the header',
  },
  {
    foreground: 'focus',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    where: 'the focus ring, offset onto the page (WCAG 2.2 SC 2.4.13)',
  },
  {
    foreground: 'focus',
    background: 'surface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    where: 'the focus ring, offset onto a panel (WCAG 2.2 SC 2.4.13)',
  },

  { foreground: 'infoInk', background: 'infoSurface', minimum: AA_TEXT, where: 'an info message' },
  {
    foreground: 'infoBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    where: 'the edge of an info message',
  },
  {
    foreground: 'successInk',
    background: 'successSurface',
    minimum: AA_TEXT,
    where: 'a success message',
  },
  {
    foreground: 'successBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    where: 'the edge of a success message',
  },
  {
    foreground: 'warningInk',
    background: 'warningSurface',
    minimum: AA_TEXT,
    where: 'a warning message — the Chrome-on-Linux path',
  },
  {
    foreground: 'warningBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    where: 'the edge of a warning message',
  },
  {
    foreground: 'dangerInk',
    background: 'dangerSurface',
    minimum: AA_TEXT,
    where: 'an error message — the Safari and Firefox path',
  },
  {
    foreground: 'dangerBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    where: 'the edge of an error message',
  },
];
