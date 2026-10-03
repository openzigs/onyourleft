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
 * ## Why the fragment is mirrored into state — #945
 *
 * Until #945 this was one `useSyncExternalStore` over `hashchange`. That hook
 * is still the right answer to the "wrong time" read below, and it cannot be
 * kept, because **its updates are synchronous and never a transition** — and
 * React 19.3's `<ViewTransition>` animates only an update made inside
 * `startTransition` (or a Suspense reveal). Wrapping the routes in
 * `<ViewTransition>` over that hook animated nothing and passed every test that
 * did not count the transitions. `browser/reflow.browser.spec.ts` §"#945"
 * counts them, and its control is this file's {@link RouteUpdates}
 * `'synchronous'`, which must count none.
 *
 * So the fragment is mirrored into state, and each change is applied in one of
 * two ways, chosen by the caller per navigation:
 *
 * - **in `startTransition`**, which lets `AppShell`'s `<ViewTransition>` run;
 * - **synchronously**, for a navigation that must never animate — to or from a
 *   ride, or while a ride has the screen (`AppShell.tsx` §`mayAnimate`). A
 *   synchronous update is not in a lane React will animate, which is what makes
 *   "no snapshot over a ride control" a property of the update rather than of a
 *   class name.
 *
 * ## The "wrong time" read, kept
 *
 * The fragment is external state that can change before React has finished
 * mounting — a link clicked during hydration, or a `location.hash` set by a
 * `<script>` in the document head. The state is seeded from the address on the
 * first render, so the first paint is already the right route; and the
 * subscription reads the address once more as soon as it is made, so a change
 * between that render and the subscription is applied rather than missed.
 */

import { startTransition, useEffect, useEffectEvent, useState } from 'react';

import { matchHash, type RouteMatch } from './routes';

function currentHash(): string {
  return globalThis.location.hash;
}

/**
 * How a change of fragment reaches React — #945.
 *
 * `'transition'` is the product. `'synchronous'` applies every change outside
 * `startTransition` and exists for one reason: it is the browser gate's control
 * (`AppShellProps.routeUpdates`), the router exactly as it was before #945,
 * under which `<ViewTransition>` must start nothing.
 */
export type RouteUpdates = 'transition' | 'synchronous';

/**
 * Whether the navigation from one route to another may animate. Asked once per
 * change of fragment, with the route on screen and the route asked for.
 */
export type MayAnimate = (from: RouteMatch, to: RouteMatch) => boolean;

/**
 * The route the address bar currently selects, and what its parameter captured.
 * Re-renders when either changes.
 *
 * Returns a {@link RouteMatch} rather than a bare route since #50: the activity
 * detail view needs the id out of `#/activities/<id>`, and a hook that returned
 * only the route would push a second `location.hash` read into the component —
 * which is the "wrong time" read this hook's own note exists to avoid.
 *
 * `mayAnimate` decides, per navigation, whether the change is applied inside
 * `startTransition` (#945). Absent, nothing is: a caller that has not said a
 * navigation may animate gets none.
 */
export function useRoute(
  mayAnimate?: MayAnimate,
  updates: RouteUpdates = 'transition',
): RouteMatch {
  const [hash, setHash] = useState(currentHash);
  const apply = useEffectEvent((next: string) => {
    // ⚠️ No early return when `next` equals the rendered fragment: a
    // navigation still in its transition has not rendered yet, and going back
    // to where the screen already is must still be applied, or the pending one
    // would commit over it. Setting an equal state is a no-op otherwise.
    if (
      next !== hash &&
      updates === 'transition' &&
      mayAnimate !== undefined &&
      mayAnimate(matchHash(hash), matchHash(next))
    ) {
      startTransition(() => {
        setHash(next);
      });
    } else {
      setHash(next);
    }
  });

  useEffect(() => {
    function onChange(): void {
      apply(currentHash());
    }
    globalThis.addEventListener('hashchange', onChange);
    // A change between the first render and this subscription.
    onChange();
    return () => {
      globalThis.removeEventListener('hashchange', onChange);
    };
  }, []);

  return matchHash(hash);
}
