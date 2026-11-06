// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's own stylesheet — #1945. `demo.css` lays the demo out in a small
 * frame, and the layout itself is measured in the browser
 * (`shell-demo.browser.spec.ts` §"#1945"), because jsdom performs no layout.
 * What is held here is what the browser cannot say: that the demo loads the
 * sheet after the theme it adjusts, that the rider app loads none of it (the
 * product's layout is unchanged by construction), and that it paints only
 * with the design tokens, as `theme.css` does.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const DEMO_CSS = read('./demo.css');
const THEME_CSS = read('../design/theme.css');
const DEMO_ENTRY = read('./main.tsx');
const PRODUCT_ENTRY = read('../main.tsx');

/** A stylesheet without its comments, which name selectors and values in prose. */
const rules = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, '');

describe('the demo’s stylesheet (#1945)', () => {
  it('is loaded by the demo’s entry, after the theme it adjusts', () => {
    const theme = DEMO_ENTRY.indexOf("import '../design/theme.css';");
    const demo = DEMO_ENTRY.indexOf("import './demo.css';");
    expect(theme).toBeGreaterThanOrEqual(0);
    expect(demo).toBeGreaterThan(theme);
  });

  it('is loaded by nothing the rider app loads, and the theme holds no rule of the demo’s', () => {
    expect(PRODUCT_ENTRY).not.toContain('demo.css');
    expect(rules(THEME_CSS)).not.toMatch(/\.oyl-demo/);
  });

  it('lays out a small frame: the compact query, and the controls kept and resized', () => {
    const css = rules(DEMO_CSS);
    expect(css).toMatch(/@media \(height < 27rem\), \(width < 46rem\) and \(height < 47rem\) \{/);
    // The narrow query is one condition: its other branch was a subset of it.
    expect(css).toContain('@media (width < 30rem) and (height < 47rem) {');
    expect(css).not.toContain('(height < 27rem) and (width < 30rem)');
    expect(css).toMatch(/\.oyl-hud__control \{[^}]*min-height: 44px !important;/);
    expect(css).not.toMatch(/\.oyl-hud__actions[^{]*\{[^}]*display: none/);
  });

  it('paints only with declared tokens: every var() is one theme.css declares, and no colour literal', () => {
    const css = rules(DEMO_CSS);
    const declared = new Set([...THEME_CSS.matchAll(/(--oyl-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
    const used = [...css.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((name) => !declared.has(name))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|color-mix)\(/i);
  });
});
