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

import { act } from 'react';
import type { TransportAvailability } from '@onyourleft/sensors';
import { createCapacitorTransport, mayShowDeviceList, permissionNotice } from '@onyourleft/mobile';
import { scriptedPort, type ScriptedPort, type ScriptedStack } from '@onyourleft/mobile/testing';
import { unixSeconds } from '@onyourleft/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tabbableElements } from '../a11y/audit';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { capacitorShellSupport, SHELL_ANSWER_TIMEOUT } from '../support/shell-support';
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

/**
 * #322 — the plugin is asked and never answers.
 *
 * ⚠️ **Fake timers and the REAL constants, deliberately.** Every other file in
 * this change injects a scheduler so a deadline can be fired by hand, which is
 * the right shape for a unit and blind to the one thing that actually broke:
 * two deadlines in two packages, `apps/mobile`'s `INITIALIZE_ANSWER_WINDOW` and
 * `apps/web`'s `SHELL_ANSWER_TIMEOUT`, which have to expire in that order for
 * the button this screen offers to reach the plugin at all. Nothing injects
 * them here — `DevicesView` takes no scheduler and must not — so both run on
 * the global clock and the ordering is observed rather than asserted from two
 * numbers.
 *
 * The whole chain is real: `createCapacitorTransport` over `scriptedPort`, the
 * real `capacitorShellSupport`, the real `permissionNotice`, the real hook.
 * Only the plugin's silence is scripted, and it is the silence that was
 * measured on the device.
 */
describe('the plugin is asked and never answers (#322)', () => {
  /** The port `main.tsx` builds, over a plugin that receives and never replies. */
  function overSilentPlugin(stack: ScriptedStack): {
    readonly port: ShellSupportPort;
    readonly plugin: ScriptedPort;
  } {
    const plugin = scriptedPort(stack);
    const transport = createCapacitorTransport({
      plugin,
      profiles: [],
      now: () => unixSeconds(0),
    });
    return {
      plugin,
      port: capacitorShellSupport({
        availability: async () => transport.availability(),
        notice: permissionNotice,
        mayShowDeviceList,
      }),
    };
  }

  /** Let both packages' deadlines run, on one clock, in whatever order they fall. */
  async function waitOutTheDeadline(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SHELL_ANSWER_TIMEOUT * 1000);
    });
  }

  beforeEach(() => {
    // `shouldAdvanceTime` keeps `settle()`'s own zero-length timer working,
    // which is what lets the rest of this file's helpers be reused unchanged.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops saying "Checking" and says the phone has not answered', async () => {
    // The defect, in one test. On the device this screen read "Checking: Asking
    // this phone about Bluetooth" at 0 s, 5 s, 15 s, 30 s and 45 s.
    const { port } = overSilentPlugin({ initializeNeverAnswers: true });
    const result = await mount(<DevicesView capabilities={WEBVIEW} shell={port} />);
    mounted = result;
    expect(result.container.textContent).toContain('Asking this phone about Bluetooth');

    await waitOutTheDeadline();

    const text = result.container.textContent ?? '';
    expect(text).toContain('This phone has not answered about Bluetooth');
    expect(text).not.toContain('Asking this phone about Bluetooth');
  });

  it('does not report a silence as a refusal, or as a phone with no radio', async () => {
    // #322's fourth criterion. `unsupported` is the screen with no retry on it
    // and `not-permitted` sends a rider to a Settings page that will not help;
    // being wrong in either direction here is worse than saying nothing.
    const { port } = overSilentPlugin({ initializeNeverAnswers: true });
    const result = await mount(<DevicesView capabilities={WEBVIEW} shell={port} />);
    mounted = result;
    await waitOutTheDeadline();

    const text = result.container.textContent ?? '';
    expect(text).toContain('Nothing has been refused');
    expect(text).not.toContain('On Your Left needs Bluetooth permission');
    expect(text).not.toContain('This device cannot use Bluetooth sensors');
    expect(text).not.toContain('Bluetooth is switched off');
  });

  it('lists no sensors, and claims nothing about them either', async () => {
    const { port } = overSilentPlugin({ initializeNeverAnswers: true });
    const result = await mount(<DevicesView capabilities={WEBVIEW} shell={port} />);
    mounted = result;
    await waitOutTheDeadline();

    expect(pairingControls(result.container)).toEqual([]);
    // Not "Sensors cannot be paired on this phone" — that is a verdict, and no
    // verdict was given.
    expect(result.container.textContent).toContain('The check did not finish');
    expect(result.container.textContent).not.toMatch(/cannot be paired on this phone/i);
  });

  it('offers a re-check that REACHES THE PLUGIN, rather than a dead promise', async () => {
    // ⚠️ The half that needs both packages. `ensureInitialized` memoises the
    // in-flight initialisation so two callers racing cost one platform call —
    // and before #322 it kept memoising one that never settled, so this button
    // attached the rider to the same dead promise every time they pressed it.
    // A screen that said "check again" and could not was #48 criterion 1's
    // silently non-functional control, reached from underneath.
    const { port, plugin } = overSilentPlugin({ initializeNeverAnswers: true });
    const result = await mount(<DevicesView capabilities={WEBVIEW} shell={port} />);
    mounted = result;
    await waitOutTheDeadline();
    expect(plugin.calls.filter((call) => call === 'initialize')).toHaveLength(1);

    const recheck = [...result.container.querySelectorAll('button')].find((button) =>
      /check again/i.test(button.textContent ?? ''),
    );
    expect(recheck, 'no re-check offered for an unanswered check').toBeDefined();
    await act(async () => {
      recheck?.click();
      await Promise.resolve();
    });

    expect(plugin.calls.filter((call) => call === 'initialize')).toHaveLength(2);
  });

  it('adopts the answer when the plugin finally speaks', async () => {
    // A rider reading Android's permission dialog is not a hang, and the first
    // `initialize()` is the call that raises it. The deadline can be short
    // because being early costs nothing: the real answer replaces the message.
    let silent = true;
    const plugin = scriptedPort();
    const transport = createCapacitorTransport({
      plugin: {
        ...plugin,
        initialize: async (): Promise<void> => {
          if (silent) {
            return new Promise<void>(() => undefined);
          }
          return plugin.initialize();
        },
      },
      profiles: [],
      now: () => unixSeconds(0),
    });
    const port = capacitorShellSupport({
      availability: async () => transport.availability(),
      notice: permissionNotice,
      mayShowDeviceList,
    });

    const result = await mount(<DevicesView capabilities={WEBVIEW} shell={port} />);
    mounted = result;
    await waitOutTheDeadline();
    expect(result.container.textContent).toContain('This phone has not answered about Bluetooth');

    silent = false;
    const recheck = [...result.container.querySelectorAll('button')].find((button) =>
      /check again/i.test(button.textContent ?? ''),
    );
    await act(async () => {
      recheck?.click();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.container.textContent).toContain('This phone can pair sensors');
  });
});
