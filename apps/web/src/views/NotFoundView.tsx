// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import { StatusMessage } from '../design/StatusMessage';
import { hrefFor, ROUTES } from '../shell/routes';

/**
 * The page for an address that matches nothing.
 *
 * It gets a heading, an explanation and a list of every page that does exist,
 * for the same reason the empty states do: the default here is a blank document
 * with the header still on it, which reads as a broken app and gives a keyboard
 * user nothing to move to.
 */
export function NotFoundView(): JSX.Element {
  return (
    <>
      <StatusMessage tone="warning" label="No such page">
        Check the address, or pick a page below.
      </StatusMessage>
      <ul>
        {ROUTES.map((route) => (
          <li key={route.id}>
            <a href={hrefFor(route)}>{route.title}</a> — {route.summary}
          </li>
        ))}
      </ul>
    </>
  );
}
