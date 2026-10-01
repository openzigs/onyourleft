// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { StatusMessage } from '../design/StatusMessage';
import type { RideController } from '../ride/controller';
import { ONE_GESTURE_PER_DEVICE, PairingPanel } from '../ride/SensorPairing';
import { BluetoothSupportNotice } from '../support/BluetoothSupportNotice';
import { ShellSupportNotice } from '../support/ShellSupportNotice';
import type { CapabilityProbe } from '../support/bluetooth-support';
import type { ShellSupportPort } from '../support/shell-support-port';
import { useBluetoothSupport } from '../support/useBluetoothSupport';
import { useShellSupport } from '../support/useShellSupport';

export interface DevicesViewProps {
  /** Stable for the life of the app — see `useBluetoothSupport`. */
  readonly capabilities: CapabilityProbe;
  /**
   * The Android shell's own answer, or `undefined` in a browser (#284).
   *
   * ⚠️ **Present is the question this screen must ask.** Inside the shell the
   * BLE stack is `apps/mobile`'s Capacitor plugin, so `capabilities` — which is
   * `navigator.bluetooth` and `isSecureContext`, read from the WebView —
   * describes a stack the app does not use. It was the *only* question this
   * screen asked until #284, so a rider on Android was told "Sensors cannot be
   * paired in this browser" while the ride screen paired a trainer and drove
   * it. `main.tsx` supplies this only when `isNativeShell` is true, which is
   * the same choice it already makes for the transport.
   */
  readonly shell?: ShellSupportPort | undefined;
  /**
   * The ride controller, mounted above the router — #659. Pairing on this
   * screen is its `pair` and its `unpair`, so a device paired here is the
   * device the Ride screen shows.
   *
   * ⚠️ **Optional, and absent is a real state as well as the accessibility
   * suite's**: `main.tsx` builds no controller where this browser cannot pair,
   * and the screen then explains. Absent where the platform CAN pair is
   * today's dead end — the browser gate's control renders exactly that.
   */
  readonly controller?: RideController | undefined;
}

/**
 * The page where an athlete pairs, checks and forgets their trainer and each
 * sensor — #659.
 *
 * ## Until #659 there was deliberately no pairing button here
 *
 * #48's first criterion rejects *"a silently non-functional pairing control"*,
 * and pairing was #49's, on the Ride screen — so this page said "Not built
 * yet" and offered nothing, while Home and the More tab both sent a new rider
 * here to pair. The owner ruled (2026-09-27) that pairing lives HERE. The
 * block moved from the Ride screen to `ride/SensorPairing.tsx` §`PairingPanel`
 * and drives the same controller; it is shown only behind the same check that
 * guarded the old message — `support.canPair` — and only with a controller, so
 * #48's rule still holds: no control is rendered that cannot work.
 *
 * ## Controls first
 *
 * #654's ruling 3: where pairing works, the pairing list comes first and what
 * the platform cannot do is beneath it in a `<details>` — the support notice
 * in its can-pair state included, because that state renders no control (see
 * `SensorPairing.tsx`'s header).
 * Every OTHER state keeps its notice visible, first, as before: a radio that
 * is off or a permission not granted is the thing to read, and its *Check
 * again* must not be inside a disclosure.
 *
 * ## Two platforms, two questions, and why they are two components
 *
 * #284: inside the Android shell the honest answer comes from the plugin, not
 * from `navigator.bluetooth`. The branch is on {@link DevicesViewProps.shell}
 * rather than on a platform name, for the reason `support/capacitor.ts` gives —
 * the presence of the port *is* `main.tsx`'s `isNativeShell` decision, already
 * taken once, in the one place that may read a global.
 *
 * It is two components rather than one with a conditional because each holds a
 * hook, and a hook cannot be called behind an `if`.
 *
 * ⚠️ **The notice keeps its place in the tree across every state but the
 * pairing one.** `DevicesView.shell.a11y.test.tsx` asserts the live region's
 * node IDENTITY from "Checking" to "unanswered" (#322), so the notice is the
 * same element at the same index in both, and only the can-pair branch moves
 * it.
 */
export function DevicesView({ capabilities, shell, controller }: DevicesViewProps): JSX.Element {
  return shell === undefined ? (
    <BrowserDevices capabilities={capabilities} controller={controller} />
  ) : (
    <ShellDevices port={shell} controller={controller} />
  );
}

/** Said where the platform can pair and this build was given no controller. */
/**
 * What stays visible beside *one user gesture per device* in a browser — ADR
 * 0003 D-7 rule 5 (#659's review): the constraints of the working path are
 * not to be hidden, and a closed `<details>` is one press from hidden.
 */
const BROWSER_LIMITS: readonly string[] = [
  'There is no silent reconnect: after a reload, each device is chosen again.',
  'Recording does not continue in the background: keep this tab open and in front while you ride.',
];

/**
 * The sentences the Devices screen never tucks into its disclosure where a
 * browser can pair — #666, ADR 0003 D-7 rule 5 and CLAUDE.md §8.
 * `a11y/kept-visible.a11y.test.tsx` holds them.
 */
export const DEVICES_KEPT_VISIBLE: readonly string[] = [ONE_GESTURE_PER_DEVICE, ...BROWSER_LIMITS];

/**
 * The shell's equivalent. No background sentence: the Android shell keeps a
 * ride alive with its foreground service (#524), so saying it cannot would be
 * false there.
 */
const PHONE_LIMITS: readonly string[] = [
  'There is no silent reconnect: after the app is closed, each device is chosen again.',
];

function NoController(): JSX.Element {
  return (
    <StatusMessage tone="warning" label="Not available">
      Pairing is not available in this build of the app, so there is nothing to list.
    </StatusMessage>
  );
}

/** The Devices screen in a browser — Web Bluetooth's answer. */
function BrowserDevices({
  capabilities,
  controller,
}: {
  readonly capabilities: CapabilityProbe;
  readonly controller: RideController | undefined;
}): JSX.Element {
  const { support, recheck } = useBluetoothSupport(capabilities);
  const notice = <BluetoothSupportNotice support={support} onRecheck={recheck} />;

  if (support?.canPair === true && controller !== undefined) {
    return (
      <>
        {/* #942: a shorter gap above the garage than a section's, which pays
            for the cards' own padding — the first Pair button stays as high
            on a phone as it was before the cards (devices.browser.spec.ts). */}
        <h2 className="tw:mt-lg">Your trainer and sensors</h2>
        <PairingPanel
          controller={controller}
          summary="What this browser can and cannot do"
          limits={BROWSER_LIMITS}
        >
          {notice}
        </PairingPanel>
      </>
    );
  }

  return (
    <>
      <h2>This browser</h2>
      {notice}
      <h2>Paired sensors</h2>
      {support === undefined ? (
        // Three states, not two. `support` is `undefined` while the probe is in
        // flight, and `support?.canPair === true` collapses that into the same
        // branch as a browser that genuinely cannot pair -- so the page told the
        // athlete "Sensors cannot be paired in this browser" *while the notice
        // above it still said "Checking"*.
        <p className="oyl-muted">Waiting for the browser check to finish.</p>
      ) : support.canPair ? (
        <NoController />
      ) : (
        <p className="oyl-muted">
          Sensors cannot be paired in this browser, so there is nothing to list.
        </p>
      )}
    </>
  );
}

/**
 * The Devices screen inside the Android shell — the plugin's answer (#284).
 *
 * The browser half's three states, and the third one deliberately: `undefined`
 * is "not known yet", which is a different thing from "cannot pair". Reading
 * `support?.canPair === true` here would tell a rider their phone cannot pair
 * sensors while the notice above still said "Checking", and on Android the read
 * is the one that raises the permission dialog, so that window is as long as
 * the rider takes to answer it.
 *
 * ⚠️ **Four since #322**, because `undefined` is no longer permanent: the read
 * is bounded, so "not known yet" now has a successor that is still not a
 * verdict. `unanswered` is that successor and it needs its own sentence for
 * exactly the reason the `undefined` branch needed one.
 *
 * ⚠️ **And since #659 the can-pair state pairs**, with the Capacitor
 * transport `main.tsx` built for the same controller — it used to say
 * "Sensors are paired on the Ride screen".
 */
function ShellDevices({
  port,
  controller,
}: {
  readonly port: ShellSupportPort;
  readonly controller: RideController | undefined;
}): JSX.Element {
  const { support, recheck } = useShellSupport(port);
  const notice = <ShellSupportNotice support={support} onRecheck={recheck} />;

  if (support?.canPair === true && controller !== undefined) {
    return (
      <>
        {/* #942: a shorter gap above the garage than a section's, which pays
            for the cards' own padding — the first Pair button stays as high
            on a phone as it was before the cards (devices.browser.spec.ts). */}
        <h2 className="tw:mt-lg">Your trainer and sensors</h2>
        <PairingPanel
          controller={controller}
          summary="What this phone can and cannot do"
          limits={PHONE_LIMITS}
        >
          {notice}
        </PairingPanel>
      </>
    );
  }

  return (
    <>
      <h2>This phone</h2>
      {notice}
      <h2>Paired sensors</h2>
      {support === undefined ? (
        <p className="oyl-muted">Waiting for the check to finish.</p>
      ) : support.kind === 'unanswered' ? (
        // ⚠️ A fourth branch, and it is here because the third one would be an
        // overclaim (#322). `canPair` is false for an unanswered check, so
        // without this the screen would say "Sensors cannot be paired on this
        // phone" — a verdict — on the strength of a question that got no reply.
        <p className="oyl-muted">
          The check did not finish, so there is nothing to list. This says nothing about the sensors
          themselves.
        </p>
      ) : support.canPair ? (
        <NoController />
      ) : (
        <p className="oyl-muted">
          Sensors cannot be paired on this phone right now, so there is nothing to list.
        </p>
      )}
    </>
  );
}
