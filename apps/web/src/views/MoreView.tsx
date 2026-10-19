// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The More tab's page — #1429: a menu of every page under the tab.
 *
 * Each entry is the page's own navigation label as a link, and the page's own
 * one line beside it, both read from `shell/routes.ts` — so the menu cannot
 * name a page differently from the section row or the page's own title line,
 * and a link always goes to the page it names. `routes.ts` §`moreMenuRoutes`
 * says which pages and in what order.
 */

import type { JSX } from 'react';

import { hrefFor, moreMenuRoutes } from '../shell/routes';

export function MoreView(): JSX.Element {
  return (
    <ul className="oyl-more">
      {moreMenuRoutes().map((route) => (
        <li key={route.id}>
          <a href={hrefFor(route)} aria-describedby={`oyl-more-${route.id}`}>
            {route.navLabel}
          </a>
          <p id={`oyl-more-${route.id}`} className="oyl-muted">
            {route.summary}
          </p>
        </li>
      ))}
    </ul>
  );
}
