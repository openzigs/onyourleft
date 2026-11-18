// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The app's design tokens, mirrored for the admin pages** (#2771, ADR 0063).
 *
 * The values are On Your Left's own, from `apps/web/src/design/tokens.ts`
 * (`COLOUR_TOKENS`, `DARK_COLOUR_TOKENS`, `SPACE_TOKENS`, `FONT_SIZE_TOKENS`,
 * `FONT_FAMILY_TOKENS`), restated rather than imported: `apps/instance` may not
 * import `apps/web`, and moving the tokens to `packages/` would relicense them
 * from AGPL to Apache-2.0, which is not this change's to make. Only the tokens
 * the admin stylesheet draws are here.
 *
 * ⚠️ **A mirror drifts unless something holds it.**
 * `apps/web/src/a11y/admin-pages.a11y.test.ts` compares every value here with
 * the app's, so a token the app re-points turns that test red until this file
 * follows.
 */

/** The colour tokens the admin stylesheet uses, by the app's names. */
export const ADMIN_COLOUR_NAMES = [
  'canvas',
  'surface',
  'surfaceRaised',
  'surfaceOverlay',
  'border',
  'ink',
  'inkMuted',
  'accent',
  'accentText',
  'accentHover',
  'accentInk',
  'selected',
  'link',
  'linkHover',
  'focus',
  'infoSurface',
  'infoInk',
  'successSurface',
  'successInk',
  'warningSurface',
  'warningInk',
  'dangerSurface',
  'dangerInk',
  'dangerAction',
  'dangerActionInk',
] as const;

export type AdminColourName = (typeof ADMIN_COLOUR_NAMES)[number];

export type AdminScheme = 'light' | 'dark';

/** Each colour in each scheme: six-digit hex, lower case, as `tokens.ts` writes it. */
export const ADMIN_COLOURS: Readonly<
  Record<AdminScheme, Readonly<Record<AdminColourName, string>>>
> = {
  light: {
    canvas: '#ffffff',
    surface: '#ebeef0',
    surfaceRaised: '#dbdde0',
    surfaceOverlay: '#cbcdd0',
    border: '#6a6c6e',
    ink: '#131415',
    inkMuted: '#515355',
    accent: '#517d00',
    accentText: '#3e6100',
    accentHover: '#2c4300',
    accentInk: '#ffffff',
    selected: '#cdf39c',
    link: '#3d5b00',
    linkHover: '#2c4300',
    focus: '#131415',
    infoSurface: '#dceeff',
    infoInk: '#004876',
    successSurface: '#dbf2df',
    successInk: '#005122',
    warningSurface: '#f9ebd3',
    warningInk: '#5d4000',
    dangerSurface: '#ffe7e4',
    dangerInk: '#792b29',
    dangerAction: '#a21a21',
    dangerActionInk: '#ffffff',
  },
  dark: {
    canvas: '#101215',
    surface: '#242729',
    surfaceRaised: '#333639',
    surfaceOverlay: '#414447',
    border: '#93969a',
    ink: '#edeef1',
    inkMuted: '#b3b7ba',
    accent: '#aff13c',
    accentText: '#aff13c',
    accentHover: '#c7fd7b',
    accentInk: '#121809',
    selected: '#304216',
    link: '#aade5b',
    linkHover: '#cdf39c',
    focus: '#aff13c',
    infoSurface: '#142b3d',
    infoInk: '#93cbfc',
    successSurface: '#162e1b',
    successInk: '#99d3a4',
    warningSurface: '#35260d',
    warningInk: '#e5c182',
    dangerSurface: '#3e211e',
    dangerInk: '#ffb2ac',
    dangerAction: '#fb8981',
    dangerActionInk: '#321312',
  },
};

/** `SPACE_TOKENS`. */
export const ADMIN_SPACE = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2.5rem',
} as const;

/** The steps of `FONT_SIZE_TOKENS` the admin pages set text in. */
export const ADMIN_FONT_SIZE = {
  sm: '0.8rem',
  md: '1rem',
  lg: '1.25rem',
  xl: '1.5625rem',
  xxl: '1.953125rem',
} as const;

/**
 * `FONT_FAMILY_TOKENS`. The instance does not serve Barlow (#2771's decision):
 * the display face falls back to the system face, as the app's does before
 * its file has loaded.
 */
export const ADMIN_FONT_FAMILY = {
  body: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  display: "'Barlow', system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;

/** `--oyl-color-ink-muted` from `inkMuted`: the custom property's name, as `theme.css` names it. */
export const colourProperty = (name: AdminColourName): string =>
  `--oyl-color-${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
