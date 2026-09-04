// SPDX-License-Identifier: Apache-2.0

/**
 * Turning a browser failure into one of `SensorErrorCode`'s ten states.
 *
 * ## Why this is a file and not three `catch` blocks
 *
 * Web Bluetooth reports almost everything as a `DOMException`, and the same
 * `name` means different things at different call sites. `NotFoundError` from
 * `requestDevice` is "the athlete pressed cancel"; from `getPrimaryService` it
 * is "this device does not offer that service". Mapping by name alone would
 * render a cancelled chooser as a device fault — which is the one outcome
 * `../../src/errors.ts` singles out as *"the ordinary result of pressing
 * cancel [that] must not be rendered as a fault"*.
 *
 * So the mapping is per call site, and each one is named.
 *
 * ⚠️ **The platform message never reaches the athlete.** `SECURITY.md` treats a
 * BLE error naming a device address or a nearby device's advertised name as a
 * disclosure, and Chrome's messages do both. The original is kept as `cause`,
 * where a bug report can reach it and a rendering layer cannot reach it by
 * accident — `SensorError`'s own doc comment states the rule.
 */

import { SensorError, type SensorErrorCode } from '../../src/errors';

/**
 * A `DOMException`'s `name`, read without naming `DOMException`.
 *
 * `instanceof DOMException` is false across realms — an iframe, a worker, a
 * test double — and a `catch` that relies on it silently takes the "unknown
 * error" branch for every real one. Reading the property is what works
 * everywhere, and a value that is not a string is simply not a match.
 */
function errorName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const name: unknown = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}

/** Wrap a platform failure, keeping the original reachable as `cause`. */
function wrap(
  code: SensorErrorCode,
  message: string,
  cause: unknown,
  deviceId?: string,
): SensorError {
  return new SensorError(code, message, {
    cause,
    ...(deviceId === undefined ? {} : { deviceId }),
  });
}

/**
 * `requestDevice` failed.
 *
 * | `DOMException` | Meaning here | Code |
 * |---|---|---|
 * | `NotFoundError` | the chooser closed with no choice, or nothing matched | `no-device-selected` |
 * | `SecurityError` | the Permissions Policy `bluetooth` denied it — a cross-origin iframe, by default | `not-permitted` |
 * | `NotAllowedError` | the athlete or the platform refused | `not-permitted` |
 * | `NotSupportedError` | the call exists but the platform will not serve it — Chrome on Linux without the experimental flag | `transport-unsupported` |
 * | anything else | unknown, and reported as a refusal rather than as success | `not-permitted` |
 *
 * ⚠️ `SecurityError` is *also* what Chrome raises for "must be handling a user
 * gesture". That ambiguity is why the adapter checks `navigator.userActivation`
 * **before** calling and raises `user-gesture-required` itself: distinguishing
 * the two afterwards would mean matching on the exception's message, which is
 * unversioned prose that differs between Chrome builds.
 */
export function discoveryError(error: unknown): SensorError {
  switch (errorName(error)) {
    case 'NotFoundError':
      return wrap('no-device-selected', 'the chooser closed without a device', error);
    case 'NotSupportedError':
      return wrap('transport-unsupported', 'this browser will not serve a device request', error);
    case 'SecurityError':
    case 'NotAllowedError':
      return wrap('not-permitted', 'this origin may not request a Bluetooth device', error);
    default:
      return wrap('not-permitted', 'the device request was refused', error);
  }
}

/**
 * `gatt.connect()`, or resolving services and characteristics, failed.
 *
 * Everything here becomes `not-connected`, because everything here means the
 * same thing to a caller: there is no usable link, and the recovery is to try
 * again. `NetworkError` (the link dropped or was refused), `InvalidStateError`
 * (a handle from a previous link) and `AbortError` are three routes to it.
 */
export function connectionError(error: unknown, deviceId: string): SensorError {
  return wrap('not-connected', 'the link to this device could not be established', error, deviceId);
}

/**
 * `getPrimaryService` or `getCharacteristic` did not find what a profile named.
 *
 * `capability-unsupported` rather than `not-connected`: the link is fine, the
 * device simply does not offer this. Retrying will not help and a UI that
 * offers a retry has misread the failure.
 */
export function missingProfileError(error: unknown, deviceId: string): SensorError {
  return wrap(
    'capability-unsupported',
    'this device does not offer the service this capability needs',
    error,
    deviceId,
  );
}
