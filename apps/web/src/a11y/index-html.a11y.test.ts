// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two accessibility properties that live in the HTML document rather than
 * in the React tree, and are therefore invisible to every other test here.
 *
 * `testing/mount.tsx` sets `lang` on the suite's own document so that the
 * `html-has-lang` rule does not fire on every route for a reason that has
 * nothing to do with the route. That is only defensible while something checks
 * the real file, and this is that something.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');

describe('index.html', () => {
  it('declares a language, which no rendered test can assert for it', () => {
    expect(indexHtml).toMatch(/<html[^>]*\slang="[a-z]{2}(-[A-Za-z0-9]+)?"/);
  });

  it('does not block zoom, which would fail WCAG 2.2 SC 1.4.4', () => {
    // `user-scalable=no` and a `maximum-scale` below 2 are the two ways a
    // viewport meta tag stops someone enlarging text. Both are the kind of line
    // that gets pasted in from a template and never questioned.
    const viewport = /<meta[^>]*name="viewport"[^>]*content="([^"]*)"/.exec(indexHtml)?.[1] ?? '';
    expect(viewport).not.toContain('user-scalable=no');
    expect(viewport).not.toMatch(/maximum-scale=(1(\.0*)?|0)/);
    expect(viewport).toContain('width=device-width');
  });

  it('has the mount point main.tsx throws without', () => {
    expect(indexHtml).toContain('id="root"');
  });
});
