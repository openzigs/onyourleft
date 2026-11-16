// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **`/admin/admin.css`** (#2645, ADR 0069 D-4, D-6): the instance pages' own
 * look (`html.ts` §`STYLE`) and the admin shell's few rules on top — the skip
 * link, the header with the section links and Sign out, and Status's facts.
 * Served as a file because the admin policy allows no inline style.
 *
 * Every colour this stylesheet names is in {@link ADMIN_CONTRAST_PAIRS} with
 * what it is drawn on and the WCAG 2.2 AA threshold it needs, and
 * `apps/web/src/a11y/admin-pages.a11y.test.ts` holds each pair to
 * `design/contrast.ts`'s thresholds — and fails on a colour in the
 * stylesheet that no pair names, so a new colour cannot slip past it.
 *
 * ⚠️ The skip link is moved off-screen with a transform and stays focusable,
 * as the app's is (`apps/web/src/a11y/audit.ts`): jsdom loads no stylesheet,
 * so nothing here may hide a control the audit would then call reachable.
 */

import { STYLE } from '../html.ts';

const SHELL = `
a { color: #1a4fa0; }
.skip { position: absolute; left: 0.5rem; top: 0.5rem; padding: 0.5rem 1rem; color: #1a1a1a; background: #ffffff; transform: translateY(-300%); }
.skip:focus { transform: none; }
.shell { max-width: 42rem; margin: 0 auto; padding: 1rem 1rem 0; }
.shell p { margin: 0.25rem 0; }
.shell .name { font-weight: 600; }
.sections ul { list-style: none; display: flex; flex-wrap: wrap; gap: 0.25rem 1.25rem; margin: 0.75rem 0 0; padding: 0; }
.sections a { display: inline-block; padding: 0.75rem 0; }
.sections a[aria-current=page] { font-weight: 600; text-decoration-thickness: 3px; }
.shell form button { margin-top: 0.75rem; }
.facts div { margin: 0.75rem 0; }
.facts dt { font-weight: 600; }
.facts dd { margin: 0; }
.warning { font-weight: 600; margin: 0.25rem 0; }
.log { padding-left: 1.25rem; }
.log li { margin: 0.5rem 0; }
@media (prefers-color-scheme: dark) {
  a { color: #8ab4ff; }
  .skip { color: #f0f0f0; background: #121212; }
}
`;

/** The whole of `/admin/admin.css`. */
export const ADMIN_STYLE = `${STYLE}${SHELL}`;

/** One colour drawn on another, and the ratio WCAG 2.2 AA asks of the pair. */
export interface AdminContrastPair {
  readonly where: string;
  readonly foreground: string;
  readonly background: string;
  /** 4.5 for text, 3 for a border, a focus ring or other non-text (SC 1.4.11). */
  readonly minimum: 4.5 | 3;
}

/** Every pair {@link ADMIN_STYLE} draws, in both schemes. Six-digit hex, lower case. */
export const ADMIN_CONTRAST_PAIRS: readonly AdminContrastPair[] = [
  // Light.
  { where: 'text', foreground: '#1a1a1a', background: '#ffffff', minimum: 4.5 },
  { where: 'a hint', foreground: '#4a4a4a', background: '#ffffff', minimum: 4.5 },
  { where: 'a problem', foreground: '#b00020', background: '#ffffff', minimum: 4.5 },
  { where: 'a link', foreground: '#1a4fa0', background: '#ffffff', minimum: 4.5 },
  { where: 'a button', foreground: '#ffffff', background: '#1a4fa0', minimum: 4.5 },
  { where: 'the focus ring', foreground: '#b35900', background: '#ffffff', minimum: 3 },
  { where: 'a field’s border', foreground: '#4a4a4a', background: '#ffffff', minimum: 3 },
  { where: 'a fieldset’s border', foreground: '#767676', background: '#ffffff', minimum: 3 },
  { where: 'a summary’s border', foreground: '#b00020', background: '#ffffff', minimum: 3 },
  // Dark.
  { where: 'text, dark', foreground: '#f0f0f0', background: '#121212', minimum: 4.5 },
  { where: 'a hint, dark', foreground: '#c8c8c8', background: '#121212', minimum: 4.5 },
  { where: 'a problem, dark', foreground: '#ff8a80', background: '#121212', minimum: 4.5 },
  { where: 'a link, dark', foreground: '#8ab4ff', background: '#121212', minimum: 4.5 },
  { where: 'a field, dark', foreground: '#f0f0f0', background: '#1e1e1e', minimum: 4.5 },
  { where: 'a field’s border, dark', foreground: '#b0b0b0', background: '#1e1e1e', minimum: 3 },
  { where: 'a button, dark', foreground: '#ffffff', background: '#1a4fa0', minimum: 4.5 },
  { where: 'the focus ring, dark', foreground: '#b35900', background: '#121212', minimum: 3 },
  { where: 'a fieldset’s border, dark', foreground: '#767676', background: '#121212', minimum: 3 },
  { where: 'a summary’s border, dark', foreground: '#ff8a80', background: '#121212', minimum: 3 },
];
