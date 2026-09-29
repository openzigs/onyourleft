// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The privacy policy says what the own-computer path sends, in the words the
 * owner approved** — #802, ADR 0035 D-9 wording B.
 *
 * ADR 0035 D-9: *"The code that ships each one pins it word for word, the way
 * `consent.test.ts` and `hosted-model.test.ts` already do."* So the paragraph
 * is read out of the ADR — never copied into this file, where it could drift
 * from both — and required in `docs/privacy-policy.md` unchanged; and the
 * rider-facing document is held to the three things #802 says it covers.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');

const ADR_0035 = 'docs/adr/0035-model-written-ride-write-ups.md';
const POLICY = 'docs/privacy-policy.md';
const RIDER_DOCUMENT = 'docs/analysis-on-your-own-computer.md';

/** Markdown as one line of words: no block-quote marks, no bold, one space. */
function asProse(markdown: string): string {
  return markdown
    .replaceAll(/^\s*>\s?/gm, '')
    .replaceAll('**', '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/**
 * ADR 0035 D-9's wording B as its 2026-09-29 amendment completed it (#845):
 * the block quote after `**B, as amended:**` and before C's. The body's
 * original B is never edited, so it is not what ships.
 */
function approvedWordingB(adr: string): string {
  const start = adr.indexOf('**B, as amended:**');
  const end = adr.indexOf('**C, as amended:**', start);
  if (start < 0 || end < 0) {
    return '';
  }
  const quoted = adr
    .slice(start, end)
    .split('\n')
    .filter((line) => line.trimStart().startsWith('>'))
    .join('\n');
  return asProse(quoted);
}

describe('the own-computer paragraph (#802, ADR 0035 D-9 B)', () => {
  const wording = approvedWordingB(read(ADR_0035));

  it('finds the approved wording in the ADR, with the owner’s addition in it', () => {
    // The vacuous pass: an empty extraction is contained in every document.
    expect(wording.length).toBeGreaterThan(400);
    expect(wording).toMatch(/^A ride sent to your own computer, when you ask for an analysis\./);
    expect(wording).toContain('your threshold power, if you set one');
    expect(wording).toContain("its distance, and each section's gradient and total climb");
    expect(wording).toContain('Never a picture.');
  });

  it('is in the privacy policy word for word', () => {
    expect(
      asProse(read(POLICY)),
      'docs/privacy-policy.md must carry ADR 0035 D-9 B as approved; an ADR body is never edited ' +
        'in place (CLAUDE.md §7), so a difference means the policy drifted',
    ).toContain(wording);
  });

  it('goes red on a policy that drops the owner’s addition', () => {
    const drifted = asProse(read(POLICY)).replace('your threshold power, if you set one, ', '');
    expect(drifted).not.toContain(wording);
  });

  it('goes red on a policy that drops the distance, gradient and climb — #845', () => {
    const drifted = asProse(read(POLICY)).replace(
      "its distance, and each section's gradient and total climb, ",
      '',
    );
    expect(drifted).not.toContain(wording);
  });
});

describe('the privacy policy’s sharing line (#845)', () => {
  const policy = asProse(read(POLICY));

  it('says the owner’s words, which agree with Play Data Safety declaring fitness info shared', () => {
    expect(policy).toContain(
      'We never sell your data. The only sharing is the analysis you choose to send to a service you set up.',
    );
  });

  it('no longer says there is no sharing at all', () => {
    expect(policy).not.toContain('No sale or sharing of personal information');
  });
});

describe('the rider-facing document (#802)', () => {
  const document = asProse(read(RIDER_DOCUMENT));

  it('states the context a model needs for the step prompts, as a size', () => {
    expect(document).toContain('at least 4 096 tokens');
  });

  it('says what happens with a weak model', () => {
    expect(document).toContain('A model too weak for the steps');
  });

  it('says nothing here has been tried with any particular server', () => {
    expect(document).toContain('has not been tried with any particular model server');
  });

  it('says the computer may still be working after a cancel', () => {
    expect(document).toContain('may still be working');
  });
});
