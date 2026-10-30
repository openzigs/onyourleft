// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `main.tsx` deletes a hosted key a device kept before #1103 FIRST, before it
 * builds or draws anything (`retired-hosted-key.ts`). Read from the source, as
 * `ride-analysis/instance-analysis-main.test.ts` reads its builder, because
 * `main.tsx` runs on import.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

import { SOURCE_ROOT } from './import-walk-testing';

const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));

describe('main.tsx retires a device-held hosted key at launch (#1103)', () => {
  it('as the first thing render does, over this device’s storage', () => {
    const render = main.slice(main.indexOf('async function render('));
    expect(render.length).toBeGreaterThan(100);
    expect(render).toMatch(
      /^async function render\([^)]*\)[^{]*\{\s*retireDeviceHostedKey\(deviceRetiredKeyStorage\(\)\);/,
    );
  });

  it('hands an erase the eraser that forgets it', () => {
    expect(main).toMatch(/retiredHostedKey: retiredHostedKeyEraser\(deviceRetiredKeyStorage\(\)\)/);
  });
});
