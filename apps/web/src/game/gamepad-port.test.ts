// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #1821 — `navigatorGamepads`, the one place that names the Gamepad API,
 * against a host shaped as `window`. #1858 — the numbered buttons the Android
 * shell forwards, called as `MainActivity.java` calls them.
 */

import { describe, expect, it } from 'vitest';

import {
  FORWARDED_BUTTON_GLOBAL,
  FORWARDED_BUTTONS,
  FORWARDED_MAPPING,
  navigatorGamepads,
  type GamepadHost,
  type PadSnapshot,
} from './gamepad-port';

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

/** The numbers of the buttons a forwarded pad lists as down, or `null` for an empty slot. */
function down(pad: PadSnapshot | null | undefined): number[] | null {
  if (pad === null || pad === undefined) return null;
  expect(pad).toMatchObject({ connected: true, mapping: FORWARDED_MAPPING, axes: [] });
  expect(pad.buttons).toHaveLength(FORWARDED_BUTTONS);
  return pad.buttons.flatMap((button, index) => (button.pressed ? [index + 1] : []));
}

/** Call the page's function as `MainActivity` does. */
function press(page: GamepadHost, button: unknown, pressed: unknown): void {
  const forward = page[FORWARDED_BUTTON_GLOBAL];
  expect(forward).toBeTypeOf('function');
  forward?.(button, pressed);
}

describe('navigatorGamepads in the shell (#1858)', () => {
  it('lists the forwarded buttons in slot 0, before the platform’s pads, while one is down', () => {
    const page = host(() => [PAD, null]);
    const port = navigatorGamepads(page, true);
    port.onConnectionChange(() => undefined);
    expect(port.pads()).toEqual([null, PAD, null]);
    press(page, 4, true);
    press(page, 16, true);
    expect(down(port.pads()[0])).toEqual([4, 16]);
    expect(port.pads().slice(1)).toEqual([PAD, null]);
    press(page, 4, false);
    expect(down(port.pads()[0])).toEqual([16]);
    press(page, 16, false);
    expect(port.pads()).toEqual([null, PAD, null]);
  });

  it('counts a press released before the next read once, on that read', () => {
    const page = host(() => []);
    const port = navigatorGamepads(page, true);
    port.onConnectionChange(() => undefined);
    press(page, 2, true);
    press(page, 2, false);
    expect(down(port.pads()[0])).toEqual([2]);
    expect(port.pads()).toEqual([null]);
  });

  it('reads a second down for a button already down as the same press, not a new one', () => {
    const page = host(() => []);
    const port = navigatorGamepads(page, true);
    port.onConnectionChange(() => undefined);
    press(page, 4, true);
    expect(down(port.pads()[0])).toEqual([4]);
    press(page, 4, true);
    press(page, 4, false);
    expect(port.pads()).toEqual([null]);
  });

  it('wakes the listener on each press and release it keeps', () => {
    const page = host(() => []);
    let told = 0;
    navigatorGamepads(page, true).onConnectionChange(() => {
      told += 1;
    });
    press(page, 3, true);
    press(page, 3, false);
    expect(told).toBe(2);
  });

  it('drops a button number outside 1 to 16, or a pressed that is not a boolean (CLAUDE.md §6)', () => {
    const page = host(() => []);
    let told = 0;
    const port = navigatorGamepads(page, true);
    port.onConnectionChange(() => {
      told += 1;
    });
    for (const button of [
      0,
      17,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '4',
      null,
      undefined,
    ]) {
      expect(() => press(page, button, true)).not.toThrow();
    }
    for (const pressed of [1, 'true', null, undefined]) press(page, 4, pressed);
    expect(told).toBe(0);
    expect(port.pads()).toEqual([null]);
    press(page, 1, true);
    press(page, 16, true);
    expect(down(port.pads()[0])).toEqual([1, 16]);
  });

  it('installs the function only while a listener is subscribed, and leaves another’s alone', () => {
    const page = host(() => []);
    const port = navigatorGamepads(page, true);
    expect(page[FORWARDED_BUTTON_GLOBAL]).toBeUndefined();
    const stop = port.onConnectionChange(() => undefined);
    expect(page[FORWARDED_BUTTON_GLOBAL]).toBeTypeOf('function');
    stop();
    expect(page[FORWARDED_BUTTON_GLOBAL]).toBeUndefined();

    const first = navigatorGamepads(page, true).onConnectionChange(() => undefined);
    const second = navigatorGamepads(page, true).onConnectionChange(() => undefined);
    const installed = page[FORWARDED_BUTTON_GLOBAL];
    first();
    expect(page[FORWARDED_BUTTON_GLOBAL]).toBe(installed);
    second();
    expect(page[FORWARDED_BUTTON_GLOBAL]).toBeUndefined();
  });

  it('lets go of every forwarded button when a pad disconnects, if no release ever comes (#1893)', () => {
    const page = host(() => []);
    const port = navigatorGamepads(page, true);
    let told = 0;
    port.onConnectionChange(() => {
      told += 1;
    });
    press(page, 4, true);
    press(page, 2, true);
    expect(down(port.pads()[0])).toEqual([2, 4]);
    told = 0;
    page.dispatchEvent(new Event('gamepaddisconnected'));
    expect(port.pads()).toEqual([null]);
    // The HUD is woken, and polls once more to find nothing held.
    expect(told).toBe(1);
    // The release that comes late changes nothing, and the next press is a press.
    press(page, 4, false);
    expect(port.pads()).toEqual([null]);
    press(page, 4, true);
    expect(down(port.pads()[0])).toEqual([4]);
  });

  it('reads a press not yet read once, though its pad disconnects before the read (#1893)', () => {
    const page = host(() => []);
    const port = navigatorGamepads(page, true);
    port.onConnectionChange(() => undefined);
    press(page, 3, true);
    page.dispatchEvent(new Event('gamepaddisconnected'));
    expect(down(port.pads()[0])).toEqual([3]);
    expect(port.pads()).toEqual([null]);
  });

  it('lets go of nothing on a connect, and hears no disconnect once stopped (#1893)', () => {
    const page = host(() => []);
    const port = navigatorGamepads(page, true);
    let told = 0;
    const stop = port.onConnectionChange(() => {
      told += 1;
    });
    press(page, 4, true);
    page.dispatchEvent(new Event('gamepadconnected'));
    expect(down(port.pads()[0])).toEqual([4]);
    stop();
    told = 0;
    page.dispatchEvent(new Event('gamepaddisconnected'));
    expect(told).toBe(0);
    expect(down(port.pads()[0])).toEqual([4]);
  });

  it('changes nothing in a browser: no slot 0, and no function installed', () => {
    const page = host(() => [PAD]);
    const port = navigatorGamepads(page);
    port.onConnectionChange(() => undefined);
    expect(page[FORWARDED_BUTTON_GLOBAL]).toBeUndefined();
    expect(port.pads()).toEqual([PAD]);
  });
});
