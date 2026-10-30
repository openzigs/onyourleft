// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A side-camera snapshot is SAVED on the tablet, so nothing shipped may say
 * that no picture ever is** — #1063's review, B1;
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-10.
 *
 * #1063 keeps one picture per press with the ride it was taken in. Two
 * disclosures written before it say the opposite, and both are read by
 * somebody deciding whether to trust this app:
 *
 * - `docs/privacy-policy.md`, the published policy: *"No picture is ever saved
 *   on the tablet"*.
 * - `apps/mobile/src/android/data-safety.ts`, the answer filed on Play: side
 *   camera pictures are *"never stored, shown or sent on"*.
 *
 * D-10 makes the new sentences the owner's to approve, and the approved
 * wording is #1060's, carried by #1121. This test does NOT write them: it
 * fails while either old sentence is still there, so #1063 cannot land before
 * #1121 does. ⚠️ It is meant to be red on #1063's branch until #1121 merges;
 * the remedy is #1121's wording, never an edit to this file.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const REMEDY =
  'a side-camera snapshot is now saved on the tablet (#1063), so this disclosure is false. ' +
  'Land the owner-approved wording from #1060 / #1121 (ADR 0044 D-10) first; do not edit this test.';

/**
 * The file's text with Markdown emphasis removed and every run of whitespace
 * one space — after `strip`, which runs on the lines as written.
 */
function prose(path: string, strip: (text: string) => string = (text) => text): string {
  return strip(readFileSync(join(REPOSITORY_ROOT, path), 'utf8'))
    .replace(/\*\*/gu, '')
    .replace(/\s+/gu, ' ');
}

describe('nothing shipped says a side-camera picture is never saved — #1063, ADR 0044 D-10', () => {
  it('the privacy policy no longer says no picture is ever saved on the tablet', () => {
    const policy = prose('docs/privacy-policy.md');
    // The control: an empty or moved policy must not pass for a corrected one.
    expect(policy).toContain('side camera');
    expect(policy, REMEDY).not.toMatch(/No picture is ever saved on the tablet/iu);
  });

  it('the Data Safety answer no longer says side-camera pictures are never stored', () => {
    // Comments removed: a note recording what the old answer said is not the
    // answer filed on Play.
    const answer = prose('apps/mobile/src/android/data-safety.ts', stripComments);
    expect(answer).toContain('Photos and videos');
    expect(answer, REMEDY).not.toMatch(/never stored, shown or sent on/iu);
  });
});
