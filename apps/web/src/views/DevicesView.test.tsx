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

import { afterEach, describe, expect, it } from 'vitest';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { tabbableElements } from '../a11y/audit';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

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

describe('in a browser that can pair', () => {
  it('says plainly that pairing is not built yet rather than showing a dead button', async () => {
    // #49 owns the pairing flow. Until it lands, a control here would be the
    // very thing criterion 1 rejects — so the page says so in words.
    const { container } = await open(CAPABLE);
    expect(pairingControls(container)).toEqual([]);
    expect(container.textContent).toContain('Not built yet');
  });

  it('states the working-path constraints instead of implying there are none', async () => {
    const { container } = await open(CAPABLE);
    expect(container.textContent).toContain('one press per device');
    expect(container.textContent).toContain('no silent reconnect');
  });
});
