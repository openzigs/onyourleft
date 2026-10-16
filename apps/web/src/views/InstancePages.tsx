// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type JSX } from 'react';

import type { InstancePort } from '../instance/instance-port';

/**
 * **The instance's own pages, linked from About** (#907): where a rider — or
 * anybody they send there — reports content they think is illegal.
 *
 * The page is the instance's, not the app's: it takes a notice from anybody,
 * with or without an account or the app (DSA Art. 16(1)), so only the LINK
 * ships here, and it goes to the instance this device connected to. A device
 * connected to none shows nothing: no instance, nothing on one to report.
 *
 * The origin is the one {@link InstancePort.current} reads back. A device
 * whose session the instance no longer accepts, or that cannot reach it, is
 * still that instance's rider, and the page needs no account: it is linked
 * whenever there is an origin.
 */

/** The notice page's path on every instance (`apps/instance` §`notices.ts` `NOTICE_PAGE_PATH`). */
export const NOTICE_PAGE_PATH = '/report';

/** A page on the instance at `origin`. */
export function instancePageUrl(origin: string, path: string): string {
  return new URL(path, origin).href;
}

/** The link's own words. */
export const REPORT_LINK_TEXT = 'Report content you think is illegal';

export function InstancePages({
  instance,
}: {
  readonly instance?: InstancePort;
}): JSX.Element | null {
  const [origin, setOrigin] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void instance
      ?.current()
      .then((state) => {
        if (!cancelled && state.kind !== 'not-connected') setOrigin(state.origin);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [instance]);
  if (origin === undefined) return null;
  return (
    <div>
      <h2>Your instance</h2>
      <p>
        The instance you connected to is run by a person, who moderates it. Anybody can tell them
        about content on it that they think is illegal, with or without an account.
      </p>
      <p>
        {/* target="_blank": inside the Android shell the system browser opens it, as
          the privacy policy link above does. */}
        <a href={instancePageUrl(origin, NOTICE_PAGE_PATH)} target="_blank" rel="noreferrer">
          {REPORT_LINK_TEXT}
        </a>{' '}
        (opens in a new tab).
      </p>
    </div>
  );
}
