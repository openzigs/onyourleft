// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ShellSupport, ShellSupportPort } from './shell-support-port';

/** @see useShellSupport */
export interface ShellSupportState {
  /** `undefined` while the first read is in flight. */
  readonly support: ShellSupport | undefined;
  /**
   * Ask the plugin again.
   *
   * The two states a rider can fix are fixed **outside this app** — a
   * permission granted in Android's Settings, a radio switched on in quick
   * settings — so there is no event to wait for and the rider has to be able to
   * say "I have done it, look again". The same reason
   * `useBluetoothSupport.recheck` exists, with a different platform on the
   * other end.
   */
  readonly recheck: () => void;
}

/**
 * Read the Android shell's Bluetooth availability, once, and again on request.
 *
 * ⚠️ **The effect depends on the attempt count alone, and the port is held in a
 * ref.** `useBluetoothSupport` solves the same problem by depending on the
 * probe's *fields*; a port has no fields to depend on, only a method, so a
 * caller writing the port inline — the most natural way anyone would call this
 * — would hand a new object to every render, re-read, set state, re-render and
 * never settle. A caller cannot reasonably be expected to know that; the hook
 * can. `useShellSupport.test.tsx` rebuilds the port on every render on purpose
 * and asserts the read count.
 */
export function useShellSupport(port: ShellSupportPort): ShellSupportState {
  const [support, setSupport] = useState<ShellSupport | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(port);

  useEffect(() => {
    latest.current = port;
  }, [port]);

  useEffect(() => {
    // ⚠️ A race guard rather than politeness about unmounting — React tolerates
    // a state update on a gone tree. `recheck` can start a second read while
    // the first is still in flight, and on Android the first read is the one
    // that raises the permission dialog, so it is outstanding for as long as a
    // rider takes to read it. Without the flag the *older* answer, resolving
    // last, overwrites the newer one: the screen says the permission was
    // refused immediately after the rider granted it.
    let cancelled = false;
    setSupport(undefined);
    void latest.current.readShellSupport().then((next) => {
      if (!cancelled) {
        setSupport(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const recheck = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  return { support, recheck };
}
