// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Connect screen's flow (#2828), audited in EVERY one of its states.
 *
 * The route walk (`a11y/routes.a11y.test.tsx`) renders the Instance screen not
 * connected, which is the flow's first step and no other. This renders the
 * real shell at the real route through each state a rider can reach — the
 * scan, the paste box, a code refused, the expert's address, the question,
 * each answer's step and each of its refusals, the owner's six digits, and
 * the connected screen each path ends on — and audits it. A state audited
 * only where it is absent has not been audited.
 *
 * It takes over the states `OwnerClaim.a11y.test.tsx` (#2823) and
 * `InstanceInvite.a11y.test.tsx` (#2826) audited, which were states of the
 * screen this flow replaced: the claim pending, refused and signed in, owner
 * or not yet; each refused invite; and the recovery codes after an invite.
 *
 * ⚠️ The 44 px touch target is a DECLARATION here, as in
 * `InstanceKeys.a11y.test.tsx`: every control is the design system's `Button`,
 * an `.oyl-input`, the paste box or an `.oyl-details` summary, whose classes
 * declare the floor. What is measured in a real engine, at 320 and 1280 px, is
 * `browser/cardscan.browser.spec.ts`'s.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { browserSecureWindow } from '../camera/secure-window-testing';
import { CameraController } from '../camera/session';
import { scriptedCamera } from '../camera/testing';
import { codeWithCard } from '../instance/instance-pin';
import {
  CLAIM_REFUSAL_TEXT,
  INVITE_REFUSAL_TEXT,
  type ConnectOutcome,
} from '../instance/instance-port';
import { SCRIPTED_FINGERPRINT, scriptedInstance, scriptedOperate } from '../instance/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { answer, buttonNamed, pasteCode, pressNamed, saidUnder } from '../testing/connect-flow';
import { mount, queryAll, settle, submitForm, type Mounted } from '../testing/mount';
import { CONNECT_CHOICE_CLASS } from './CardScanner';
import { CONNECT_FLOW_TEXT } from './ConnectFlow';
import { OWNER_CLAIM_TEXT } from './OwnerClaim';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const CARD = `oyl-instance:https://ride.example#${SCRIPTED_FINGERPRINT}`;
const LINE = codeWithCard(CARD, 'k7mq-x3ra-p9tz-wc4e');
const REFUSED = 'That address starts with http://.';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function agreedCamera(): CameraController {
  const camera = scriptedCamera();
  const controller = new CameraController({
    secureWindow: browserSecureWindow(),
    port: camera.port,
    schedule: () => () => undefined,
  });
  controller.agree({ acknowledgedBystanders: true, allowLocal: true });
  return controller;
}

async function open(
  scripted: ReturnType<typeof scriptedInstance>,
  extra: { readonly camera?: CameraController; readonly standing?: 'owner' | 'not-owner' } = {},
): Promise<void> {
  mounted?.unmount();
  globalThis.location.hash = '#/settings/instance';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      instance={scripted.port}
      operate={scriptedOperate({ standing: extra.standing ?? 'owner' }).port}
      {...(extra.camera === undefined ? {} : { camera: extra.camera })}
    />,
  );
  await settle();
}

/** The flow's controls: everything in the Connect section. */
function flowControls(): HTMLElement[] {
  const section = document.querySelector('[aria-labelledby="oyl-instance-connect"]');
  expect(section, 'no Connect section').not.toBeNull();
  return queryAll<HTMLElement>(section!, 'button, textarea, input, select, a[href], summary');
}

/** The audit, and every control in the flow declaring a 44 px target. */
function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
  const controls = flowControls();
  expect(controls.length, where).toBeGreaterThan(0);
  for (const control of controls) {
    const declared =
      control.tagName === 'BUTTON'
        ? control.classList.contains('oyl-button')
        : control.tagName === 'SUMMARY'
          ? control.parentElement?.classList.contains('oyl-details') === true
          : control.tagName === 'TEXTAREA'
            ? control.classList.contains('oyl-instance__card-box')
            : control.classList.contains('oyl-input');
    expect(declared, `${where}: ${control.outerHTML}`).toBe(true);
  }
  // At most one primary in the flow (#668): the step's own action.
  const primaries = flowControls().filter(
    (control) =>
      control.tagName === 'BUTTON' &&
      control.classList.contains('oyl-button') &&
      [...control.classList].every((name) => !name.startsWith('oyl-button--')),
  );
  expect(primaries.length, where).toBeLessThanOrEqual(1);
}

/** Open the start step's expert disclosure and press its Connect with `http://` typed. */
async function connectByAddress(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>(
    `form[aria-label="${CONNECT_FLOW_TEXT.expert}"]`,
  );
  const details = form?.closest('details');
  if (details === null || details === undefined) throw new Error('no expert disclosure');
  details.open = true;
  await submitForm(form!);
  await settle();
}

// One state per case, as `InstanceKeys.a11y.test.tsx` keeps them (#1207).
describe('the Connect flow, in each of its states (#2828)', () => {
  it('passes the audit on the start step with a camera: one large Scan a code, and Paste a code instead', async () => {
    await open(scriptedInstance(), { camera: agreedCamera() });
    const scan = buttonNamed(CONNECT_FLOW_TEXT.scan);
    expect(scan.classList.contains(CONNECT_CHOICE_CLASS)).toBe(true);
    expect(scan.classList.contains('oyl-button--secondary')).toBe(false);
    expect(buttonNamed(CONNECT_FLOW_TEXT.pasteInstead).classList).toContain('oyl-button--tertiary');
    // One scan button on the screen, not one per box (#2828).
    expect(
      queryAll<HTMLButtonElement>(document.body, 'button').filter((each) =>
        each.textContent?.startsWith('Scan'),
      ),
    ).toHaveLength(1);
    expectClean('start, camera');
  });

  it('passes the audit with the paste box opened from its link, which takes the focus', async () => {
    await open(scriptedInstance(), { camera: agreedCamera() });
    await pressNamed(CONNECT_FLOW_TEXT.pasteInstead);
    expect(document.activeElement?.tagName).toBe('TEXTAREA');
    // The scan steps down: Continue is the step's one primary now.
    expect(buttonNamed(CONNECT_FLOW_TEXT.scan).classList).toContain('oyl-button--secondary');
    expectClean('start, paste opened');
  });

  it('passes the audit on the start step with no camera, where the paste box is the way in', async () => {
    await open(scriptedInstance());
    expect(() => buttonNamed(CONNECT_FLOW_TEXT.scan)).toThrow();
    expectClean('start, no camera');
  });

  it('passes the audit with a pasted code refused under Continue', async () => {
    await open(scriptedInstance());
    await pasteCode('https://example.org/wifi');
    expect(saidUnder(CONNECT_FLOW_TEXT.read)).toContain(CONNECT_FLOW_TEXT.unreadable);
    expectClean('start, code refused');
  });

  it('passes the audit with the expert’s address open and its Connect refused', async () => {
    await open(scriptedInstance({ connectAnswer: { kind: 'refused', text: REFUSED } }));
    await connectByAddress();
    expect(saidUnder('Connect')).toContain(REFUSED);
    expectClean('start, address refused');
  });

  it('passes the audit with the one question and its three large choices', async () => {
    await open(scriptedInstance());
    await pasteCode(LINE);
    for (const choice of Object.values(CONNECT_FLOW_TEXT.choices)) {
      expect(buttonNamed(choice).classList).toContain(CONNECT_CHOICE_CLASS);
    }
    // The question names the group its choices are in.
    const group = buttonNamed(CONNECT_FLOW_TEXT.choices.claim).closest('[role="group"]');
    const label = document.getElementById(group?.getAttribute('aria-labelledby') ?? '');
    expect(label?.textContent).toBe(CONNECT_FLOW_TEXT.question);
    expect(document.activeElement).toBe(label);
    expectClean('question');
  });

  it('passes the audit on a plain card’s Connect, and with it refused', async () => {
    await open(scriptedInstance());
    await pasteCode(CARD);
    expect(document.body.textContent).toContain(CONNECT_FLOW_TEXT.cardHeading);
    expectClean('card');
    await open(scriptedInstance({ connectAnswer: { kind: 'refused', text: REFUSED } }));
    await pasteCode(CARD);
    await pressNamed('Connect');
    expect(saidUnder('Connect')).toContain(REFUSED);
    expectClean('card, refused');
  });

  it('passes the audit on the invite’s step, with each refused invite said under Connect', async () => {
    await open(scriptedInstance());
    await pasteCode(LINE);
    await answer('invite');
    expectClean('invite');
    for (const text of Object.values(INVITE_REFUSAL_TEXT)) {
      await open(scriptedInstance({ connectAnswer: { kind: 'refused', text } }));
      await pasteCode(LINE);
      await answer('invite');
      await pressNamed('Connect');
      expect(saidUnder('Connect')).toContain(text);
      expectClean(`invite refused: ${text}`);
    }
  });

  it('passes the audit signed in by an invite, with the recovery codes shown once', async () => {
    const outcome: ConnectOutcome = {
      kind: 'connected',
      recoveryCodes: Array.from({ length: 10 }, (_, index) => `code-${String(index)}`),
    };
    await open(scriptedInstance({ connectAnswer: outcome }));
    await pasteCode(LINE);
    await answer('invite');
    await pressNamed('Connect');
    expect(document.querySelector('#oyl-instance-connected')).not.toBeNull();
    expect(document.querySelector('#oyl-instance-recovery')).not.toBeNull();
    const violations = auditAccessibility(document);
    expect(violations.length === 0 ? '' : formatViolations(violations)).toBe('');
  });

  it('passes the audit on the add-device step, and with it refused under Add this device', async () => {
    await open(scriptedInstance());
    await pasteCode(LINE);
    await answer('device');
    expectClean('device');
    await open(scriptedInstance({ connectAnswer: { kind: 'refused', text: REFUSED } }));
    await pasteCode(LINE);
    await answer('device');
    await pressNamed(CONNECT_FLOW_TEXT.deviceButton);
    expect(saidUnder(CONNECT_FLOW_TEXT.deviceButton)).toContain(REFUSED);
    expectClean('device, refused');
  });

  it('passes the audit on the claim’s step, with the six digits waiting, and with each refusal', async () => {
    await open(scriptedInstance());
    await pasteCode(LINE);
    await answer('claim');
    expectClean('claim');
    await pressNamed(OWNER_CLAIM_TEXT.claim);
    expect(document.querySelector('.oyl-instance__compare')).not.toBeNull();
    expectClean('claim pending');
    await open(
      scriptedInstance({ claimAnswer: { kind: 'refused', text: CLAIM_REFUSAL_TEXT.refused } }),
    );
    await pasteCode(LINE);
    await answer('claim');
    await pressNamed(OWNER_CLAIM_TEXT.claim);
    expect(saidUnder(OWNER_CLAIM_TEXT.claim)).toContain(CLAIM_REFUSAL_TEXT.refused);
    expectClean('claim refused');
    await open(
      scriptedInstance({
        ownerSignInAnswer: { kind: 'refused', text: CLAIM_REFUSAL_TEXT['not-confirmed'] },
      }),
    );
    await pasteCode(LINE);
    await answer('claim');
    await pressNamed(OWNER_CLAIM_TEXT.claim);
    await pressNamed(OWNER_CLAIM_TEXT.signIn);
    expect(saidUnder(OWNER_CLAIM_TEXT.signIn)).toContain(CLAIM_REFUSAL_TEXT['not-confirmed']);
    expectClean('claim sign-in refused');
  });

  it('passes the audit starting again after the numbers differed', async () => {
    await open(scriptedInstance(), { camera: agreedCamera() });
    await pasteCode(LINE);
    await answer('claim');
    await pressNamed(OWNER_CLAIM_TEXT.claim);
    await pressNamed(OWNER_CLAIM_TEXT.differs);
    expect(document.body.textContent).toContain(OWNER_CLAIM_TEXT.mismatch);
    // The scan replaced the button pressed, and has the focus.
    expect(document.activeElement).toBe(buttonNamed(CONNECT_FLOW_TEXT.scan));
    expectClean('start again after a mismatch');
  });

  it('passes the audit signed in after the claim, owner or not yet', async () => {
    for (const standing of ['owner', 'not-owner'] as const) {
      await open(scriptedInstance(), { standing });
      await pasteCode(LINE);
      await answer('claim');
      await pressNamed(OWNER_CLAIM_TEXT.claim);
      await pressNamed(OWNER_CLAIM_TEXT.signIn);
      expect(document.body.textContent).toContain(
        standing === 'owner' ? OWNER_CLAIM_TEXT.owned : OWNER_CLAIM_TEXT['not-owner'],
      );
      const violations = auditAccessibility(document);
      expect(violations.length === 0 ? '' : `${standing}\n${formatViolations(violations)}`).toBe(
        '',
      );
    }
  });
});
