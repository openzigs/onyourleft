// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The card-entry and confirm-new-card screens (#1190, ADR 0047 D-6), audited.
 *
 * The route walk (`a11y/routes.a11y.test.tsx`) renders the Instance screen
 * not connected, where neither screen exists. This renders the real shell at
 * the real route, connected, before a card, with one, and with the confirm
 * screen open, and audits each state. A screen audited only where it is
 * absent has not been audited.
 *
 * ⚠️ **The 44 px touch target is a DECLARATION here, not a measurement**:
 * jsdom performs no layout (`apps/web/CLAUDE.md`). Every control must be the
 * design system's `Button` — whose `.oyl-button` declares the floor that
 * `shell.browser.spec.ts` measures — or the card box, whose class declares
 * `min-height: 2.75rem` in `theme.css`, which `InstanceKeys.target.a11y.test.ts`
 * reads (jsdom loads no stylesheet).
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import {
  SCRIPTED_FINGERPRINT,
  SCRIPTED_NEW_FINGERPRINT,
  scriptedInstance,
} from '../instance/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, settle, typeIntoTextArea, type Mounted } from '../testing/mount';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

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

/** Every control on the instance's key section declares a 44 px target. */
function expectTargets(where: string): void {
  const section = queryAll<HTMLElement>(document.body, 'section').find((each) =>
    each.textContent?.startsWith('The instance’s key'),
  );
  expect(section, where).toBeDefined();
  const controls = queryAll<HTMLElement>(section!, 'button, textarea, input, select, a[href]');
  expect(controls.length, where).toBeGreaterThan(0);
  for (const control of controls) {
    if (control.tagName === 'BUTTON') {
      expect(control.classList.contains('oyl-button'), `${where}: ${control.outerHTML}`).toBe(true);
    } else {
      expect(
        control.classList.contains('oyl-instance__card-box'),
        `${where}: ${control.outerHTML}`,
      ).toBe(true);
    }
  }
}

async function open(scripted: ReturnType<typeof scriptedInstance>): Promise<void> {
  globalThis.location.hash = '#/settings/instance';
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} instance={scripted.port} />);
  await settle();
}

async function offer(card: string): Promise<void> {
  const box = queryAll<HTMLTextAreaElement>(document.body, 'textarea.oyl-instance__card-box').at(
    -1,
  );
  await typeIntoTextArea(box!, card);
  const use = queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => each.textContent === 'Use this card',
  );
  expect(use, 'no Use this card button').toBeDefined();
  // The press starts the port's promise; its answer renders inside the same
  // act scope, so React has nothing to warn about (#1207).
  await act(async () => {
    use!.click();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  await settle();
}

// One state per case (#1207): the three together took 3.7–4.1 s of Vitest's
// 5 s default under a loaded machine, and each now has the whole budget.
describe('the card-entry and confirm-new-card screens (#1190)', () => {
  const PINNED = `oyl-instance:https://ride.example#${SCRIPTED_FINGERPRINT}`;
  const NEW_CARD = `oyl-instance:https://ride.example#${SCRIPTED_NEW_FINGERPRINT}`;

  it('passes the audit connected with no card', async () => {
    const scripted = scriptedInstance({ connected: true });
    await open(scripted);
    expect(document.body.textContent).toContain('This needs the instance’s card');
    expectClean('Instance, connected, no card');
    expectTargets('Instance, connected, no card');
  });

  it('passes the audit with a card pinned', async () => {
    const scripted = scriptedInstance({ connected: true });
    await open(scripted);
    await offer(PINNED);
    expect(scripted.held.pin).toBe(SCRIPTED_FINGERPRINT);
    expectClean('Instance, pinned');
    expectTargets('Instance, pinned');
  });

  it('passes the audit with the confirm-new-card screen open', async () => {
    const scripted = scriptedInstance({ connected: true });
    await open(scripted);
    await offer(PINNED);
    await offer(NEW_CARD);
    expect(document.body.textContent).toContain('Confirm the new card');
    expectClean('Instance, confirm-new-card');
    expectTargets('Instance, confirm-new-card');
  });
});
