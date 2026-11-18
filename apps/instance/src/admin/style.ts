// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **`/admin/admin.css`** (#2645, ADR 0069 D-4, D-6; restyled by #2771): the
 * admin pages in On Your Left's own look (ADR 0063, hi-vis) — the app's colour
 * tokens (`tokens.ts`, a mirror held to the app's by a test), its type scale
 * and spacing, its primary, secondary and danger buttons — dark unless the
 * browser prefers light, as the app is dark by default (ADR 0063 D-2). Served
 * as a file because the admin policy allows no inline style.
 *
 * - The header carries the mark and the instance's name, with the section
 *   links as a tab bar that marks the current page by a bar and a weight, not
 *   by colour alone, and wraps on a phone.
 * - A page is a column of cards; key figures are label/value tiles; a list is
 *   a table inside its own focusable scroll region (the app's `ScrollTable`).
 * - A change that is hard to undo is a `danger` card, apart from what is read,
 *   with the app's danger button.
 * - Every target is at least 48 px (the owner's ruling for the admin pages).
 *
 * Every colour this stylesheet draws is in {@link ADMIN_CONTRAST_PAIRS} with
 * what it is drawn on and the WCAG 2.2 AA threshold it needs, in both schemes,
 * and `apps/web/src/a11y/admin-pages.a11y.test.ts` holds each pair to
 * `design/contrast.ts`'s thresholds — and fails on a colour in the stylesheet
 * that no pair names, so a new colour cannot slip past it.
 *
 * ⚠️ The skip link is moved off-screen with a transform and stays focusable,
 * as the app's is (`apps/web/src/a11y/audit.ts`): jsdom loads no stylesheet,
 * so nothing here may hide a control the audit would then call reachable.
 *
 * ⚠️ `[hidden]` is restated as `display: none`: the passkey script shows and
 * hides its forms by the attribute, and a rule here that gives a form a
 * `display` of its own would otherwise draw a hidden form.
 */

import {
  ADMIN_COLOUR_NAMES,
  ADMIN_COLOURS,
  ADMIN_FONT_FAMILY,
  ADMIN_FONT_SIZE,
  ADMIN_SPACE,
  colourProperty,
  type AdminColourName,
  type AdminScheme,
} from './tokens.ts';

const colours = (scheme: AdminScheme): string =>
  ADMIN_COLOUR_NAMES.map(
    (name) => `  ${colourProperty(name)}: ${ADMIN_COLOURS[scheme][name]};`,
  ).join('\n');

const scale = (prefix: string, values: Readonly<Record<string, string>>): string =>
  Object.entries(values)
    .map(([step, value]) => `  --oyl-${prefix}-${step}: ${value};`)
    .join('\n');

const TOKENS = `
:root {
  color-scheme: dark;
${colours('dark')}
${scale('space', ADMIN_SPACE)}
${scale('font-size', ADMIN_FONT_SIZE)}
  --oyl-font-family-body: ${ADMIN_FONT_FAMILY.body};
  --oyl-font-family-display: ${ADMIN_FONT_FAMILY.display};
  --oyl-radius: 0.375rem;
  --oyl-radius-card: 0.75rem;
  --admin-width: 64rem;
  --admin-target: 3rem;
}
@media (prefers-color-scheme: light) {
  :root {
    color-scheme: light;
${colours('light').replace(/^ {2}/gm, '    ')}
  }
}
`;

const RULES = `
*, *::before, *::after { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--oyl-color-canvas); color: var(--oyl-color-ink); font-family: var(--oyl-font-family-body); font-size: var(--oyl-font-size-md); line-height: 1.55; }
h1, h2, h3 { line-height: 1.2; margin: 0 0 var(--oyl-space-sm); text-wrap: balance; }
h1 { font-family: var(--oyl-font-family-display); font-size: var(--oyl-font-size-xxl); font-weight: 800; letter-spacing: -0.02em; overflow-wrap: break-word; margin-bottom: var(--oyl-space-md); }
h2 { font-family: var(--oyl-font-family-display); font-size: var(--oyl-font-size-xl); font-weight: 700; letter-spacing: -0.01em; }
h3 { font-size: var(--oyl-font-size-lg); font-weight: 700; margin-top: var(--oyl-space-md); }
h2:first-child, h3:first-child { margin-top: 0; }
p { margin: var(--oyl-space-sm) 0; }
ul, ol { padding-left: var(--oyl-space-lg); }
li { margin: var(--oyl-space-xs) 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; overflow-wrap: anywhere; padding: 0 0.2em; border-radius: 0.2em; background: var(--oyl-color-surface-raised); }
a { color: var(--oyl-color-link); text-decoration-thickness: 1px; text-underline-offset: 0.15em; }
a:hover { color: var(--oyl-color-link-hover); text-decoration-thickness: 2px; }
:focus-visible { outline: 3px solid var(--oyl-color-focus); outline-offset: 2px; border-radius: var(--oyl-radius); }

.skip { position: absolute; left: var(--oyl-space-sm); top: var(--oyl-space-sm); z-index: 10; padding: var(--oyl-space-sm) var(--oyl-space-md); color: var(--oyl-color-accent-text); background: var(--oyl-color-canvas); border: 2px solid var(--oyl-color-accent-text); border-radius: var(--oyl-radius); transform: translateY(-300%); }
.skip:focus { transform: none; }

.shell { background: var(--oyl-color-surface); border-bottom: 1px solid var(--oyl-color-border); }
.shell-inner { max-width: var(--admin-width); margin: 0 auto; padding: var(--oyl-space-sm) var(--oyl-space-md) 0; }
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--oyl-space-sm) var(--oyl-space-md); }
.brand { display: flex; flex-wrap: wrap; align-items: center; gap: var(--oyl-space-xs) var(--oyl-space-md); margin: 0; min-height: var(--admin-target); }
.wordmark { display: inline-flex; align-items: center; gap: var(--oyl-space-sm); font-family: var(--oyl-font-family-display); font-size: var(--oyl-font-size-lg); font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
.mark { width: 1.75rem; height: 1rem; flex: none; fill: var(--oyl-color-info-ink); }
.brand .name { font-weight: 600; overflow-wrap: anywhere; }
.session { color: var(--oyl-color-ink-muted); font-size: var(--oyl-font-size-sm); margin: var(--oyl-space-xs) 0 0; }
.sign-out button { margin: 0; }
.sections ul { list-style: none; display: flex; flex-wrap: wrap; gap: 0 var(--oyl-space-xs); margin: var(--oyl-space-sm) 0 0; padding: 0; }
.sections li { margin: 0; }
.sections a { display: flex; align-items: center; min-height: var(--admin-target); padding: 0 var(--oyl-space-md); color: var(--oyl-color-ink); text-decoration: none; border-bottom: 4px solid transparent; border-radius: var(--oyl-radius) var(--oyl-radius) 0 0; }
.sections a:hover { background: var(--oyl-color-surface-raised); color: var(--oyl-color-ink); }
.sections a[aria-current=page] { font-weight: 700; background: var(--oyl-color-canvas); border-bottom-color: var(--oyl-color-accent-text); }

main { max-width: var(--admin-width); margin: 0 auto; padding: var(--oyl-space-lg) var(--oyl-space-md) var(--oyl-space-xl); }
.signed-out main { max-width: 36rem; }
.lead { max-width: 68ch; }
.panel { background: var(--oyl-color-surface); border: 1px solid var(--oyl-color-border); border-radius: var(--oyl-radius-card); padding: var(--oyl-space-md) var(--oyl-space-md) var(--oyl-space-lg); margin: var(--oyl-space-md) 0; }
.panel > :last-child { margin-bottom: 0; }
.panel.danger { border: 2px solid var(--oyl-color-danger-action); margin-top: var(--oyl-space-xl); }
form.apart { border-top: 2px solid var(--oyl-color-danger-action); padding-top: var(--oyl-space-sm); margin-top: var(--oyl-space-lg); }
.compact { margin: var(--oyl-space-xs) 0 0; font-size: var(--oyl-font-size-sm); }
.compact div { display: flex; flex-wrap: wrap; gap: 0 var(--oyl-space-sm); }
.compact dt { color: var(--oyl-color-ink-muted); }
.compact dt::after { content: ':'; }
.compact dd { margin: 0; overflow-wrap: anywhere; }
.pager a { display: inline-flex; align-items: center; min-height: var(--admin-target); }
.signed-out .shell-inner { padding-bottom: var(--oyl-space-sm); }
.item { border-top: 1px solid var(--oyl-color-border); padding: var(--oyl-space-md) 0 0; margin: var(--oyl-space-md) 0 0; }
.items { list-style: none; padding: 0; margin: 0; }
.items > li:first-child.item { border-top: 0; padding-top: 0; margin-top: var(--oyl-space-sm); }

.facts, .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); gap: var(--oyl-space-sm); margin: var(--oyl-space-md) 0; padding: 0; list-style: none; }
.facts > div, .tiles > li { background: var(--oyl-color-surface-raised); border-radius: var(--oyl-radius); padding: var(--oyl-space-sm) var(--oyl-space-md); margin: 0; min-width: 0; }
.facts dt { color: var(--oyl-color-ink-muted); font-size: var(--oyl-font-size-sm); font-weight: 600; letter-spacing: 0.02em; }
.facts dd { margin: var(--oyl-space-xs) 0 0; font-weight: 600; overflow-wrap: anywhere; }
.tiles .figure { display: block; font-family: var(--oyl-font-family-display); font-size: var(--oyl-font-size-xxl); font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
.tiles .label { color: var(--oyl-color-ink-muted); font-size: var(--oyl-font-size-sm); font-weight: 600; }

.scroll { max-width: 100%; overflow-x: auto; margin: var(--oyl-space-md) 0; border-radius: var(--oyl-radius); }
table { width: 100%; border-collapse: collapse; }
caption { text-align: left; font-weight: 700; padding: 0 0 var(--oyl-space-sm); }
th, td { text-align: left; vertical-align: top; padding: var(--oyl-space-sm); border-bottom: 1px solid var(--oyl-color-border); }
thead th { background: var(--oyl-color-surface-raised); font-size: var(--oyl-font-size-sm); white-space: nowrap; }
td.when { white-space: nowrap; font-variant-numeric: tabular-nums; }
td p { margin: 0 0 var(--oyl-space-xs); }

.hint { color: var(--oyl-color-ink-muted); }
.notice, .problem, .warning { padding: var(--oyl-space-sm) var(--oyl-space-md); border-radius: var(--oyl-radius); border-left: 4px solid; }
.notice { color: var(--oyl-color-info-ink); background: var(--oyl-color-info-surface); }
.notice[role=status] { color: var(--oyl-color-success-ink); background: var(--oyl-color-success-surface); }
.problem { color: var(--oyl-color-danger-ink); background: var(--oyl-color-danger-surface); font-weight: 600; }
.warning { color: var(--oyl-color-warning-ink); background: var(--oyl-color-warning-surface); }
.notice code, .problem code, .warning code { background: transparent; padding: 0; }

form { margin: var(--oyl-space-md) 0 0; }
label, legend { display: block; font-weight: 600; margin: var(--oyl-space-md) 0 var(--oyl-space-xs); }
fieldset { border: 1px solid var(--oyl-color-border); border-radius: var(--oyl-radius); margin: var(--oyl-space-md) 0 0; padding: 0 var(--oyl-space-md) var(--oyl-space-sm); }
fieldset label, .models label { display: inline; font-weight: 400; margin: 0; }
.models { list-style: none; padding: 0; }
.models li { display: flex; align-items: center; gap: var(--oyl-space-sm); min-height: var(--admin-target); }
input[type=text], input[type=url], select { font: inherit; width: 100%; max-width: 32rem; min-height: var(--admin-target); padding: var(--oyl-space-sm); color: var(--oyl-color-ink); background: var(--oyl-color-canvas); border: 2px solid var(--oyl-color-border); border-radius: var(--oyl-radius); }
input[type=radio], input[type=checkbox] { width: 1.5rem; height: 1.5rem; flex: none; margin: 0; accent-color: var(--oyl-color-accent); }

button { font: inherit; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; margin: var(--oyl-space-md) 0 0; min-height: var(--admin-target); min-width: var(--admin-target); padding: var(--oyl-space-sm) var(--oyl-space-lg); color: var(--oyl-color-accent-ink); background: var(--oyl-color-accent); border: 2px solid var(--oyl-color-accent-text); border-radius: var(--oyl-radius); }
button:hover { background: var(--oyl-color-accent-hover); border-color: var(--oyl-color-accent-hover); }
button.secondary { color: var(--oyl-color-accent-text); background: var(--oyl-color-surface-overlay); border-color: var(--oyl-color-surface-overlay); }
button.secondary:hover { color: var(--oyl-color-accent-hover); background: var(--oyl-color-selected); border-color: var(--oyl-color-selected); }
button.danger { color: var(--oyl-color-danger-action); background: var(--oyl-color-danger-surface); border-color: var(--oyl-color-danger-action); }
button.danger:hover { color: var(--oyl-color-danger-action-ink); background: var(--oyl-color-danger-action); border-color: var(--oyl-color-danger-action); }

details { margin: var(--oyl-space-xs) 0 0; }
summary { cursor: pointer; display: flex; align-items: center; min-height: var(--admin-target); color: var(--oyl-color-link); text-decoration: underline; text-underline-offset: 0.15em; }
details > code { display: block; padding: var(--oyl-space-sm); white-space: pre-wrap; }

.qr-figure { margin: var(--oyl-space-md) 0; }
.qr { display: block; width: 100%; max-width: 22rem; height: auto; forced-color-adjust: none; }

@media (min-width: 40rem) {
  h1 { font-size: 2.44140625rem; }
  main { padding: var(--oyl-space-xl) var(--oyl-space-lg); }
  .shell-inner { padding: var(--oyl-space-sm) var(--oyl-space-lg) 0; }
  .panel { padding: var(--oyl-space-lg); }
}
`;

/** The whole of `/admin/admin.css`. */
export const ADMIN_STYLE = `${TOKENS}${RULES}`;

/** One colour drawn on another, and the ratio WCAG 2.2 AA asks of the pair. */
export interface AdminContrastPair {
  readonly where: string;
  readonly foreground: string;
  readonly background: string;
  /** 4.5 for text, 3 for a border, a focus ring or other non-text (SC 1.4.11). */
  readonly minimum: 4.5 | 3;
}

/** What the stylesheet draws on what, by token: each becomes a pair in each scheme. */
const DRAWN: readonly (readonly [string, AdminColourName, AdminColourName, 4.5 | 3])[] = [
  ['text', 'ink', 'canvas', 4.5],
  ['text on a card', 'ink', 'surface', 4.5],
  ['text on a tile, a table’s head or code', 'ink', 'surfaceRaised', 4.5],
  ['a hint', 'inkMuted', 'canvas', 4.5],
  ['a hint on a card or the header', 'inkMuted', 'surface', 4.5],
  ['a tile’s label', 'inkMuted', 'surfaceRaised', 4.5],
  ['a link', 'link', 'canvas', 4.5],
  ['a link on a card', 'link', 'surface', 4.5],
  ['a link under a pointer', 'linkHover', 'canvas', 4.5],
  ['a link on a card, under a pointer', 'linkHover', 'surface', 4.5],
  ['the mark', 'infoInk', 'surface', 3],
  ['the current tab', 'ink', 'canvas', 4.5],
  ['the current tab’s bar', 'accentText', 'surface', 3],
  ['the skip link', 'accentText', 'canvas', 4.5],
  ['a notice', 'infoInk', 'infoSurface', 4.5],
  ['a notice of a change made', 'successInk', 'successSurface', 4.5],
  ['a problem', 'dangerInk', 'dangerSurface', 4.5],
  ['a warning', 'warningInk', 'warningSurface', 4.5],
  ['a button', 'accentInk', 'accent', 4.5],
  ['a button under a pointer', 'accentInk', 'accentHover', 4.5],
  ['a button’s edge on a card', 'accentText', 'surface', 3],
  ['a secondary button', 'accentText', 'surfaceOverlay', 4.5],
  ['a secondary button under a pointer', 'accentHover', 'selected', 4.5],
  ['a danger button', 'dangerAction', 'dangerSurface', 4.5],
  ['a danger button under a pointer', 'dangerActionInk', 'dangerAction', 4.5],
  ['a danger card’s edge, and the rule above a form apart', 'dangerAction', 'surface', 3],
  ['a field', 'ink', 'canvas', 4.5],
  ['a field’s border on a card', 'border', 'surface', 3],
  ['a field’s border', 'border', 'canvas', 3],
  ['a card’s or a table row’s border', 'border', 'surface', 3],
  ['a radio button', 'accent', 'surface', 3],
  ['the focus ring', 'focus', 'canvas', 3],
  ['the focus ring on a card or the header', 'focus', 'surface', 3],
  ['the focus ring on a secondary button', 'focus', 'surfaceOverlay', 3],
  ['the focus ring on a tab under a pointer', 'focus', 'surfaceRaised', 3],
];

/** Every pair {@link ADMIN_STYLE} draws, in both schemes. Six-digit hex, lower case. */
export const ADMIN_CONTRAST_PAIRS: readonly AdminContrastPair[] = (
  ['dark', 'light'] as const
).flatMap((scheme) =>
  DRAWN.map(([where, foreground, background, minimum]) => ({
    where: `${where}, ${scheme}`,
    foreground: ADMIN_COLOURS[scheme][foreground],
    background: ADMIN_COLOURS[scheme][background],
    minimum,
  })),
);
