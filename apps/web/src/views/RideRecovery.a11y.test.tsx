// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The recovery offer, audited — #212.
 *
 * ⚠️ **This file exists because `routes.a11y.test.tsx` cannot reach this
 * markup.** That suite renders every route and audits it, which is what makes a
 * new *route* audited without anyone editing a test — but it renders the ride
 * screen with a stub whose `recoverable` list is empty, and the offer renders
 * **nothing** when there is nothing to offer. So every control added here would
 * have sat outside the one gate in this repository with a real pass/fail line
 * in it, while the suite stayed green and looked like it covered them.
 *
 * Named `*.a11y.test.tsx` so `test:a11y` selects it (§4e), and
 * `scripts/check-a11y-suite.mjs` would catch the reverse mistake.
 */

import { unixSeconds } from '@onyourleft/domain';
import { recordingSessionId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { formatDuration } from '../format';
import type { RecoverableRide } from '../recording/recovery';
import { idleSnapshot, stubRideController } from '../ride/testing';
import { AppShell } from '../shell/AppShell';
import { routeById } from '../shell/routes';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

const SPANNED_SECONDS = 4_320;

/** A browser that can pair, so the ride screen renders its full set of controls. */
const WORKING_BLUETOOTH: BluetoothPort = {
  getAvailability: async () => Promise.resolve(true),
  requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
};

const CAPABLE: CapabilityProbe = { bluetooth: WORKING_BLUETOOTH, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

function offered(kind: RecoverableRide['kind'], id = 'left-behind'): RecoverableRide {
  return {
    id: recordingSessionId(id),
    kind,
    startedAt: unixSeconds(1_700_000_000),
    lastWrittenAt: unixSeconds(1_700_000_000 + SPANNED_SECONDS),
    spannedSeconds: SPANNED_SECONDS,
    // The screen's own formatter, so this fixture cannot pin a second spelling
    // of a duration the rest of the ride screen writes differently.
    spanned: formatDuration(SPANNED_SECONDS),
    canContinue: kind === 'interrupted',
    alreadySaved: kind === 'already-saved',
    damaged: [],
  };
}

/**
 * The offer inside the shell it actually ships in.
 *
 * ⚠️ Through `AppShell` at the ride route, not through `RideView` alone and
 * certainly not through the offer alone. `auditAccessibility` walks the whole
 * document, and the landmark and heading-order rules cannot be checked against
 * a fragment: `RideView` renders no `main` and no `h1` of its own — the shell
 * does — so mounting it bare reports three violations the shipping screen does
 * not have. That is a false failure, and the way it gets "fixed" is by
 * loosening the audit. `HudPanel.a11y.test.tsx` makes the same argument for the
 * same reason.
 */
async function show(
  rides: readonly RecoverableRide[],
  unreadable: readonly string[] = [],
): Promise<Mounted> {
  return (await showWith(rides, unreadable)).view;
}

async function showWith(
  rides: readonly RecoverableRide[],
  unreadable: readonly string[] = [],
): Promise<{ view: Mounted; stub: ReturnType<typeof stubRideController> }> {
  const stub = stubRideController({
    ...idleSnapshot(),
    recoverable: rides,
    unreadableRecordings: unreadable.map((id) => recordingSessionId(id)),
  });
  globalThis.location.hash = `#${routeById('ride').path}`;
  mounted = await mount(<AppShell capabilities={CAPABLE} rideController={stub.controller} />);
  await settle();
  return { view: mounted, stub };
}

describe('the offer is inside the accessibility gate', () => {
  it('audits clean with an interrupted ride on offer', async () => {
    await show([offered('interrupted')]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean with a finished ride that could not be saved', async () => {
    await show([offered('unsaved')]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('audits clean with several at once', async () => {
    await show([offered('interrupted', 'one'), offered('unsaved', 'two')]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('puts every control in the tab order', async () => {
    // A control a keyboard cannot reach is a ride a keyboard user cannot
    // recover, which on this screen means a ride they cannot get back at all.
    await show([offered('interrupted')]);
    const names = tabbableElements(document).map((element) => element.textContent ?? '');
    expect(names).toContain('Continue this ride');
    expect(names).toContain('Save this ride');
    expect(names).toContain('Discard this ride');
  });
});

describe('what the offer says, and what it does not', () => {
  it('offers no Continue for a ride the rider already stopped', async () => {
    // ⚠️ The distinction `recovery.ts` draws, at the screen. A rider who
    // pressed Stop is not shown a control that would restart the ride.
    const view = await show([offered('unsaved')]);
    const text = view.container.textContent ?? '';
    expect(text).toContain('could not be saved');
    expect(text).not.toContain('Continue this ride');
  });

  it('offers no Save for a ride that is already in the activities', async () => {
    // ⚠️ Added because a mutation survived. This is the duplicate the whole
    // `savedAs` link exists to prevent, at the one place a rider can press it:
    // a leftover working copy must be discardable and nothing else.
    const view = await show([offered('already-saved')]);
    const text = view.container.textContent ?? '';
    expect(text).toContain('already in your activities');
    expect(text).not.toContain('Save this ride');
    expect(text).not.toContain('Continue this ride');
    expect(text).toContain('Discard this ride');
  });

  it('audits clean with a ride that is already in the activities', async () => {
    await show([offered('already-saved')]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('renders nothing at all when the device is holding nothing', async () => {
    // The normal case. A heading that says "no interrupted rides" on every
    // visit trains a rider to stop reading the one place that will ever matter.
    const view = await show([]);
    expect(view.container.textContent ?? '').not.toContain('Rides still on this device');
  });

  it('says the length is an upper bound rather than a measurement', async () => {
    // `recovery.ts` spans start to last checkpoint without decoding the chunks,
    // so a recording with a hole in it recovers less than it says. "up to" is
    // the wording that keeps that honest.
    const view = await show([offered('interrupted')]);
    expect(view.container.textContent ?? '').toContain(`up to ${formatDuration(SPANNED_SECONDS)}`);
  });
});

describe('a recording that will not read (#1325)', () => {
  it('is said, and discarded on its id, beside a ride that reads', async () => {
    const { view, stub } = await showWith([offered('interrupted')], ['damaged-one']);
    const text = view.container.textContent ?? '';
    expect(text).toContain('A recording that cannot be read, so it cannot be continued or saved.');
    // The ride beside it is offered all the same.
    expect(text).toContain('Continue this ride');
    const discard = [...view.container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Discard this recording',
    );
    if (discard === undefined) {
      throw new Error('no discard for the unreadable recording');
    }
    discard.click();
    expect(stub.calls.discardRecovered).toEqual([recordingSessionId('damaged-one')]);
  });

  it('shows the offer for an unreadable recording alone', async () => {
    const view = await show([], ['damaged-one']);
    expect(view.container.textContent ?? '').toContain('Rides still on this device');
  });

  it('audits clean with an unreadable recording on offer', async () => {
    await show([offered('interrupted')], ['damaged-one']);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says a ride whose pauses did not read saves with its moving time as its elapsed time', async () => {
    const view = await show([
      { ...offered('interrupted'), canContinue: false, damaged: ['pauses'] },
    ]);
    const text = view.container.textContent ?? '';
    expect(text).toContain(
      'Its pauses could not be read, so saving it counts them as riding: its moving time will be its elapsed time.',
    );
    expect(text).toContain('Save this ride');
    expect(text).not.toContain('Continue this ride');
  });

  it('does not warn about lost pauses on a ride already in the library', async () => {
    const view = await show([{ ...offered('already-saved'), damaged: ['pauses'] }]);
    const text = view.container.textContent ?? '';
    expect(text).not.toContain('Its pauses could not be read');
    expect(text).not.toContain('Save this ride');
  });

  it('does not call a ride whose state did not read a finished one', async () => {
    const view = await show([{ ...offered('unsaved'), damaged: ['state'] }]);
    const text = view.container.textContent ?? '';
    expect(text).toContain('whether it was finished could not be read');
    expect(text).not.toContain('A finished ride');
    expect(text).toContain('Save this ride');
  });
});

/**
 * What a control's `aria-describedby` reads out: the text of every element it
 * names, in order, hidden or not — as the accessible-description computation
 * reads it.
 */
function describedAs(control: Element): string {
  return (control.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter((id) => id !== '')
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
    .join(' ');
}

function buttonsNamed(name: string): HTMLElement[] {
  return [...document.querySelectorAll('button')].filter((button) => button.textContent === name);
}

describe('controls that share a name are told apart — #1419', () => {
  it('describes each Discard this ride by its own row', async () => {
    // Two rides with the same sentence: only where each stands tells them apart.
    await show([offered('interrupted', 'one'), offered('interrupted', 'two')]);
    const discards = buttonsNamed('Discard this ride');
    expect(discards).toHaveLength(2);
    const descriptions = discards.map(describedAs);
    expect(descriptions).toEqual([
      `An interrupted ride, up to ${formatDuration(SPANNED_SECONDS)} long. Ride 1 of 2.`,
      `An interrupted ride, up to ${formatDuration(SPANNED_SECONDS)} long. Ride 2 of 2.`,
    ]);
    // Continue and Save on the same row are described by the same row.
    expect(buttonsNamed('Continue this ride').map(describedAs)).toEqual(descriptions);
    expect(buttonsNamed('Save this ride').map(describedAs)).toEqual(descriptions);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('describes each Discard this recording by its own row', async () => {
    await show([], ['broken-one', 'broken-two']);
    expect(buttonsNamed('Discard this recording').map(describedAs)).toEqual([
      'A recording that cannot be read, so it cannot be continued or saved. Recording 1 of 2.',
      'A recording that cannot be read, so it cannot be continued or saved. Recording 2 of 2.',
    ]);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('shows no new text: the position is the hidden half of the description', async () => {
    const view = await show([offered('interrupted', 'one')], ['broken-one']);
    for (const position of ['Ride 1 of 1.', 'Recording 1 of 1.']) {
      const span = [...view.container.querySelectorAll('span')].find(
        (element) => element.textContent === position,
      );
      expect(span?.hidden).toBe(true);
    }
  });
});
