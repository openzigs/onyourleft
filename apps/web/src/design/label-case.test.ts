// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * #1442: a label is in sentence case everywhere in the menus. The Ride
 * screen's readings and clock were drawn in capitals (ELAPSED, MOVING,
 * RECORDED) by `text-transform`, unlike every other label in the app.
 *
 * What this reads: every rule in `theme.css` that transforms case, and every
 * shipped `.tsx` for a Tailwind case utility. The one place capitals stay is
 * the trainer game's heads-up display (`.oyl-hud…`), which is the game's own
 * surface over a moving world, read at a glance, and not a menu.
 *
 * What it cannot reach: capitals typed into the words themselves. Those are
 * read in review, and by the route-sentences record for what a route renders.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const THEME = readFileSync(join(SRC, 'design/theme.css'), 'utf8');

/** The selectors of every rule whose block declares a case transform other than none. */
function caseTransformingSelectors(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const found: string[] = [];
  for (const match of bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector = '', body = ''] = match;
    if (/text-transform\s*:\s*(?!none\b)[a-z-]+/i.test(body)) {
      found.push(selector.trim().replace(/\s+/g, ' '));
    }
  }
  return found;
}

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name)) yield path;
  }
}

describe('labels in sentence case — #1442', () => {
  it('theme.css transforms case only on the game’s heads-up display', () => {
    const outside = caseTransformingSelectors(THEME).filter(
      (selector) => !selector.split(',').every((each) => each.trim().startsWith('.oyl-hud')),
    );
    expect(outside).toStrictEqual([]);
  });

  it('no shipped view uses a Tailwind case utility', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      if (/\btw:(uppercase|capitalize)\b/.test(readFileSync(file, 'utf8'))) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('finds a transform in a rule, and not in a comment or a `none`', () => {
    expect(
      caseTransformingSelectors(`
        /* .a { text-transform: uppercase; } */
        .b { color: red; text-transform: uppercase; }
        .c { text-transform: none; }
        @media (min-width: 1px) { .d, .e { text-transform: capitalize } }
      `),
    ).toStrictEqual(['.b', '.d, .e']);
  });
});
