// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The one function in the client that reads the browser's globals.
 *
 * Everything above it takes a `CapabilityProbe` as a parameter, which is what
 * makes every unsupported branch reachable from a test. That design is only
 * worth anything if this function actually reads the right two globals, and
 * this is the file that says so — otherwise the whole shell could be perfectly
 * tested against a probe nothing ever populates correctly.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';

import { probeBrowser, readBluetoothSupport } from './bluetooth-support';

const originalSecureContext = globalThis.isSecureContext;

function setSecureContext(value: boolean): void {
  Object.defineProperty(globalThis, 'isSecureContext', {
    configurable: true,
    value,
  });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'bluetooth');
  setSecureContext(originalSecureContext);
});

describe('probeBrowser', () => {
  it('reports no bluetooth in a browser that has none — the jsdom default', () => {
    setSecureContext(true);
    expect(probeBrowser()).toEqual({ bluetooth: undefined, secureContext: true });
  });

  it('picks up navigator.bluetooth when the browser exposes it', () => {
    const bluetooth: BluetoothPort = {
      getAvailability: async () => Promise.resolve(true),
      requestDevice: async () => Promise.reject(new Error('no chooser in a test')),
    };
    Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: bluetooth });
    setSecureContext(true);
    expect(probeBrowser().bluetooth).toBe(bluetooth);
  });

  it('reads the secure-context flag rather than assuming it', () => {
    setSecureContext(false);
    expect(probeBrowser().secureContext).toBe(false);
  });

  it('feeds the classifier, end to end, without a stubbed probe in between', async () => {
    // The join. Everything else in this suite hands `readBluetoothSupport` a
    // probe built by hand; this is the one case where the value came out of the
    // browser, which is the only way to catch reading the wrong property name.
    setSecureContext(false);
    expect((await readBluetoothSupport(probeBrowser())).kind).toBe('insecure-context');
  });
});
