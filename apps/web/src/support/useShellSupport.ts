// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Seconds } from '@onyourleft/domain';

import { SHELL_ANSWER_TIMEOUT, UNANSWERED_SHELL_SUPPORT } from './shell-support';
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
   *
   * ⚠️ Since #322 there is a third state it is for, and it is the one where the
   * button is doing the most work: the plugin never answered, so there is
   * nothing for the rider to have fixed and pressing this is the whole of the
   * recovery.
   */
  readonly recheck: () => void;
}

/**
 * Run `callback` after `after` seconds, and return a way to cancel it.
 *
 * Injected everywhere below so a test can miss a deadline immediately rather
 * than waiting ten real seconds for one — the shape `createGattQueue` uses in
 * `packages/sensors/web-bluetooth`, and for the same reason: a deadline a test
 * fires by hand is a decision the test makes rather than a race it wins.
 */
export type Schedule = (callback: () => void, after: Seconds) => () => void;

/** Subscribe to the screen coming back. Returns an unsubscribe. */
export type ScreenReturn = (listener: () => void) => () => void;

/** @see useShellSupport */
export interface ShellSupportOptions {
  /** Defaults to {@link SHELL_ANSWER_TIMEOUT}. */
  readonly answerWithin?: Seconds | undefined;
  /** Defaults to `setTimeout`. */
  readonly schedule?: Schedule | undefined;
  /** Defaults to the document's own `visibilitychange`. */
  readonly onScreenReturn?: ScreenReturn | undefined;
}

function browserSchedule(callback: () => void, after: Seconds): () => void {
  const handle = setTimeout(callback, after * 1000);
  return () => {
    clearTimeout(handle);
  };
}

/**
 * The screen coming back, as the document reports it.
 *
 * ⚠️ `visibilitychange` rather than `focus` or `pageshow`, because it is the
 * one a Capacitor WebView actually gets when the Android activity is stopped
 * and started again — which is #322's observed trigger, *"the activity being
 * stopped and restarted after the device slept"*. The guard on
 * `visibilityState` is what makes it a **return** rather than an event pair:
 * the same event fires on the way out, and re-reading the plugin as the rider
 * leaves is work nobody asked for and an answer nobody will see.
 */
function documentScreenReturn(listener: () => void): () => void {
  // ⚠️ No `typeof document === 'undefined'` guard, deliberately. This client
  // does not server-render and this function is only ever reached from an
  // effect, which does not run without a DOM — so the guard would be a line no
  // mutation could turn red, which CLAUDE.md §5 treats as worse than absent.
  // `transport.ts` §`knownDevices` declines an unreachable guard for the same
  // reason and writes down what would make it reachable; here it is a build
  // that renders this tree on a server, which is #7's question and not one this
  // milestone has.
  const handler = (): void => {
    if (document.visibilityState === 'visible') {
      listener();
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
  };
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
 * and asserts the read count. {@link ShellSupportOptions} is held the same way
 * and for the same reason.
 *
 * ## The bound, and why it is here rather than in the port (#322)
 *
 * On a device that had slept, `BluetoothLe.initialize` was called and never
 * called back — the plugin threw inside its own permission callback and
 * resolved nothing — so this hook's `support` stayed `undefined` for ever and
 * the screen held "Checking" at 45 s with no way forward. Three properties are
 * wanted and no two of them fit in the same place:
 *
 * 1. **A deadline**, so the screen stops claiming to be working on it.
 *    {@link SHELL_ANSWER_TIMEOUT}.
 * 2. **A late answer still wins.** The first `initialize()` on Android is the
 *    call that raises the runtime permission dialog, and it does not resolve
 *    until the rider answers it — a rider reading that dialog is not a hang.
 *    So the read is *not* abandoned at the deadline; only the screen moves on,
 *    and the real answer replaces the message when it arrives. This is what
 *    lets the deadline be short enough to be useful.
 * 3. **The bound survives the lifecycle**, which a timer does not. A
 *    `setTimeout` armed before the activity stops is throttled or suspended
 *    while the device sleeps, so the deadline that was supposed to rescue the
 *    screen is itself asleep beside it. The answer is not a longer timer: the
 *    check is **re-run when the screen comes back**, which is an event rather
 *    than an elapsed time and is therefore immune to the clock having stopped.
 *
 * A promise can carry (1). Only a component can carry (2) and (3), which is why
 * `ShellSupportPort.readShellSupport` is deliberately left unbounded.
 */
export function useShellSupport(
  port: ShellSupportPort,
  options: ShellSupportOptions = {},
): ShellSupportState {
  const [support, setSupport] = useState<ShellSupport | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(port);
  const settings = useRef(options);
  /**
   * What was last delivered, readable from an event listener.
   *
   * The `support` state cannot be: the screen-return listener is subscribed
   * once, so it would close over the state as it was on the first render and
   * decide whether to re-check from an answer several minutes stale.
   */
  const delivered = useRef<ShellSupport | undefined>(undefined);

  useEffect(() => {
    latest.current = port;
  });

  useEffect(() => {
    settings.current = options;
  });

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
    delivered.current = undefined;

    const deliver = (next: ShellSupport): void => {
      if (cancelled) {
        return;
      }
      delivered.current = next;
      setSupport(next);
    };

    const cancelDeadline = (settings.current.schedule ?? browserSchedule)(() => {
      deliver(UNANSWERED_SHELL_SUPPORT);
    }, settings.current.answerWithin ?? SHELL_ANSWER_TIMEOUT);

    void latest.current.readShellSupport().then((next) => {
      // ⚠️ No check on whether the deadline already fired. An answer that
      // arrives late is still the truth, and overwriting "this phone has not
      // answered" with it is the whole of property (2) above — without this
      // line a rider who took eleven seconds over Android's permission dialog
      // would be told their phone was unresponsive and left there.
      cancelDeadline();
      deliver(next);
    });

    return () => {
      cancelled = true;
      cancelDeadline();
    };
  }, [attempt]);

  const recheck = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  useEffect(() => {
    const subscribe = settings.current.onScreenReturn ?? documentScreenReturn;
    return subscribe(() => {
      // Only where there is nothing to lose. A settled answer is not re-read on
      // every return to the app: on Android the read is the call that can raise
      // the permission dialog, and a rider who has already been told their
      // radio is off does not want to be asked again every time they glance at
      // their phone. What is re-read is a check that never finished and a
      // deadline that already gave up on one — the two states #322 leaves a
      // rider stranded in.
      const last = delivered.current;
      if (last === undefined || last.kind === 'unanswered') {
        setAttempt((previous) => previous + 1);
      }
    });
  }, []);

  return { support, recheck };
}
