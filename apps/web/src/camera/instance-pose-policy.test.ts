// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The privacy policy says what the side camera's instance switches say, in
 * the words the Camera page says beside them** — #1106.
 *
 * The three texts are the page's own constants (`instance-pose.ts`), so the
 * policy and the page cannot say two things; and the policy is held to the
 * facts the owner's rulings name — sealed or not sent, not stored on the
 * instance, the hosted service named and under its own terms, its own
 * consent, and that *"never stored"* is a promise about the instance only.
 *
 * ⚠️ **The owner approved the words as written on 2026-10-12** (#1106, ADR
 * 0050 D-7). This holds the two documents together, so a change to one is
 * seen in the other; a change to either is the owner's.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  SIDE_INSTANCE_CONSENT,
  SIDE_INSTANCE_WHAT_IS_SENT,
  sideInstanceHostedConsent,
} from './instance-pose';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');

/** Markdown as one line of words: no bold or italics marks, no quote marks, one space. */
function asProse(markdown: string): string {
  return markdown
    .replaceAll(/^> ?/gm, '')
    .replaceAll('**', '')
    .replaceAll('*', '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

const POLICY = asProse(read('docs/privacy-policy.md'));
const SECTION = POLICY.slice(
  POLICY.indexOf('## Side-camera pictures sent to your instance'),
  POLICY.indexOf('## A ride analysed on your instance'),
);

describe('the side camera’s instance switches in the privacy policy (#1106)', () => {
  it('has a section of its own, before the write-up’s', () => {
    expect(SECTION.length).toBeGreaterThan(2_000);
  });

  it('says what is sent and the first consent word for word, as the page says them', () => {
    expect(SECTION).toContain(SIDE_INSTANCE_WHAT_IS_SENT);
    expect(SECTION).toContain(SIDE_INSTANCE_CONSENT);
  });

  it('says the hosted consent word for word, with “the service” where the page names one', () => {
    for (const paragraph of sideInstanceHostedConsent('the service')) {
      expect(SECTION, paragraph).toContain(paragraph);
    }
  });

  it('goes red on a policy that drops what the tunnel can still see', () => {
    const drifted = SECTION.replace(
      'how often and roughly how large. Your instance shows',
      'Your instance shows',
    );
    expect(drifted).not.toBe(SECTION);
    expect(drifted).not.toContain(SIDE_INSTANCE_CONSENT);
  });

  it.each([
    'with no card, or in a copy of the web app loaded from a website, none is sent',
    'It does not store the picture: it is not written to its database, to a file or to its logs',
    'Your instance never uses its operator’s key, or another rider’s, for your pictures',
    'It is agreed to by name.',
    'It is separate from a write-up.',
    'A model that cannot take pictures: your instance says so, no more pictures are sent',
    'no more than about one a second',
    'If this device later signs in to a different instance, it is off there until you switch it on again',
    'the tablet will not send one that does; your instance checks again and refuses one too',
  ])('says: %s', (fact) => {
    expect(SECTION.replaceAll("'", '’')).toContain(fact);
  });

  it('no longer says that no picture is ever sent to an instance, or that none can reach a hosted service', () => {
    expect(POLICY).not.toContain('no picture is ever sent to one');
    expect(POLICY).not.toContain(
      'There is no option in this app to send a picture to a hosted AI service',
    );
    expect(POLICY).not.toContain(
      "This is the only way this app's own code sends a picture anywhere",
    );
    // What is still true, and still said: #1106 did not change the count of
    // network calls (five since #1539's corridor, #1104).
    expect(POLICY).toContain('contains exactly five network calls');
  });
});
