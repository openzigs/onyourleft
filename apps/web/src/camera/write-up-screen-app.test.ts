// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The two halves of `@onyourleft/analysis`'s `screen/write-up-screen.test.ts`
 * that read the app (#1094 moved the screen into that package): a screened
 * write-up renders through React as text, and no shipped module in the app
 * casts anything to a `ScreenedWriteUp` — the package's own test holds that of
 * the package, where the one cast is.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  passedScreen,
  screenWriteUp,
  type ScreenedWriteUp,
  type UntrustedText,
} from '@onyourleft/analysis';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

function shown(text: string): ScreenedWriteUp {
  const outcome = screenWriteUp(text as UntrustedText);
  if (!passedScreen(outcome)) {
    throw new Error(`withheld: ${outcome.withheld.join(', ')}`);
  }
  return outcome;
}

describe('screenWriteUp — plain text only', () => {
  it('is a string React renders as text: no element, no link, whatever it says', () => {
    const text = '<b>bold</b> <script>x()</script> [a](javascript:alert(1)) https://example.org';
    const markup = renderToStaticMarkup(createElement('p', null, shown(text)));
    expect(markup).toBe(
      '<p>&lt;b&gt;bold&lt;/b&gt; &lt;script&gt;x()&lt;/script&gt; [a](javascript:alert(1)) https://example.org</p>',
    );
    expect(markup).not.toMatch(/<(?!\/?p>)/);
  });
});

describe('ScreenedWriteUp — made only by the screen', () => {
  it('is never cast to in a shipped file of the app', () => {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const casts: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/as\s+ScreenedWriteUp\b/.test(readFileSync(path, 'utf8'))) {
            casts.push(path);
          }
        }
      }
    };
    walk(root);
    expect(casts).toEqual([]);
  });
});
