// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The More tab's page — #1429: a menu of every page under the tab.
 *
 * Each entry is the page's own navigation label as a link, and the page's own
 * one line beside it, both read from `shell/routes.ts` — so the menu cannot
 * name a page differently from the section row or the page's own title line,
 * and a link always goes to the page it names. `routes.ts` §`moreMenuRoutes`
 * says which pages and in what order.
 *
 * **Except the Instance line once this device holds a connection** (#2859):
 * it said "Sign in to an instance with this device" on a connected tablet, as
 * Settings' card did before #2756. It now says what Settings says, in the
 * wording the owner approved there: connected, the server's address and the
 * rider's name as the instance answered them; holding a sign-in the instance
 * did not answer as connected, that the server is not answering. With nothing
 * connected, or before the port answers, it is the route's own line.
 */

import type { JSX } from 'react';

import type { InstancePort, InstanceState } from '../instance/instance-port';
import { hrefFor, moreMenuRoutes, type RouteDefinition } from '../shell/routes';
import { useInstanceState } from './SettingsView';

/** The Instance line for a device that holds a connection, or `undefined` for the route's own. */
export function instanceLine(state: InstanceState | undefined): string | undefined {
  switch (state?.kind) {
    case 'connected':
      return `Connected to your server at ${state.origin} as ${state.displayName}.`;
    case 'signed-out':
    case 'unreadable':
    case 'unreachable':
      return `Your server at ${state.origin} is not answering right now.`;
    default:
      return undefined;
  }
}

export function MoreView({
  instance,
}: {
  readonly instance?: InstancePort | undefined;
}): JSX.Element {
  const state = useInstanceState(instance);
  const summary = (route: RouteDefinition): string =>
    (route.id === 'instance' ? instanceLine(state) : undefined) ?? route.summary;
  return (
    // #2067: a screen of sections, one page to a cell, in rows on a tablet.
    <ul className="oyl-more oyl-sections">
      {moreMenuRoutes().map((route) => (
        <li key={route.id}>
          <a href={hrefFor(route)} aria-describedby={`oyl-more-${route.id}`}>
            {route.navLabel}
          </a>
          <p id={`oyl-more-${route.id}`} className="oyl-muted">
            {summary(route)}
          </p>
        </li>
      ))}
    </ul>
  );
}
