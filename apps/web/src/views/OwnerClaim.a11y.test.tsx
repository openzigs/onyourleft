// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The owner's claim (#2823, ADR 0080 D-3, D-5), audited in each of its states.
 *
 * The route walk (`a11y/routes.a11y.test.tsx`) renders the Instance screen not
 * connected, where the claim form is, but never its later states: the six
 * digits waiting, a refusal, and the connected screen after the claim. This
 * renders the real shell at the real route through each one and audits it. A
 * state audited only where it is absent has not been audited.
 *
 * ⚠️ The 44 px touch target is a DECLARATION here, as in
 * `InstanceKeys.a11y.test.tsx`: every control is the design system's `Button`
 * or the card box, whose class declares the floor. The digits' size and the
 * layout at 320 px are measured in a real engine by
 * `browser/cardscan.browser.spec.ts`.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { browserSecureWindow } from '../camera/secure-window-testing';
import { CameraController } from '../camera/session';
import { scriptedCamera } from '../camera/testing';
import { codeWithCard } from '../instance/instance-pin';
import { CLAIM_REFUSAL_TEXT } from '../instance/instance-port';
import { SCRIPTED_FINGERPRINT, scriptedInstance, scriptedOperate } from '../instance/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import {
  mount,
  queryAll,
  settle,
  submitForm,
  typeIntoTextArea,
  type Mounted,
} from '../testing/mount';
import { OWNER_CLAIM_TEXT } from './OwnerClaim';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const LINE = codeWithCard(
  `oyl-instance:https://ride.example#${SCRIPTED_FINGERPRINT}`,
  'k7mq-x3ra-p9tz-wc4e',
);

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

/**
 * The claim's part of the screen: from its heading to the Connect form, which
 * follows it since the owner's ruling of 2026-11-18 put the claim at the top.
 */
function claimControls(): HTMLElement[] {
  const heading = queryAll<HTMLElement>(document.body, 'h3').find(
    (each) => each.textContent === OWNER_CLAIM_TEXT.heading,
  );
  expect(heading, 'no claim heading').toBeDefined();
  const connect = document.querySelector('form[aria-label="Connect"]');
  expect(connect, 'no Connect form').not.toBeNull();
  return queryAll<HTMLElement>(document.body, 'button, textarea, input, select, a[href]').filter(
    (control) =>
      heading!.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING &&
      control.compareDocumentPosition(connect!) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

/** Every control from the claim's heading on declares a 44 px target. */
function expectTargets(where: string): void {
  const controls = claimControls();
  expect(controls.length, where).toBeGreaterThan(0);
  for (const control of controls) {
    const declared =
      control.tagName === 'BUTTON'
        ? control.classList.contains('oyl-button')
        : control.classList.contains('oyl-instance__card-box');
    expect(declared, `${where}: ${control.outerHTML}`).toBe(true);
  }
}

async function open(
  scripted: ReturnType<typeof scriptedInstance>,
  extra: { readonly camera?: CameraController; readonly standing?: 'owner' | 'not-owner' } = {},
): Promise<void> {
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

function claimBox(): HTMLTextAreaElement {
  const label = queryAll<HTMLLabelElement>(document.body, 'label').find(
    (each) => each.textContent === OWNER_CLAIM_TEXT.label,
  );
  const box = document.getElementById(label?.htmlFor ?? '');
  if (!(box instanceof HTMLTextAreaElement)) throw new Error('no claim box');
  return box;
}

async function claim(): Promise<void> {
  await typeIntoTextArea(claimBox(), LINE);
  await submitForm(claimBox().closest('form')!);
  await settle();
}

async function press(name: string): Promise<void> {
  const found = queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => each.textContent === name,
  );
  expect(found, `no ${name} button`).toBeDefined();
  await act(async () => {
    found!.click();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  await settle();
}

// One state per case, as `InstanceKeys.a11y.test.tsx` keeps them (#1207).
describe('the owner’s claim, in each of its states (#2823)', () => {
  it('passes the audit with the claim form and its scanner button on the Connect screen', async () => {
    const camera = scriptedCamera();
    const controller = new CameraController({
      secureWindow: browserSecureWindow(),
      port: camera.port,
      schedule: () => () => undefined,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true });
    await open(scriptedInstance(), { camera: controller });
    // The two scanners on this screen are told apart by their names.
    const names = queryAll<HTMLButtonElement>(document.body, 'button').map(
      (each) => each.textContent,
    );
    expect(names).toContain(OWNER_CLAIM_TEXT.scan);
    expect(new Set(names.filter((name) => name?.startsWith('Scan'))).size).toBe(2);
    expectClean('Connect, claim form');
    expectTargets('Connect, claim form');
  });

  it('passes the audit with the six digits waiting', async () => {
    await open(scriptedInstance());
    await claim();
    expect(document.querySelector('.oyl-instance__compare')).not.toBeNull();
    expectClean('Connect, claim pending');
    expectTargets('Connect, claim pending');
  });

  it('passes the audit with a refusal said', async () => {
    await open(
      scriptedInstance({ claimAnswer: { kind: 'refused', text: CLAIM_REFUSAL_TEXT.refused } }),
    );
    await claim();
    expect(document.body.textContent).toContain(CLAIM_REFUSAL_TEXT.refused);
    expectClean('Connect, claim refused');
    expectTargets('Connect, claim refused');
  });

  it('passes the audit signed in after the claim, owner or not yet', async () => {
    for (const standing of ['owner', 'not-owner'] as const) {
      await open(scriptedInstance(), { standing });
      await claim();
      await press(OWNER_CLAIM_TEXT.signIn);
      expect(document.body.textContent).toContain(
        standing === 'owner' ? OWNER_CLAIM_TEXT.owned : OWNER_CLAIM_TEXT['not-owner'],
      );
      expectClean(`Connected after the claim, ${standing}`);
      mounted?.unmount();
      mounted = undefined;
    }
  });
});
