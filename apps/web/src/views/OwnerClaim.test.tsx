// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The owner's claim on the Connect screen (#2823, ADR 0080 D-3, D-5), over the
 * scripted port in `instance/testing.ts`.
 * `instance/instance-port.owner-claim.test.ts` is where the port meets a real
 * instance; this is what the screen does with its answers: the six digits,
 * large, the press that signs in, and one sentence for each refusal.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { codeWithCard } from '../instance/instance-pin';
import { CLAIM_REFUSAL_TEXT } from '../instance/instance-port';
import {
  SCRIPTED_COMPARISON_CODE,
  SCRIPTED_FINGERPRINT,
  scriptedInstance,
  scriptedOperate,
} from '../instance/testing';
import {
  mount,
  queryAll,
  settle,
  submitForm,
  typeIntoTextArea,
  type Mounted,
} from '../testing/mount';
import { InstanceView, RECOVERY_CODES_LEAD } from './InstanceView';
import { comparisonGroups, OWNER_CLAIM_TEXT } from './OwnerClaim';

const CARD = `oyl-instance:https://ride.example#${SCRIPTED_FINGERPRINT}`;
const CODE = 'k7mq-x3ra-p9tz-wc4e';
const LINE = codeWithCard(CARD, CODE);

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function text(): string {
  return (mounted?.container.textContent ?? '').replace(/\s+/g, ' ');
}

function button(name: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => each.textContent === name,
  );
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

function claimBox(): HTMLTextAreaElement {
  const label = queryAll<HTMLLabelElement>(document.body, 'label').find(
    (each) => each.textContent === OWNER_CLAIM_TEXT.label,
  );
  const box = document.getElementById(label?.htmlFor ?? '');
  if (!(box instanceof HTMLTextAreaElement)) throw new Error('no claim box');
  return box;
}

function claimForm(): HTMLFormElement {
  const form = claimBox().closest('form');
  if (form === null) throw new Error('no claim form');
  return form;
}

async function press(name: string): Promise<void> {
  await act(async () => {
    button(name).click();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  await settle();
}

async function claim(line: string): Promise<void> {
  await typeIntoTextArea(claimBox(), line);
  await submitForm(claimForm());
  await settle();
}

describe('the owner’s claim on the Connect screen — #2823', () => {
  it('sends the line it was given, then shows the six digits large in two groups, and never the code', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).toContain(OWNER_CLAIM_TEXT.lead);
    await claim(LINE);
    expect(scripted.calls).toContain(`claimOwner ${LINE}`);

    const digits = mounted.container.querySelector('.oyl-instance__compare');
    expect(digits?.textContent).toBe(comparisonGroups(SCRIPTED_COMPARISON_CODE).join(' '));
    expect(queryAll(digits!, 'strong').map((each) => each.textContent)).toEqual(['482', '913']);
    // Announced as it appears, with what to compare it with.
    expect(digits?.closest('[role="status"]')?.textContent).toContain(OWNER_CLAIM_TEXT.compare);
    expect(text()).toContain(OWNER_CLAIM_TEXT.then);
    expect(text()).not.toContain(CODE);
    // The next press has the focus.
    expect(document.activeElement).toBe(button(OWNER_CLAIM_TEXT.signIn));
  });

  it('shows one sentence for a refusal, keeps the box, and shows no digits', async () => {
    const scripted = scriptedInstance({
      claimAnswer: { kind: 'refused', text: CLAIM_REFUSAL_TEXT.refused },
    });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await claim(LINE);
    expect(text()).toContain(CLAIM_REFUSAL_TEXT.refused);
    expect(mounted.container.querySelector('.oyl-instance__compare')).toBeNull();
    expect(claimBox().value).toBe(LINE);
    // Typing again clears the old sentence.
    await typeIntoTextArea(claimBox(), CARD);
    expect(text()).not.toContain(CLAIM_REFUSAL_TEXT.refused);
  });

  it('on “another number”, forgets the digits and the line, says what to do, and gives the box the focus', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await claim(LINE);
    await press(OWNER_CLAIM_TEXT.differs);
    expect(mounted.container.querySelector('.oyl-instance__compare')).toBeNull();
    expect(text()).toContain(OWNER_CLAIM_TEXT.mismatch);
    expect(text()).not.toContain(SCRIPTED_COMPARISON_CODE.slice(0, 3));
    expect(claimBox().value).toBe('');
    expect(document.activeElement).toBe(claimBox());
    // Nothing was signed in.
    expect(scripted.calls.some((call) => call.startsWith('signInAsOwner'))).toBe(false);
  });

  it('signs in with the claim’s card, shows the recovery codes, and says the device owns the server', async () => {
    const scripted = scriptedInstance({
      ownerSignInAnswer: { kind: 'connected', recoveryCodes: ['aaaa-bbbb-cccc-dddd'] },
    });
    const operate = scriptedOperate({ standing: 'owner' });
    mounted = await mount(<InstanceView port={scripted.port} operate={operate.port} />);
    await settle();
    await claim(LINE);
    await press(OWNER_CLAIM_TEXT.signIn);
    expect(scripted.calls).toContain(`signInAsOwner ${CARD}`);
    expect(text()).toContain('Connected');
    expect(text()).toContain(OWNER_CLAIM_TEXT.owned);
    expect(text()).toContain(RECOVERY_CODES_LEAD);
    expect(text()).toContain('aaaa-bbbb-cccc-dddd');
  });

  it('says the device is not the owner yet when the server does not say it is', async () => {
    const scripted = scriptedInstance();
    const operate = scriptedOperate({ standing: 'not-owner' });
    mounted = await mount(<InstanceView port={scripted.port} operate={operate.port} />);
    await settle();
    await claim(LINE);
    await press(OWNER_CLAIM_TEXT.signIn);
    expect(text()).toContain(OWNER_CLAIM_TEXT['not-owner']);
    expect(text()).not.toContain(OWNER_CLAIM_TEXT.owned);
  });

  it('keeps the digits and says what to do when signing in is refused', async () => {
    const scripted = scriptedInstance({
      ownerSignInAnswer: { kind: 'refused', text: CLAIM_REFUSAL_TEXT['not-confirmed'] },
    });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await claim(LINE);
    await press(OWNER_CLAIM_TEXT.signIn);
    expect(text()).toContain(CLAIM_REFUSAL_TEXT['not-confirmed']);
    expect(mounted.container.querySelector('.oyl-instance__compare')?.textContent).toBe('482 913');
    expect(text()).not.toContain('Connected');
  });

  it('says nothing of a claim on a sign-in that did not come from one', async () => {
    const scripted = scriptedInstance({ connected: true });
    const operate = scriptedOperate({ standing: 'owner' });
    mounted = await mount(<InstanceView port={scripted.port} operate={operate.port} />);
    await settle();
    expect(text()).not.toContain(OWNER_CLAIM_TEXT.owned);
    expect(text()).not.toContain(OWNER_CLAIM_TEXT['not-owner']);
  });
});
