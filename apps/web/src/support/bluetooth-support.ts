// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Whether this browser can pair a sensor, and what to tell the athlete if not.
 *
 * [ADR 0003](../../../../docs/adr/0003-platform-support-matrix.md) decision D-7
 * feeds #48's first two acceptance criteria directly, and its first rule is the
 * one this file exists to keep: **detect capability, never the user agent.**
 *
 * ## Why there are six answers and not two
 *
 * "Supported / unsupported" would collapse five different situations, each with
 * a different thing for the athlete to do, into one message that is wrong for
 * four of them:
 *
 * | Kind | Cause | What the athlete can do |
 * |---|---|---|
 * | `available` | Chrome-family on Android, Chrome OS, macOS or Windows | Pair |
 * | `adapter-unavailable` | Everything works, the radio is off | Turn Bluetooth on and retry |
 * | `not-permitted` | A Permissions Policy refusal, e.g. a cross-origin frame | Open the app directly |
 * | `insecure-context` | Served over plain HTTP, so the API is withheld | Use HTTPS or localhost |
 * | `absent` | Safari and Firefox, on every platform, permanently | Nothing. Use another browser, or wait for #15 |
 * | `incomplete` | Chrome on Linux without the flag; any partial implementation | Enable the flag, kernel 3.19+, BlueZ 5.41+ |
 *
 * The two that matter most are the last two, and they are the two a naive
 * `'bluetooth' in navigator` check cannot tell apart. On Linux
 * `navigator.bluetooth` **is present while the adapter is unusable**, so a
 * presence test reports "supported" and the athlete meets the failure at the
 * chooser instead — and `insecure-context` otherwise masquerades as `absent`,
 * telling a contributor on `http://192.168.1.5:5173` that their Chrome has no
 * Web Bluetooth.
 *
 * ## The probing is not ours
 *
 * `readAvailability` comes from `@onyourleft/sensors/web-bluetooth`, where #40
 * already solved this and where the four unusable cases are enumerated.
 * Re-deriving them here would be a second answer to the same question that could
 * disagree with the transport the pairing button actually uses — and the first
 * draft of this file did exactly that, adding an `isUsableBluetooth` check that
 * a mutation showed to be dead because `readAvailability` performs it already.
 * What this file adds is the **distinction the
 * transport does not need and the UI does**: the transport treats absent,
 * partial and throwing as one `unsupported`, because for its purposes they are.
 * For a message to a human they are not.
 *
 * ## There is no user agent in this module, by construction
 *
 * {@link readBluetoothSupport} takes a {@link CapabilityProbe}, and a
 * `CapabilityProbe` has no user-agent field to read. `bluetooth-support.test.ts`
 * proves the behaviour rather than the shape: a probe carrying a working
 * `bluetooth` object resolves to `available` whatever the browser calls itself,
 * and a probe carrying none never does.
 */

import type { TransportAvailability } from '@onyourleft/sensors';
import type { BluetoothPort } from '@onyourleft/sensors/web-bluetooth';
import { readAvailability } from '@onyourleft/sensors/web-bluetooth';

/** @see BluetoothSupport */
export type BluetoothSupportKind =
  | 'available'
  | 'adapter-unavailable'
  | 'not-permitted'
  | 'insecure-context'
  | 'absent'
  | 'incomplete';

/** What this browser can do, and whether asking again could change the answer. */
export interface BluetoothSupport {
  readonly kind: BluetoothSupportKind;
  /**
   * Whether a pairing control may be offered at all.
   *
   * `false` means **do not render one**, not "render it disabled". #48's first
   * criterion is explicit that a control which cannot work fails the criterion
   * even when it is disabled: a disabled button is removed from the tab order
   * and announces no reason, so it is the silent failure with extra steps.
   */
  readonly canPair: boolean;
  /**
   * Whether retrying could succeed without the athlete changing browser.
   *
   * `false` for `absent` — Safari's and Firefox's vendors have published formal
   * positions against the API (ADR 0003), so a "try again" here would be a lie
   * with a button on it.
   */
  readonly recoverable: boolean;
}

/**
 * What this module needs to know about the browser.
 *
 * Two fields, both capabilities. Built by {@link probeBrowser}, which is the
 * only function in the client that reads these globals, and passed in
 * everywhere else so that every state above is reachable from a test.
 */
export interface CapabilityProbe {
  /** `navigator.bluetooth`, or `undefined` where the browser exposes none. */
  readonly bluetooth: BluetoothPort | undefined;
  /**
   * `window.isSecureContext`.
   *
   * Web Bluetooth is withheld entirely outside a secure context, so this has to
   * be read *before* concluding anything from the absence of the object.
   */
  readonly secureContext: boolean;
}

const SUPPORT: Record<BluetoothSupportKind, BluetoothSupport> = {
  available: { kind: 'available', canPair: true, recoverable: true },
  'adapter-unavailable': { kind: 'adapter-unavailable', canPair: false, recoverable: true },
  'not-permitted': { kind: 'not-permitted', canPair: false, recoverable: true },
  'insecure-context': { kind: 'insecure-context', canPair: false, recoverable: true },
  absent: { kind: 'absent', canPair: false, recoverable: false },
  incomplete: { kind: 'incomplete', canPair: false, recoverable: true },
};

/**
 * Read the browser's own globals into a {@link CapabilityProbe}.
 *
 * `navigator.bluetooth` is not in this package's TypeScript library — `apps/web`
 * declares `lib: ["ES2024", "DOM", "DOM.Iterable"]` and the Web Bluetooth types
 * are a separate package that only `packages/sensors/web-bluetooth` installs.
 * That is the right place for them, so the read here is narrowed by hand to the
 * one property, against the structural port `#40` already defines.
 */
export function probeBrowser(): CapabilityProbe {
  const candidate = (navigator as unknown as { bluetooth?: BluetoothPort }).bluetooth;
  return {
    bluetooth: candidate,
    secureContext: globalThis.isSecureContext,
  };
}

/**
 * Classify what this browser can do. Never rejects.
 *
 * The order of the checks is the order of the causes: an insecure context
 * removes the object, so it has to be ruled out before the object's absence can
 * be read as "this browser does not implement the API".
 */
export async function readBluetoothSupport(probe: CapabilityProbe): Promise<BluetoothSupport> {
  if (probe.bluetooth === undefined) {
    return probe.secureContext ? SUPPORT.absent : SUPPORT['insecure-context'];
  }
  // No `isUsableBluetooth` check here, deliberately. The obvious version of
  // this function had one, and mutation testing found it to be dead: neutering
  // it changed no test result, because `readAvailability` runs the same check
  // first and answers `unsupported` when it fails. Two guards that cannot
  // disagree are one guard and one thing to keep in step.
  return supportFor(await readAvailability(probe.bluetooth));
}

/**
 * The transport's four-way answer, mapped onto this module's six.
 *
 * Separate and exported so that every branch is reachable from a test.
 * `not-permitted` is the reason: `readAvailability` cannot currently produce
 * it — Web Bluetooth exposes no queryable permission, so #40 only learns of a
 * Permissions Policy refusal when `requestDevice` rejects — but
 * `TransportAvailability` declares it, so a total mapping has to handle it, and
 * an untestable branch inside an `async` function is how a wrong mapping
 * survives. When #49 wires the chooser and the refusal becomes observable, this
 * function is already right.
 */
export function supportFor(availability: TransportAvailability): BluetoothSupport {
  switch (availability.kind) {
    case 'available':
      return SUPPORT.available;
    case 'adapter-unavailable':
      return SUPPORT['adapter-unavailable'];
    case 'not-permitted':
      return SUPPORT['not-permitted'];
    case 'unsupported':
      // Reached two ways and they are the same cause: the object is present
      // with a method missing, or `getAvailability()` throws one layer in. Both
      // are a partial implementation, which is Chrome on Linux without the
      // flag, and both get the same actionable message.
      return SUPPORT.incomplete;
  }
}
