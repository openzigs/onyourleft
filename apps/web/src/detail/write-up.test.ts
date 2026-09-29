// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a ride's page says about a model's write-up** — #805.
 *
 * The approved wording (ADR 0035 D-9) is read out of the ADR and required in
 * the code word for word, never copied into this file where it could drift
 * from both. A saved row is screened again before it is shown. And the two
 * files that render a write-up hold no way to turn text into markup.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { unixSeconds } from '@onyourleft/domain';
import { activityId, athleteId, type RideWriteUpRecord } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import { HOSTED_CONSENT } from '../camera/hosted-model';
import { stripComments } from '../units/no-inline-units';
import {
  COMPUTER_SENDS,
  COMPUTER_SENDS_LEAD,
  HOSTED_SENDS,
  missingSectionsText,
  shownWriteUp,
  WRITE_UP_FRAMING_LEAD,
  WRITE_UP_FRAMING_REST,
} from './write-up';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');

const ADR_0035 = 'docs/adr/0035-model-written-ride-write-ups.md';

/** Markdown as one line of words: no block-quote marks, no bold, one space. */
function asProse(markdown: string): string {
  return markdown
    .replaceAll(/^\s*>\s?/gm, '')
    .replaceAll('**', '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

/** The block quote after `heading` in ADR 0035 and before `next`. */
function quotedAfter(heading: string, next: string): string {
  const adr = read(ADR_0035);
  const start = adr.indexOf(heading);
  const end = adr.indexOf(next, start + heading.length);
  if (start < 0 || end < 0) {
    return '';
  }
  return asProse(
    adr
      .slice(start, end)
      .split('\n')
      .filter((line) => line.trimStart().startsWith('>'))
      .join('\n'),
  );
}

describe('the approved wording, word for word (ADR 0035 D-9)', () => {
  it('shows wording A, the framing, above every write-up', () => {
    const approved = quotedAfter('**A — the write-up', '**B — own computer');
    // The vacuous pass: an empty extraction equals nothing and is in everything.
    expect(approved).toMatch(/^Written by the model you chose/);
    expect(`${WRITE_UP_FRAMING_LEAD} ${WRITE_UP_FRAMING_REST}`).toBe(approved);
  });

  // B and C as ADR 0035's 2026-09-29 amendment completed them (#845). The
  // body's D-9 still quotes the originals, and an ADR body is never edited.
  it('says what the rider’s own computer is sent in wording B, as amended — #845', () => {
    const approved = quotedAfter('**B, as amended:**', '**C, as amended:**');
    expect(approved.length).toBeGreaterThan(400);
    expect(approved).toContain("its distance, and each section's gradient and total climb");
    expect(`${COMPUTER_SENDS_LEAD} ${COMPUTER_SENDS}`).toBe(approved);
  });

  it('stands wording C, as amended, beside the hosted ask, all but the sentence about the switch — #803, #845', () => {
    const approved = quotedAfter('**C, as amended:**', '⚠️ **The test question');
    expect(approved.length).toBeGreaterThan(900);
    expect(approved).toContain('one test question, containing none of your data');
    expect(`${HOSTED_SENDS.join(' ')} ${HOSTED_CONSENT.offUntilOn}`).toBe(approved);
    // More than the headline: #838's review found only the first sentence here.
    expect(HOSTED_SENDS.length).toBe(5);
  });

  it('would notice the body’s original B and C, which no longer ship — the control', () => {
    const originalB = quotedAfter('**B — own computer', '**C — hosted');
    const originalC = quotedAfter('**C — hosted', '⚠️ **A says');
    expect(originalB.length).toBeGreaterThan(400);
    expect(originalC.length).toBeGreaterThan(900);
    expect(`${COMPUTER_SENDS_LEAD} ${COMPUTER_SENDS}`).not.toBe(originalB);
    expect(`${HOSTED_SENDS.join(' ')} ${HOSTED_CONSENT.offUntilOn}`).not.toBe(originalC);
  });
});

const RECORD: RideWriteUpRecord = {
  activityId: activityId('ride-1'),
  athleteId: athleteId('athlete-a'),
  text: 'A steady ride.',
  templateId: 'ride-write-up',
  templateVersion: '1',
  source: 'computer',
  includedPose: false,
  missingSections: [],
  writtenAt: unixSeconds(1_800_000_000),
};

describe('a saved write-up is screened again before it is shown', () => {
  it('shows a row that passes, as the text the screen hands back', () => {
    expect(shownWriteUp({ ...RECORD, text: '  A steady ride.\r\nEven pacing.  ' })).toStrictEqual({
      kind: 'shown',
      text: 'A steady ride.\nEven pacing.',
      source: 'computer',
      includedPose: false,
      missingSections: [],
    });
  });

  it.each([
    ['an angle', 'Your knee opened to 142° at the bottom of the stroke.'],
    ['the frontal plane', 'Your knees showed some valgus late on.'],
    ['a degree spelled as a reference', 'The hip closed to 40&deg; at the top.'],
    ['a control character', 'A steady\u0007 ride.'],
  ])('withholds a row whose text states %s, whole', (_what, text) => {
    expect(shownWriteUp({ ...RECORD, text })).toStrictEqual({ kind: 'withheld' });
  });
});

describe('which sections were left out, counted as a rider counts', () => {
  it('says nothing when every section was written about', () => {
    expect(missingSectionsText([])).toBeUndefined();
  });

  it('names one section, counted from one', () => {
    expect(missingSectionsText([0])).toBe(
      'Section 1 could not be analysed, so the write-up says nothing about it.',
    );
  });

  it('names several, with an "and" before the last', () => {
    expect(missingSectionsText([1, 2, 4])).toBe(
      'Sections 2, 3 and 5 could not be analysed, so the write-up says nothing about them.',
    );
  });
});

describe('a write-up reaches the page as text and nothing else', () => {
  it.each(['apps/web/src/detail/RideWriteUpSection.tsx', 'apps/web/src/detail/write-up.ts'])(
    '%s turns no text into markup',
    (path) => {
      const code = stripComments(read(path));
      expect(code.length).toBeGreaterThan(500);
      expect(code).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|createElement|DOMParser|href=\{shown|href=\{saved/,
      );
    },
  );
});
