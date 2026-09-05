// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * What the ride screen *says*, which is where three of #49's criteria are won
 * or lost.
 *
 * `ride/controller.test.ts` proves the state machine against the #44 simulator
 * and the real store. This file proves the projection: that a requested
 * setpoint never reads as an active one, that a lost control permission is on
 * the screen rather than in a console, that one press of Stop does not stop a
 * ride, and that closing the tab mid-ride is refused.
 *
 * The assertions on wording are deliberately literal. "Holding" is the word the
 * first acceptance criterion is about, and a test that matched
 * `/\\d+\\s*W/` would pass against every one of the four states.
 */

import { describe, expect, it, afterEach } from 'vitest';

import { watts } from '@onyourleft/domain';

import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';

import { RideView, formatDuration } from './RideView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function show(stub: ReturnType<typeof stubRideController>): Promise<Mounted> {
  const result = await mount(<RideView controller={stub.controller} />);
  await settle();
  mounted = result;
  return result;
}

function buttonNamed(label: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document, 'button').find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) {
    throw new Error(
      `no button labelled "${label}". Present: ${queryAll<HTMLButtonElement>(document, 'button')
        .map((button) => button.textContent?.trim())
        .join(', ')}`,
    );
  }
  return found;
}

describe('a browser that cannot pair', () => {
  it('explains instead of rendering controls that cannot work', async () => {
    mounted = await mount(<RideView controller={undefined} />);
    await settle();

    expect(document.body.textContent).toContain('cannot pair Bluetooth sensors');
    // Not a disabled button: `design/Button.tsx` records why a disabled control
    // is the wrong way to say this — it leaves the tab order, so a keyboard
    // user never reaches it and never hears the reason.
    expect(queryAll(document, 'button')).toEqual([]);
  });
});

describe('criterion 1 — requested versus confirmed', () => {
  it('never says "Holding" while a setpoint is outstanding', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({
      trainer: { ...ridingSnapshot().trainer, target: { kind: 'none' }, requested: watts(300) },
    });
    await show(stub);

    expect(document.body.textContent).toContain('Asked for 300 W');
    expect(document.body.textContent).toContain('waiting for the trainer to confirm');
    expect(document.body.textContent).not.toContain('Holding');
  });

  it('says "Holding" once, and only once, the trainer has confirmed', async () => {
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    expect(document.body.textContent).toContain('Holding 250 W');
  });

  it('does not claim a target the app can no longer verify', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({
      trainer: {
        ...ridingSnapshot().trainer,
        hasControl: false,
        target: { kind: 'unknown', attempted: watts(250) },
        lost: 'link-lost',
      },
    });
    await show(stub);

    expect(document.body.textContent).toContain('may still be holding 250 W');
    expect(document.body.textContent).toContain('this app can no longer tell');
    expect(document.body.textContent).not.toContain('Holding 250 W');
  });

  it('quotes the trainer’s own limits, so the rider is not guessing', async () => {
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    expect(document.body.textContent).toContain('0 W to 2000 W in steps of 5 W');
  });

  it('does not read an empty box as a 0 W target', async () => {
    // ⚠️ `Number('') === 0`, and 0 W is a *legal* ERG setpoint — so an empty
    // field submitted straight through would silently tell the trainer to
    // free-wheel. The browser's own validation catches a negative (the `min`
    // attribute comes from the device); nothing catches this one.
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    const input = document.querySelector<HTMLInputElement>('#oyl-erg-target');
    await typeInto(input as HTMLInputElement, '');
    await activateWithKeyboard(buttonNamed('Set target'));

    expect(stub.calls.setTargetPower).toEqual([]);
    expect(document.body.textContent).toContain('Enter a target in watts');
    // Nothing was thrown into the render: the tree is intact.
    expect(document.querySelector('#oyl-erg-target')).not.toBeNull();
  });

  it('clears the complaint once a real target follows it', async () => {
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    const input = document.querySelector<HTMLInputElement>('#oyl-erg-target');
    await typeInto(input as HTMLInputElement, '');
    await activateWithKeyboard(buttonNamed('Set target'));
    expect(document.body.textContent).toContain('Enter a target in watts');

    await typeInto(input as HTMLInputElement, '200');
    await activateWithKeyboard(buttonNamed('Set target'));

    expect(stub.calls.setTargetPower).toEqual([200]);
    // The complaint must not sit under a target that was in fact sent.
    expect(document.body.textContent).not.toContain('Enter a target in watts');
  });

  it('leaves a negative to the browser, whose refusal comes from the device range', async () => {
    // The `min` attribute is the trainer's own minimum, so a negative never
    // reaches the handler at all — the form does not submit. Asserted rather
    // than assumed, because it is the reason the handler does not need to cope
    // with one.
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    const input = document.querySelector<HTMLInputElement>('#oyl-erg-target');
    expect(input?.getAttribute('min')).toBe('0');
    await typeInto(input as HTMLInputElement, '-50');
    await activateWithKeyboard(buttonNamed('Set target'));

    expect(stub.calls.setTargetPower).toEqual([]);
  });

  it('sends the typed target through the controller unchanged', async () => {
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    const input = document.querySelector<HTMLInputElement>('#oyl-erg-target');
    expect(input).not.toBeNull();
    await typeInto(input as HTMLInputElement, '265');
    await activateWithKeyboard(buttonNamed('Set target'));

    expect(stub.calls.setTargetPower).toEqual([265]);
  });
});

describe('criterion 2 — control loss is on the screen', () => {
  it('names what happened and offers to ask for control again', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({
      trainer: {
        ...ridingSnapshot().trainer,
        hasControl: false,
        target: { kind: 'none' },
        lost: 'permission-lost',
      },
    });
    await show(stub);

    expect(document.body.textContent).toContain('The trainer took control back');
    // A live region, so a rider who is looking at the road hears it.
    expect(queryAll(document, '[role="status"]').length).toBeGreaterThan(0);

    await activateWithKeyboard(buttonNamed('Ask the trainer for control'));
    expect(stub.calls.requestControl).toBe(1);
  });

  it('hides the ERG form on a trainer whose feature bit says it has none', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ trainer: { ...ridingSnapshot().trainer, canSetPower: false } });
    await show(stub);

    expect(document.body.textContent).toContain('does not accept a power target');
    expect(document.querySelector('#oyl-erg-target')).toBeNull();
  });
});

describe('criterion 3 — an unavailable metric shows no number', () => {
  it('renders a dash and the silence, never the last reading', async () => {
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    const heartRate = queryAll(document, '.oyl-metric--stale');
    expect(heartRate).toHaveLength(1);
    expect(heartRate[0]?.textContent).toContain('no reading for 12 s');
    expect(heartRate[0]?.querySelector('.oyl-metric__value')?.textContent).toBe('—');
    // And the live ones do show their numbers, so the assertion above is not
    // passing because nothing renders at all.
    expect(document.body.textContent).toContain('248');
  });

  it('says every metric and its state in words, for a reader moving through the grid', async () => {
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    // ⚠️ Read from the text a screen reader is given, not from an `aria-label`:
    // `aria-label` is prohibited on a `span`, whose role is `generic`, and is
    // ignored by real assistive technology. The visible spans are `aria-hidden`
    // so this sentence is heard once and not beside its own fragments.
    const announced = queryAll(document, '.oyl-metric .oyl-visually-hidden').map((node) =>
      node.textContent?.trim(),
    );
    expect(announced).toContain('Power: 248 W');
    // Speed is the one metric whose canonical unit is not the one it is shown
    // in: the fixture's 9.4 m/s is 33.84 km/h, rendered to one decimal. The
    // conversion and the decimal count both come from `format.ts`, which #143
    // gave this caller — before that the grid carried its own copy of both and
    // `format.ts` had no production consumer at all. A `* 3.6` or a
    // `.toFixed(0)` reappearing here fails this line.
    expect(announced).toContain('Speed: 33.8 km/h');
    // A reader must not hear "Heart rate: dash".
    expect(announced).toContain('Heart rate: unavailable — no reading for 12 s');
    // And nothing in the cell is announced twice.
    expect(queryAll(document, '.oyl-metric__value[aria-hidden="true"]')).toHaveLength(
      announced.length,
    );
  });
});

describe('criterion 6 — one click cannot end a ride', () => {
  it('arms a confirmation instead of stopping', async () => {
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    await activateWithKeyboard(buttonNamed('Stop'));

    expect(stub.calls.armStop).toBe(1);
    expect(stub.calls.confirmStop).toBe(0);
  });

  it('stops only from the confirmation, which is a different control', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ stopArmed: true });
    await show(stub);

    expect(document.body.textContent).toContain('Stopping ends this ride');
    await activateWithKeyboard(buttonNamed('Yes, stop the ride'));
    expect(stub.calls.confirmStop).toBe(1);
  });

  it('lets the rider back out', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ stopArmed: true });
    await show(stub);

    await activateWithKeyboard(buttonNamed('Keep riding'));
    expect(stub.calls.cancelStop).toBe(1);
    expect(stub.calls.confirmStop).toBe(0);
  });
});

// Criterion 5 — closing the tab mid-ride — is asserted in
// `../ride/RideSession.test.tsx`, through `AppShell` and across a route change.
// The guard is no longer this component's, and a copy of the assertion mounted
// on `RideView` alone would pass while the shipping app let a tab close mid-ride
// from any other page.

describe('pairing is one gesture per device, and the screen says so', () => {
  it('offers a separate control for each kind of sensor', async () => {
    const stub = stubRideController(idleSnapshot());
    await show(stub);

    for (const label of [
      'Pair a smart trainer',
      'Pair a heart rate strap',
      'Pair a power meter',
      'Pair a speed or cadence sensor',
    ]) {
      expect(buttonNamed(label)).toBeDefined();
    }
    expect(document.body.textContent).toContain('one device at a time');
    expect(document.body.textContent).toContain('no way to pair them all at once');
  });

  it('passes the role straight through', async () => {
    const stub = stubRideController(idleSnapshot());
    await show(stub);

    await activateWithKeyboard(buttonNamed('Pair a smart trainer'));
    expect(stub.calls.pair).toEqual(['trainer']);
  });

  it('says how many more connections this browser will take', async () => {
    const stub = stubRideController(idleSnapshot());
    stub.set({ connectionsRemaining: 1 });
    await show(stub);

    // Singular, because "1 more connections" reads as a bug in the app.
    expect(document.body.textContent).toContain('1 more connection.');
  });
});

describe('the storage notice', () => {
  it('says nothing while checkpoints are landing', async () => {
    const stub = stubRideController(ridingSnapshot());
    await show(stub);
    expect(document.body.textContent).not.toContain('no room left');
  });

  it('tells the rider not to close the tab when the device is full', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ storage: 'quota-exceeded' });
    await show(stub);

    expect(document.body.textContent).toContain('no room left');
    expect(document.body.textContent).toContain('do not close');
  });

  it('is softer about a transient failure, which retries on its own', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ storage: 'failed' });
    await show(stub);

    expect(document.body.textContent).toContain('next checkpoint will try again');
  });
});

describe('the notice a stopped ride ends on', () => {
  it('says the ride is safe once the last checkpoint has landed', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ phase: 'stopped' });
    await show(stub);

    expect(document.body.textContent).toContain('every second of it is saved');
    expect(document.body.textContent).toContain('Closing the tab is safe now');
  });

  it('does not say the tab is safe to close when the last checkpoint failed', async () => {
    // ⚠️ Both notices are on screen at once: this one and `StorageNotice`. Two
    // live regions, one saying the device is full and the other saying the ride
    // is saved and the tab is safe — and the rider acts on the reassuring one.
    // The final flush happens inside `confirmStop` and can be refused.
    const stub = stubRideController(ridingSnapshot());
    stub.set({ phase: 'stopped', storage: 'quota-exceeded' });
    await show(stub);

    expect(document.body.textContent).not.toContain('Closing the tab is safe now');
    expect(document.body.textContent).toContain('Do not close it yet');
    // And the notice that explains why is still there, so the two agree.
    expect(document.body.textContent).toContain('no room left');
  });

  it('says the same about a transient failure, which is equally unsaved', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set({ phase: 'stopped', storage: 'failed' });
    await show(stub);

    expect(document.body.textContent).not.toContain('Closing the tab is safe now');
    expect(document.body.textContent).toContain('only in this tab');
  });
});

describe('the ride clock', () => {
  it('reads as hours only once there are some', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3_725)).toBe('1:02:05');
    expect(formatDuration(-1)).toBe('0:00');
  });

  it('is on the screen alongside moving time', async () => {
    const stub = stubRideController(ridingSnapshot());
    await show(stub);

    expect(document.body.textContent).toContain('1:02:05 elapsed');
    expect(document.body.textContent).toContain('1:00:00 moving');
  });
});
