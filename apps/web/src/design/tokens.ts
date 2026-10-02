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
  /**
   * The one accent: primary buttons, the active navigation item. A link in
   * running text is `link` since #661, which has the same value today.
   */
  accent: '#0b5c55',
  /** The accent under a pointer or a press. */
  accentHover: '#07443f',
  /** Text and glyphs drawn on `accent` or `accentHover`. */
  accentInk: '#ffffff',
  /**
   * The fill of a toggle that is ON and of the checked segment of a segmented
   * control (#668) — a light tint of the accent.
   *
   * ⚠️ **It is not the signal on its own, and cannot be**: against the page it
   * is 1.25:1, nowhere near SC 1.4.11's 3:1, and a state told by colour alone
   * fails SC 1.4.1 whatever the ratio. The state is the doubled border drawn
   * inside the control's own (`theme.css` §"THE THREE KINDS OF BUTTON"), and
   * a segment's radio dot. What this tint must clear is the text and the ring
   * drawn ON it, which are the pairs below.
   *
   * Its own token rather than `surfaceRaised` reused, so #672's dark theme can
   * give "on" a value of its own without moving every card.
   */
  selected: '#d4ebe7',

  /*
   * A link in running text, one token per state (#661).
   *
   * ⚠️ Until #661 there were none. `accent`'s comment said it was for links
   * while no rule in `theme.css` painted a plain `a` at all, so every inline
   * link was the browser's own `rgb(0, 0, 238)` — a colour no token supplies,
   * which is why the contrast suite, a walk over token pairs, could not see it.
   *
   * Four tokens rather than `accent` reused, so that a second palette (#654's
   * dark theme) can give links values of their own without also moving every
   * primary button. `link` and `linkHover` carry `accent`'s and `accentHover`'s
   * values today; they are separate names, not aliases.
   *
   * Colour is never the only signal: `theme.css` underlines a link in every
   * state (WCAG 2.2 SC 1.4.1), because inside a status message a link's colour
   * is within a shade of the message's own ink. Each of the four is paired with
   * every surface in `LINK_SURFACES` — see `LINK_CONTRAST_MEASURED`.
   */
  /** An unvisited link at rest. */
  link: '#0b5c55',
  /** A link to somewhere this browser has been. */
  linkVisited: '#5b3a8c',
  /** A link under a pointer, or focused from the keyboard. */
  linkHover: '#07443f',
  /** A link while it is being pressed. */
  linkActive: '#042e2a',
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
   * THE ILLUSTRATION PALETTE — #936, the menus' house style (epic #935, the
   * owner's D-1: flat geometric art drawn from code and painted with tokens).
   *
   * ⚠️ **Decoration, never text, and never the only carrier of a state.** Art
   * is `aria-hidden` and the words beside it say everything it shows, so no
   * illustration colour owes SC 1.4.3 against another. What each DOES owe is a
   * pair against whatever text or control a later screen draws OVER it — the
   * hero's title on the sky, a card's title where it overlaps the far hill, a
   * primary button standing on the near hill, and the focus ring landing on
   * any of them — and those pairs are in {@link CONTRAST_REQUIREMENTS}. A
   * screen that draws a new kind of text or control over art adds its pair
   * there first.
   *
   * The five are a landscape read back to front — sky, far hill, near hill,
   * road — with the sun apart from it. {@link ILLUSTRATION_DEPTH} is that
   * order, and it moves the way the elevation ramp does (#672): nearer is
   * DARKER in the light palette (aerial perspective pales what is far) and
   * LIGHTER in the dark one, where the far hills sink into the night.
   */
  /** The sky behind a scene. The one illustration colour text sits on most. */
  illoSky: '#cfe4ef',
  /** The sun. Small, warm, and nothing is drawn over it but a focus ring. */
  illoSun: '#f4c65a',
  /** The hills on the horizon, paler than the near ones. */
  illoHillFar: '#a7d3a3',
  /** The hill in front, which a primary control may stand on. */
  illoHillNear: '#7db678',
  /** The road ribbon, the nearest thing in the scene. */
  illoRoad: '#6f726c',

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
 * The two palettes (#672). `light` is {@link COLOUR_TOKENS}, which is what this
 * client always was; `dark` is {@link DARK_COLOUR_TOKENS} over the same names.
 *
 * Which one paints is decided before the first paint by the inline script
 * `design/theme-selection.ts` writes into every page — the device's
 * `prefers-color-scheme`, unless the rider chose one in Settings.
 */
export const THEMES = ['light', 'dark'] as const;

/** A palette. */
export type Theme = (typeof THEMES)[number];

/**
 * The ride HUD's tokens — theme-INDEPENDENT (#672).
 *
 * The HUD is an opaque panel over the world (#94), and the world does not
 * change with the page's palette, so neither does the panel. The dark palette
 * declares none of these and `theme.css`'s dark block redeclares none of them;
 * `tokens.test.ts` and `theme.a11y.test.ts` each hold one half of that.
 */
export type HudColourToken = Extract<ColourToken, `hud${string}`>;

/** Every colour token a palette gives its own value. */
export type ThemedColourToken = Exclude<ColourToken, HudColourToken>;

/**
 * The dark palette (#672) — the owner's ruling of 2026-09-27: the page follows
 * the device, with an override in Settings, and every pair passes in BOTH
 * palettes.
 *
 * ## What is the same, and what is not
 *
 * Exactly {@link COLOUR_TOKENS}' names less the HUD's, so every rule in
 * `theme.css` paints with the same `var()` in either palette and nothing has
 * to know which one is on. `tokens.test.ts` holds the key sets equal in both
 * directions.
 *
 * - **No pure black or white.** The canvas is a green-tinted near-black and
 *   body text a near-white — a comfort choice (halation on a dark page), not a
 *   WCAG rule.
 * - **Elevation goes LIGHTER.** A raised surface on a dark page is lighter
 *   than what it rests on, the other way from the light palette — so
 *   {@link ELEVATION_DIRECTION} states the direction per palette and
 *   `tokens.test.ts` holds each ramp to its own, with both step bounds.
 * - **Its own accent.** The light palette's `#0b5c55` is 2.3:1 on this canvas,
 *   so `accent`, `accentHover` and `accentInk` are light teal on dark ink here,
 *   and a hover is LIGHTER, as elevation is. The links follow, as #661 left
 *   room for.
 * - **The status messages are dark tints with light ink**, each the hue of its
 *   light counterpart.
 *
 * Every value was chosen against the pairs in {@link CONTRAST_REQUIREMENTS}
 * and for no other reason — ADR 0009 L1's rule for the light palette applies
 * here too.
 */
export const DARK_COLOUR_TOKENS = {
  canvas: '#121816',
  surface: '#19201f',
  surfaceRaised: '#222a29',
  surfaceOverlay: '#2b3433',
  border: '#869391',
  ink: '#e4ebe9',
  inkMuted: '#a9b7b5',
  accent: '#6cc9bd',
  accentHover: '#9ddcd3',
  accentInk: '#0d1f1c',
  selected: '#1d4540',
  link: '#6cc9bd',
  linkVisited: '#c4a8f0',
  linkHover: '#9ddcd3',
  linkActive: '#c6ede7',
  focus: '#e4ebe9',
  infoSurface: '#12303a',
  infoInk: '#a9dcec',
  infoBorder: '#4f9db5',
  successSurface: '#13301f',
  successInk: '#a7e0c1',
  successBorder: '#4ea77e',
  warningSurface: '#33280f',
  warningInk: '#f1d08f',
  warningBorder: '#b98c31',
  dangerSurface: '#3a1818',
  dangerInk: '#f4b8b8',
  dangerBorder: '#d46a6a',
  illoSky: '#152637',
  illoSun: '#9a7a30',
  illoHillFar: '#1d3a2b',
  illoHillNear: '#2f5d3b',
  illoRoad: '#5f6a63',
} as const satisfies Record<ThemedColourToken, string>;

/**
 * Every colour a palette paints, the HUD's included: the palette's own values
 * over the theme-independent HUD. What the contrast suite measures a pair in.
 */
export function paletteColours(theme: Theme): Readonly<Record<ColourToken, string>> {
  return theme === 'light' ? COLOUR_TOKENS : { ...COLOUR_TOKENS, ...DARK_COLOUR_TOKENS };
}

/**
 * The colour the browser's own chrome takes in each palette — the two
 * `theme-color` metas in `index.html`, which `offline/manifest.test.ts` holds
 * to these (#672).
 *
 * Light keeps the accent it always had, which is also the manifest's single
 * `theme_color`. Dark takes the header's surface rather than the dark accent:
 * a bright teal band over a dark page is the flash of light this theme exists
 * to take away.
 */
export const THEME_COLOUR_TOKEN: Readonly<Record<Theme, ThemedColourToken>> = {
  light: 'accent',
  dark: 'surfaceOverlay',
};

/** The {@link THEME_COLOUR_TOKEN} of a palette, as the hex a meta carries. */
export function themeColour(theme: Theme): string {
  return paletteColours(theme)[THEME_COLOUR_TOKEN[theme]];
}

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
 * The page and everything stacked on it, from the page up.
 *
 * ## The direction, and why it is downward in the light palette
 *
 * In the light palette a raised surface is **darker** than the one below it. That is not the
 * convention every system uses — a white card on a grey page is the other one —
 * and the choice is forced rather than chosen: `canvas` is `#ffffff`, so there
 * is nothing lighter to move toward. Depth reads as increasing tint, and the
 * direction is stated once here so that a new surface cannot be added on the
 * other side of the page and still call itself elevation.
 *
 * ⚠️ **In the dark palette it goes the other way** (#672): a raised surface on
 * a dark page is LIGHTER, because there is nothing darker than a near-black
 * canvas to move toward. The levels are the same four tokens in the same
 * order; {@link ELEVATION_DIRECTION} states which way each palette runs.
 *
 * ## What holds it to being a ramp
 *
 * `tokens.test.ts` asserts three things, in each palette, and each catches a
 * different mistake:
 *
 * - **Strictly monotonic relative luminance, in the palette's stated
 *   {@link ELEVATION_DIRECTION}.** A surface added out of order is
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
/**
 * Which way luminance moves as a surface rises, per palette (#672). Stated
 * rather than inferred, so `tokens.test.ts` can hold each ramp to a direction
 * somebody chose — a ramp checked only for being monotonic in SOME direction
 * would pass one that had been turned upside down.
 */
export const ELEVATION_DIRECTION: Readonly<Record<Theme, 'darker' | 'lighter'>> = {
  light: 'darker',
  dark: 'lighter',
};

export const ELEVATION_SURFACES: readonly ElevationSurface[] = [
  { level: 0, token: 'canvas', where: 'the page itself' },
  { level: 1, token: 'surface', where: 'a panel, a chart well, the header of the page' },
  { level: 2, token: 'surfaceRaised', where: 'a metric card, a table header row' },
  { level: 3, token: 'surfaceOverlay', where: 'the app header, over content where it sticks' },
];

/**
 * The illustration palette's landscape, back to front (#936). Each layer is
 * nearer than the one before it, so it moves the way {@link
 * ELEVATION_DIRECTION} says a raised surface does: darker in the light
 * palette, lighter in the dark. `illoSun` is not in it — a light source is not
 * a layer of ground. `tokens.test.ts` holds the order in both palettes, and a
 * visible step between neighbours ({@link MINIMUM_ILLUSTRATION_STEP}).
 */
export const ILLUSTRATION_DEPTH = ['illoSky', 'illoHillFar', 'illoHillNear', 'illoRoad'] as const;

/**
 * The smallest contrast ratio two adjacent layers of {@link ILLUSTRATION_DEPTH}
 * may have: past this, a hill and the sky behind it are one flat shape. A
 * legibility floor of this design system's own — decoration owes WCAG nothing
 * here — and wider than {@link MINIMUM_ELEVATION_STEP}, because a hill's edge
 * is a curve across a small drawing rather than the edge of a large panel.
 */
export const MINIMUM_ILLUSTRATION_STEP = 1.2;

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
  display: 4,
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
   * Step 4 (#936). A hero title on a menu — the one line on a screen that says
   * what the screen is for, set above the view title on the same ladder, at a
   * heavier weight and — since #991 — in {@link FONT_FAMILY_TOKENS}' display
   * face; `theme.css` §`.oyl-display` is the rule that sets all three.
   */
  display: '2.44140625rem',
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
 * The font families, by role — #991, ADR 0043.
 *
 * `display` is the bundled face, Barlow (SIL OFL 1.1, subset and committed
 * under `design/fonts/` by `tools/fonts/subset-fonts.ts`), in front of the
 * same system stack `body` uses, so a weight it does not carry or a character
 * outside its Latin range falls back to the page's own face rather than to a
 * missing glyph. Chosen against Barlow Condensed, Saira, Archivo, Exo 2 and
 * Rajdhani on legibility, true tabular figures, weights and size; ADR 0043
 * D-6 records the measurements.
 */
export const FONT_FAMILY_TOKENS = {
  display: "'Barlow', system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const satisfies Record<string, string>;

/**
 * The menus' motion (#936), in milliseconds — the one place a duration is
 * written. Epic #935's principle 4: motion is short, explains a change, and is
 * optional. `short` is feedback on a press; `medium` is a change of place — a
 * card opening into its detail. **Nothing may run longer than `medium`**:
 * `theme.a11y.test.ts` fails on any duration literal above it in `theme.css`.
 *
 * ⚠️ Two readers, one number each. CSS reads {@link MOTION_TOKENS}, and
 * Motion — the animation library [ADR 0041](../../../../docs/adr/0041-motion-for-menu-animation.md)
 * admits, installed by #945 — reads {@link MOTION_FOR_SCRIPT}. Both are written
 * out and `tokens.test.ts` derives each from these, so the stylesheet and a
 * script animation cannot be two speeds.
 */
export const MOTION_DURATION_MS = {
  short: 120,
  medium: 200,
} as const satisfies Record<string, number>;

/**
 * The one easing curve (#936): a cubic Bézier's four control numbers, which
 * is the form CSS's `cubic-bezier()` and Motion's `ease` array both take. It
 * decelerates hard into place — a thing that arrives, rather than one that
 * bounces — and it overshoots nothing, so no frame puts an element outside the
 * box it ends in.
 */
export const MOTION_EASING = {
  standard: [0.2, 0, 0, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/**
 * The motion tokens as `theme.css` declares them — `--oyl-motion-short`,
 * `--oyl-motion-medium` and `--oyl-motion-ease-standard`. Written out, and
 * `tokens.test.ts` requires them to equal what {@link MOTION_DURATION_MS} and
 * {@link MOTION_EASING} say, for the reason {@link FONT_SIZE_TOKENS} gives.
 *
 * Every transition in the stylesheet reads these, so the
 * `prefers-reduced-motion` and `update: slow` blocks collapse every one of them
 * and a slower one cannot be written without a literal the gate refuses.
 */
export const MOTION_TOKENS = {
  short: '120ms',
  medium: '200ms',
  easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
} as const satisfies Record<string, string>;

/**
 * The same motion as Motion reads it: `duration` in SECONDS and `ease` as the
 * Bézier array — `<m.div transition={MOTION_FOR_SCRIPT.medium}>`. A script
 * animation takes one of these and never a number of its own.
 */
export const MOTION_FOR_SCRIPT = {
  short: { duration: 0.12, ease: MOTION_EASING.standard },
  medium: { duration: 0.2, ease: MOTION_EASING.standard },
} as const satisfies Record<
  keyof typeof MOTION_DURATION_MS,
  { readonly duration: number; readonly ease: readonly number[] }
>;

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
   *
   * ⚠️ **One number per palette since #672**, and the gate holds each: a pair
   * is a pair of VALUES, and the dark palette's values are its own. A pair
   * whose two colours are both HUD tokens measures the same in both, because
   * the HUD does not change with the palette.
   */
  readonly measured: Readonly<Record<Theme, number>>;
  /** Where this pair appears, so a failure names a screen and not a hex code. */
  readonly where: string;
}

/**
 * The check mark on a checked checkbox (#667, #672) — the PLATFORM's glyph,
 * not a token, recorded per palette with its ratio on that palette's `accent`.
 *
 * `accent-color` hands Chromium the fill, and Chromium chooses the mark: a
 * light or a dark glyph by the accent's luminance and the `color-scheme`. In
 * the light palette it draws white, which happens to be `accentInk`; in the
 * dark palette it draws its own dark grey, which is NOT the dark `accentInk`
 * (#744's review). So this is what the platform paints, read back off the
 * pixels in both palettes by `browser/shell.browser.spec.ts` §"#667", and
 * `contrast.a11y.test.ts` holds each `measured` exactly — below is erosion,
 * above is an unrecorded change — and at least SC 1.4.11's 3:1.
 *
 * ⚠️ A Chromium bump can change the dark glyph. The browser read fails then,
 * naming what it found inside the box; record the new colour and ratio here.
 */
export const PLATFORM_CHECK_MARK: Readonly<
  Record<Theme, { readonly colour: string; readonly measured: number }>
> = {
  light: { colour: '#ffffff', measured: 7.85 },
  dark: { colour: '#3b3b3b', measured: 5.72 },
};

/** The four states a link in running text is painted in (#661). */
export const LINK_STATE_TOKENS = ['link', 'linkVisited', 'linkHover', 'linkActive'] as const;

/** A link state's token. */
export type LinkStateToken = (typeof LINK_STATE_TOKENS)[number];

/**
 * Every surface a link in running text can sit on (#661).
 *
 * The four rungs of the elevation ramp and the four status messages, which is
 * every light surface `theme.css` paints. ⚠️ **Not `hudSurface`, and not the
 * `ink` the ride stage and the camera's picture are drawn on**: no link is
 * rendered on either today, and `browser/links.browser.spec.ts` reads the
 * surface behind every link it renders and fails on a pair not declared in
 * {@link CONTRAST_REQUIREMENTS} — so the first link that lands on a dark
 * surface is a red build naming the pair to add, rather than a pair declared
 * here for a link nobody drew.
 */
export const LINK_SURFACES = [
  'canvas',
  'surface',
  'surfaceRaised',
  'surfaceOverlay',
  'infoSurface',
  'successSurface',
  'warningSurface',
  'dangerSurface',
] as const satisfies readonly ColourToken[];

/** A surface a link can sit on. */
export type LinkSurface = (typeof LINK_SURFACES)[number];

/**
 * What each link state measures on each surface, to two decimal places, in
 * each palette — the {@link ContrastRequirement.measured} of thirty-two pairs,
 * written as a table because thirty-two object literals would bury the one
 * column that differs.
 *
 * The same erosion gate applies: `contrast.a11y.test.ts` requires every cell
 * to equal the computed ratio in both directions. The tightest is `link` on
 * `surfaceOverlay`, at 5.90 — what `accent` on `surfaceOverlay` already
 * recorded, because it is the same value.
 *
 * ## The dark palette's half (#672)
 *
 * This section used to say what a dark palette WOULD owe here: its own copy of
 * the table, because a ratio is a property of a pair of values. `dark` is that
 * copy. Its tightest cell is `link` on `surfaceOverlay` too, at 6.53.
 */
export const LINK_CONTRAST_MEASURED: Readonly<
  Record<Theme, Readonly<Record<LinkStateToken, Readonly<Record<LinkSurface, number>>>>>
> = {
  light: {
    link: {
      canvas: 7.85,
      surface: 7.15,
      surfaceRaised: 6.48,
      surfaceOverlay: 5.9,
      infoSurface: 6.74,
      successSurface: 6.77,
      warningSurface: 6.9,
      dangerSurface: 6.65,
    },
    linkVisited: {
      canvas: 8.65,
      surface: 7.88,
      surfaceRaised: 7.14,
      surfaceOverlay: 6.51,
      infoSurface: 7.43,
      successSurface: 7.46,
      warningSurface: 7.6,
      dangerSurface: 7.33,
    },
    linkHover: {
      canvas: 11.01,
      surface: 10.03,
      surfaceRaised: 9.09,
      surfaceOverlay: 8.28,
      infoSurface: 9.45,
      successSurface: 9.49,
      warningSurface: 9.68,
      dangerSurface: 9.34,
    },
    linkActive: {
      canvas: 14.69,
      surface: 13.39,
      surfaceRaised: 12.13,
      surfaceOverlay: 11.06,
      infoSurface: 12.62,
      successSurface: 12.67,
      warningSurface: 12.92,
      dangerSurface: 12.46,
    },
  },
  dark: {
    link: {
      canvas: 9.18,
      surface: 8.46,
      surfaceRaised: 7.5,
      surfaceOverlay: 6.53,
      infoSurface: 7.11,
      successSurface: 7.3,
      warningSurface: 7.39,
      dangerSurface: 8.1,
    },
    linkVisited: {
      canvas: 8.74,
      surface: 8.05,
      surfaceRaised: 7.13,
      surfaceOverlay: 6.22,
      infoSurface: 6.76,
      successSurface: 6.94,
      warningSurface: 7.03,
      dangerSurface: 7.71,
    },
    linkHover: {
      canvas: 11.65,
      surface: 10.74,
      surfaceRaised: 9.51,
      surfaceOverlay: 8.29,
      infoSurface: 9.02,
      successSurface: 9.26,
      warningSurface: 9.38,
      dangerSurface: 10.28,
    },
    linkActive: {
      canvas: 14.27,
      surface: 13.15,
      surfaceRaised: 11.65,
      surfaceOverlay: 10.15,
      infoSurface: 11.04,
      successSurface: 11.34,
      warningSurface: 11.49,
      dangerSurface: 12.59,
    },
  },
};

/** How a failure names a link state. */
const LINK_STATE_WORDS: Readonly<Record<LinkStateToken, string>> = {
  link: 'link text',
  linkVisited: 'a visited link',
  linkHover: 'a link under a pointer or focused from the keyboard',
  linkActive: 'a link being pressed',
};

/** Every illustration colour (#936) — the five `illo*` tokens, in one list. */
export const ILLUSTRATION_TOKENS = [
  'illoSky',
  'illoSun',
  'illoHillFar',
  'illoHillNear',
  'illoRoad',
] as const satisfies readonly ThemedColourToken[];

/** One of {@link ILLUSTRATION_TOKENS}. */
export type IllustrationToken = (typeof ILLUSTRATION_TOKENS)[number];

/**
 * What the focus ring measures on each illustration colour, per palette —
 * `contrast.a11y.test.ts` holds each, both ways (#307's erosion rule).
 */
const ILLUSTRATION_FOCUS_MEASURED: Readonly<
  Record<IllustrationToken, Readonly<Record<Theme, number>>>
> = {
  illoSky: { light: 13.31, dark: 12.72 },
  illoSun: { light: 10.88, dark: 3.34 },
  illoHillFar: { light: 10.4, dark: 10.26 },
  illoHillNear: { light: 7.35, dark: 6.31 },
  illoRoad: { light: 3.58, dark: 4.66 },
};

/**
 * {@link LINK_CONTRAST_MEASURED} as requirements, one per state and surface.
 *
 * ⚠️ It spreads whatever the table holds rather than every state by every
 * surface, so a cell deleted from the table (a type error, and an `undefined`
 * under a runner that does not typecheck) is a pair missing from the list —
 * which `contrast.a11y.test.ts` §"every link state is paired with every link
 * surface" is what notices.
 */
const LINK_CONTRAST_REQUIREMENTS: readonly ContrastRequirement[] = LINK_STATE_TOKENS.flatMap(
  (state) =>
    LINK_SURFACES.filter(
      (surface) =>
        surface in LINK_CONTRAST_MEASURED.light[state] &&
        surface in LINK_CONTRAST_MEASURED.dark[state],
    ).map((surface) => ({
      foreground: state,
      background: surface,
      minimum: AA_TEXT,
      measured: {
        light: LINK_CONTRAST_MEASURED.light[state][surface],
        dark: LINK_CONTRAST_MEASURED.dark[state][surface],
      },
      where: `${LINK_STATE_WORDS[state]} on ${surface}`,
    })),
);

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
    measured: { light: 17.48, dark: 14.86 },
    where: 'body text on the page',
  },
  {
    foreground: 'ink',
    background: 'surface',
    minimum: AA_TEXT,
    measured: { light: 15.93, dark: 13.69 },
    where: 'body text on a panel',
  },
  {
    foreground: 'inkMuted',
    background: 'canvas',
    minimum: AA_TEXT,
    measured: { light: 7.14, dark: 8.67 },
    where: 'helper and empty-state text on the page',
  },
  {
    foreground: 'inkMuted',
    background: 'surface',
    minimum: AA_TEXT,
    measured: { light: 6.51, dark: 7.99 },
    where: 'helper and empty-state text on a panel',
  },
  {
    foreground: 'border',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 4.15, dark: 5.65 },
    where: 'the edge of a control on the page (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'border',
    background: 'surface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 3.79, dark: 5.2 },
    where: 'the edge of a control on a panel (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'accentInk',
    background: 'accent',
    minimum: AA_TEXT,
    measured: { light: 7.85, dark: 8.72 },
    where: 'the label of a primary button',
  },
  {
    foreground: 'accentInk',
    background: 'accentHover',
    minimum: AA_TEXT,
    measured: { light: 11.01, dark: 11.07 },
    where: 'the label of a primary button under a pointer',
  },
  /*
   * Every state of the three kinds of button and of a segmented control —
   * #668, and #688's hovered secondary. A state a button can be drawn in that
   * is not a pair here is a state nothing checks; #688 was exactly that — the
   * secondary's `accent` label left on the primary's `accentHover` hover fill,
   * 1.40:1, because nobody had meant to draw it and so nobody declared it.
   *
   * Some of these pairs are ALSO declared above for another use (link text is
   * `accent` on `canvas`, a disabled label is `inkMuted` on `surface`). They
   * are repeated here, named for the button state, so that the list of a
   * button's states is complete in one place and a change to either use has
   * to face both.
   */
  {
    foreground: 'accentInk',
    background: 'accent',
    minimum: AA_TEXT,
    measured: { light: 7.85, dark: 8.72 },
    where: 'a primary button at rest (#668)',
  },
  {
    foreground: 'accentInk',
    background: 'accentHover',
    minimum: AA_TEXT,
    measured: { light: 11.01, dark: 11.07 },
    where: 'a primary button under a pointer or a press (#668)',
  },
  {
    foreground: 'accent',
    background: 'canvas',
    minimum: AA_TEXT,
    measured: { light: 7.85, dark: 9.18 },
    where: 'the label of a secondary button, an off toggle and an unchecked segment (#668)',
  },
  {
    foreground: 'accent',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 7.85, dark: 9.18 },
    where: 'the border of a secondary button, a toggle and a segment, on the page (#668)',
  },
  {
    foreground: 'accentHover',
    background: 'surface',
    minimum: AA_TEXT,
    measured: { light: 10.03, dark: 10.74 },
    where: 'a secondary button, an off toggle or a segment under a pointer or a press (#688)',
  },
  {
    foreground: 'accentHover',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 11.01, dark: 11.65 },
    where: 'the border of a button under a pointer, on the page (#668, #688)',
  },
  {
    foreground: 'accentHover',
    background: 'selected',
    minimum: AA_TEXT,
    measured: { light: 8.83, dark: 6.88 },
    where: 'the label of an on toggle and of the checked segment (#668)',
  },
  {
    foreground: 'accent',
    background: 'selected',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 6.29, dark: 5.42 },
    where:
      'the doubled border of an on toggle and a checked segment, and the checked radio, on the `selected` fill (SC 1.4.1, 1.4.11, #668)',
  },
  {
    foreground: 'accentHover',
    background: 'selected',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 8.83, dark: 6.88 },
    where: 'the doubled border of an on toggle under a pointer (#668)',
  },
  {
    foreground: 'focus',
    background: 'selected',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 14.01, dark: 8.78 },
    where: "the focus ring on a checked segment's radio, landing on the segment's fill (#668)",
  },
  {
    foreground: 'inkMuted',
    background: 'surface',
    minimum: AA_TEXT,
    measured: { light: 6.51, dark: 7.99 },
    where: 'the label of a disabled button of any kind (#668)',
  },
  {
    foreground: 'border',
    background: 'surface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 3.79, dark: 5.2 },
    where: 'the border of a disabled button, and the doubled border of a disabled on toggle (#668)',
  },
  /*
   * #667: `accent-color` paints checkboxes, radios, a range and a progress bar
   * in `accent`, so two non-text pairs (WCAG 2.2 SC 1.4.11, 3:1) are new even
   * though both colours already meet here as text. The fill against the page
   * is what says "on"; the mark against the fill is the check itself. The
   * platform picks the mark's colour — a light or a dark glyph by the accent's
   * luminance — so the mark is NOT a token and is not a pair here: it is
   * {@link PLATFORM_CHECK_MARK}, recorded per palette and read back off the
   * pixels by `browser/shell.browser.spec.ts` §"#667" (#744's review found the
   * dark palette's mark is Chromium's own glyph, not `accentInk`).
   */
  {
    foreground: 'accent',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 7.85, dark: 9.18 },
    where: 'a checked checkbox or radio, a range and a progress bar (SC 1.4.11, #667)',
  },
  {
    foreground: 'hudInk',
    background: 'hudSurface',
    minimum: AA_TEXT,
    measured: { light: 17.07, dark: 17.07 },
    where: 'a metric on the ride HUD, over its own opaque panel (#94)',
  },
  {
    foreground: 'hudInkMuted',
    background: 'hudSurface',
    minimum: AA_TEXT,
    measured: { light: 8.79, dark: 8.79 },
    where: 'a field label on the ride HUD (#94)',
  },
  {
    foreground: 'hudBorder',
    background: 'hudSurface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 5.2, dark: 5.2 },
    where: 'the edge of a HUD control (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'hudInk',
    background: 'hudSurface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 17.07, dark: 17.07 },
    where:
      'the focus ring of every HUD control, the mute, the volume and the side camera’s Stop among them, offset onto its panel (WCAG 2.2 SC 2.4.13, #748)',
  },
  {
    foreground: 'hudStaleInk',
    background: 'hudSurface',
    minimum: AA_TEXT,
    measured: { light: 9.88, dark: 9.88 },
    where: 'the mark on a HUD reading whose sensor has dropped (#94)',
  },
  {
    foreground: 'accent',
    background: 'canvas',
    minimum: AA_TEXT,
    measured: { light: 7.85, dark: 9.18 },
    where: 'link text',
  },
  {
    foreground: 'accent',
    background: 'surface',
    minimum: AA_TEXT,
    measured: { light: 7.15, dark: 8.46 },
    where: 'link text and the active navigation item in the header',
  },
  {
    foreground: 'focus',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 17.48, dark: 14.86 },
    where: 'the focus ring, offset onto the page (WCAG 2.2 SC 2.4.13)',
  },
  {
    foreground: 'focus',
    background: 'surface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 15.93, dark: 13.69 },
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
    measured: { light: 14.44, dark: 12.13 },
    where: 'body text on a card resting on a panel',
  },
  {
    foreground: 'inkMuted',
    background: 'surfaceRaised',
    minimum: AA_TEXT,
    measured: { light: 5.89, dark: 7.08 },
    where: 'a label on a card resting on a panel',
  },
  {
    foreground: 'border',
    background: 'surfaceRaised',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 3.43, dark: 4.61 },
    where: 'the edge of a control on a raised card (WCAG 2.2 SC 1.4.11)',
  },
  {
    foreground: 'accent',
    background: 'surfaceRaised',
    minimum: AA_TEXT,
    measured: { light: 6.48, dark: 7.5 },
    where: 'link text on a raised card',
  },
  {
    foreground: 'focus',
    background: 'surfaceRaised',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 14.44, dark: 12.13 },
    where: 'the focus ring, offset onto a raised card (WCAG 2.2 SC 2.4.13)',
  },
  {
    foreground: 'ink',
    background: 'surfaceOverlay',
    minimum: AA_TEXT,
    measured: { light: 13.15, dark: 10.57 },
    where: 'the wordmark and the navigation, on the app header',
  },
  {
    foreground: 'inkMuted',
    background: 'surfaceOverlay',
    minimum: AA_TEXT,
    measured: { light: 5.37, dark: 6.17 },
    where: 'secondary text on the app header',
  },
  {
    foreground: 'border',
    background: 'surfaceOverlay',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 3.13, dark: 4.02 },
    where: "the header's own bottom rule (WCAG 2.2 SC 1.4.11)",
  },
  {
    foreground: 'accent',
    background: 'surfaceOverlay',
    minimum: AA_TEXT,
    measured: { light: 5.9, dark: 6.53 },
    where: 'a navigation link on the app header',
  },
  /*
   * #944: the navigation's active indicator, a filled pill behind the current
   * destination's icon and label, on the bar and the rail (both painted in
   * `surfaceOverlay`). The label and icon drawn on the pill are text, 4.5:1;
   * the pill against the bar is the shape that says where you are, so it is a
   * non-text boundary, 3:1 (SC 1.4.11). Both colours already meet elsewhere —
   * a primary button, a navigation link — and are repeated here, named for the
   * indicator, so a change to either use has to face this one too.
   */
  {
    foreground: 'accentInk',
    background: 'accent',
    minimum: AA_TEXT,
    measured: { light: 7.85, dark: 8.72 },
    where: "the current destination's label and icon, on the navigation's active indicator (#944)",
  },
  {
    foreground: 'accent',
    background: 'surfaceOverlay',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 5.9, dark: 6.53 },
    where: "the navigation's active indicator, against the bar and the rail (SC 1.4.11, #944)",
  },
  {
    foreground: 'focus',
    background: 'surfaceOverlay',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 13.15, dark: 10.57 },
    where: 'the focus ring, offset onto the app header (WCAG 2.2 SC 2.4.13)',
  },

  {
    foreground: 'infoInk',
    background: 'infoSurface',
    minimum: AA_TEXT,
    measured: { light: 8.44, dark: 9.36 },
    where: 'an info message',
  },
  {
    foreground: 'infoBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 5.43, dark: 5.84 },
    where: 'the edge of an info message',
  },
  {
    foreground: 'successInk',
    background: 'successSurface',
    minimum: AA_TEXT,
    measured: { light: 7.99, dark: 9.57 },
    where: 'a success message',
  },
  {
    foreground: 'successBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 5.22, dark: 6.12 },
    where: 'the edge of a success message',
  },
  {
    foreground: 'warningInk',
    background: 'warningSurface',
    minimum: AA_TEXT,
    measured: { light: 7.99, dark: 9.76 },
    where: 'a warning message — the Chrome-on-Linux path',
  },
  {
    foreground: 'warningBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 5.47, dark: 5.87 },
    where: 'the edge of a warning message',
  },
  {
    foreground: 'dangerInk',
    background: 'dangerSurface',
    minimum: AA_TEXT,
    measured: { light: 8.81, dark: 9.36 },
    where: 'an error message — the Safari and Firefox path',
  },
  {
    foreground: 'dangerBorder',
    background: 'canvas',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 6.63, dark: 5.2 },
    where: 'the edge of an error message',
  },

  /*
   * The focus ring on a status message (#661). A link inside a message is
   * focusable, and its ring is offset onto the message's own surface — a pair
   * nothing declared until a link in a message was painted on purpose.
   */
  {
    foreground: 'focus',
    background: 'infoSurface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 15.01, dark: 11.5 },
    where: 'the focus ring round a link in an info message (WCAG 2.2 SC 2.4.13)',
  },
  {
    foreground: 'focus',
    background: 'successSurface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 15.07, dark: 11.81 },
    where: 'the focus ring round a link in a success message (WCAG 2.2 SC 2.4.13)',
  },
  {
    foreground: 'focus',
    background: 'warningSurface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 15.37, dark: 11.96 },
    where: 'the focus ring round a link in a warning message (WCAG 2.2 SC 2.4.13)',
  },
  {
    foreground: 'focus',
    background: 'dangerSurface',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 14.82, dark: 13.11 },
    where: 'the focus ring round a link in an error message (WCAG 2.2 SC 2.4.13)',
  },

  // #661: every link state on every link surface.
  ...LINK_CONTRAST_REQUIREMENTS,

  /*
   * #936: what a menu draws OVER an illustration colour. Art is decoration and
   * owes nothing against itself (see `illoSky` above); these are the text and
   * controls later screens (#938 onwards) place on it, and the focus ring,
   * which lands on whatever art is behind a focused control. A new kind of
   * text or control over art declares its pair here before it is drawn.
   */
  {
    foreground: 'ink',
    background: 'illoSky',
    minimum: AA_TEXT,
    measured: { light: 13.31, dark: 12.72 },
    where: 'a hero title drawn on the sky of a menu illustration',
  },
  {
    foreground: 'inkMuted',
    background: 'illoSky',
    minimum: AA_TEXT,
    measured: { light: 5.44, dark: 7.42 },
    where: 'the line under a hero title, on the sky',
  },
  {
    foreground: 'ink',
    background: 'illoHillFar',
    minimum: AA_TEXT,
    measured: { light: 10.4, dark: 10.26 },
    where: 'a card title where it overlaps the far hills',
  },
  {
    foreground: 'accent',
    background: 'illoHillNear',
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: { light: 3.3, dark: 3.9 },
    where: 'the edge of a primary button standing on the near hill (WCAG 2.2 SC 1.4.11)',
  },
  ...ILLUSTRATION_TOKENS.map((token): ContrastRequirement => ({
    foreground: 'focus',
    background: token,
    minimum: AA_LARGE_TEXT_OR_NON_TEXT,
    measured: ILLUSTRATION_FOCUS_MEASURED[token],
    where: `the focus ring of a control over art, where it lands on ${token} (WCAG 2.2 SC 2.4.13)`,
  })),
];
