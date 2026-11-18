// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The owner's claim on the Connect screen (#2823, ADR 0080 D-3, D-5), over the
 * scripted port in `instance/testing.ts`.
 * `instance/instance-port.owner-claim.test.ts` is where the port meets a real
 * instance; this is what the screen does with its answers: the six digits,
 * large, the press that signs in, and one sentence for each refusal.
 */

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
  answer,
  buttonNamed,
  fieldLabelled,
  pasteCode,
  pressNamed,
  saidUnder,
} from '../testing/connect-flow';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { CONNECT_FLOW_TEXT } from './ConnectFlow';
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

const button = buttonNamed;
const press = pressNamed;

/** Since #2828: paste the line, say a setup page showed it, and press Claim this server. */
async function claim(line: string): Promise<void> {
  await pasteCode(line);
  await answer('claim');
  // The claim step takes the focus from the answer it replaced.
  expect(document.activeElement?.textContent).toBe(OWNER_CLAIM_TEXT.heading);
  await press(OWNER_CLAIM_TEXT.claim);
}

describe('the owner’s claim on the Connect screen — #2823', () => {
  it('sends the line it was given, then shows the six digits large in two groups, and never the code', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await pasteCode(LINE);
    await answer('claim');
    expect(text()).toContain(OWNER_CLAIM_TEXT.lead);
    // Nothing was sent by the paste or the answer: the press sends.
    expect(scripted.calls).toEqual(['current']);
    expect(text()).toContain(OWNER_CLAIM_TEXT.nothingSent);
    await press(OWNER_CLAIM_TEXT.claim);
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

  it('shows one sentence for a refusal under Claim this server, stays on the step, and shows no digits', async () => {
    const scripted = scriptedInstance({
      claimAnswer: { kind: 'refused', text: CLAIM_REFUSAL_TEXT.refused },
    });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await claim(LINE);
    // #2828: directly under the button that was pressed.
    expect(saidUnder(OWNER_CLAIM_TEXT.claim)).toContain(CLAIM_REFUSAL_TEXT.refused);
    expect(mounted.container.querySelector('.oyl-instance__compare')).toBeNull();
    expect(text()).not.toContain(CODE);
    // Pressing again takes the old sentence away until the new answer.
    await press(OWNER_CLAIM_TEXT.claim);
    expect(scripted.calls.filter((call) => call === `claimOwner ${LINE}`)).toHaveLength(2);
  });

  it('on “another number”, forgets the digits and the line, says what to do, and starts again with the focus on the paste box', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await claim(LINE);
    await press(OWNER_CLAIM_TEXT.differs);
    expect(mounted.container.querySelector('.oyl-instance__compare')).toBeNull();
    expect(text()).toContain(OWNER_CLAIM_TEXT.mismatch);
    expect(text()).not.toContain(SCRIPTED_COMPARISON_CODE.slice(0, 3));
    // The screen starts again: this device has no camera, so the paste box, empty.
    const box = fieldLabelled<HTMLTextAreaElement>(CONNECT_FLOW_TEXT.pasteLabel);
    expect(box.value).toBe('');
    expect(document.activeElement).toBe(box);
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
    expect(saidUnder(OWNER_CLAIM_TEXT.signIn)).toContain(CLAIM_REFUSAL_TEXT['not-confirmed']);
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
