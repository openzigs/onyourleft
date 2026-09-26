// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Where focus goes after *Start a new ride* — #548, #565's review.
 *
 * WCAG 2.2 SC 2.4.3 (Focus Order). Pressing the control unmounts it, and the
 * idle screen's *Start recording* replaces it. Without a hand-over, focus falls
 * to `<body>` and a keyboard or TalkBack rider loses their place on the screen
 * they are about to ride from. `routes.a11y.test.tsx` cannot see this: it audits
 * a static render, and a lost focus is a property of a transition.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it (§4e).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { RideView } from './RideView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function buttonNamed(label: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document, 'button').find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) {
    throw new Error(`no button labelled "${label}"`);
  }
  return found;
}

describe('#548 — Start a new ride, by keyboard', () => {
  it('is audited clean on the stopped screen that offers it', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ phase: 'stopped', saveState: 'saved' });
    // Under the page's own title, as the shell renders it, so the audit is
    // about this screen rather than about a heading outline only a route has.
    mounted = await mount(
      <main>
        <h1>Ride</h1>
        <RideView controller={stub.controller} />
      </main>,
    );
    await settle();
    expect(buttonNamed('Start a new ride')).toBeDefined();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('hands focus to Start recording once the idle screen renders, not to the page body', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ phase: 'stopped', saveState: 'saved' });
    mounted = await mount(<RideView controller={stub.controller} />);
    await settle();

    await activateWithKeyboard(buttonNamed('Start a new ride'));
    await settle();
    // The stub answers `true` and leaves the phase to the test, as the real
    // controller's `changed()` would move it.
    stub.set(idleSnapshot());
    await settle();

    expect(stub.calls.startNewRide).toBe(1);
    expect(document.activeElement).toBe(buttonNamed('Start recording'));
  });

  it('does not chase a later move to idle when the controller refused the press', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ phase: 'stopped', saveState: 'saved' });
    const refusing = { ...stub.controller, startNewRide: async () => Promise.resolve(false) };
    mounted = await mount(<RideView controller={refusing} />);
    await settle();

    await activateWithKeyboard(buttonNamed('Start a new ride'));
    await settle();
    // A move to idle by some other path is not this press's to follow.
    stub.set(idleSnapshot());
    await settle();
    expect(document.activeElement).not.toBe(buttonNamed('Start recording'));
  });
});
