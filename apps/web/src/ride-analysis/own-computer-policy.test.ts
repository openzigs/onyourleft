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

/** ADR 0035 D-9's wording B: the block quote after its heading and before C's. */
function approvedWordingB(adr: string): string {
  const start = adr.indexOf('**B — own computer, a new paragraph in the privacy policy:**');
  const end = adr.indexOf('**C — hosted', start);
  if (start < 0 || end < 0) {
    return '';
  }
  const quoted = adr
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('>'))
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
