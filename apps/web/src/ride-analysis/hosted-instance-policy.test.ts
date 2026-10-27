// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The privacy policy says what the hosted consent says, in the consent's own
 * words** — #1251, #1104 B1, B2 and B6.
 *
 * The consent is the screen's own constant (`hosted-consent.ts`
 * §`hostedInstanceConsent`), so the policy and the screen cannot say two
 * things; and the policy is held to the facts that are true of this build —
 * the key is the rider's own, where it is kept and who could read it, that the
 * masking list is sent to the instance, and what this device keeps.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { hostedInstanceConsent, HOSTED_REMOVE_BUTTON } from './hosted-consent';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');

/** Markdown as one line of words: no emphasis marks, no quote marks, one space. */
function asProse(markdown: string): string {
  return markdown.replaceAll(/^> ?/gm, '').replaceAll('*', '').replaceAll(/\s+/g, ' ').trim();
}

const POLICY = asProse(read('docs/privacy-policy.md'));
/** What the policy says where the screen says the service's address. */
const AS_THE_POLICY_NAMES_IT = 'the address you agreed to';
const consent = hostedInstanceConsent(AS_THE_POLICY_NAMES_IT);
const SENTENCES = [consent.headline, ...consent.paragraphs, consent.notNeeded, consent.offUntilOn];

describe('the hosted consent in the privacy policy (#1251, #1104 B1)', () => {
  it('is there word for word, in the order the screen shows it', () => {
    expect(SENTENCES).toHaveLength(10);
    expect(POLICY).toContain(SENTENCES.join(' '));
  });

  it('goes red on a policy that drops a tool the model may look up — the control', () => {
    const drifted = POLICY.replaceAll('summaries of older rides, ', '');
    expect(drifted).not.toContain(consent.paragraphs[0]);
  });

  it.each(
    [
      'The key is always your own.',
      'Whoever runs your instance cannot lend you theirs',
      'Your instance does not follow a redirect somewhere else.',
      'A key you paste is accepted only over the sealed connection from this app, never in plain text, and this device does not keep it.',
      'It is not a switch on this device and it does not turn itself off',
      'If you store a key for a different service, your instance withdraws it',
      'If it cannot be sent, no analysis is asked for.',
      // The owner's ruling of 2026-10-26 (#1104 B1-a, C-9), which the instance carries out.
      'Your instance keeps it with your account and in its export, and deletes it when you withdraw your agreement or remove your key.',
      'removed when you withdraw your agreement or remove your key, and erased with your account on the instance',
      'Your instance tells the app only whether the service answered, never what it said.',
      'What this device keeps: not the key.',
      `press ${HOSTED_REMOVE_BUTTON}`,
      // The instance table's rows (#1104 B6).
      '| A hosted model key you paste | held by your instance, encrypted',
      '| Your words to mask and your privacy zones | copied to your instance so it can mask what it sends to a service',
      '| Your hosted consent | the address of the service you agreed to, and when',
      // The short version and the sharing line.
      // The third since #1103 removed the second (#1104 C-6).
      'The third thing you can agree to: your instance sending a ride to a service you hold your own key for.',
      "the operator's key is never used for you",
      'a ride your instance sends, masked, to a service you hold your own key for and agreed to by its address, for an analysis you asked for',
    ].map((each) => each.replaceAll('’', "'")),
  )('says %s', (fact) => {
    expect(POLICY.replaceAll('’', "'")).toContain(fact);
  });

  it('does not say a record of what was sent is kept: none is', () => {
    expect(POLICY).not.toMatch(/record of what (was|it) (actually )?sent/);
  });
});
