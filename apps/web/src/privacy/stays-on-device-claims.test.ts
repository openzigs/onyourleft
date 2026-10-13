// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * #1327 (owner ruling 2026-10-13): no sentence a rider can read may claim that
 * EVERYTHING stays on this device, because a rider signed in to an instance
 * sends things (a sync, an analysis, a private room, a re-plan). #1244 reworded
 * the Ride note and the footer; this holds the rest, in every shipped source
 * file, not only the route notes `routes.test.ts` reads.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLAIM = /everything\b[^.\n]{0,20}\bstays? on this device/i;

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

describe('no claim that everything stays on this device — #1327', () => {
  it('is made by no shipped source file', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        // A comment may quote the old words to explain a rewording.
        if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
        if (CLAIM.test(line)) offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders).toStrictEqual([]);
  });

  it('would catch the claim (the pattern is not vacuous)', () => {
    expect(CLAIM.test('<p>Everything here stays on this device. To go:</p>')).toBe(true);
    expect(CLAIM.test('Every ride stays on this device.')).toBe(false);
  });
});
