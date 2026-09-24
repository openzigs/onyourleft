// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The consent decision, and the one assertion that stops its wording drifting
 * from the ADR that ruled on it.
 *
 * ⚠️ **The verbatim check is the point of this file.** ADR 0029's 2026-09-23
 * amendment says why: *"the point of quoting it in an ADR was that Phase B
 * implements a sentence somebody ruled on."* A copy of a sentence in source is
 * a copy that drifts — this repository already checks a licence text against a
 * recorded digest (`check-licence-hashes.sh`) and a stylesheet against its
 * tokens (`theme.a11y.test.ts`) for exactly that reason. This is the third.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BYSTANDER_SENTENCE,
  CONSENT_REFUSAL_TEXT,
  CONSENT_STATEMENT,
  NO_CONSENT,
  consentDecision,
} from './consent';

const ADR_0029 = fileURLToPath(
  new URL('../../../../docs/adr/0029-camera-imagery-as-a-data-class.md', import.meta.url),
);

/**
 * A markdown block quote, as one line of prose.
 *
 * The ADR wraps at eighty columns, prefixes each line with `> `, and puts the
 * first three words in `**bold**`. None of that is the sentence; all of it
 * would make a naive `includes` fail for a reason nobody cares about. So both
 * sides are normalised the same way and what is compared is the words.
 */
function asProse(markdown: string): string {
  return markdown
    .replaceAll(/^\s*>\s?/gm, '')
    .replaceAll('**', '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

describe('the bystander sentence is the one the ADR ruled on', () => {
  const adr = asProse(readFileSync(ADR_0029, 'utf8'));

  it('can find the ADR at all', () => {
    // The vacuous pass: a path that resolved to nothing, or an ADR whose D-5
    // had been renumbered away, would make the assertion below compare a
    // sentence against an empty string and pass only if the sentence were also
    // empty — which it is not, so this is belt rather than braces. It is here
    // because the *next* version of this file might compare a substring.
    expect(adr).toContain('D-5 — Bystanders');
    expect(adr.length).toBeGreaterThan(10_000);
  });

  it('appears in ADR 0029 word for word', () => {
    expect(
      adr,
      'the consent screen must say what ADR 0029 D-5 says; an ADR body is never edited in place ' +
        '(CLAUDE.md §7), so a difference here means the code changed and needs a superseding ADR',
    ).toContain(asProse(BYSTANDER_SENTENCE));
  });

  it('keeps both limbs of the remedy, which is what the owner’s Q4 answer leans on', () => {
    // ADR 0029's amendment: with the camera on a tripod across the room the
    // first limb may not be available at all, and *"the second limb is then the
    // whole remedy"*. Dropping it would read as a softening.
    expect(BYSTANDER_SENTENCE).toContain('point the camera so they will not be in it');
    expect(BYSTANDER_SENTENCE).toContain('leave the camera off');
  });
});

describe('what the consent screen states', () => {
  it('says what is captured, where it goes and what is kept', () => {
    const all = CONSENT_STATEMENT.join(' ');
    expect(all).toContain('still pictures');
    expect(all).toContain('Nothing is sent anywhere');
    expect(all).toContain('thrown away');
    expect(all).toContain('until you delete it');
  });

  it('says where a picture CAN go since #387, and no longer that nothing can send one', () => {
    // #387 gave the client one network call. A consent screen that went on
    // saying "there is no code in it that can" would be false for every rider
    // who set up their own computer — the sentence changes with the code.
    const all = CONSENT_STATEMENT.join(' ');
    expect(all).toContain('a computer of your own');
    expect(all).toContain('only when you press the button');
    expect(all).not.toContain('there is no code in it that can');
  });

  it('promises no expiry timer, which ADR 0029 D-2 refuses', () => {
    // *"A deletion that depends on the program running is not a deletion, it is
    // a hope."* A line here promising "deleted after 30 days" would be the
    // promise the ADR declined to make.
    expect(CONSENT_STATEMENT.join(' ')).not.toMatch(/\b\d+\s*days?\b/i);
  });
});

describe('the decision', () => {
  const acknowledged = { acknowledgedBystanders: true, allowLocal: true, allowHosted: false };

  it('records a local consent once the bystander sentence is acknowledged', () => {
    expect(consentDecision(acknowledged)).toStrictEqual({
      consent: { local: true, hosted: false },
      refusal: undefined,
    });
  });

  it('refuses until the bystander sentence is acknowledged', () => {
    expect(consentDecision({ ...acknowledged, acknowledgedBystanders: false })).toStrictEqual({
      consent: undefined,
      refusal: 'not-acknowledged',
    });
  });

  it('refuses when nothing was agreed to', () => {
    expect(
      consentDecision({
        acknowledgedBystanders: true,
        allowLocal: false,
        allowHosted: false,
      }).refusal,
    ).toBe('nothing-agreed');
  });

  it('granting the local answer does not grant the hosted one', () => {
    // #382's own criterion, and the failure it prevents: *"a single 'allow
    // camera' toggle that silently also permits third-party egress"*.
    const decision = consentDecision(acknowledged);
    expect(decision.consent?.local).toBe(true);
    expect(decision.consent?.hosted).toBe(false);
  });

  it('refuses a hosted answer that has no local one under it', () => {
    expect(
      consentDecision({
        acknowledgedBystanders: true,
        allowLocal: false,
        allowHosted: true,
      }).refusal,
    ).toBe('hosted-without-local');
  });

  it('a device nobody has answered on has agreed to nothing', () => {
    expect(NO_CONSENT).toStrictEqual({ local: false, hosted: false });
  });

  it('has a sentence for every refusal it can return', () => {
    // Total over the union rather than sampled: a refusal added without words
    // renders `undefined` at a rider.
    for (const refusal of ['not-acknowledged', 'nothing-agreed', 'hosted-without-local'] as const) {
      expect(CONSENT_REFUSAL_TEXT[refusal].length).toBeGreaterThan(20);
    }
  });
});
