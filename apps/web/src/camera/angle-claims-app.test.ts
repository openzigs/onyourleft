// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The half of `@onyourleft/analysis`'s `screen/angle-claims.test.ts` that
 * reads the app: the source scan takes its matchers from that package's
 * `angle-claims.ts` — one list, not two (#798). It stayed beside the scan when
 * #1094 moved the matchers, because the scan imports the TypeScript compiler
 * and stays in `apps/web`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

function source(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');
}

describe('angle-claims.ts, the matchers the scan and the screen share', () => {
  it('is where the source scan takes its matchers from — one list, not two', () => {
    const scan = source('./no-absolute-angles.ts');
    expect(scan).toMatch(/from '@onyourleft\/analysis'/);
    // None of the patterns is restated there.
    expect(scan).not.toMatch(
      /\bconst\s+(?:DEGREE_SIGN|DEGREE_ABBREVIATION|DEGREE_WORD|FRONTAL_PLANE|INVISIBLE)\b/,
    );
    expect(scan).not.toMatch(/\/valgus\//);
  });
});
