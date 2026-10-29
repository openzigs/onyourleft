// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1821 — `navigatorGamepads`, the one place that names the Gamepad API,
 * against a host shaped as `window`.
 */

import { describe, expect, it } from 'vitest';

import { navigatorGamepads, type GamepadHost, type PadSnapshot } from './gamepad-port';

const PAD: PadSnapshot = { connected: true, mapping: 'standard', axes: [0], buttons: [] };

/** A host whose events are a real `EventTarget`, with `getGamepads` as given. */
function host(getGamepads?: () => readonly (PadSnapshot | null)[]): GamepadHost & EventTarget {
  const target = new EventTarget();
  return Object.assign(target, { navigator: { getGamepads } });
}

describe('navigatorGamepads', () => {
  it('lists the pads `getGamepads` lists, called on the navigator', () => {
    const page = host(function (this: unknown) {
      expect(this).toBe(page.navigator);
      return [null, PAD];
    });
    expect(navigatorGamepads(page).pads()).toEqual([null, PAD]);
  });

  it('lists none where there is no Gamepad API, or where a policy refuses it', () => {
    expect(navigatorGamepads(host()).pads()).toEqual([]);
    const refused = host(() => {
      throw new DOMException('gamepad is not allowed', 'SecurityError');
    });
    expect(navigatorGamepads(refused).pads()).toEqual([]);
  });

  it('tells a listener of each connect and disconnect, until it is stopped', () => {
    const page = host(() => []);
    let told = 0;
    const stop = navigatorGamepads(page).onConnectionChange(() => {
      told += 1;
    });
    page.dispatchEvent(new Event('gamepadconnected'));
    page.dispatchEvent(new Event('gamepaddisconnected'));
    page.dispatchEvent(new Event('keydown'));
    expect(told).toBe(2);
    stop();
    page.dispatchEvent(new Event('gamepadconnected'));
    page.dispatchEvent(new Event('gamepaddisconnected'));
    expect(told).toBe(2);
  });
});
