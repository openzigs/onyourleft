// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **When the page releases the Android launch splash** — #2051.
 *
 * Exactly once, by whichever comes first:
 *
 * 1. **The first render has painted.** {@link FirstRender} sits after the
 *    whole tree in `main.tsx`, so its effect runs once the first route has
 *    committed. A commit is not yet a frame on screen, so the release waits
 *    for two animation frames after it: the first runs before the next paint,
 *    and the second runs once that paint is done.
 * 2. **The first render failed.** An error nothing in the tree caught reaches
 *    the root's `onUncaughtError` ({@link launchRootOptions}), which releases
 *    the splash at once, so it never sits over a page that will not draw. The
 *    error is still reported as React would have reported it.
 *
 * #2050's own 3 s timeout covers what neither reaches, such as a script that
 * never ran.
 *
 * ⚠️ **Nothing here runs at module load.** Releasing the splash when the
 * script starts would show the rider the frame the splash is there to hide.
 */

import { useEffect, type ReactNode } from 'react';
import type { RootOptions } from 'react-dom/client';

import type { LaunchPort } from './launch-port';

/** The two moments the splash can be released at. */
export interface LaunchRelease {
  /** The first route has committed: release the splash two frames later. */
  readonly rendered: () => void;
  /** A render threw and nothing caught it: release the splash now. */
  readonly failed: () => void;
}

/**
 * Release `port` once, from whichever of {@link LaunchRelease}'s two calls
 * comes first. `frame` is `requestAnimationFrame` in `main.tsx`.
 */
export function launchRelease(
  port: LaunchPort,
  frame: (callback: () => void) => void,
): LaunchRelease {
  let released = false;
  // StrictMode runs a mount effect twice, and a later draw may run it again;
  // a failure may follow a release. Only the first call reaches the port.
  const release = (): void => {
    if (released) return;
    released = true;
    // The shell's timeout is the fallback, so a refusal changes nothing.
    port.releaseSplash().catch(() => undefined);
  };
  return {
    rendered: () => {
      frame(() => {
        frame(release);
      });
    },
    failed: release,
  };
}

/**
 * Calls `onRendered` once the commit it is part of has been made. Rendered
 * AFTER `AppShell`, as its sibling: a commit's effects run in tree order, so by
 * the time this one runs, every effect of the first route has run too. Draws
 * nothing.
 */
export function FirstRender({ onRendered }: { readonly onRendered: () => void }): ReactNode {
  useEffect(() => {
    onRendered();
  }, [onRendered]);
  return null;
}

/**
 * The root's options: an error no boundary caught releases the splash, then is
 * reported as React's default does (`reportError`).
 */
export function launchRootOptions(launch: LaunchRelease): RootOptions {
  return {
    onUncaughtError: (error) => {
      launch.failed();
      globalThis.reportError(error);
    },
  };
}
