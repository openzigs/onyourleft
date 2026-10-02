// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * No stylesheet fetches anything from another origin — #991, ADR 0043 D-4.
 *
 * `no-network.test.ts` reads the client's TypeScript for a network call, and
 * a stylesheet makes requests no script names: an `@import` and every
 * `url()` — a font above all. A display face linked from a font CDN would put
 * every rider's address, and the page that asked, in somebody else's log on
 * every cold start, which is ADR 0024's posture and D-3.a of ADR 0036 broken
 * by a line of CSS. So every stylesheet the client ships is read here: an
 * `@import` is refused outright (Tailwind's comes through the build, not a
 * request), every `url()` must be relative, and every `@font-face` must load
 * a WOFF2 committed in this repository.
 *
 * `browser/shell.browser.spec.ts` §"#991" is the other half: what the engine
 * actually requested for the face, read back from the network.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SOURCE = fileURLToPath(new URL('../', import.meta.url));

function stylesheets(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return stylesheets(path);
    return entry.name.endsWith('.css') ? [path] : [];
  });
}

/** What one stylesheet would ask the network for that is not a file beside it. */
function stylesheetFaults(css: string, file: string): string[] {
  const text = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const faults: string[] = [];
  for (const match of text.matchAll(/@import\b[^;]*;/g)) {
    faults.push(`${file}: an @import (${match[0]}) is a request the build does not make`);
  }
  for (const match of text.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g)) {
    const target = match[2] ?? '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) {
      faults.push(`${file}: url(${target}) is not on this app's own origin`);
    } else if (target.startsWith('/')) {
      faults.push(`${file}: url(${target}) is absolute, and does not resolve under every base`);
    } else if (!existsSync(resolve(dirname(file), target))) {
      faults.push(`${file}: url(${target}) names no committed file`);
    }
  }
  for (const match of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = match[1] ?? '';
    if (/\blocal\(/.test(body)) {
      faults.push(`${file}: an @font-face that reads a local() font draws differently per device`);
    }
    if (!/src:\s*url\(\s*'\.\/fonts\/[a-z0-9-]+\.woff2'\s*\)\s*format\('woff2'\)\s*;/.test(body)) {
      faults.push(`${file}: an @font-face that does not load one committed WOFF2 from ./fonts/`);
    }
  }
  return faults;
}

describe('the scan itself', () => {
  const here = join(SOURCE, 'design/theme.css');

  it('refuses a font from a CDN, however the URL is spelled', () => {
    for (const css of [
      "@font-face { src: url('https://fonts.gstatic.com/s/barlow/v12/x.woff2') format('woff2'); }",
      '@font-face { src: url(//fonts.gstatic.com/x.woff2) format("woff2"); }',
      "@font-face { src: url('HTTP://example.invalid/x.woff2') format('woff2'); }",
    ]) {
      expect(stylesheetFaults(css, here).some((fault) => /own origin/.test(fault))).toBe(true);
    }
  });

  it('refuses an @import, an absolute path, a missing file and a local() face', () => {
    expect(
      stylesheetFaults("@import url('https://fonts.googleapis.com/css2?family=Barlow');", here),
    ).not.toEqual([]);
    expect(stylesheetFaults("a { background: url('/fonts/x.woff2'); }", here)).not.toEqual([]);
    expect(stylesheetFaults("a { background: url('./fonts/nothing.woff2'); }", here)).not.toEqual(
      [],
    );
    expect(
      stylesheetFaults(
        "@font-face { src: local('Barlow'), url('./fonts/barlow-latin-800.woff2') format('woff2'); }",
        here,
      ),
    ).not.toEqual([]);
  });

  it('passes the face as theme.css loads it, and ignores a URL inside a comment', () => {
    expect(
      stylesheetFaults(
        "/* https://fonts.gstatic.com */ @font-face { src: url('./fonts/barlow-latin-800.woff2') format('woff2'); }",
        here,
      ),
    ).toEqual([]);
  });
});

describe('the client’s stylesheets', () => {
  const files = stylesheets(SOURCE);

  it('has stylesheets to read', () => {
    expect(files.map((file) => file.slice(SOURCE.length))).toContain('design/theme.css');
  });

  it('ask nothing of any origin but the app’s own', () => {
    expect(files.flatMap((file) => stylesheetFaults(readFileSync(file, 'utf8'), file))).toEqual([]);
  });

  it('load the display face — so the case above read a stylesheet that loads a font', () => {
    const theme = readFileSync(join(SOURCE, 'design/theme.css'), 'utf8');
    expect([...theme.matchAll(/@font-face\s*\{/g)].length).toBeGreaterThan(0);
  });
});
