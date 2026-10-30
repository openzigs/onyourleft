// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState } from 'react';

import type { InstancePort } from '../instance/instance-port';

/**
 * Where a rider's rides are, said once for every screen that says it. #1438
 * wrote it for History's footer; #1450 moved it here so that About says the
 * same sentence, because About's own copy ("there is no copy anywhere else")
 * went stale the day an instance could keep a synced ride (ADR 0036).
 */

/**
 * Whether this device has an instance — #1438. `unknown` until the port has
 * answered, and while it is, the sentence claims neither way.
 */
export type InstanceKnown = 'none' | 'connected' | 'unknown';

/**
 * The sentence about where the rides are — #1013, #1438, #1450.
 *
 * Until #1438 History said "There is no account and no server" and named "this
 * browser's site data" everywhere, and until #1450 About said "there is no copy
 * anywhere else": false inside the Android app, which has no browser, and false
 * with an instance (ADR 0036), which keeps a synced ride.
 *
 * "Nowhere else" is never said. A rider who synced and then disconnected (or
 * whose session is gone) reads as `none`, yet the instance still holds what it
 * was sent. So the sentence says only what is here and what deletes it.
 */
export function whereRidesAreText(nativeShell: boolean, instance: InstanceKnown): string {
  const lead =
    instance === 'connected'
      ? 'Rides are stored on this device, and a ride you sync is also kept on your instance.'
      : 'Rides are stored on this device.';
  const deletes = nativeShell
    ? 'Uninstalling the app, or clearing its storage in Android’s settings, deletes them from this device'
    : 'Clearing this browser’s site data deletes them from this device';
  return `${lead} ${deletes} — export anything you want to keep.`;
}

/** {@link InstanceKnown} for `port`, read once — #1438. */
export function useInstanceKnown(port: InstancePort | undefined): InstanceKnown {
  // Kept with the port it answered for, so a new port reads as unknown until it answers.
  const [answer, setAnswer] = useState<
    { readonly port: InstancePort; readonly known: InstanceKnown } | undefined
  >(undefined);
  useEffect(() => {
    if (port === undefined) return undefined;
    let cancelled = false;
    port
      .current()
      .then((state) => {
        // Signed out, unreadable or unreachable: rides synced before are still there.
        const known = state.kind === 'not-connected' ? 'none' : 'connected';
        if (!cancelled) setAnswer({ port, known });
      })
      // Deliberate: a failed read leaves the sentence on its hedged wording.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [port]);
  if (port === undefined) return 'none';
  return answer?.port === port ? answer.known : 'unknown';
}
