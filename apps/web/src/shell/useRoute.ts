// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The whole router, which is one subscription to `hashchange`.
 *
 * No routing library. `routes.ts` records why the routing is hash-based; the
 * consequence here is that the browser already does the navigating, so there is
 * nothing left for a router to do beyond telling React that the fragment moved.
 * `react-router` is listed in ADR 0005 and is not installed
 * (CLAUDE.md §4b); adding it to render four static views would be a dependency,
 * a licence check and a lockfile entry in exchange for the twenty lines below.
 * The decision is recorded in the pull request for #48 and is a cheap one to
 * reverse — `useRoute()` is the only thing the shell imports.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the fragment is
 * external state that can change before React has finished mounting — a link
 * clicked during hydration, or a `location.hash` set by a `<script>` in the
 * document head — and the effect version reads it one render too late and
 * renders the previous route first. That is the "wrong time" variant of a read
 * that cannot see a write, and this hook is the API that exists to avoid it.
 */

import { useSyncExternalStore } from 'react';

import { matchHash, type RouteMatch } from './routes';

function subscribe(onChange: () => void): () => void {
  globalThis.addEventListener('hashchange', onChange);
  return () => {
    globalThis.removeEventListener('hashchange', onChange);
  };
}

function currentHash(): string {
  return globalThis.location.hash;
}

/**
 * The route the address bar currently selects, and what its parameter captured.
 * Re-renders when either changes.
 *
 * Returns a {@link RouteMatch} rather than a bare route since #50: the activity
 * detail view needs the id out of `#/activities/<id>`, and a hook that returned
 * only the route would push a second `location.hash` read into the component —
 * which is the "wrong time" read this hook's own note exists to avoid.
 */
export function useRoute(): RouteMatch {
  const hash = useSyncExternalStore(subscribe, currentHash, currentHash);
  return matchHash(hash);
}
