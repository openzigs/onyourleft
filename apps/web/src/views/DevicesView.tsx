// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { StatusMessage } from '../design/StatusMessage';
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
}

/**
 * The page where an athlete finds out whether this browser can pair a sensor.
 *
 * ## There is deliberately no pairing button here
 *
 * #48's first acceptance criterion says a *"silently non-functional pairing
 * control fails this criterion"*, and the issue's own guidance adds that this
 * holds *"even if the button is disabled"*. Pairing is
 * [#49](https://github.com/openzigs/onyourleft/issues/49), which is explicitly
 * not in this change. A button rendered here now would be exactly the control
 * the criterion rejects — it would look like the way in, do nothing, and leave
 * the reason in a console nobody opens.
 *
 * So the page says what it can honestly say: whether the browser is capable,
 * what to do if it is not, and that the pairing flow itself is still to come.
 * When #49 lands, the button goes where the second `StatusMessage` is, behind
 * the same `support.canPair` check that guards it now.
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
 * hook, and a hook cannot be called behind an `if`. That is a React rule and
 * not a preference, and it is worth the extra function: the browser half below
 * is byte-for-byte what it was, which is #284's third acceptance criterion
 * (`DevicesView.test.tsx` is untouched by that change).
 */
export function DevicesView({ capabilities, shell }: DevicesViewProps): JSX.Element {
  return shell === undefined ? (
    <BrowserDevices capabilities={capabilities} />
  ) : (
    <ShellDevices port={shell} />
  );
}

/** The Devices screen in a browser — Web Bluetooth's answer, unchanged. */
function BrowserDevices({ capabilities }: { readonly capabilities: CapabilityProbe }): JSX.Element {
  const { support, recheck } = useBluetoothSupport(capabilities);

  return (
    <>
      <h2>This browser</h2>
      <BluetoothSupportNotice support={support} onRecheck={recheck} />

      <h2>Paired sensors</h2>
      {support === undefined ? (
        // Three states, not two. `support` is `undefined` while the probe is in
        // flight, and `support?.canPair === true` collapses that into the same
        // branch as a browser that genuinely cannot pair -- so the page told the
        // athlete "Sensors cannot be paired in this browser" *while the notice
        // above it still said "Checking"*. A contradiction on screen is bad; a
        // false negative delivered before the answer is known is worse, because
        // criterion 1 of this issue exists to stop exactly that kind of
        // dishonesty about what the browser can do.
        <p className="oyl-muted">Waiting for the browser check to finish.</p>
      ) : support.canPair ? (
        <StatusMessage tone="info" label="Not built yet">
          Nothing is paired. Choosing and connecting a sensor is the next change; this page reports
          what the browser can do so that it never offers a control that cannot work.
        </StatusMessage>
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
 */
function ShellDevices({ port }: { readonly port: ShellSupportPort }): JSX.Element {
  const { support, recheck } = useShellSupport(port);

  return (
    <>
      <h2>This phone</h2>
      <ShellSupportNotice support={support} onRecheck={recheck} />

      <h2>Paired sensors</h2>
      {support === undefined ? (
        <p className="oyl-muted">Waiting for the check to finish.</p>
      ) : support.kind === 'unanswered' ? (
        // ⚠️ A fourth branch, and it is here because the third one would be an
        // overclaim (#322). `canPair` is false for an unanswered check, so
        // without this the screen would say "Sensors cannot be paired on this
        // phone" — a verdict — on the strength of a question that got no reply.
        // That is the same dishonesty the `undefined` branch above exists to
        // avoid, one state further along.
        <p className="oyl-muted">
          The check did not finish, so there is nothing to list. This says nothing about the sensors
          themselves.
        </p>
      ) : support.canPair ? (
        <StatusMessage tone="info" label="Not listed here">
          Sensors are paired on the Ride screen, where the recording that needs them is. This page
          reports what this phone can do, so that it never offers a control that cannot work.
        </StatusMessage>
      ) : (
        <p className="oyl-muted">
          Sensors cannot be paired on this phone right now, so there is nothing to list.
        </p>
      )}
    </>
  );
}
