// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The third-party notices as the app ships them — #664.
 *
 * `check:notices` is the gate that the two committed files are what the
 * generator writes from the installed tree. What it cannot see is the other
 * side of each file: that the screen reads the contents the way the generator
 * wrote them, that the copy in `public/` and the copy the screen inlines say
 * the same thing, and that the files the build copies out of a package are the
 * ones the notices name. Those are here.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { POSE_DIRECTORY, POSE_RUNTIME_WASM_FILE } from '../camera/pose-files';

import { parseNotices, THIRD_PARTY_NOTICES_URL } from './notices';
import { THIRD_PARTY_CONTENTS_SOURCE } from './notices-source';

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The whole document, as Vite copies it into `dist`. */
const DOCUMENT = readFileSync(
  join(WEB_ROOT, 'public', ...THIRD_PARTY_NOTICES_URL.replace(/^\.\//, '').split('/')),
  'utf8',
);

describe('the notices document in public/', () => {
  it('is where the screen links it, relative to the page', () => {
    // Read through the URL constant rather than a path typed here, so a link
    // pointing somewhere `public/` has nothing is a failure to read the file.
    expect(DOCUMENT.startsWith('THIRD-PARTY SOFTWARE IN ON YOUR LEFT')).toBe(true);
  });

  it('opens with exactly the contents the screen inlines', () => {
    expect(DOCUMENT.startsWith(THIRD_PARTY_CONTENTS_SOURCE)).toBe(true);
  });

  it('reads the same from the whole document as from the contents', () => {
    expect(parseNotices(DOCUMENT)).toEqual(parseNotices(THIRD_PARTY_CONTENTS_SOURCE));
  });

  it('carries every package it lists as an entry of its own, with licence text', () => {
    const { app, android } = parseNotices(DOCUMENT);
    for (const item of [...app, ...android]) {
      expect(DOCUMENT, `${item.name} ${item.version} has no entry`).toContain(
        `Name: ${item.name}\nVersion: ${item.version}\nLicence: ${item.licence}\n`,
      );
    }
  });

  it('names the pose runtime the build copies out of @mediapipe/tasks-vision', () => {
    // `tools/pose/pose-runtime-plugin.ts` emits this file into `dist` from the
    // installed package. Its name is the constant the plugin and the worker
    // both read, so renaming the runtime without the notices is red here.
    // Compared as text rather than built into a pattern, so nothing in the
    // file name has to be escaped.
    const copied = `  ${POSE_DIRECTORY}${POSE_RUNTIME_WASM_FILE} — from @mediapipe/tasks-vision `;
    expect(DOCUMENT.split('\n').some((line) => line.startsWith(copied))).toBe(true);
  });
});

describe('reading the contents', () => {
  const CONTENTS = [
    'Part 1 — in the app (2 packages)',
    '  @scope/name 1.0.0 — (MIT OR Apache-2.0)',
    '  plain 2.0.0 — ISC',
    '',
    'Part 2 — in the Android app only (1 libraries)',
    '  org.example:lib:3.0.0 — Apache-2.0',
    '',
    '  Built into the Android app from source:',
    '  :project — built from plain, noticed in part 1',
    '',
    'Part 3 — files copied out of a package into the build',
    '  pose/x.wasm — from plain 2.0.0 (a plugin)',
  ].join('\n');

  it('reads a scoped name and a compound licence expression', () => {
    expect(parseNotices(CONTENTS).app).toEqual([
      { name: '@scope/name', version: '1.0.0', licence: '(MIT OR Apache-2.0)' },
      { name: 'plain', version: '2.0.0', licence: 'ISC' },
    ]);
  });

  it('splits a Maven coordinate at its last colon', () => {
    expect(parseNotices(CONTENTS).android).toEqual([
      { name: 'org.example:lib', version: '3.0.0', licence: 'Apache-2.0' },
    ]);
  });

  it('reads nothing from part 3 or from the projects, and reports no problem', () => {
    expect(parseNotices(CONTENTS).problems).toEqual([]);
  });

  it('stops at the first entry, so licence text is never read as a package', () => {
    // A licence text that happened to hold a line shaped like a part heading
    // and one like a package would otherwise re-open the list.
    const parsed = parseNotices(
      `${CONTENTS}\n${'='.repeat(72)}\nPart 1 — in the app (3 packages)\n  evil 6.6.6 — MIT\n`,
    );
    expect(parsed.app.map((item) => item.name)).not.toContain('evil');
    expect(parsed.problems).toEqual([]);
  });

  it('reports a line it cannot read rather than skipping it', () => {
    const parsed = parseNotices(CONTENTS.replace('  plain 2.0.0 — ISC', '  plain-with-no-version'));
    expect(parsed.problems).toContain(
      'This line of the notices could not be read: plain-with-no-version',
    );
  });

  it('reports a part with no declared count', () => {
    expect(parseNotices('').problems).toEqual([
      'The notices do not say how many entries part 1 has.',
      'The notices do not say how many entries part 2 has.',
    ]);
  });
});
