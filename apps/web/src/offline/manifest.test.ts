// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The web app manifest, and the two documents it has to agree with (#405).
 *
 * `public/manifest.webmanifest` is a **static file**: Vite copies it into
 * `dist` verbatim and nothing typechecks it, nothing lints it and no SPDX
 * header can go in it. So the only thing standing between it and a colour that
 * drifted, an icon that was renamed or a `start_url` that points at nothing is
 * a test that reads it as a file — the `theme.a11y.test.ts` posture, applied to
 * a second artefact for the same reason.
 *
 * ⚠️ **What this file deliberately does NOT do is read `dist`.** CI runs
 * `test:coverage` *before* `build` (CLAUDE.md §4c), so a Vitest assertion over
 * the built output would skip on every CI run and report green — #142's shape
 * arriving through the ordering of a workflow rather than through a selector.
 * The built-output half of #405's criteria is in
 * `apps/web/browser/offline.browser.spec.ts`, which runs against a server
 * previewing `dist` and can therefore make the claim honestly.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { THEME_META_ATTRIBUTE } from '../design/theme-selection';
import { COLOUR_TOKENS, THEMES, paletteColours, themeColour } from '../design/tokens';

const PUBLIC_DIRECTORY = new URL('../../public/', import.meta.url);

const manifestText = readFileSync(
  fileURLToPath(new URL('manifest.webmanifest', PUBLIC_DIRECTORY)),
  'utf8',
);

const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose: string;
}

interface Manifest {
  readonly name: string;
  readonly short_name: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: string;
  readonly background_color: string;
  readonly theme_color: string;
  readonly icons: readonly ManifestIcon[];
}

const manifest = JSON.parse(manifestText) as Manifest;

describe('the web app manifest', () => {
  it('declares the fields a browser needs before it will offer to install', () => {
    expect(manifest.name).toBe('On Your Left');
    expect(manifest.short_name.length).toBeGreaterThan(0);
    // Twelve characters is what Android's launcher shows before it truncates.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.scope).toBe('./');
    expect(manifest.start_url).toBe('./');
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display);
  });

  it('carries both the sizes Chrome names, and a maskable one', () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose.split(' ').includes('maskable'))).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png');
    }
  });

  it('names no icon that is not committed', () => {
    // The failure this prevents is the one browsers report only in devtools: a
    // manifest entry pointing at a file nobody shipped. The built-output half —
    // that the file also reaches `dist` — is the browser gate's.
    const committed = new Set(readdirSync(fileURLToPath(PUBLIC_DIRECTORY)));
    for (const icon of manifest.icons) {
      expect(committed).toContain(icon.src.replace(/^\.\//, ''));
    }
  });

  it('commits no icon the manifest does not name, so a stale file cannot linger', () => {
    const named = new Set(manifest.icons.map((icon) => icon.src.replace(/^\.\//, '')));
    const pngs = readdirSync(fileURLToPath(PUBLIC_DIRECTORY)).filter((file) =>
      file.endsWith('.png'),
    );
    expect([...pngs].sort()).toEqual([...named].sort());
  });
});

describe('the manifest and the design tokens cannot drift', () => {
  it('takes its colours from tokens rather than from a hex literal typed twice', () => {
    expect(manifest.theme_color).toBe(COLOUR_TOKENS.accent);
    expect(manifest.background_color).toBe(COLOUR_TOKENS.canvas);
  });

  it('declares no colour that is not a token — the other direction', () => {
    // `theme.a11y.test.ts`'s rule: a one-way check passes over a manifest that
    // grew a fourth colour nobody declared. Every `#rrggbb` anywhere in the
    // document has to be a token's value.
    const declared = new Set(Object.values(COLOUR_TOKENS));
    for (const [literal] of manifestText.matchAll(/#[0-9a-f]{6}/g)) {
      expect(declared).toContain(literal);
    }
  });
});

/** Every `theme-color` meta in `index.html`, as its attributes (#672). */
function themeColourMetas(): Map<string, string>[] {
  return [...indexHtml.matchAll(/<meta\s+name="theme-color"([^>]*)\/>/g)].map(
    ([, attributes]) =>
      new Map(
        [...(attributes ?? '').matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, name, value]) => [
          name ?? '',
          value ?? '',
        ]),
      ),
  );
}

describe('index.html and the manifest', () => {
  it('links the manifest, which is what makes the browser fetch it at all', () => {
    expect(indexHtml).toMatch(/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/>/);
  });

  it('states the same theme colour the manifest does, for the light palette', () => {
    // Two documents, one colour. A browser reads the meta tag for the tab strip
    // and the manifest for the installed window, and a rider who installs the
    // app should not watch the chrome change colour. The manifest has ONE
    // `theme_color` and no media query, so it is the light palette's.
    const light = themeColourMetas().find((meta) => meta.get(THEME_META_ATTRIBUTE) === 'light');
    expect(light?.get('content')).toBe(manifest.theme_color);
  });
});

describe('index.html states a theme colour per palette (#672)', () => {
  it('carries exactly one meta per palette, each from its palette’s token', () => {
    // It read only the first meta until #672, so a second, drifted one would
    // have passed. Every meta is read, and each palette has exactly one.
    const metas = themeColourMetas();
    expect(metas.map((meta) => meta.get(THEME_META_ATTRIBUTE)).sort()).toEqual([...THEMES].sort());
    for (const theme of THEMES) {
      const meta = metas.find((candidate) => candidate.get(THEME_META_ATTRIBUTE) === theme);
      expect(meta?.get('content'), theme).toBe(themeColour(theme));
      // A token of THAT palette, so a dark meta cannot carry a light colour.
      expect(Object.values(paletteColours(theme))).toContain(meta?.get('content'));
      // Following the device until the script says otherwise.
      expect(meta?.get('media'), theme).toBe(`(prefers-color-scheme: ${theme})`);
    }
  });

  it('tells the browser the page has both palettes, before any stylesheet', () => {
    expect(indexHtml).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"\s*\/>/);
    expect(indexHtml.indexOf('name="color-scheme"')).toBeLessThan(indexHtml.indexOf('</head>'));
  });
});
