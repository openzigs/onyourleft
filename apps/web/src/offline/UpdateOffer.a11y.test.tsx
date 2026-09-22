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

import {
  UPDATE_ACTIVATING_TEXT,
  UPDATE_AVAILABLE_TEXT,
  UPDATE_DEFERRED_TEXT,
  UPDATE_REGION_LABEL,
  UPDATE_SUPERSEDED_DEFERRED_TEXT,
  UPDATE_SUPERSEDED_TEXT,
} from './UpdateOffer';
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
  readonly reloads: () => number;
  readonly go: (status: UpdateStatus) => void;
}

function drivenWatcher(initial: UpdateStatus): Driven {
  let status = initial;
  let activations = 0;
  let dismissals = 0;
  let reloads = 0;
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
      reloadNow: () => {
        reloads += 1;
      },
    },
    activations: () => activations,
    dismissals: () => dismissals,
    reloads: () => reloads,
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

  it('audits clean in both of #483’s states, each saying its own sentence', async () => {
    // The sentence is asserted here as well as the audit, because a state that
    // rendered the WRONG one of the six would audit perfectly clean.
    const expected = {
      superseded: UPDATE_SUPERSEDED_TEXT,
      'superseded-deferred': UPDATE_SUPERSEDED_DEFERRED_TEXT,
    } as const;
    for (const status of ['superseded', 'superseded-deferred'] as const) {
      const view = await show(drivenWatcher(status));
      expect(formatViolations(auditAccessibility(document)), status).toBe('');
      expect(view.container.textContent ?? '', status).toContain(expected[status]);
      mounted?.unmount();
      mounted = undefined;
    }
  });

  it('gives each of the five states its OWN sentence, with none repeated — #483', () => {
    // ⚠️ What this catches is **two constants declared with the same text**. A
    // record keyed by status makes a MISSING sentence a type error and says
    // nothing about a DUPLICATED one, and the whole-sentence assertions above
    // would pass over a duplicate in silence — each would find its own text and
    // neither would notice the other had it too.
    //
    // ⚠️ What it does NOT catch is the MAPPING mutation that stayed green while
    // this file was being written — `TEXT_FOR['superseded-deferred'] →
    // UPDATE_DEFERRED_TEXT` — which leaves all five constants distinct and this
    // set the same size. #486's review re-ran it: it is the whole-sentence
    // assertions that go red, in "audits clean in both of #483’s states" and in
    // "offers no reload a ride in progress would refuse". Do not read this case
    // as their protection and delete them.
    const texts = [
      UPDATE_AVAILABLE_TEXT,
      UPDATE_DEFERRED_TEXT,
      UPDATE_ACTIVATING_TEXT,
      UPDATE_SUPERSEDED_TEXT,
      UPDATE_SUPERSEDED_DEFERRED_TEXT,
    ];
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('reloads a tab left behind from the keyboard alone — #483', async () => {
    const driven = drivenWatcher('superseded');
    const view = await show(driven);
    const reload = tabbableElements(view.container).find(
      (element) => element.textContent === 'Reload now',
    );
    if (reload === undefined) {
      throw new Error('there is no Reload now control');
    }
    await activateWithKeyboard(reload);
    expect(driven.reloads()).toBe(1);
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

  it('offers no reload a ride in progress would refuse — #483', async () => {
    // ADR 0027 D-3, and the same argument `deferred` makes one case up: the
    // repair is a page reload, and a page reload over an unsaved ride is the
    // thing ADR 0024 D-3 rule 3 exists to prevent. So the rider gets the
    // sentence and no control until the ride is saved.
    const view = await show(drivenWatcher('superseded-deferred'));
    const names = tabbableElements(view.container).map((element) => element.textContent ?? '');
    expect(names).not.toContain('Reload now');
    expect(names).not.toContain('Update now');
    // ⚠️ **Not `toContain('finish and save your ride')` alone**, which is the
    // assertion this case shipped with for about an hour: `UPDATE_DEFERRED_TEXT`
    // contains that phrase too, so rendering the OFFER's deferred sentence here
    // passed. Found by mutating `TEXT_FOR['superseded-deferred']` to
    // `UPDATE_DEFERRED_TEXT` and watching nothing go red. The two states are
    // materially different promises — one says the update will be OFFERED when
    // the ride is saved, the other that this tab must be RELOADED — so what is
    // asserted is the whole sentence.
    expect(view.container.textContent ?? '').toContain(UPDATE_SUPERSEDED_DEFERRED_TEXT);
    expect(view.container.textContent ?? '').not.toContain(UPDATE_DEFERRED_TEXT);
  });

  it('offers the reload the moment that ride is saved, without a remount — #483', async () => {
    const driven = drivenWatcher('superseded-deferred');
    const view = await show(driven);
    driven.go('superseded');
    await settle();
    const names = tabbableElements(view.container).map((element) => element.textContent ?? '');
    expect(names).toContain('Reload now');
  });

  it('offers no "Not now" beside the reload — #483', async () => {
    // Dismissing an offer leaves a rider on a version that works; dismissing
    // this would leave them on one whose next lazy route may not open, with
    // nothing on screen left to say why. ADR 0027 D-2.
    const view = await show(drivenWatcher('superseded'));
    const names = tabbableElements(view.container).map((element) => element.textContent ?? '');
    expect(names).toContain('Reload now');
    expect(names).not.toContain('Not now');
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

  it('tells a left-behind tab what is wrong with IT, not that an update is available — #483', () => {
    // ⚠️ The update already happened, somewhere else. Copy that said "a new
    // version is ready" here would be the same sentence as the offer's and
    // would send the rider looking for a button that is not the one they need.
    expect(UPDATE_SUPERSEDED_TEXT).toContain('another tab');
    expect(UPDATE_SUPERSEDED_TEXT).toContain('reload');
    expect(UPDATE_SUPERSEDED_TEXT).toContain('recorded rides');
    expect(UPDATE_SUPERSEDED_DEFERRED_TEXT).toContain('another tab');
    expect(UPDATE_SUPERSEDED_DEFERRED_TEXT).toContain('finish and save your ride');
  });

  it('promises nothing about backups, durability or clearing site data', () => {
    // Those are `AboutView`'s to say, where the honest consequence is stated
    // beside them. A banner is the wrong place for a claim a rider cannot check.
    for (const text of [
      UPDATE_AVAILABLE_TEXT,
      UPDATE_DEFERRED_TEXT,
      UPDATE_SUPERSEDED_TEXT,
      UPDATE_SUPERSEDED_DEFERRED_TEXT,
    ]) {
      for (const forbidden of ['backup', 'safe', 'never lose', 'permanent', 'cloud']) {
        expect(text.toLowerCase()).not.toContain(forbidden);
      }
    }
  });
});
