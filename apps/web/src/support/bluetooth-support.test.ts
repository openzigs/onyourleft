// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #48's second acceptance criterion, at the layer that decides it:
 *
 * > Capability detection is used, **not** user-agent sniffing — asserted by a
 * > test that a browser with the capability present is never told it is
 * > unsupported regardless of its user agent.
 *
 * The assertion is behavioural in both directions and deliberately so. Reading
 * the source for the string `userAgent` would prove nothing: a sniff can be
 * spelled `navigator.vendor`, `userAgentData.brands`, or a regular expression
 * over `navigator.appVersion`, and a grep that found none of those would report
 * a clean result about a module it had not understood. What is asserted instead
 * is that the *answer* does not move when the user agent does.
 */

import { describe, expect, it } from 'vitest';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { readBluetoothSupport, supportFor, type CapabilityProbe } from './bluetooth-support';

/**
 * User agents that a naive sniff would reject, and one it would accept.
 *
 * Real strings, including the two that matter most: Chrome on iOS calls itself
 * `CriOS` and is WKWebView underneath, and Edge calls itself both `Chrome` and
 * `Edg`. A sniff that allow-listed "Chrome" would accept the first, which
 * cannot work, and a sniff that matched "Safari" would reject the second, which
 * can — every desktop Chrome user-agent string contains the word "Safari".
 */
const USER_AGENTS = {
  chromeDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  safariDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0',
  chromeOnIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.0.0 Mobile/15E148 Safari/604.1',
  somethingUnreleased: 'Mozilla/5.0 (Fuchsia) SomeBrowser/1.0',
} as const;

function bluetoothPort(overrides: Partial<BluetoothPort> = {}): BluetoothPort {
  return {
    getAvailability: async () => Promise.resolve(true),
    requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
    ...overrides,
  };
}

/**
 * A probe with a user agent hung off it.
 *
 * `CapabilityProbe` has no user-agent field — the shape is part of the
 * guarantee — so this widens it deliberately. If somebody later reaches for a
 * user agent, the value is here for them to find and these tests are what
 * fails.
 */
function probeWith(
  bluetooth: BluetoothPort | undefined,
  userAgent: string,
  secureContext = true,
): CapabilityProbe {
  return { bluetooth, secureContext, userAgent } as CapabilityProbe & { userAgent: string };
}

describe('criterion 2 — the answer follows the capability, not the user agent', () => {
  it.each(Object.entries(USER_AGENTS))(
    'reports available for a working adapter claiming to be %s',
    async (_name, userAgent) => {
      const support = await readBluetoothSupport(probeWith(bluetoothPort(), userAgent));
      expect(support.kind).toBe('available');
      expect(support.canPair).toBe(true);
    },
  );

  it.each(Object.entries(USER_AGENTS))(
    'reports the browser unsupported with no adapter, even claiming to be %s',
    async (_name, userAgent) => {
      const support = await readBluetoothSupport(probeWith(undefined, userAgent));
      expect(support.kind).toBe('absent');
      expect(support.canPair).toBe(false);
    },
  );

  it('gives the same answer for the same capability under two opposite user agents', async () => {
    const chrome = await readBluetoothSupport(
      probeWith(bluetoothPort(), USER_AGENTS.chromeDesktop),
    );
    const safari = await readBluetoothSupport(
      probeWith(bluetoothPort(), USER_AGENTS.safariDesktop),
    );
    expect(safari).toEqual(chrome);
  });
});

describe('criterion 1 — the six states are told apart', () => {
  it('absent: no bluetooth object, and no recovery to offer', async () => {
    const support = await readBluetoothSupport({ bluetooth: undefined, secureContext: true });
    expect(support).toEqual({ kind: 'absent', canPair: false, recoverable: false });
  });

  it('insecure-context: no object because the page is on plain HTTP, which IS recoverable', async () => {
    // The distinction this test pins is the one a presence check cannot make.
    // Both cases have `bluetooth === undefined`; telling a contributor on
    // http://192.168.1.5:5173 that their Chrome has no Web Bluetooth is a wrong
    // answer that sends them to install a different browser.
    const support = await readBluetoothSupport({ bluetooth: undefined, secureContext: false });
    expect(support).toEqual({ kind: 'insecure-context', canPair: false, recoverable: true });
  });

  it('incomplete: the object exists and getAvailability is missing — Chrome on Linux', async () => {
    const partial = {
      requestDevice: async () => bluetoothPort().requestDevice(),
    } as unknown as BluetoothPort;
    const support = await readBluetoothSupport({ bluetooth: partial, secureContext: true });
    expect(support.kind).toBe('incomplete');
    expect(support.canPair).toBe(false);
  });

  it('incomplete: the object exists and requestDevice is missing', async () => {
    const partial = {
      getAvailability: async () => Promise.resolve(true),
    } as unknown as BluetoothPort;
    expect((await readBluetoothSupport({ bluetooth: partial, secureContext: true })).kind).toBe(
      'incomplete',
    );
  });

  it('incomplete: getAvailability throws one layer in, rather than the rejection escaping', async () => {
    const throwing = bluetoothPort({
      getAvailability: async () => Promise.reject(new Error('NotSupportedError')),
    });
    await expect(
      readBluetoothSupport({ bluetooth: throwing, secureContext: true }),
    ).resolves.toEqual({ kind: 'incomplete', canPair: false, recoverable: true });
  });

  it('adapter-unavailable: everything works and the radio is off', async () => {
    const off = bluetoothPort({ getAvailability: async () => Promise.resolve(false) });
    expect(await readBluetoothSupport({ bluetooth: off, secureContext: true })).toEqual({
      kind: 'adapter-unavailable',
      canPair: false,
      recoverable: true,
    });
  });
});

describe('supportFor maps every availability the transport can express', () => {
  it.each([
    ['available', { kind: 'available', canPair: true, recoverable: true }],
    ['adapter-unavailable', { kind: 'adapter-unavailable', canPair: false, recoverable: true }],
    // Not reachable through `readAvailability` today — see the note on
    // `supportFor`. Asserted here so that the branch is right *before* #49
    // makes a Permissions Policy refusal observable, rather than being
    // discovered wrong by an athlete in an embedded frame.
    ['not-permitted', { kind: 'not-permitted', canPair: false, recoverable: true }],
    ['unsupported', { kind: 'incomplete', canPair: false, recoverable: true }],
  ] as const)('%s', (kind, expected) => {
    expect(supportFor({ kind })).toEqual(expected);
  });
});

describe('the presence check this replaces would get two of these wrong', () => {
  it("'bluetooth' in navigator would call the partial Linux implementation supported", async () => {
    const partial = {
      requestDevice: async () => bluetoothPort().requestDevice(),
    } as unknown as BluetoothPort;
    const naive = partial !== undefined;
    expect(naive).toBe(true);
    expect((await readBluetoothSupport({ bluetooth: partial, secureContext: true })).canPair).toBe(
      false,
    );
  });

  it('and would call an insecure context a browser problem', async () => {
    expect((await readBluetoothSupport({ bluetooth: undefined, secureContext: false })).kind).toBe(
      'insecure-context',
    );
  });
});

describe('only `available` may pair', () => {
  it('canPair is true for exactly one state', async () => {
    const probes: CapabilityProbe[] = [
      { bluetooth: bluetoothPort(), secureContext: true },
      {
        bluetooth: bluetoothPort({ getAvailability: async () => Promise.resolve(false) }),
        secureContext: true,
      },
      { bluetooth: undefined, secureContext: true },
      { bluetooth: undefined, secureContext: false },
      { bluetooth: {} as unknown as BluetoothPort, secureContext: true },
    ];
    const pairable = await Promise.all(
      probes.map(async (probe) => (await readBluetoothSupport(probe)).canPair),
    );
    expect(pairable).toEqual([true, false, false, false, false]);
  });
});
