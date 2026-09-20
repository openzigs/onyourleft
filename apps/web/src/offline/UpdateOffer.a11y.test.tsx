// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The update offer, audited — #407.
 *
 * ⚠️ **This file exists because `routes.a11y.test.tsx` cannot reach this
 * markup**, for the reason `RideRecovery.a11y.test.tsx` gives about its own:
 * that suite renders every route through an `AppShell` with no `update` port,
 * and the offer renders **nothing** when nothing is waiting. So every control
 * here would have sat outside the one gate in this repository with a real
 * pass/fail line in it, while the suite stayed green and looked like it covered
 * them.
 *
 * ⚠️ Audited through `AppShell` rather than bare. `auditAccessibility` walks
 * the whole document and its landmark and heading-order rules cannot be checked
 * against a fragment — mounting the offer alone reports violations the shipping
 * page does not have, and the way that gets "fixed" is by loosening the audit.
 *
 * ⚠️ And the suite loads no stylesheet, so nothing here may be hidden with
 * `display: none` in CSS and expected to leave the tab order: `tabbableElements`
 * would still find it. The offer hides by rendering `null`, which is the only
 * kind of hiding both a browser and this suite agree about.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { AppShell } from '../shell/AppShell';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';

import { UPDATE_AVAILABLE_TEXT, UPDATE_DEFERRED_TEXT, UPDATE_REGION_LABEL } from './UpdateOffer';
import type { UpdateStatus, UpdateWatcher } from './update';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

interface Driven {
  readonly watcher: UpdateWatcher;
  readonly activations: () => number;
  readonly dismissals: () => number;
  readonly go: (status: UpdateStatus) => void;
}

function drivenWatcher(initial: UpdateStatus): Driven {
  let status = initial;
  let activations = 0;
  let dismissals = 0;
  const listeners = new Set<() => void>();
  const announce = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };
  return {
    watcher: {
      status: () => status,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      activate: () => {
        activations += 1;
      },
      dismiss: () => {
        dismissals += 1;
      },
    },
    activations: () => activations,
    dismissals: () => dismissals,
    go: (next) => {
      status = next;
      announce();
    },
  };
}

async function show(driven: Driven): Promise<Mounted> {
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} update={driven.watcher} />);
  await settle();
  return mounted;
}

describe('the offer is inside the accessibility gate', () => {
  it('audits clean with an update available', async () => {
    await show(drivenWatcher('available'));
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean while a ride defers it', async () => {
    await show(drivenWatcher('deferred'));
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean while it is activating', async () => {
    await show(drivenWatcher('activating'));
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is a named region, so a screen-reader user knows what they landed in', async () => {
    const view = await show(drivenWatcher('available'));
    const region = view.container.querySelector(`[aria-label="${UPDATE_REGION_LABEL}"]`);
    expect(region).not.toBeNull();
  });

  it('puts both controls in the tab order', async () => {
    const view = await show(drivenWatcher('available'));
    const names = tabbableElements(view.container).map((element) => element.textContent ?? '');
    expect(names).toContain('Update now');
    expect(names).toContain('Not now');
  });

  it('is dismissible from the keyboard alone', async () => {
    const driven = drivenWatcher('available');
    const view = await show(driven);
    const dismiss = tabbableElements(view.container).find(
      (element) => element.textContent === 'Not now',
    );
    if (dismiss === undefined) {
      throw new Error('there is no Not now control to dismiss with');
    }
    await activateWithKeyboard(dismiss);
    expect(driven.dismissals()).toBe(1);
  });

  it('applies the update from the keyboard alone', async () => {
    const driven = drivenWatcher('available');
    const view = await show(driven);
    const apply = tabbableElements(view.container).find(
      (element) => element.textContent === 'Update now',
    );
    if (apply === undefined) {
      throw new Error('there is no Update now control');
    }
    await activateWithKeyboard(apply);
    expect(driven.activations()).toBe(1);
  });
});

describe('what the offer renders, and when', () => {
  it('renders nothing at all when nothing is waiting', async () => {
    const view = await show(drivenWatcher('none'));
    expect(view.container.querySelector('.oyl-update')).toBeNull();
  });

  it('offers no control a ride in progress would refuse', async () => {
    // ⚠️ Not a disabled button. `design/Button.tsx`: a disabled control is out
    // of the tab order, so a keyboard rider reaches it never and hears why
    // never — the sentence is the whole of what is offered, and the buttons
    // come back when the ride is saved.
    const view = await show(drivenWatcher('deferred'));
    const names = tabbableElements(view.container).map((element) => element.textContent ?? '');
    expect(names).not.toContain('Update now');
    expect(view.container.textContent ?? '').toContain('finish and save your ride');
  });

  it('appears when the deferral lifts, without a remount', async () => {
    const driven = drivenWatcher('deferred');
    const view = await show(driven);
    driven.go('available');
    await settle();
    const names = tabbableElements(view.container).map((element) => element.textContent ?? '');
    expect(names).toContain('Update now');
  });
});

describe('what the copy may and may not claim', () => {
  it('says an update replaces the app and leaves the rides alone', () => {
    // #407's last criterion. Asserted by string in both halves so the
    // reassuring one cannot be edited without the factual one going with it.
    expect(UPDATE_AVAILABLE_TEXT).toContain('replaces the app');
    expect(UPDATE_AVAILABLE_TEXT).toContain('your recorded rides are not affected');
  });

  it('promises nothing about backups, durability or clearing site data', () => {
    // Those are `AboutView`'s to say, where the honest consequence is stated
    // beside them. A banner is the wrong place for a claim a rider cannot check.
    for (const text of [UPDATE_AVAILABLE_TEXT, UPDATE_DEFERRED_TEXT]) {
      for (const forbidden of ['backup', 'safe', 'never lose', 'permanent', 'cloud']) {
        expect(text.toLowerCase()).not.toContain(forbidden);
      }
    }
  });
});
