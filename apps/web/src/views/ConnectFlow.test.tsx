// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Connect flow (#2828), over the scripted port in `instance/testing.ts`:
 * how a code is read, and what each press does and does not send.
 * `ConnectFlow.instance.test.tsx` is where each path meets a real instance,
 * and `ConnectFlow.a11y.test.tsx` audits every state.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { browserSecureWindow } from '../camera/secure-window-testing';
import { CameraController } from '../camera/session';
import { scriptedCamera } from '../camera/testing';
import { codeWithCard, INSTANCE_KEY_TEXT } from '../instance/instance-pin';
import { SCRIPTED_FINGERPRINT, scriptedInstance } from '../instance/testing';
import type { ClaimOutcome, ConnectOutcome } from '../instance/instance-port';
import {
  answer,
  buttonNamed,
  fieldLabelled,
  pasteCode,
  pressNamed,
  typeName,
} from '../testing/connect-flow';
import { mount, settle, submitForm, typeInto, type Mounted } from '../testing/mount';
import { CONNECT_FLOW_TEXT, readCode } from './ConnectFlow';
import { InstanceView } from './InstanceView';
import { OWNER_CLAIM_TEXT } from './OwnerClaim';

const ORIGIN = 'https://ride.example';
const CARD = `oyl-instance:${ORIGIN}#${SCRIPTED_FINGERPRINT}`;
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

/** Every call but the screen's own reads of this device's connection. */
function sent(scripted: ReturnType<typeof scriptedInstance>): string[] {
  return scripted.calls.filter((call) => call !== 'current');
}

describe('reading a scanned or pasted code, on this device — #2828', () => {
  it('reads a card with a code as one line for the question, its code in lower case', () => {
    expect(readCode(`  ${codeWithCard(CARD, CODE.toUpperCase())}\n`)).toEqual({
      kind: 'line',
      line: LINE,
      origin: ORIGIN,
    });
  });

  it('reads a card alone as a card, with the address it names', () => {
    expect(readCode(` ${CARD} `)).toEqual({ kind: 'card', card: CARD, origin: ORIGIN });
  });

  it('refuses what is not a card in a sentence of its own, and a damaged card as a pasted one is', () => {
    expect(readCode('https://example.org/wifi')).toEqual({
      kind: 'refused',
      text: CONNECT_FLOW_TEXT.unreadable,
    });
    expect(readCode('')).toEqual({ kind: 'refused', text: CONNECT_FLOW_TEXT.unreadable });
    // Starts like a card, so the card's own words say what is wrong with it.
    expect(readCode(CARD.slice(0, -5))).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT['not-a-card'],
    });
    expect(readCode(codeWithCard(CARD.slice(0, -5), CODE))).toEqual({
      kind: 'refused',
      text: INSTANCE_KEY_TEXT['not-a-card'],
    });
  });
});

describe('the Connect flow — #2828', () => {
  it('asks where a card with a code came from, and sends nothing for the paste or the answer', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await pasteCode(LINE);
    expect(text()).toContain(CONNECT_FLOW_TEXT.question);
    expect(text()).toContain(CONNECT_FLOW_TEXT.codeFor(ORIGIN));
    for (const choice of Object.values(CONNECT_FLOW_TEXT.choices)) {
      expect(buttonNamed(choice)).toBeDefined();
    }
    // No box any more: the code was read, not put anywhere.
    expect(mounted.container.querySelector('textarea')).toBeNull();
    await answer('device');
    expect(sent(scripted)).toEqual([]);
    expect(text()).toContain(CONNECT_FLOW_TEXT.deviceNothingSent);
  });

  it('refuses a code it cannot read under Continue, sends nothing, and keeps the paste', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await pasteCode('https://example.org/wifi');
    expect(text()).toContain(CONNECT_FLOW_TEXT.unreadable);
    expect(text()).not.toContain(CONNECT_FLOW_TEXT.question);
    expect(fieldLabelled<HTMLTextAreaElement>(CONNECT_FLOW_TEXT.pasteLabel).value).toBe(
      'https://example.org/wifi',
    );
    expect(sent(scripted)).toEqual([]);
  });

  it('sends an invite with the name typed, to the card’s own address', async () => {
    const scripted = scriptedInstance();
    const pressed: unknown[] = [];
    mounted = await mount(
      <InstanceView
        port={{
          ...scripted.port,
          connect: (address, name, card) => {
            pressed.push([address, name, card]);
            return scripted.port.connect(address, name, card);
          },
        }}
      />,
    );
    await settle();
    await pasteCode(LINE);
    await answer('invite');
    expect(text()).toContain(CONNECT_FLOW_TEXT.inviteFor(ORIGIN));
    await typeName('Bea');
    expect(pressed).toEqual([]);
    await pressNamed('Connect');
    expect(pressed).toEqual([[ORIGIN, 'Bea', LINE]]);
    expect(text()).toContain('Connected');
  });

  it('connects a plain card to the address an expert typed instead of the card’s', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await pasteCode(CARD);
    const address = fieldLabelled<HTMLInputElement>(CONNECT_FLOW_TEXT.addressLabel);
    expect(address.value).toBe(ORIGIN);
    // In the expert's disclosure, shut until opened.
    expect(address.closest('details')?.open).toBe(false);
    await typeInto(address, 'https://elsewhere.example');
    await pressNamed('Connect');
    expect(sent(scripted)).toContain('connect https://elsewhere.example');
    expect(sent(scripted)).not.toContain(`connect ${ORIGIN}`);
  });

  it('starts again on Use another code from any step, forgetting the code and sending nothing', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    for (const step of [undefined, 'claim', 'invite', 'device'] as const) {
      await pasteCode(LINE);
      if (step !== undefined) await answer(step);
      await pressNamed(CONNECT_FLOW_TEXT.again);
      expect(text(), step).not.toContain(CONNECT_FLOW_TEXT.question);
      const box = fieldLabelled<HTMLTextAreaElement>(CONNECT_FLOW_TEXT.pasteLabel);
      expect(box.value, step).toBe('');
      expect(document.activeElement, step).toBe(box);
    }
    expect(sent(scripted)).toEqual([]);
  });

  it('gives each step’s heading the focus as the step replaces the answer pressed', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await pasteCode(LINE);
    expect(document.activeElement?.textContent).toBe(CONNECT_FLOW_TEXT.question);
    await answer('invite');
    expect(document.activeElement?.textContent).toBe(CONNECT_FLOW_TEXT.inviteHeading);
    await pressNamed(CONNECT_FLOW_TEXT.again);
    await pasteCode(LINE);
    await answer('device');
    expect(document.activeElement?.textContent).toBe(CONNECT_FLOW_TEXT.deviceHeading);
    await pressNamed(CONNECT_FLOW_TEXT.again);
    await pasteCode(LINE);
    await answer('claim');
    expect(document.activeElement?.textContent).toBe(OWNER_CLAIM_TEXT.heading);
  });

  it('cannot walk away from a claim in flight, and says what to do with the numbers it leaves', async () => {
    const scripted = scriptedInstance();
    let finish: (outcome: ClaimOutcome) => void = () => undefined;
    mounted = await mount(
      <InstanceView
        port={{
          ...scripted.port,
          claimOwner: () =>
            new Promise<ClaimOutcome>((resolve) => {
              finish = resolve;
            }),
        }}
      />,
    );
    await settle();
    await pasteCode(LINE);
    await answer('claim');
    await pressNamed(OWNER_CLAIM_TEXT.claim);
    expect(buttonNamed(CONNECT_FLOW_TEXT.again).disabled).toBe(true);
    await act(async () => {
      finish({ kind: 'pending', comparisonCode: '482913', card: CARD });
      await Promise.resolve();
    });
    await settle();
    expect(text()).toContain('482 913');
    expect(buttonNamed(CONNECT_FLOW_TEXT.again).disabled).toBe(false);
    await pressNamed(CONNECT_FLOW_TEXT.again);
    // The claim is pending on the server: the rider is told to press No there.
    expect(text()).toContain(OWNER_CLAIM_TEXT.mismatch);
  });

  it('holds Continue and Scan a code while the expert’s Connect is in flight', async () => {
    const scripted = scriptedInstance();
    let finish: (outcome: ConnectOutcome) => void = () => undefined;
    const camera = new CameraController({
      secureWindow: browserSecureWindow(),
      port: scriptedCamera().port,
      schedule: () => () => undefined,
    });
    camera.agree({ acknowledgedBystanders: true, allowLocal: true });
    mounted = await mount(
      <InstanceView
        camera={camera}
        port={{
          ...scripted.port,
          connect: () =>
            new Promise<ConnectOutcome>((resolve) => {
              finish = resolve;
            }),
        }}
      />,
    );
    await settle();
    await pressNamed(CONNECT_FLOW_TEXT.pasteInstead);
    const address = fieldLabelled<HTMLInputElement>(CONNECT_FLOW_TEXT.addressLabel);
    await typeInto(address, ORIGIN);
    const form = address.closest('form');
    if (form === null) throw new Error('no expert form');
    await submitForm(form);
    expect(buttonNamed(CONNECT_FLOW_TEXT.read).disabled).toBe(true);
    expect(buttonNamed(CONNECT_FLOW_TEXT.scan).disabled).toBe(true);
    await act(async () => {
      finish({ kind: 'refused', text: 'Nothing answered there.' });
      await Promise.resolve();
    });
    await settle();
    expect(buttonNamed(CONNECT_FLOW_TEXT.read).disabled).toBe(false);
    expect(buttonNamed(CONNECT_FLOW_TEXT.scan).disabled).toBe(false);
  });

  it('takes nothing on focus as the screen first opens', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
});
