// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { StatusMessage } from '../design/StatusMessage';
import { BluetoothSupportNotice } from '../support/BluetoothSupportNotice';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { useBluetoothSupport } from '../support/useBluetoothSupport';

export interface DevicesViewProps {
  /** Stable for the life of the app — see `useBluetoothSupport`. */
  readonly capabilities: CapabilityProbe;
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
 */
export function DevicesView({ capabilities }: DevicesViewProps): JSX.Element {
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
