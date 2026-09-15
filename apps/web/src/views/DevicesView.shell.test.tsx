// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Devices screen inside the Android shell (#284).
 *
 * ⚠️ **A separate file from `DevicesView.test.tsx` on purpose.** #284's third
 * acceptance criterion is that a browser's behaviour is unchanged, *"proved by
 * the existing `DevicesView` and `bluetooth-support` tests still passing
 * untouched"* — and a criterion about a file not changing is not worth much if
 * the change lands inside it.
 *
 * The port here is the **real** `capacitorShellSupport` over the **real**
 * `permissionNotice` and `mayShowDeviceList`, with only the plugin's answer
 * scripted. Stubbing the port would assert that this component renders what it
 * is given, which is the one thing #284 was never in doubt about.
 */

import type { TransportAvailability } from '@onyourleft/sensors';
import { mayShowDeviceList, permissionNotice } from '@onyourleft/mobile';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { tabbableElements } from '../a11y/audit';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { capacitorShellSupport } from '../support/shell-support';
import type { ShellSupportPort } from '../support/shell-support-port';
import { mount, settle, type Mounted } from '../testing/mount';

import { DevicesView } from './DevicesView';

/**
 * What a WebView reports, which is the wrong answer and is why #284 exists.
 *
 * Android System WebView does expose `navigator.bluetooth` in recent Chromium,
 * and this fixture makes it answer `false` — so the *browser* verdict here is
 * `adapter-unavailable`, "Bluetooth is switched off", with no mention of a
 * permission. Every assertion below that names the plugin's answer would also
 * pass if the screen read this one, unless it names wording only the plugin
 * produces. They do.
 */
const WEBVIEW: CapabilityProbe = {
  bluetooth: {
    getAvailability: async () => Promise.resolve(false),
    requestDevice: async () => Promise.reject(new Error('no chooser in a WebView')),
  },
  secureContext: true,
};

function shellPort(...answers: readonly TransportAvailability[]): {
  readonly port: ShellSupportPort;
  readonly availability: ReturnType<typeof vi.fn<() => Promise<TransportAvailability>>>;
} {
  const availability = vi.fn<() => Promise<TransportAvailability>>();
  for (const answer of answers) {
    availability.mockResolvedValueOnce(answer);
  }
  availability.mockResolvedValue(answers[answers.length - 1] ?? { kind: 'available' });
  return {
    port: capacitorShellSupport({ availability, notice: permissionNotice, mayShowDeviceList }),
    availability,
  };
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function open(port: ShellSupportPort): Promise<Mounted> {
  const result = await mount(<DevicesView capabilities={WEBVIEW} shell={port} />);
  await settle();
  mounted = result;
  return result;
}

/** Every control whose name suggests it starts a pairing flow. */
function pairingControls(root: ParentNode): Element[] {
  return [...root.querySelectorAll('button, a[href], [role="button"]')].filter((element) =>
    /pair|connect|add (a )?(sensor|device)|scan/i.test(element.textContent ?? ''),
  );
}

describe('criterion 1 — the answer comes from the plugin, not from the WebView', () => {
  it('asks the plugin', async () => {
    const { port, availability } = shellPort({ kind: 'available' });
    await open(port);
    expect(availability).toHaveBeenCalledTimes(1);
  });

  it('says the phone can pair even though the WebView’s own radio answer is no', async () => {
    const { port } = shellPort({ kind: 'available' });
    const { container } = await open(port);
    // The browser probe on this fixture resolves to `adapter-unavailable`, so
    // this assertion fails the moment the screen reads `navigator.bluetooth`
    // again — which is the defect, in one line.
    expect(container.textContent).toContain('Bluetooth is available');
    expect(container.textContent).toContain('This phone can pair sensors');
    expect(container.textContent).not.toContain('this browser');
  });

  it('never tells a rider on a phone to open a different browser', async () => {
    // The browser notice's remedy for every unusable state. On a phone running
    // the shell it is not merely unhelpful, it is wrong: there is no other
    // browser to open, and the thing that refused is the plugin.
    for (const kind of ['not-permitted', 'adapter-unavailable', 'unsupported'] as const) {
      const { port } = shellPort({ kind });
      const { container } = await open(port);
      expect(container.textContent).not.toMatch(/Safari|Firefox|chrome:\/\/flags/i);
      mounted?.unmount();
      mounted = undefined;
    }
  });
});

describe('criterion 2 — a refused permission and a switched-off radio are told apart', () => {
  it('names the permission, and where to grant it', async () => {
    const { port } = shellPort({ kind: 'not-permitted' });
    const { container } = await open(port);
    const text = container.textContent ?? '';
    expect(text).toContain('On Your Left needs Bluetooth permission');
    // The action `permissionNotice` carries, turned into something a rider can
    // follow — the shell can offer no button for it, so it is prose or nothing.
    expect(text).toMatch(/Settings/);
    expect(text).toMatch(/Nearby devices/i);
  });

  it('names the radio, and does not send that rider to app settings', async () => {
    const { port } = shellPort({ kind: 'adapter-unavailable' });
    const { container } = await open(port);
    const text = container.textContent ?? '';
    expect(text).toContain('Bluetooth is switched off');
    expect(text).not.toMatch(/Nearby devices/i);
  });

  it('offers a re-check for both, and it is reachable by keyboard', async () => {
    for (const kind of ['not-permitted', 'adapter-unavailable'] as const) {
      const { port } = shellPort({ kind });
      const { container } = await open(port);
      const button = container.querySelector('button');
      expect(button, `no re-check offered for ${kind}`).not.toBeNull();
      expect(tabbableElements(container)).toContain(button);
      mounted?.unmount();
      mounted = undefined;
    }
  });

  it('re-reads the plugin when the rider says they have fixed it', async () => {
    // The defect this catches is the read that cannot see the write: the rider
    // grants the permission outside the app and comes back, and a screen
    // serving its first answer leaves them on the page that sent them away.
    const { port, availability } = shellPort({ kind: 'not-permitted' }, { kind: 'available' });
    const { container } = await open(port);
    expect(container.textContent).toContain('On Your Left needs Bluetooth permission');

    container.querySelector('button')?.click();
    await settle();

    expect(availability).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('This phone can pair sensors');
    expect(container.textContent).not.toContain('On Your Left needs Bluetooth permission');
  });

  it('offers no re-check on a phone with no Bluetooth Low Energy at all', async () => {
    const { port } = shellPort({ kind: 'unsupported' });
    const { container } = await open(port);
    expect(container.textContent).toContain('This device cannot use Bluetooth sensors');
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('#48 criterion 1 still holds on the shell branch', () => {
  it('renders no pairing control in any unusable state — not a disabled one, none', async () => {
    for (const kind of ['not-permitted', 'adapter-unavailable', 'unsupported'] as const) {
      const { port } = shellPort({ kind });
      const { container } = await open(port);
      expect(pairingControls(container), `pairing control offered for ${kind}`).toEqual([]);
      expect(container.querySelectorAll('button[disabled]')).toHaveLength(0);
      expect(container.textContent).toContain('there is nothing to list');
      mounted?.unmount();
      mounted = undefined;
    }
  });

  it('does not claim pairing is impossible before the plugin has answered', async () => {
    const port: ShellSupportPort = {
      readShellSupport: () => new Promise(() => undefined),
    };
    const result = await mount(<DevicesView capabilities={WEBVIEW} shell={port} />);
    mounted = result;

    const text = result.container.textContent ?? '';
    expect(text).not.toMatch(/cannot be paired/i);
    expect(text).toContain('Asking this phone about Bluetooth');
    expect(pairingControls(result.container)).toHaveLength(0);
  });
});

describe('the browser branch is still reachable', () => {
  it('reads the browser probe when no shell port is supplied', async () => {
    // The other half of criterion 3, asserted here rather than by editing
    // `DevicesView.test.tsx`: with no port, the WebView fixture's own answer
    // is what renders, wording and all.
    const result = await mount(<DevicesView capabilities={WEBVIEW} />);
    await settle();
    mounted = result;
    expect(result.container.textContent).toContain('Bluetooth is switched off');
    expect(result.container.textContent).toContain('This browser supports Bluetooth');
  });
});
