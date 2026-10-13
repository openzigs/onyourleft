// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * #1327 (owner ruling 2026-10-13): no sentence a rider can read may claim that
 * EVERYTHING stays on this device, because a rider signed in to an instance
 * sends things (a sync, an analysis, a private room, a re-plan). #1244 reworded
 * the Ride note and the footer; this holds the rest, in every shipped source
 * file, not only the route notes `routes.test.ts` reads.
 *
 * ⚠️ It reads a FILE, not a line. Prose here wraps at 100 columns, in JSX text
 * and in string constants built with `+`, so a line-at-a-time scan passed over
 * both of the sentences it was written for once they wrapped (PR #1330's
 * review). `readable` joins the pieces first.
 *
 * What it cannot reach: the pattern is the ruling's own words, "everything …
 * stays on this device". A paraphrase ("Everything is kept on this device",
 * "Nothing leaves this device") passes it, and so does a sentence assembled at
 * run time from separate constants. Those are held by reading, and by the
 * route-sentences snapshot for what a route renders.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLAIM = /everything\b[^.]{0,20}\bstays? on this device/gi;

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) yield path;
  }
}

/**
 * A source file as the sentences in it read: comments dropped (a comment may
 * quote the old words to explain a rewording — a whole block comment, JSX's
 * included, and a line that is only a `//` comment), string pieces joined
 * across `+`, and every run of whitespace collapsed to one space.
 */
function readable(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/(['"`])\s*\+\s*(['"`])/g, '')
    .replace(/\s+/g, ' ');
}

/** Every claim a source file makes, as it reads. */
function claimsIn(source: string): string[] {
  return readable(source).match(CLAIM) ?? [];
}

describe('no claim that everything stays on this device — #1327', () => {
  it('is made by no shipped source file', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      for (const claim of claimsIn(readFileSync(file, 'utf8'))) {
        offenders.push(`${relative(SRC, file)}: ${claim}`);
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('reads the files the reworded sentences live in, and no test file', () => {
    const walked = [...sources(SRC)].map((file) => relative(SRC, file).replaceAll('\\', '/'));
    expect(walked).toContain('views/HomeView.tsx');
    expect(walked).toContain('views/AboutView.tsx');
    expect(walked).toContain('views/SyncPanel.tsx');
    expect(walked).toContain('shell/routes.ts');
    expect(walked.filter((file) => /\.test\.tsx?$/.test(file))).toStrictEqual([]);
  });

  it('catches the claim on one line', () => {
    expect(claimsIn('<p>Everything here stays on this device. To go:</p>')).toStrictEqual([
      'Everything here stays on this device',
    ]);
  });

  it('catches the claim wrapped across lines of JSX text', () => {
    const wrapped = ['<p>', '  Everything here stays on', '  this device. To get going:', '</p>'];
    expect(claimsIn(wrapped.join('\n'))).toHaveLength(1);
  });

  it('catches the claim split across concatenated string pieces', () => {
    const pieces = [
      'export const LEAD =',
      "  'sent there. Everything stays on ' +",
      "  'this device too.';",
    ];
    expect(claimsIn(pieces.join('\n'))).toHaveLength(1);
    expect(claimsIn('const a = "Everything stays " +\n  `on this device`;')).toHaveLength(1);
  });

  it('leaves alone a sentence that does not claim everything, and a comment that quotes one', () => {
    expect(claimsIn('<p>Every ride stays on this device.</p>')).toStrictEqual([]);
    expect(claimsIn('<p>Everything is here. A ride stays on this device.</p>')).toStrictEqual([]);
    expect(claimsIn('// was: Everything here stays on this device.')).toStrictEqual([]);
    const block = [
      '{/* #1327: was "Everything here',
      '    stays on this device." */}',
      '<p>Rides.</p>',
    ];
    expect(claimsIn(block.join('\n'))).toStrictEqual([]);
  });
});
