// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useState, type JSX } from 'react';

import type { InstancePort } from '../instance/instance-port';

/**
 * **The instance's own pages, linked from About** (#907, #908): where a
 * rider — or anybody they send there — reports content they think is
 * illegal, and the instance's legal and contact page, which names whom to
 * write to and who is accountable, from its operator's own settings.
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

/** The legal and contact page's path on every instance (`apps/instance` §`legal.ts` `LEGAL_PAGE_PATH`). */
export const LEGAL_PAGE_PATH = '/legal';

/** The links' own words. */
export const REPORT_LINK_TEXT = 'Report content you think is illegal';
export const LEGAL_LINK_TEXT = 'Who runs it, and how to contact them';

/** The terms page's path on every instance (`apps/instance` §`terms.ts` `TERMS_PAGE_PATH`, #909). */
export const TERMS_PAGE_PATH = '/terms';
export const TERMS_LINK_TEXT = 'Its terms of service';

/**
 * #1381: the notice page's link where a screen names something to report —
 * a room's references and a race result's, after the identifiers to copy. In
 * About's words, to the page About links to.
 */
export function NoticePageLink({ href }: { readonly href: string }): JSX.Element {
  return (
    <p>
      <a href={href} target="_blank" rel="noreferrer">
        {REPORT_LINK_TEXT}
      </a>{' '}
      (opens in a new tab).
    </p>
  );
}

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
      <p>
        <a href={instancePageUrl(origin, LEGAL_PAGE_PATH)} target="_blank" rel="noreferrer">
          {LEGAL_LINK_TEXT}
        </a>{' '}
        (opens in a new tab).
      </p>
      <p>
        <a href={instancePageUrl(origin, TERMS_PAGE_PATH)} target="_blank" rel="noreferrer">
          {TERMS_LINK_TEXT}
        </a>{' '}
        (opens in a new tab).
      </p>
    </div>
  );
}
