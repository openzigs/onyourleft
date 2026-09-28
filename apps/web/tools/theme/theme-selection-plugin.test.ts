// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { THEME_SELECTION_SCRIPT } from '../../src/design/theme-selection';

import { THEME_SELECTION_MARKER, withThemeSelection } from './theme-selection-plugin';

const INDEX_HTML = readFileSync(
  fileURLToPath(new URL('../../index.html', import.meta.url)),
  'utf8',
);

describe('the theme script is written ahead of every stylesheet (#672)', () => {
  it('goes straight after the charset, in the head', () => {
    const html = withThemeSelection(INDEX_HTML, '/index.html');
    const charset = html.indexOf('<meta charset="UTF-8" />');
    const script = html.indexOf(`<script id="${THEME_SELECTION_MARKER}">`);
    expect(charset).toBeGreaterThanOrEqual(0);
    expect(script).toBeGreaterThan(charset);
    expect(html.slice(charset, script).trim()).toBe('<meta charset="UTF-8" />');
    expect(script).toBeLessThan(html.indexOf('</head>'));
    expect(html).toContain(THEME_SELECTION_SCRIPT);
  });

  it('lands ahead of a stylesheet and a module in the head', () => {
    const html = withThemeSelection(
      '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/a.css"><style>b{}</style>' +
        '<script type="module" src="/m.js"></script></head><body></body></html>',
      'x.html',
    );
    const script = html.indexOf(THEME_SELECTION_MARKER);
    expect(script).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
    expect(script).toBeLessThan(html.indexOf('<style>'));
    expect(script).toBeLessThan(html.indexOf('type="module"'));
  });

  it('refuses a page it cannot put the script in the right place on', () => {
    expect(() => withThemeSelection('<html><head></head><body></body></html>', 'x.html')).toThrow(
      /no <meta charset>/,
    );
    expect(() =>
      withThemeSelection('<html><body><meta charset="utf-8"></body></html>', 'x.html'),
    ).toThrow(/no <meta charset>/);
  });

  it('is a classic script, so it runs before the page paints', () => {
    const html = withThemeSelection(INDEX_HTML, '/index.html');
    const opening = /<script id="oyl-theme-selection"([^>]*)>/.exec(html)?.[1] ?? 'missing';
    // No `type="module"`, no `defer`, no `async`: each would let a frame paint first.
    expect(opening).toBe('');
  });
});
