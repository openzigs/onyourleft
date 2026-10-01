// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The sharpest reading of #48's first acceptance criterion:
 *
 * > A silently non-functional pairing control fails this criterion.
 *
 * …and the issue's own guidance, which closes the obvious loophole: *"A shell
 * that lets someone reach a pairing button that can never work in their browser
 * fails criterion 1 **even if the button is disabled**."*
 *
 * A disabled button is removed from the tab order and announces no reason, so
 * it is the silent failure with an extra step. This file asserts the only thing
 * that satisfies the criterion: in a browser that cannot pair, there is **no
 * such control on the page at all**, and there is prose saying why instead.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { deviceId, type ConnectionState } from '@onyourleft/sensors';
import { createSimulator, hrsStrap } from '@onyourleft/sensors/simulator';
import { unixSeconds } from '@onyourleft/domain';
import { athleteId, recordingSessionId } from '@onyourleft/store';

import { tabbableElements } from '../a11y/audit';
import { createRideController, type RideSnapshot } from '../ride/controller';
import { connectionWords } from '../ride/SensorPairing';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';

import { DevicesView } from './DevicesView';

const WORKING: BluetoothPort = {
  getAvailability: async () => Promise.resolve(true),
  requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
};

const CAPABLE: CapabilityProbe = { bluetooth: WORKING, secureContext: true };

/** Safari and Firefox. */
const ABSENT: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/** Chrome with the radio switched off. */
const RADIO_OFF: CapabilityProbe = {
  bluetooth: { ...WORKING, getAvailability: async () => Promise.resolve(false) },
  secureContext: true,
};

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(capabilities: CapabilityProbe): Promise<Mounted> {
  const result = await mount(<DevicesView capabilities={capabilities} />);
  await settle();
  mounted = result;
  return result;
}

/** Every control on the page whose name suggests it starts a pairing flow. */
function pairingControls(root: ParentNode): Element[] {
  return [...root.querySelectorAll('button, a[href], [role="button"]')].filter((element) =>
    /pair|connect|add (a )?(sensor|device)|scan/i.test(element.textContent ?? ''),
  );
}

/**
 * A probe that never settles, so the view stays in its in-flight state.
 *
 * `open()` above awaits `settle()`, which is right for every other test and
 * wrong for this one: the state worth asserting is the one that exists *before*
 * the answer arrives, and it lasted microseconds in every other test here.
 */
const NEVER_ANSWERS: CapabilityProbe = {
  bluetooth: { ...WORKING, getAvailability: () => new Promise<boolean>(() => undefined) },
  secureContext: true,
};

describe('while the browser check is still running', () => {
  it('does not claim pairing is impossible before it knows', async () => {
    // The view used to read `support?.canPair === true`, which collapses "not
    // yet known" into the same branch as "known impossible" -- so this page
    // said "Sensors cannot be paired in this browser" at the same moment the
    // notice above it said "Checking". Criterion 1 exists to stop the app
    // being dishonest about what the browser can do, and a false negative
    // delivered before the answer is known is exactly that.
    const result = await mount(<DevicesView capabilities={NEVER_ANSWERS} />);
    mounted = result;

    const text = result.container.textContent ?? '';
    expect(text).not.toMatch(/cannot be paired/i);
    // And it must not silently render nothing either -- an empty section is
    // the other way to fail this, and is what the `?.` version would have done
    // if the else branch had been dropped instead of widened.
    expect(text).toMatch(/\S/);
  });

  it('offers no pairing control while it is still checking', async () => {
    const result = await mount(<DevicesView capabilities={NEVER_ANSWERS} />);
    mounted = result;
    expect(pairingControls(result.container)).toHaveLength(0);
  });
});

describe('in a browser that cannot pair', () => {
  it('renders no pairing control — not a disabled one, none', async () => {
    const { container } = await open(ABSENT);
    expect(pairingControls(container)).toEqual([]);
    // Nor a disabled control of any kind, which is the loophole the criterion
    // names explicitly.
    expect(container.querySelectorAll('button[disabled]')).toHaveLength(0);
  });

  it('says why, rather than leaving an empty section', async () => {
    const { container } = await open(ABSENT);
    expect(container.textContent).toContain('Safari and Firefox');
    expect(container.textContent).toContain('Sensors cannot be paired in this browser');
  });

  it('renders no retry either, when there is nothing that retrying could change', async () => {
    const { container } = await open(ABSENT);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('in a browser whose radio is merely off', () => {
  it('still offers no pairing control, because pairing still cannot work', async () => {
    const { container } = await open(RADIO_OFF);
    expect(pairingControls(container)).toEqual([]);
  });

  it('does offer a retry, and it is reachable by keyboard', async () => {
    const { container } = await open(RADIO_OFF);
    const button = container.querySelector('button');
    expect(button).not.toBeNull();
    expect(tabbableElements(container)).toContain(button);
  });
});

describe('in a browser that can pair, handed no controller', () => {
  // The dead end #659 is about, still reachable in one shape: the platform can
  // pair and this build was given nothing to pair with. It must stay honest —
  // no control — and it is the browser gate's control for the walk below.
  it('offers no pairing control and says why', async () => {
    const { container } = await open(CAPABLE);
    expect(pairingControls(container)).toEqual([]);
    expect(container.textContent).toContain('Pairing is not available in this build');
  });

  it('states the working-path constraints instead of implying there are none', async () => {
    const { container } = await open(CAPABLE);
    expect(container.textContent).toContain('one press per device');
    expect(container.textContent).toContain('no silent reconnect');
  });
});

describe('in a browser that can pair — #659, pairing lives here', () => {
  async function withController(snapshot: RideSnapshot = idleSnapshot()) {
    const stub = stubRideController(snapshot);
    mounted = await mount(<DevicesView capabilities={CAPABLE} controller={stub.controller} />);
    await settle();
    return { stub, container: mounted.container };
  }

  function button(container: HTMLElement, label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find(
      (each) => each.textContent?.trim() === label,
    );
    if (found === undefined) throw new Error(`no button labelled "${label}"`);
    return found;
  }

  it('offers one control per kind of device, in the order #49 asks for', async () => {
    const { container } = await withController();
    expect(
      [...container.querySelectorAll('.oyl-pairing button')]
        .map((each) => each.textContent?.trim())
        .filter((label) => label?.startsWith('Pair')),
    ).toEqual([
      'Pair a smart trainer',
      'Pair a heart rate strap',
      'Pair a power meter',
      'Pair a speed or cadence sensor',
    ]);
  });

  it('with nothing paired, the empty garage pairs the trainer with its one action — #943', async () => {
    const { stub, container } = await withController();
    const empty = container.querySelector('[data-oyl-empty-state]');
    expect(empty?.textContent).toContain('Nothing paired yet');
    // The action wears the trainer row's own label (#987's review), so it is
    // found INSIDE the empty state rather than by name alone.
    const action = empty?.querySelector('.oyl-empty-state__action button');
    expect(action?.textContent?.trim()).toBe('Pair a smart trainer');
    if (!(action instanceof HTMLButtonElement)) throw new Error('the empty garage has no button');
    await activateWithKeyboard(action);
    expect(stub.calls.pair).toEqual(['trainer']);
  });

  it('with a device paired, there is no empty garage — #943', async () => {
    const { container } = await withController(ridingSnapshot());
    expect(container.querySelector('[data-oyl-empty-state]')).toBeNull();
  });

  it('passes the role straight to the ride controller, from the keyboard', async () => {
    const { stub, container } = await withController();
    await activateWithKeyboard(button(container, 'Pair a heart rate strap'));
    expect(stub.calls.pair).toEqual(['heart-rate']);
  });

  it('forgets a paired device through the same controller', async () => {
    const { stub, container } = await withController(ridingSnapshot());
    await activateWithKeyboard(button(container, 'Forget KICKR 1F2A'));
    expect(stub.calls.unpair).toEqual(['kickr']);
  });

  it('puts the controls first and the limits after them, in a closed disclosure', async () => {
    const { container } = await withController();
    const details = container.querySelector('details');
    const firstPair = button(container, 'Pair a smart trainer');
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    if (details === null) return;
    // Document order: the first pairing control PRECEDES the disclosure.
    expect(
      firstPair.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // What Bluetooth cannot do is in there…
    expect(details.textContent).toContain('no silent reconnect');
    expect(details.textContent).toContain('3 more connections');
    // …and no control is in there: the disclosure is prose, and every control
    // a rider needs to pair is outside it. The summary is the one tab stop.
    expect(details.querySelectorAll('a[href], button, input, select, textarea')).toHaveLength(0);
    expect(tabbableElements(details).map((each) => each.tagName)).toEqual(['SUMMARY']);
    // No heading in the summary: its exposure varies by browser and reader.
    expect(details.querySelector('summary h1, summary h2, summary h3, summary h4')).toBeNull();
  });

  it('keeps "one user gesture per device" visible, outside the disclosure', async () => {
    const { container } = await withController();
    const sentence = [...container.querySelectorAll('p')].find((p) =>
      p.textContent?.includes('one user gesture per device'),
    );
    expect(sentence).toBeDefined();
    expect(sentence?.closest('details')).toBeNull();
  });

  it('keeps "no silent reconnect" and "no background recording" visible too — ADR 0003 D-7 rule 5', async () => {
    const { container } = await withController();
    for (const phrase of [
      'There is no silent reconnect',
      'Recording does not continue in the background',
    ]) {
      const sentence = [...container.querySelectorAll('p')].find((p) =>
        p.textContent?.includes(phrase),
      );
      expect(sentence, phrase).toBeDefined();
      expect(sentence?.closest('details'), phrase).toBeNull();
    }
  });

  it('says what forgetting the trainer does to ERG and to a workout', async () => {
    const { container } = await withController();
    expect(container.querySelector('details')?.textContent).toContain(
      'Forgetting the trainer lets it go first, as End ERG does, and ends a workout that is running.',
    );
  });

  it('says how many more connections, in the singular when it is one', async () => {
    const stub = stubRideController(idleSnapshot());
    stub.set({ connectionsRemaining: 1 });
    mounted = await mount(<DevicesView capabilities={CAPABLE} controller={stub.controller} />);
    await settle();
    expect(mounted.container.textContent).toContain('1 more connection.');
  });

  it('shows a pairing failure where the rider pressed', async () => {
    const stub = stubRideController(idleSnapshot());
    stub.set({ pairingError: 'KICKR 1F2A is already paired.' });
    mounted = await mount(<DevicesView capabilities={CAPABLE} controller={stub.controller} />);
    await settle();
    expect(mounted.container.textContent).toContain('KICKR 1F2A is already paired.');
  });
});

describe('a controller does not make pairing possible where the platform cannot (#48, #659)', () => {
  // `main.tsx` builds no controller in such a browser, so this cannot happen in
  // the product today — and it is asserted anyway, because the guard on this
  // screen is `support.canPair` and not the controller's absence. A screen that
  // offered Pair whenever it held a controller would put a control that cannot
  // work in front of a rider whose radio is off, which is #48's first criterion.
  for (const [name, probe] of [
    ['Safari or Firefox', ABSENT],
    ['a radio switched off', RADIO_OFF],
    ['a check still running', NEVER_ANSWERS],
  ] as const) {
    it(`offers no pairing control for ${name}`, async () => {
      const stub = stubRideController(idleSnapshot());
      mounted = await mount(<DevicesView capabilities={probe} controller={stub.controller} />);
      await settle();
      expect(pairingControls(mounted.container)).toEqual([]);
    });
  }
});

describe('each device’s state is in words, not colour or an icon alone (WCAG 2.2 SC 1.4.1)', () => {
  const STATES: readonly ConnectionState[] = [
    'connected',
    'connecting',
    'reconnecting',
    'disconnected',
    'unavailable',
  ];

  it('says "Not paired" in every row with nothing in it', async () => {
    const stub = stubRideController(idleSnapshot());
    mounted = await mount(<DevicesView capabilities={CAPABLE} controller={stub.controller} />);
    await settle();
    const rows = [...mounted.container.querySelectorAll('.oyl-pairing__row')];
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.querySelector('.oyl-pairing__state')?.textContent).toBe('Not paired');
    }
  });

  for (const state of STATES) {
    it(`names "${state}" in the row's own text`, async () => {
      const stub = stubRideController(idleSnapshot());
      stub.set({
        sensors: [
          {
            id: deviceId('kickr'),
            name: 'KICKR 1F2A',
            role: 'trainer',
            capabilities: ['power'],
            state,
          },
        ],
      });
      mounted = await mount(<DevicesView capabilities={CAPABLE} controller={stub.controller} />);
      await settle();
      const line = mounted.container.querySelector('.oyl-sensor-list .oyl-pairing__state');
      // The words, in the text a screen reader reads and a colour-blind rider
      // sees — never carried by a class or an icon alone.
      expect(line?.textContent).toBe(`KICKR 1F2A: ${connectionWords(state)}`);
      expect(connectionWords(state)).toMatch(/^[A-Z][a-z]+/);
    });
  }

  it('gives every state different words', () => {
    const words = STATES.map(connectionWords);
    expect(new Set(words).size).toBe(STATES.length);
  });
});

describe('Forget when an unsubscribe throws — #706', () => {
  it('removes the device, says so in a sentence, and lets no rejection reach the page', async () => {
    // The REAL controller over the simulator, because the defect was in the
    // controller and the `void` call on this screen together: `unpair`
    // rejected, the button's handler discarded the promise, and the rider saw
    // nothing while the page got an unhandled rejection.
    const { transport } = createSimulator({
      devices: [hrsStrap({ id: 'strap', name: 'HRM 04B1' })],
    });
    const observe = transport.observeConnectionState.bind(transport);
    vi.spyOn(transport, 'observeConnectionState').mockImplementation((id, listener) => {
      const unobserve = observe(id, listener);
      return () => {
        unobserve();
        throw new Error('the transport would not let go');
      };
    });
    const controller = createRideController({
      transport,
      store: {
        putRecordingSession: (record) => Promise.resolve(record.id),
        appendRecordingChunk: () => Promise.resolve(0),
        listRecordingSessions: () => Promise.resolve([]),
        recoverRecording: () => Promise.resolve(undefined),
        deleteRecordingSession: () => Promise.resolve(false),
      },
      athleteId: athleteId('devices'),
      newSessionId: () => recordingSessionId('devices-ride'),
      now: () => unixSeconds(0),
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      mounted = await mount(<DevicesView capabilities={CAPABLE} controller={controller} />);
      await settle();
      const press = async (label: string): Promise<void> => {
        const found = [...mounted!.container.querySelectorAll('button')].find(
          (each) => each.textContent?.trim() === label,
        );
        if (found === undefined) throw new Error(`no button labelled "${label}"`);
        await activateWithKeyboard(found);
        await settle();
      };
      await press('Pair a heart rate strap');
      expect(mounted.container.textContent).toContain('HRM 04B1: Connected');

      await press('Forget HRM 04B1');
      // A macrotask, so a rejection nobody handled has been reported by now.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mounted.container.textContent).toContain(
        'HRM 04B1 is forgotten, but this app could not stop listening to it cleanly. If its readings still appear, reload the page, or close the app and open it again.',
      );
      expect(mounted.container.textContent).not.toContain('HRM 04B1: ');
      expect(mounted.container.textContent).not.toContain('the transport would not let go');
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      controller.dispose();
    }
  });
});
