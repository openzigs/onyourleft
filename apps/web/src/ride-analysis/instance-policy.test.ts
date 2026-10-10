// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The privacy policy says what a write-up asked of the instance sends, in
 * the words the page says beside the press** — #1102, #1104 B3 and B6.
 *
 * The paragraph is the page's own constant (`detail/write-up.ts`
 * §`INSTANCE_SENDS`), so the policy and the page cannot say two things; and the
 * policy is held to the facts the issue names — where it goes, what the
 * instance keeps and for how long, what this device keeps, and a cancel.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { INSTANCE_SENDS, INSTANCE_SENDS_LEAD } from '../detail/write-up';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');

/** Markdown as one line of words: no bold, no italics marks, one space. */
function asProse(markdown: string): string {
  return markdown.replaceAll('**', '').replaceAll(/\s+/g, ' ').trim();
}

const POLICY = asProse(read('docs/privacy-policy.md'));
const WORDS = `${INSTANCE_SENDS_LEAD} ${INSTANCE_SENDS}`;

describe('the instance paragraph in the privacy policy (#1102, #1104 B3)', () => {
  it('is there word for word, as the page says it', () => {
    expect(WORDS.length).toBeGreaterThan(400);
    expect(POLICY).toContain(WORDS);
  });

  it('goes red on a policy that drops the tools the model may look up', () => {
    const drifted = POLICY.replace(
      'your saved workouts, and earlier write-ups',
      'earlier write-ups',
    );
    expect(drifted).not.toContain(WORDS);
  });

  it.each(
    [
      'encrypted end to end to your instance',
      'for 7 days',
      'The side camera’s measurements are not kept with it',
      'never the ride’s numbers or the model’s words',
      'your instance stops the analysis at its next step',
      "A ride's numbers sent to your instance, when you ask for an analysis of it",
    ].map((each) => each.replaceAll('’', "'")),
  )('says %s', (fact) => {
    expect(POLICY).toContain(fact);
  });
});
