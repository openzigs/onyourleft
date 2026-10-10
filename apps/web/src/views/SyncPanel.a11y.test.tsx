// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The sync control and the key-admission screen (#1195), audited.
 *
 * The route walk renders the Instance screen not connected and with no sync
 * port, where neither exists. This renders the real shell at the real route,
 * connected, with a scripted sync port in each state a rider can reach — the
 * card missing, the control offered, a partial sync that raised a key
 * question, and the confirmation open — and audits each one.
 *
 * ⚠️ **The 44 px touch target is a DECLARATION here, not a measurement**:
 * jsdom performs no layout (`apps/web/CLAUDE.md`). Every control in the panel
 * and in the dialog must be the design system's `Button`, whose `.oyl-button`
 * declares the floor that `shell.browser.spec.ts` measures.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { INSTANCE_KEY_TEXT } from '../instance/instance-pin';
import type { SyncReport } from '../instance/sync';
import type { SyncAvailability, SyncPort } from '../instance/sync-port';
import { scriptedInstance } from '../instance/testing';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import {
  ADMIT_CONFIRM_LABEL,
  ADMIT_CONTROL_LABEL,
  KEYS_HEADING,
  SYNC_CONTROL_LABEL,
  SYNC_HEADING,
  syncFailuresText,
} from './SyncPanel';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const OTHER_KEY = 'cd'.repeat(32);
/**
 * The first case pays for loading the More group's views: 0.6 s for the three
 * on an idle Mac (2026-10-09), and over 5 s on the same machine under a load
 * of 50. A stop, not a budget; nothing here is a performance claim.
 */
const CASE_MS = 15_000;

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

const REPORT: SyncReport = {
  pulled: 0,
  pushed: 2,
  itemsPulled: 0,
  itemsPushed: 0,
  summariesPushed: 2,
  deletedOnInstance: 0,
  hiddenOnInstance: 0,
  consentsPushed: 0,
  consentsPulled: 0,
  textsPulled: 0,
  textsPushed: 0,
  textsHiddenOnInstance: 0,
  textsDeletedOnInstance: 0,
  textConflicts: 0,
  workoutsPushed: 0,
  workoutsDeletedOnInstance: 0,
  workoutsHiddenOnInstance: 0,
  keysToConfirm: [OTHER_KEY],
  failures: [{ kind: 'activity', key: 'abc', reason: 'key-not-admitted' }],
};

function scriptedSync(availability: SyncAvailability) {
  const admitted: string[] = [];
  const port: SyncPort = {
    availability: () => availability,
    sync: () => Promise.resolve({ kind: 'synced', report: REPORT }),
    admitKey: (key) => {
      admitted.push(key);
      return Promise.resolve({ kind: 'admitted' });
    },
  };
  return { port, admitted };
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

function panel(): HTMLElement | undefined {
  return queryAll<HTMLElement>(document.body, 'section').find(
    (section) => section.querySelector('h2')?.textContent === SYNC_HEADING,
  );
}

/** Every control in `root` is the design system's button, whose class declares 44 px. */
function expectTargets(root: ParentNode, where: string, atLeast: number): void {
  const controls = queryAll<HTMLElement>(root, 'button, textarea, input, select, a[href]');
  expect(controls.length, where).toBeGreaterThanOrEqual(atLeast);
  for (const control of controls) {
    expect(control.tagName, `${where}: ${control.outerHTML}`).toBe('BUTTON');
    expect(control.classList.contains('oyl-button'), `${where}: ${control.outerHTML}`).toBe(true);
  }
}

function button(text: string): HTMLButtonElement | undefined {
  return queryAll<HTMLButtonElement>(document.body, 'button').find(
    (each) => (each.textContent ?? '').trim() === text,
  );
}

async function open(sync: SyncPort): Promise<void> {
  globalThis.location.hash = '#/settings/instance';
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      instance={scriptedInstance({ connected: true }).port}
      sync={sync}
    />,
  );
  await settle();
}

async function press(control: HTMLButtonElement | undefined): Promise<void> {
  expect(control).toBeDefined();
  await act(async () => {
    control?.click();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
  await settle();
}

describe('the sync panel (#1195)', () => {
  it(
    'passes the audit with no card, saying the card sentence and offering no control',
    async () => {
      await open(scriptedSync({ kind: 'closed', text: INSTANCE_KEY_TEXT['needs-card'] }).port);
      expect(panel()?.textContent).toContain(INSTANCE_KEY_TEXT['needs-card']);
      expect(button(SYNC_CONTROL_LABEL)).toBeUndefined();
      expectClean('Instance, sync without a card');
    },
    CASE_MS,
  );

  it(
    'passes the audit with the control offered, every control a 44 px button',
    async () => {
      await open(scriptedSync({ kind: 'offered' }).port);
      expectClean('Instance, sync offered');
      expectTargets(panel()!, 'the sync panel', 1);
    },
    CASE_MS,
  );

  it(
    'passes the audit after a partial sync that asks about a key, and with the confirmation open',
    async () => {
      const { port, admitted } = scriptedSync({ kind: 'offered' });
      await open(port);
      await press(button(SYNC_CONTROL_LABEL));
      expect(panel()?.textContent).toContain(syncFailuresText(1));
      expect(panel()?.textContent).toContain(KEYS_HEADING);
      expectClean('Instance, after a partial sync');
      expectTargets(panel()!, 'the sync panel with a key question', 2);

      await press(button(ADMIT_CONTROL_LABEL));
      const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
      expect(dialog).not.toBeNull();
      expectClean('Instance, the key confirmation open');
      expectTargets(dialog!, 'the key confirmation', 2);
      // Asked, not yet answered: nothing admitted.
      expect(admitted).toEqual([]);
      await press(button(ADMIT_CONFIRM_LABEL));
      expect(admitted).toEqual([OTHER_KEY]);
      expectClean('Instance, a key admitted');
    },
    CASE_MS,
  );
});
