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
 *
 * ## Depth is a colour, because a shadow is the one thing this repository
 * cannot gate
 *
 * #307. `contrast.a11y.test.ts` walks colour pairs and requires every token to
 * appear in one, so a surface colour arrives **inside** the gate that already
 * exists. A `box-shadow` is invisible to it, invisible to jsdom, and invisible
 * to the browser gate, which renders a map and a 3D scene and no chrome — so an
 * elevation system built from shadows would be the one part of this design
 * system nothing in the repository could check. {@link ELEVATION_SURFACES} is
 * the ramp and `tokens.test.ts` is what holds it to being one.
 *
 * ## The type scale has a ratio, and the ratio is checkable
 *
 * Also #307. The sizes below are literals rather than values computed from
 * {@link TYPE_SCALE_RATIO}, and that is deliberate: a ladder derived from its
 * own ratio agrees with it by construction, so the test asserting they agree
 * could never fail. Written out by hand, `tokens.test.ts` re-derives them and a
 * size edited off the ladder goes red.
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
  /**
   * Elevation 1: a panel resting on the page — a card, the footer's rule, the
   * well a chart or a map is drawn into.
   */
  surface: '#f2f5f4',
  /**
   * Elevation 2: two steps off the page, for something that has to read as an
   * object rather than as a tinted area — a metric card, a table's header row.
   *
   * ⚠️ Two steps, and **not** because either of them rests on a level-1 panel:
   * both consumers sit directly on the canvas. One step was not enough at the
   * size they are drawn. `#f2f5f4` on `#ffffff` is 1.097:1, and a 10 rem card
   * at that separation reads as a faintly tinted rectangle. The level is what
   * the separation had to be, not a count of the things underneath — and an
   * earlier version of this comment said the opposite of the two rules in
   * `theme.css` that use it.
   */
  surfaceRaised: '#e7eae9',
  /**
   * Elevation 3: the header, the chrome that frames every view — and the only
   * surface other content ever passes beneath.
   *
   * ⚠️ It is sticky only on a viewport with room for it, which is a bound
   * #307's review established by measuring: at 320×256 — the viewport WCAG 2.2
   * SC 1.4.10 names — an eleven-link header is 178px, 70% of the screen.
   * `theme.css`'s `@media (min-width: 64rem) and (min-height: 40rem)` block is
   * where that is decided and where the numbers are. The level is unchanged by
   * it: the header is the top of the ramp on every viewport, and on a small
   * one it simply does not have anything scrolling under it.
   */
  surfaceOverlay: '#dde0df',
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

  /*
   * The ride HUD (#94), which is the one surface in this app that is drawn over
   * something we do not control.
   *
   * ⚠️ **The HUD does not take its contrast from the world behind it, and that
   * is what makes #94's contrast criterion dischargeable at all.** The criterion
   * asks for AA *"against the rendered world behind it, in both a bright
   * daytime scene and a dark one"* — and a translucent panel over a scene whose
   * colours change every metre cannot be checked, because there is no second
   * colour to check against. So `hudSurface` is **opaque**: whatever the world
   * is doing, the text sits on this, and the pair below is a pair the contrast
   * suite can actually walk.
   *
   * Dark rather than light because the HUD is a minority of the screen and a
   * bright panel over a bright scene is what a rider reads at arm's length in
   * sunlight with a bloom around it.
   */
  hudSurface: '#10161c',
  /** The numbers a rider is pacing to. Large, and the highest contrast here. */
  hudInk: '#f5f8fa',
  /** Field labels, which are read once and then found by position. */
  hudInkMuted: '#a8b6c2',
  /** The edge of a HUD control, per WCAG 2.2 SC 1.4.11. */
  hudBorder: '#7b8b99',
  /**
   * A reading that is **stale**, not zero.
   *
   * #94's second criterion: a rider must be able to tell "I stopped pedalling"
   * from "the trainer disconnected" at a glance. This is one half of that; the
   * other half is that the value is replaced by a dash rather than tinted, so
   * the distinction survives for a rider who cannot see the tint at all.
   */
  hudStaleInk: '#f0b45f',
} as const satisfies Record<string, string>;

/** The name of a colour token. */
export type ColourToken = keyof typeof COLOUR_TOKENS;

/**
 * One rung of the elevation ramp.
 *
 * `level` is how far above the page the surface sits, and it is the index into
 * {@link ELEVATION_SURFACES} rather than a free number: a list whose levels can
 * disagree with its own order is two sources of truth.
 */
export interface ElevationSurface {
  readonly level: number;
  readonly token: ColourToken;
  /** What sits at this level, so a failure names a screen and not a hex code. */
  readonly where: string;
}

/**
 * The page and everything stacked on it, lightest first.
 *
 * ## The direction, and why it is downward
 *
 * A raised surface here is **darker** than the one below it. That is not the
 * convention every system uses — a white card on a grey page is the other one —
 * and the choice is forced rather than chosen: `canvas` is `#ffffff`, so there
 * is nothing lighter to move toward. Depth reads as increasing tint, and the
 * direction is stated once here so that a new surface cannot be added on the
 * other side of the page and still call itself elevation.
 *
 * ## What holds it to being a ramp
 *
 * `tokens.test.ts` asserts three things, and each catches a different mistake:
 *
 * - **Strictly decreasing relative luminance.** A surface added out of order is
 *   a level that means nothing.
 * - **Every adjacent step is at least {@link MINIMUM_ELEVATION_STEP}.** Two
 *   surfaces a reader cannot tell apart are one surface with two names, and the
 *   whole finding in #307 was that nothing sat above anything else.
 * - **Every adjacent step is at most {@link MAXIMUM_ELEVATION_STEP}.** This is
 *   the one that catches a nonsense value. A token set to `#ff0000` still has a
 *   luminance and can still be ordered; what it cannot do is sit a tenth of a
 *   stop from its neighbour. #307's last criterion — *"a token that can be set
 *   to a nonsense value with the suite still green is not covered"* — is this
 *   bound.
 *
 * The list is also checked against the palette: every token named `canvas` or
 * beginning `surface` has to appear here, so a fourth surface cannot be added
 * beside the ramp instead of on it.
 */
export const ELEVATION_SURFACES: readonly ElevationSurface[] = [
  { level: 0, token: 'canvas', where: 'the page itself' },
  { level: 1, token: 'surface', where: 'a panel, a chart well, the header of the page' },
  { level: 2, token: 'surfaceRaised', where: 'a metric card, a table header row' },
  { level: 3, token: 'surfaceOverlay', where: 'the app header, over content where it sticks' },
];

/**
 * The smallest contrast ratio two adjacent elevation levels may have.
 *
 * WCAG states no requirement for surface-against-surface, because neither is
 * text and neither is a control boundary — so this is a legibility floor of
 * this design system's own. 1.05 is roughly where the boundary between two
 * large flat areas stops being visible on an uncalibrated phone screen in
 * daylight, which is the device #307 was reported from.
 */
export const MINIMUM_ELEVATION_STEP = 1.05;

/**
 * The largest, for the opposite reason: past about a fifth of a stop the ramp
 * stops reading as one surface lifted off another and starts reading as two
 * unrelated colours, and the page looks striped rather than layered.
 */
export const MAXIMUM_ELEVATION_STEP = 1.2;

/** Spacing, on a 4px base. Unitless names so a component never writes a pixel. */
export const SPACE_TOKENS = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2.5rem',
} as const satisfies Record<string, string>;

/**
 * The base of the type scale, in `rem`.
 *
 * One `rem` is exactly the size the reader chose in their browser, which is why
 * body text is the base rather than a size somebody picked: every other size in
 * the product is then a multiple of the reader's own setting.
 */
export const TYPE_SCALE_BASE_REM = 1;

/**
 * The ratio between adjacent steps — a major third.
 *
 * #307's first finding was that there was no ratio at all: `0.875 / 1 / 1.25 /
 * 1.75 / 4` steps by 1.14×, 1.25×, 1.4× and 2.29×, so hierarchy read as
 * arbitrary because it was. 1.25 is chosen over a gentler ratio because this
 * client is read on a phone clamped to a handlebar as well as on a tablet, and
 * a scale whose steps are 1.125 apart is not legible as a hierarchy at arm's
 * length.
 *
 * ⚠️ It is exactly representable in binary floating point (5/4), and so is
 * every power of it used below. That is why `tokens.test.ts` can compare the
 * literals to the derived ladder **exactly** rather than within a tolerance,
 * and a tolerance is what would have let a size drift back off the ladder.
 */
export const TYPE_SCALE_RATIO = 1.25;

/**
 * Which rung of the ladder each named size is.
 *
 * Steps −1 through 3 are the reading sizes and are contiguous: caption, body,
 * lead, section heading, page heading. `metric` skips to 6 because it is not a
 * reading size at all — see the note on it below.
 */
export const TYPE_SCALE_STEPS = {
  sm: -1,
  md: 0,
  lg: 1,
  xl: 2,
  xxl: 3,
  metric: 6,
} as const satisfies Record<string, number>;

/**
 * The type scale. `md` is body text.
 *
 * ⚠️ **Written out rather than computed**, and `tokens.test.ts` re-derives them
 * from {@link TYPE_SCALE_RATIO} and requires them to agree. A ladder generated
 * from its own ratio agrees by construction and the test proving it could never
 * fail — which is the shape CLAUDE.md §5 spends a section on.
 */
export const FONT_SIZE_TOKENS = {
  /** Step −1. Captions, helper text, a field label above a number. */
  sm: '0.8rem',
  /** Step 0. Body text, and the reader's own browser setting. */
  md: '1rem',
  /** Step 1. A lead paragraph, a summary value, a clock. */
  lg: '1.25rem',
  /** Step 2. A section heading inside a view. */
  xl: '1.5625rem',
  /** Step 3. The title of the view. */
  xxl: '1.953125rem',
  /**
   * A live ride metric, read from two metres away while pedalling.
   *
   * #49's eighth acceptance criterion asks for a **stated** minimum size for
   * the primary metrics, and this is it. It is not a heading size with a
   * different name: `xxl` is what a view title uses and a power number at that
   * size is unreadable from a bike. `ride/MetricGrid.tsx` states the floor and
   * `a11y/ride-legibility.a11y.test.ts` fails the build if this value drops
   * below it.
   *
   * ⚠️ Step 6 rather than 7, and it is the one size #307 moved **down** —
   * 3.815 rem where it used to be 4. Step 7 is 4.77 rem, and the metric grid's
   * track floor is `minmax(10rem, 1fr)`: four characters at 4.77 rem overflow a
   * 10 rem track and land on the field beside them, which is #259's failure in
   * a new place. Step 6 is 61 px against the stated 56 px floor, so the
   * criterion still holds with room.
   */
  metric: '3.814697265625rem',
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
  /**
   * What this pair measures today, to two decimal places.
   *
   * ⚠️ **This is the erosion gate, and it is not the same thing as
   * {@link minimum}.** #307's fifth criterion: *"no contrast pair's measured
   * ratio falls, even where it stays above its threshold — a change that
   * quietly erodes margin is the one this gate would let through."* A palette
   * edit that takes `border` on `surface` from 3.79 to 3.05 passes every
   * threshold in this file and leaves nothing for the next edit to spend.
   *
   * `contrast.a11y.test.ts` requires the computed ratio to equal this number,
   * in both directions: below it is erosion and fails; above it is an
   * improvement that has not been recorded, and fails so that the new margin
   * appears in the diff where a reviewer can see what was bought.
   */
  readonly measured: number;
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
  {
    foreground: 'ink',
    background: 'canvas',
    minimum: AA_TEXT,
    measured: 17.48,
    where: 'body text on the page',
  },
  {
    foreground: 'ink',
    background: 'surface',
    minimum: AA_TEXT,
    measured: 15.93,
    where: 'body text on a panel',
  },
  {
    foreground: 'inkMuted',
    background: 'canvas',
    minimum: AA_TEXT,
    measured: 7.14,
    where: 'helper and empty-state text on the page',
  },
  {
    foreground: 'inkMuted',
    background: 'surface',
    minimum: AA_TEXT,
    measured: 6.51,
    where: 'helper and empty-state text on a panel',
  },
  {
    foreground: 'border',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 4.15,
    where: 'the edge of a control on the page (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'border',
    background: 'surface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 3.79,
    where: 'the edge of a control on a panel (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'accentInk',
    background: 'accent',
    minimum: AA_TEXT,
    measured: 7.85,
    where: 'the label of a primary button',
  },
  {
    foreground: 'accentInk',
    background: 'accentHover',
    minimum: AA_TEXT,
    measured: 11.01,
    where: 'the label of a primary button under a pointer',
  },
  {
    foreground: 'hudInk',
    background: 'hudSurface',
    minimum: AA_TEXT,
    measured: 17.07,
    where: 'a metric on the ride HUD, over its own opaque panel (#94)',
  },
  {
    foreground: 'hudInkMuted',
    background: 'hudSurface',
    minimum: AA_TEXT,
    measured: 8.79,
    where: 'a field label on the ride HUD (#94)',
  },
  {
    foreground: 'hudBorder',
    background: 'hudSurface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 5.2,
    where: 'the edge of a HUD control (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'hudStaleInk',
    background: 'hudSurface',
    minimum: AA_TEXT,
    measured: 9.88,
    where: 'the mark on a HUD reading whose sensor has dropped (#94)',
  },
  {
    foreground: 'accent',
    background: 'canvas',
    minimum: AA_TEXT,
    measured: 7.85,
    where: 'link text',
  },
  {
    foreground: 'accent',
    background: 'surface',
    minimum: AA_TEXT,
    measured: 7.15,
    where: 'link text and the active navigation item in the header',
  },
  {
    foreground: 'focus',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 17.48,
    where: 'the focus ring, offset onto the page (WCAG 2.2 SC 2.4.13)',
  },
  {
    foreground: 'focus',
    background: 'surface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 15.93,
    where: 'the focus ring, offset onto a panel (WCAG 2.2 SC 2.4.13)',
  },

  /*
   * Elevation 2 and 3 (#307).
   *
   * Five pairs each rather than one, because all five are things the product
   * actually draws on these surfaces and #307's criterion is that the existing
   * gate *covers* the new tokens. A single token/ink pair would satisfy the
   * coverage assertion below and leave the edge of a control on the darkest
   * surface unchecked — and `border` on `surfaceOverlay` is 3.13, the tightest
   * margin in the whole palette and the first thing a further step down the
   * ramp would break.
   */
  {
    foreground: 'ink',
    background: 'surfaceRaised',
    minimum: AA_TEXT,
    measured: 14.44,
    where: 'body text on a card resting on a panel',
  },
  {
    foreground: 'inkMuted',
    background: 'surfaceRaised',
    minimum: AA_TEXT,
    measured: 5.89,
    where: 'a label on a card resting on a panel',
  },
  {
    foreground: 'border',
    background: 'surfaceRaised',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 3.43,
    where: 'the edge of a control on a raised card (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'accent',
    background: 'surfaceRaised',
    minimum: AA_TEXT,
    measured: 6.48,
    where: 'link text on a raised card',
  },
  {
    foreground: 'focus',
    background: 'surfaceRaised',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 14.44,
    where: 'the focus ring, offset onto a raised card (WCAG 2.2 SC 2.4.13)',
  },
  {
    foreground: 'ink',
    background: 'surfaceOverlay',
    minimum: AA_TEXT,
    measured: 13.15,
    where: 'the wordmark and the navigation, on the app header',
  },
  {
    foreground: 'inkMuted',
    background: 'surfaceOverlay',
    minimum: AA_TEXT,
    measured: 5.37,
    where: 'secondary text on the app header',
  },
  {
    foreground: 'border',
    background: 'surfaceOverlay',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 3.13,
    where: "the header's own bottom rule (WCAG 2.2 SC 1.4.11)",
  },
  {
    foreground: 'accent',
    background: 'surfaceOverlay',
    minimum: AA_TEXT,
    measured: 5.9,
    where: 'a navigation link on the app header',
  },
  {
    foreground: 'focus',
    background: 'surfaceOverlay',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 13.15,
    where: 'the focus ring, offset onto the app header (WCAG 2.2 SC 2.4.13)',
  },

  {
    foreground: 'infoInk',
    background: 'infoSurface',
    minimum: AA_TEXT,
    measured: 8.44,
    where: 'an info message',
  },
  {
    foreground: 'infoBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 5.43,
    where: 'the edge of an info message',
  },
  {
    foreground: 'successInk',
    background: 'successSurface',
    minimum: AA_TEXT,
    measured: 7.99,
    where: 'a success message',
  },
  {
    foreground: 'successBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 5.22,
    where: 'the edge of a success message',
  },
  {
    foreground: 'warningInk',
    background: 'warningSurface',
    minimum: AA_TEXT,
    measured: 7.99,
    where: 'a warning message — the Chrome-on-Linux path',
  },
  {
    foreground: 'warningBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 5.47,
    where: 'the edge of a warning message',
  },
  {
    foreground: 'dangerInk',
    background: 'dangerSurface',
    minimum: AA_TEXT,
    measured: 8.81,
    where: 'an error message — the Safari and Firefox path',
  },
  {
    foreground: 'dangerBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: 6.63,
    where: 'the edge of an error message',
  },
];
