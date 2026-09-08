// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Which transport the client picks, and the two ways of getting it wrong.
 *
 * Both wrong answers are the kind that look right on the machine they were
 * written on: a user-agent sniff finds Android in a Capacitor WebView *and* in
 * Chrome on a phone, and a presence check finds `window.Capacitor` in the shell
 * *and* in the same bundle served as a web page.
 */

import { describe, expect, it } from 'vitest';

import { isNativeShell, shellPlatform } from './capacitor';

describe('detecting the Android shell', () => {
  it('says yes inside a native shell', () => {
    expect(isNativeShell({ isNativePlatform: () => true, getPlatform: () => 'android' })).toBe(
      true,
    );
  });

  it('says no in a plain browser, where there is no global at all', () => {
    expect(isNativeShell(undefined)).toBe(false);
  });

  it('says no when Capacitor is present but running as a web page', () => {
    // ⚠️ The case a `'Capacitor' in window` check gets wrong. `cap serve`, and
    // any deployment of the same bundle to a browser, define the global and
    // report `false` — and the native transport would fail there at the first
    // plugin call, with an error naming a bridge rather than a browser.
    expect(isNativeShell({ isNativePlatform: () => false, getPlatform: () => 'web' })).toBe(false);
  });

  it('says no when the global exists but is not the shape we expect', () => {
    expect(isNativeShell({})).toBe(false);
  });

  it('falls back to the browser when the global throws', () => {
    // Falling back this way is the safe direction: the browser transport
    // degrades to an honest "cannot pair here" notice; the native one throws
    // inside a bridge that is not there.
    expect(
      isNativeShell({
        isNativePlatform: () => {
          throw new Error('bridge not ready');
        },
      }),
    ).toBe(false);
  });

  it('does not treat a truthy non-boolean as yes', () => {
    expect(isNativeShell({ isNativePlatform: () => 'yes' as unknown as boolean })).toBe(false);
  });
});

describe('what the shell says it is', () => {
  it('reports the platform inside a shell', () => {
    expect(shellPlatform({ isNativePlatform: () => true, getPlatform: () => 'android' })).toBe(
      'android',
    );
  });

  it('reports nothing at all in a browser, rather than the string web', () => {
    // `undefined` rather than `'web'`, so a caller cannot accidentally branch on
    // the absence of a shell as though it were a platform.
    expect(
      shellPlatform({ isNativePlatform: () => false, getPlatform: () => 'web' }),
    ).toBeUndefined();
    expect(shellPlatform(undefined)).toBeUndefined();
  });

  it('survives a shell that reports being native and then throws', () => {
    expect(
      shellPlatform({
        isNativePlatform: () => true,
        getPlatform: () => {
          throw new Error('no');
        },
      }),
    ).toBeUndefined();
  });
});
