// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The instance card box's touch target (#1190): DECLARED in `theme.css`, the
 * half of SC 2.5.5 a test without layout can hold. `InstanceKeys.a11y.test.tsx`
 * holds every control on the screen to this class or to `.oyl-button`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const THEME = readFileSync(fileURLToPath(new URL('../design/theme.css', import.meta.url)), 'utf8');

describe('the instance card box (#1190)', () => {
  it('declares a 44 px floor', () => {
    const rule = /\.oyl-instance__card-box\s*\{([^}]*)\}/.exec(THEME)?.[1] ?? '';
    expect(rule).toMatch(/min-height:\s*2\.75rem/);
  });
});
