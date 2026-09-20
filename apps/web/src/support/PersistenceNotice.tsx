// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a rider is told about whether this browser may throw their rides away
 * (#409).
 *
 * ## Both halves, always
 *
 * #409's criterion: *"the text says what persistence does **and does not**
 * protect against … a test asserts both halves by string, so the reassuring
 * half cannot ship without the honest half."* So every branch below names
 * automatic eviction **and** says that clearing site data still removes
 * everything, and `PersistenceNotice.a11y.test.tsx` asserts each by string.
 *
 * ⚠️ **No coordinate, no ride and no athlete identifier appears in any of
 * it.** ADR 0004 decision D binds every layer that formats a coordinate into a
 * string, a toast and a settings panel included; there is nothing here for it
 * to bind, and that is the point — this screen talks about *storage*, never
 * about what is in it.
 *
 * ## Why the state is read here and the request is made in `main.tsx`
 *
 * Reading is idempotent and safe on every render; **asking** is not, and
 * ADR 0024 D-5 puts the request at the moment the app is installed rather than
 * at the moment a rider opens Settings. A panel that asked would ask again on
 * every visit to the screen, which is the loop `requestPersistenceOnce` exists
 * to prevent.
 */

import { useEffect, useState, type JSX } from 'react';

import { StatusMessage, type StatusTone } from '../design/StatusMessage';

import {
  readPersistence,
  type PersistenceState,
  type StorageManagerLike,
} from './persistent-storage';

/** The sentence that is true in every branch, and may never be dropped. */
export const CLEARING_STILL_REMOVES =
  'Clearing this browser’s site data still removes your rides, and there is no copy anywhere ' +
  'else — export them if you want one.';

export const PERSISTENT_TEXT =
  'This browser has marked your rides as persistent, so it will not remove them automatically ' +
  'when it is short of space.';

export const BEST_EFFORT_TEXT =
  'This browser has not marked your rides as persistent, so it may remove them automatically ' +
  'when it is short of space. Installing the app makes that permission more likely to be ' +
  'granted.';

export const UNSUPPORTED_TEXT =
  'This browser does not say whether it will remove your rides automatically when it is short ' +
  'of space.';

const TEXT: Record<PersistenceState, string> = {
  persistent: PERSISTENT_TEXT,
  'best-effort': BEST_EFFORT_TEXT,
  unsupported: UNSUPPORTED_TEXT,
};

const TONE: Record<PersistenceState, StatusTone> = {
  persistent: 'success',
  // ⚠️ `warning` rather than `danger`: nothing is wrong, and a browser that has
  // not granted persistence is the ordinary state on a first visit. Overstating
  // it is how a rider learns to ignore this panel.
  'best-effort': 'warning',
  unsupported: 'info',
};

const LABEL: Record<PersistenceState, string> = {
  persistent: 'Protected',
  'best-effort': 'Not protected',
  unsupported: 'Unknown',
};

export interface PersistenceNoticeProps {
  /**
   * `navigator.storage`, or `undefined`.
   *
   * Passed in rather than read from a global inside the tree, for the reason
   * every port in this client is: no test machine can be a browser with the
   * Storage API, one without it, and one whose `persisted()` throws.
   */
  readonly storage?: StorageManagerLike | undefined;
}

export function PersistenceNotice({ storage }: PersistenceNoticeProps): JSX.Element {
  const [state, setState] = useState<PersistenceState | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void readPersistence(storage).then((answer) => {
      if (live) {
        setState(answer);
      }
    });
    return () => {
      live = false;
    };
  }, [storage]);

  // Before the probe answers there is nothing honest to say, and a guess would
  // be the one thing this panel must not do.
  const settled: PersistenceState = state ?? 'unsupported';

  return (
    <section className="oyl-panel" aria-labelledby="oyl-persistence-heading">
      <h2 id="oyl-persistence-heading">Storage</h2>
      <StatusMessage tone={TONE[settled]} label={LABEL[settled]}>
        {TEXT[settled]}
      </StatusMessage>
      <p className="oyl-muted">{CLEARING_STILL_REMOVES}</p>
    </section>
  );
}
