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
      // #1104 C-3, the owner's ruling of 2026-10-26: the policy says what the
      // code keeps — a finished job keeps its input until the account goes.
      'An analysis that does not finish is deleted after 7 days',
      'the side camera’s measurements included, if they were sent — are kept with your account until your account there is erased',
      'Deleting the ride, here or on your instance, does not remove them',
      'The write-up is in your account’s export there, and the ride’s numbers are not',
      // #1104 C-4: no route serves the kept write-up to a device; a sync does.
      'Another of your devices shows the write-up once this device has synced the ride’s write-up there',
      // #1104 C-2, ADR 0040 D-11.
      'How the model looks things up: with the searchable copy your instance keeps of what you synced',
      '| A searchable copy of what you synced, for the analysis |',
      'with a model on its own machine or its own private network, never a service',
      'your instance deletes its passages in the same step. Erasing this device does not reach it',
      'never the ride’s numbers or the model’s words',
      'your instance stops the analysis at its next step',
      "A ride's numbers sent to your instance, when you ask for an analysis of it",
      // #1229: what naming a synced ride sends, and that an unsynced one is not synced for it.
      "the app also sends the ride's id, which your instance already holds with the ride",
      'A ride you have not synced is not synced for this: it is sent with no id',
    ].map((each) => each.replaceAll('’', "'")),
  )('says %s', (fact) => {
    expect(POLICY).toContain(fact);
  });

  it.each(
    [
      // #1104 C-3 and C-4: both were false of the code on main.
      'The side camera’s measurements are not kept with it',
      'the write-up as it was written — for 7 days',
      'so another of your devices can show it',
    ].map((each) => each.replaceAll('’', "'")),
  )('no longer says %s', (claim) => {
    expect(POLICY).not.toContain(claim);
  });
});
