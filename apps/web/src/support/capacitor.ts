// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Am I running inside a native shell (Android, or the iOS app since #1755), or in a browser?
 *
 * One question, asked in one place, because the answer decides which BLE
 * transport the client uses — Web Bluetooth in a browser, `apps/mobile`'s
 * Capacitor adapter inside the shell. Both satisfy #39's `SensorTransport`
 * unchanged, which is the promise that makes a runtime choice possible at all.
 *
 * ## Why this is not `navigator.userAgent`
 *
 * A Capacitor WebView **is** Chrome, and reports itself as Chrome. Sniffing the
 * user agent would find Android and conclude "mobile browser", which is a
 * different platform with a different transport and a different set of things it
 * may do without a user gesture. Capacitor injects `window.Capacitor` and that
 * object's `isNativePlatform()` is the question's actual answer.
 *
 * ⚠️ **And it is not `'Capacitor' in window` either.** Capacitor's web build
 * defines the same global when the app runs as a plain web page — `cap serve`,
 * and any deployment of the same bundle to a browser — and there
 * `isNativePlatform()` returns `false`. Testing for the object's presence would
 * put the browser build on the native transport, which would fail at the first
 * plugin call with an error naming a bridge rather than a browser.
 *
 * ## Why it takes the global as a parameter
 *
 * The same reason `readAvailability` does in #40: every branch has to be
 * reachable from a test, and no test machine can be both a Capacitor WebView and
 * not one. `platformIsNative()` reads the real global; `isNativeShell` is the
 * pure function underneath it, and that is what the tests drive.
 */

/** The shape Capacitor injects. Named here so this file needs no import from it. */
export interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

/**
 * Whether this bundle is running inside a native Capacitor shell.
 *
 * `false` for every browser, including one on Android, and including the same
 * bundle served as a web page by Capacitor's own tooling.
 */
export function isNativeShell(capacitor: CapacitorGlobal | undefined): boolean {
  if (capacitor === undefined || typeof capacitor.isNativePlatform !== 'function') {
    return false;
  }
  try {
    return capacitor.isNativePlatform() === true;
  } catch {
    // A malformed or partially-injected global. Falling back to "browser" is the
    // safe direction: the browser transport degrades to an honest "cannot pair
    // here" notice, where the native one would throw inside a plugin bridge.
    return false;
  }
}

/**
 * Which platform the shell reports, for a notice that wants to say so.
 *
 * `undefined` rather than `'web'` when there is no shell, so a caller cannot
 * accidentally treat the absence of Capacitor as a platform it can branch on.
 */
export function shellPlatform(capacitor: CapacitorGlobal | undefined): string | undefined {
  if (!isNativeShell(capacitor)) {
    return undefined;
  }
  try {
    return capacitor?.getPlatform?.();
  } catch {
    return undefined;
  }
}

/**
 * The two native shells this client knows how to wire — #1755.
 *
 * `android` is `apps/mobile`'s shell, with its own Java plugins registered in
 * `MainActivity`; `ios` is the iOS and iPadOS app (#15), which has none of
 * them.
 */
export type ShellKind = 'android' | 'ios';

/**
 * Which native shell this is, or `undefined` for a browser — #1755.
 *
 * ⚠️ **"Native" is not "Android".** {@link isNativeShell} is true in both
 * shells, and two things must keep reading it that way: the BLE transport
 * (the Capacitor adapter in any shell) and ADR 0047 D-11's sealed-build offer
 * (`instance/instance-pin.ts` §`sealedBuildOffered`, which the owner ruled on
 * 2026-11-26 covers the iOS app). This is the finer question, for what only
 * one shell has: `RecordingService`, `SecureWindow`, `Autoplay`, `OtherPlayer`
 * and the `MainActivity` hooks are Android's alone.
 *
 * ⚠️ **A native shell that names any other platform, or none, is
 * `undefined`**, and so gets no Android plugin. That is the safe direction: a
 * plugin that is missing degrades to the browser's fallback, where one that is
 * wrongly assumed throws inside the bridge.
 */
export function shellKind(capacitor: CapacitorGlobal | undefined): ShellKind | undefined {
  const platform = shellPlatform(capacitor);
  return platform === 'android' || platform === 'ios' ? platform : undefined;
}

/** Whether this is the Android shell, the one with `apps/mobile`'s own plugins — #1755. */
export function isAndroidShell(capacitor: CapacitorGlobal | undefined): boolean {
  return shellKind(capacitor) === 'android';
}

/** Reads the real global. The one impure function here. */
export function platformCapacitor(): CapacitorGlobal | undefined {
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
}
