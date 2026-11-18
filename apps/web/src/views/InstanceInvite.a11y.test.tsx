// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A rider invite redeemed on the Connect screen (#2826), audited in each of
 * its states.
 *
 * The route walk (`a11y/routes.a11y.test.tsx`) renders the Instance screen not
 * connected, where the card box and its invite sentence are, but never what
 * follows an invite: the line a scan put in the boxes, a refused invite, and
 * the recovery codes shown once the invite has registered the rider. This
 * renders the real shell at the real route through each one and audits it,
 * as `OwnerClaim.a11y.test.tsx` does for the owner's claim.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { browserSecureWindow } from '../camera/secure-window-testing';
import { CameraController } from '../camera/session';
import { photographedCode, scriptedCamera } from '../camera/testing';
import { pairingCodeModules } from '../camera/side-link-qr';
import { codeWithCard } from '../instance/instance-pin';
import { INVITE_REFUSAL_TEXT, type ConnectOutcome } from '../instance/instance-port';
import { SCRIPTED_FINGERPRINT, scriptedInstance } from '../instance/testing';
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
import { CARD_SCAN_TEXT } from './CardScanner';
import { CONNECT_CARD_LABEL, CONNECT_SCANNED_TEXT, CONNECT_WITH_INVITE } from './InstanceView';
import { act } from 'react';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const INVITE = codeWithCard(
  `oyl-instance:https://ride.example#${SCRIPTED_FINGERPRINT}`,
  'wxyz-2345-abcd-efgh',
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

async function open(
  scripted: ReturnType<typeof scriptedInstance>,
  camera?: CameraController,
): Promise<void> {
  globalThis.location.hash = '#/settings/instance';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      instance={scripted.port}
      {...(camera === undefined ? {} : { camera })}
    />,
  );
  await settle();
}

function cardBox(): HTMLTextAreaElement {
  const label = queryAll<HTMLLabelElement>(document.body, 'label').find(
    (each) => each.textContent === CONNECT_CARD_LABEL,
  );
  const box = document.getElementById(label?.htmlFor ?? '');
  if (!(box instanceof HTMLTextAreaElement)) throw new Error('no card box');
  return box;
}

/** Paste the invite line into the card box and press Connect, as a rider would. */
async function redeem(): Promise<void> {
  await typeIntoTextArea(cardBox(), INVITE);
  await submitForm(cardBox().closest('form')!);
  await settle();
}

describe('a rider invite on the Connect screen, in each of its states (#2826)', () => {
  it('passes the audit with the invite sentence beside the card box', async () => {
    await open(scriptedInstance());
    expect(document.body.textContent).toContain(CONNECT_WITH_INVITE);
    // The sentence is the card box's description, read with it.
    const described = cardBox().getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(described)?.textContent).toContain(CONNECT_WITH_INVITE);
    expectClean('Connect, invite sentence');
  });

  it('passes the audit with a scanned invite in the boxes', async () => {
    const camera = scriptedCamera({
      codePixels: () => photographedCode(pairingCodeModules(INVITE)),
    });
    const controller = new CameraController({
      secureWindow: browserSecureWindow(),
      port: camera.port,
      schedule: () => () => undefined,
    });
    controller.agree({ acknowledgedBystanders: true, allowLocal: true });
    await open(scriptedInstance(), controller);
    const scan = queryAll<HTMLButtonElement>(document.body, 'button').find(
      (each) => each.textContent === CARD_SCAN_TEXT.start,
    );
    expect(scan, 'no scan button').toBeDefined();
    await act(async () => {
      scan!.click();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    for (let tick = 0; tick < 100 && cardBox().value === ''; tick += 1) {
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 30);
        });
      });
    }
    expect(cardBox().value).toBe(INVITE);
    expect(document.body.textContent).toContain(CONNECT_SCANNED_TEXT.line);
    expectClean('Connect, invite scanned');
  });

  it('passes the audit with each refused invite said', async () => {
    for (const text of Object.values(INVITE_REFUSAL_TEXT)) {
      await open(scriptedInstance({ connectAnswer: { kind: 'refused', text } }));
      await redeem();
      expect(document.body.textContent).toContain(text);
      expectClean(`Connect, invite refused: ${text}`);
      mounted?.unmount();
      mounted = undefined;
    }
  });

  it('passes the audit signed in by the invite, with the recovery codes shown once', async () => {
    const answer: ConnectOutcome = {
      kind: 'connected',
      recoveryCodes: Array.from({ length: 10 }, (_, index) => `code-${index}`),
    };
    await open(scriptedInstance({ connectAnswer: answer }));
    await redeem();
    expect(document.querySelector('#oyl-instance-connected')).not.toBeNull();
    expect(document.querySelector('#oyl-instance-recovery')).not.toBeNull();
    expectClean('Connected by an invite');
  });
});
