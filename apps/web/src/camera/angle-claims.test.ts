// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shared matchers — #798. What each rule matches is fixed by the scan's
 * suite (`no-absolute-angles.test.ts`, unchanged by the split) and by the
 * screen's (`write-up-screen.test.ts`); this file holds the two things the
 * split itself promised: the module imports nothing, and both users read it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { angleClaimKinds, visibleText } from './angle-claims';

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
}

describe('angle-claims.ts, the matchers the scan and the screen share', () => {
  it('imports nothing at all, so shipping it ships no compiler and nothing else', () => {
    const text = source('./angle-claims.ts');
    expect(text).not.toMatch(/^\s*import\b/m);
    expect(text).not.toMatch(/\bimport\s*\(/);
    expect(text).not.toMatch(/\brequire\s*\(/);
    expect(text).not.toMatch(/^\s*export\s+(?:\*|\{[^}]*\})\s+from\b/m);
    expect(text).not.toMatch(/['"]typescript['"]/);
  });

  it('is where the source scan takes its matchers from — one list, not two', () => {
    const scan = source('./no-absolute-angles.ts');
    expect(scan).toMatch(/from '\.\/angle-claims'/);
    // None of the patterns is restated there.
    expect(scan).not.toMatch(
      /\bconst\s+(?:DEGREE_SIGN|DEGREE_ABBREVIATION|DEGREE_WORD|FRONTAL_PLANE|INVISIBLE)\b/,
    );
    expect(scan).not.toMatch(/\/valgus\//);
  });

  it('is where the run-time screen takes its matchers from', () => {
    expect(source('./write-up-screen.ts')).toMatch(/from '\.\/angle-claims'/);
  });

  it('reports every rule a text breaks, each once, in a fixed order', () => {
    expect(angleClaimKinds('the knee valgus was 12 degrees, 12\u00b0, twice 12\u00b0')).toEqual([
      'angle-sign',
      'angle-word',
      'body-sideways',
    ]);
    expect(angleClaimKinds('a steady ride with a strong finish')).toEqual([]);
  });

  it('matches a full-width word through its compatibility form', () => {
    expect(angleClaimKinds('ｄｅｇｒｅｅｓ')).toEqual(['angle-word']);
    expect(angleClaimKinds('ｖａｌｇｕｓ')).toEqual(['body-sideways']);
  });

  it('removes the directional and zero-width characters before matching', () => {
    expect(visibleText('val\u202egus\ufeff\u200e\u2066x\u2069')).toBe('valgusx');
    expect(angleClaimKinds('val\u202egus')).toEqual(['body-sideways']);
    expect(angleClaimKinds('de\u2067gree')).toEqual(['angle-word']);
  });
});
