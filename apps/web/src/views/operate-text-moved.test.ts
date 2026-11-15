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

/** A declaration of `name`: `const`, `let`, `var`, `function` or `class`. */
function declares(source: string, name: string): boolean {
  return new RegExp(`\\b(?:const|let|var|function\\*?|class)\\s+${name}\\b`).test(source);
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

  it('declares none of the moved names anywhere under apps/web/src', () => {
    const left: string[] = [];
    // This file is skipped: its own probes above are declarations on purpose.
    for (const file of sources(SRC).filter((each) => each !== HERE)) {
      const source = readFileSync(file, 'utf8');
      for (const name of MOVED) {
        if (declares(source, name)) left.push(`${relative(SRC, file)}: ${name}`);
      }
    }
    expect(left).toEqual([]);
  });
});
