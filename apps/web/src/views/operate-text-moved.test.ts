// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #2644 (ADR 0069 D-7): the Operate sections' words moved to
 * `@onyourleft/operate-text`, and **no copy of them is left behind** in this
 * app. A copy would go on being drawn after the package's sentence changed,
 * and the app and the instance's admin pages would disagree without a test
 * noticing: the panels' own tests read the same name the panel draws.
 *
 * The names are DERIVED from the package — every value it exports — not
 * written down here, so a word added to it later is held to this as well. A
 * re-export (`export { X } from '@onyourleft/operate-text'`) is not a
 * declaration and is allowed: it is how the panels keep the names their tests
 * import. A type is not a value and is not in the list: the package's types
 * restate the route's shape structurally, and the app's checked types in
 * `instance/operate-port.ts` stay the client's own (#2644 leaves them there).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as operateText from '@onyourleft/operate-text';
import { describe, expect, it } from 'vitest';

const HERE = fileURLToPath(import.meta.url);
const SRC = join(dirname(HERE), '..');

const MOVED = Object.keys(operateText);

const DECLARATION = '\\b(?:const|let|var|function\\*?|class)\\s+';

/** A declaration of `name`: `const`, `let`, `var`, `function` or `class`. */
function declares(source: string, name: string): boolean {
  return new RegExp(`${DECLARATION}${name}\\b`).test(source);
}

/**
 * Every moved name a source declares, in one pass: a single pattern over all the
 * names, rather than one pattern per name per file, which grew past the 5 s case
 * bound under CI load as the package gained names (#1688: made cheaper, not given
 * more time).
 */
const ANY_MOVED = new RegExp(`${DECLARATION}(${MOVED.join('|')})\\b`, 'g');
function declaredMoved(source: string): string[] {
  return [...source.matchAll(ANY_MOVED)].map((match) => match[1] ?? '');
}

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('the Operate words live in @onyourleft/operate-text alone — #2644', () => {
  it('derives a list that holds the words the issue names', () => {
    for (const name of [
      'REGISTRATION_MODE_TEXT',
      'NOT_RECORDED',
      'STATUS_UNREADABLE_TEXT',
      'DOCKER_DESKTOP_DISK_TEXT',
      'TUNNEL_NOT_KNOWN',
      'BACKUP_OFF_BOX_TEXT',
      'LAST_BACKUP_OFF_BOX_TEXT',
      'BACKUPS_UNREADABLE_TEXT',
      'compareWithMainUrl',
      'durationText',
      'bytesText',
      'statusRows',
    ]) {
      expect(MOVED).toContain(name);
    }
  });

  it('finds a declaration it is shown, and passes over a re-export or an alias', () => {
    expect(declares("export const NOT_RECORDED = 'not recorded';", 'NOT_RECORDED')).toBe(true);
    expect(declares('function durationText(seconds: number) {}', 'durationText')).toBe(true);
    expect(
      declares("export { NOT_RECORDED } from '@onyourleft/operate-text';", 'NOT_RECORDED'),
    ).toBe(false);
    expect(declares('export { workoutDurationText as durationText };', 'durationText')).toBe(false);
    expect(declares('const NOT_RECORDED_YET = 1;', 'NOT_RECORDED')).toBe(false);
  });

  it('finds the same declarations in one pass as one name at a time', () => {
    const source = [
      "export const NOT_RECORDED = 'not recorded';",
      'function durationText(seconds: number) {}',
      "export { bytesText } from '@onyourleft/operate-text';",
      'const NOT_RECORDED_YET = 1;',
    ].join('\n');
    expect(declaredMoved(source)).toEqual(MOVED.filter((name) => declares(source, name)));
    expect(declaredMoved(source)).toEqual(['NOT_RECORDED', 'durationText']);
  });

  it('finds every export in one pass, from a source that declares them all (#2713)', () => {
    // A pattern built from only some of the names would miss the rest here.
    const source = MOVED.map((name) => `const ${name} = 1;`).join('\n');
    expect(declaredMoved(source)).toEqual(MOVED);
  });

  it('builds its pattern from plain identifiers only, so no name can widen it (#2713)', () => {
    // Unescaped in the pattern: a `$`, a `.` or a `|` in a name would change what it matches.
    expect(MOVED.filter((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))).toEqual([]);
  });

  it('declares none of the moved names anywhere under apps/web/src', () => {
    const left: string[] = [];
    // This file is skipped: its own probes above are declarations on purpose.
    for (const file of sources(SRC).filter((each) => each !== HERE)) {
      for (const name of declaredMoved(readFileSync(file, 'utf8'))) {
        left.push(`${relative(SRC, file)}: ${name}`);
      }
    }
    expect(left).toEqual([]);
  });
});
