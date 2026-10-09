// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two cases of `@onyourleft/analysis`'s `template/template.test.ts` that
 * read the app or the Android shell, which a package may not (#1094 moved the
 * templates). Unchanged in assertion; the prompts are built by the same
 * fixtures, from `@onyourleft/analysis/testing`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ANALYSIS_TEMPLATES } from '@onyourleft/analysis';
import { everyPrompt, textOf } from '@onyourleft/analysis/testing';
import { describe, expect, it } from 'vitest';

import { angleClaimsIn } from '../camera/no-absolute-angles';

describe('each step declares its bounds', () => {
  it('sets no deadline the Android shell’s native read timeout would cut short', () => {
    const native = readFileSync(
      fileURLToPath(new URL('../../../mobile/src/http/analysis-http.ts', import.meta.url)),
      'utf8',
    );
    expect(native).toMatch(/ANALYSIS_READ_TIMEOUT_MILLISECONDS = 120_000;/);
  });
});

describe('what every prompt says', () => {
  const prompts = ANALYSIS_TEMPLATES.flatMap((template) => everyPrompt(template));

  it.each(prompts)('%s carries nothing the write-up screen would withhold', (label, prompt) => {
    const source = `export const prompt = ${JSON.stringify(textOf(prompt))};\n`;
    expect(angleClaimsIn(`${label}.ts`, source)).toStrictEqual([]);
  });
});
