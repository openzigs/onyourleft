// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useState } from 'react';

import {
  readBluetoothSupport,
  type BluetoothSupport,
  type CapabilityProbe,
} from './bluetooth-support';

/** @see useBluetoothSupport */
export interface BluetoothSupportState {
  /** `undefined` while the first probe is in flight. */
  readonly support: BluetoothSupport | undefined;
  /**
   * Ask the platform again.
   *
   * Three of the six states are recoverable without changing browser — the
   * radio is off, the page is framed, the context is insecure — and each of
   * them is fixed *outside* the page, so there is no event to wait for and the
   * athlete has to be able to say "I have done it, look again". Web Bluetooth's
   * `availabilitychanged` event covers only the radio, and only where the
   * implementation is complete enough to fire it, which is exactly not the
   * cases that need it most.
   */
  readonly recheck: () => void;
}

/**
 * Probe the browser's Bluetooth capability, once, and again on request.
 *
 * ⚠️ The effect depends on the probe's **fields**, not on the probe object.
 * That is deliberate and it is not a style choice: depending on the object
 * would make a `probeBrowser()` written inline in JSX — the most natural way
 * anyone would call this — produce a new dependency on every render, so the
 * effect would re-run, set state, re-render, and never settle. A caller cannot
 * reasonably be expected to know that; the hook can. `navigator.bluetooth` is
 * the same object on every read, so the fields are stable even when the wrapper
 * is not.
 */
export function useBluetoothSupport(probe: CapabilityProbe): BluetoothSupportState {
  const [support, setSupport] = useState<BluetoothSupport | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const { bluetooth, secureContext } = probe;

  useEffect(() => {
    // ⚠️ This flag is not politeness about unmounting — React tolerates a
    // state update on a gone tree. It is a **race guard**, and the race is
    // reachable: `recheck` starts a second probe while the first is still in
    // flight, and `getAvailability()` on a cold adapter takes long enough for
    // the two to cross. Without the flag the *older* answer, resolving last,
    // overwrites the newer one, and the page tells the athlete Bluetooth is off
    // immediately after it came back on. `useBluetoothSupport.test.tsx`
    // resolves them out of order on purpose.
    let cancelled = false;
    setSupport(undefined);
    void readBluetoothSupport({ bluetooth, secureContext }).then((next) => {
      if (!cancelled) {
        setSupport(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bluetooth, secureContext, attempt]);

  const recheck = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  return { support, recheck };
}
