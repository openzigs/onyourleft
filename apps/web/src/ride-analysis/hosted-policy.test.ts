// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The privacy policy says what a ride analysis on the hosted model sends,
 * in the words the owner approved** — #803, ADR 0035 D-9 wording C.
 *
 * The policy's hosted section carries C's first two paragraphs — what is sent
 * and to whom — word for word, the same words `camera/hosted-model.ts`
 * §`HOSTED_CONSENT` renders and `hosted-model.test.ts` pins against ADR 0029's
 * newest amendment. And the sentence that promised to say so before any such
 * question was added is gone, not left beside the new text.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { HOSTED_CONSENT } from '../camera/hosted-model';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');

/** Markdown as one line of words: no block-quote marks, no bold, one space. */
function asProse(markdown: string): string {
  return markdown
    .replaceAll(/^\s*>\s?/gm, '')
    .replaceAll('**', '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** The policy's hosted section, as prose. */
function hostedSection(policy: string): string {
  const start = policy.indexOf('## Questions sent to a service you chose, on your own key');
  const end = policy.indexOf('\n## ', start + 3);
  return start < 0 ? '' : asProse(policy.slice(start, end < 0 ? undefined : end));
}

describe('the hosted section of the privacy policy (#803, ADR 0035 D-9 C)', () => {
  const section = hostedSection(read('docs/privacy-policy.md'));
  const approved = asProse(`${HOSTED_CONSENT.headline} ${HOSTED_CONSENT.paragraphs[0] ?? ''}`);

  it('finds the section, and the approved words are long enough to mean something', () => {
    expect(section.length).toBeGreaterThan(1000);
    expect(approved).toContain('your heart rate, cadence and power');
  });

  it('says what a ride analysis sends, and to whom, word for word', () => {
    expect(section).toContain(approved);
  });

  it('says what is not sent in the approved words’ terms', () => {
    expect(section).toContain('never a picture');
    expect(section).toContain('Not your name, not where you rode');
  });

  it('no longer promises to say so before numbers are added', () => {
    const policy = asProse(read('docs/privacy-policy.md'));
    expect(policy).not.toContain('this policy will say so before any question');
    expect(policy).not.toContain('it carries no numbers from your rides. The app is allowed');
  });

  it('goes red on a section that dropped the owner’s addition', () => {
    const drifted = section.replace('your threshold power, if you set one, ', '');
    expect(drifted).not.toContain(approved);
  });
});
