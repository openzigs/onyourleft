// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The page releases the Android launch splash once its first route has
 * painted, or at once when the first render throws — #2051.
 *
 * Rendered through React's own root, with the root options and the
 * `FirstRender` sibling `main.tsx` uses, against a fake port and a frame
 * clock the test advances by hand. What the port was told is read off the
 * fake, and what was on screen when it was told is read off the DOM.
 */

import { act, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstRender, launchRelease, launchRootOptions } from './launch';
import { NO_LAUNCH, type LaunchPort } from './launch-port';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A frame clock: callbacks wait until the test runs the next frame. */
function frames(): { frame: (callback: () => void) => void; next: () => void } {
  let queue: (() => void)[] = [];
  return {
    frame: (callback) => {
      queue.push(callback);
    },
    next: () => {
      const due = queue;
      queue = [];
      for (const callback of due) callback();
    },
  };
}

/** A port that records what was on screen each time it was told. */
function fakePort(container: HTMLElement): LaunchPort & { readonly seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    releaseSplash: () => {
      seen.push(container.textContent);
      return Promise.resolve();
    },
  };
}

function Home(): ReactNode {
  return <h1>Home</h1>;
}

let container: HTMLElement;
let root: Root | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  container.remove();
});

describe('releasing the launch splash after the first route has painted (#2051)', () => {
  it('waits for the first render and two frames after it, then asks once', () => {
    const clock = frames();
    const port = fakePort(container);
    const launch = launchRelease(port, clock.frame);
    // Nothing is released when the script starts.
    clock.next();
    expect(port.seen).toEqual([]);

    root = createRoot(container, launchRootOptions(launch));
    const draw = (): void => {
      act(() => {
        root?.render(
          <StrictMode>
            <Home />
            <FirstRender onRendered={launch.rendered} />
          </StrictMode>,
        );
      });
    };
    draw();
    // Committed, but no frame has run since.
    expect(container.textContent).toBe('Home');
    expect(port.seen).toEqual([]);
    clock.next();
    expect(port.seen).toEqual([]);
    clock.next();
    expect(port.seen).toEqual(['Home']);

    // The tree drawn again (main.tsx draws once more with the update watcher),
    // and more frames: still once.
    draw();
    clock.next();
    clock.next();
    clock.next();
    expect(port.seen).toEqual(['Home']);
  });

  it('runs after every effect of the route it follows', () => {
    const clock = frames();
    const order: string[] = [];
    const launch = launchRelease(
      {
        releaseSplash: () => {
          order.push('ready');
          return Promise.resolve();
        },
      },
      (callback) => {
        order.push('frame asked');
        clock.frame(callback);
      },
    );
    function Route(): ReactNode {
      useEffect(() => {
        order.push('route effect');
      }, []);
      return <p>Route</p>;
    }
    root = createRoot(container, launchRootOptions(launch));
    act(() => {
      root?.render(
        <>
          <Route />
          <FirstRender onRendered={launch.rendered} />
        </>,
      );
    });
    clock.next();
    clock.next();
    expect(order).toEqual(['route effect', 'frame asked', 'frame asked', 'ready']);
  });

  it('asks at once when the first render throws, and the error is still reported', async () => {
    const clock = frames();
    const port = fakePort(container);
    const launch = launchRelease(port, clock.frame);
    const failure = new Error('the first route could not render');
    const reported: unknown[] = [];
    // React's default for an uncaught error is `reportError`, which the
    // WebView has and jsdom does not: stood in for, and read back.
    vi.stubGlobal('reportError', (error: unknown) => {
      reported.push(error);
    });
    function Broken(): ReactNode {
      throw failure;
    }
    // ⚠️ Outside `act`, as `main.tsx` renders: inside it React 19 hands an
    // uncaught error to `act` to rethrow and never calls the root's
    // `onUncaughtError`, so the path under test would not run at all.
    const environment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    environment.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      root = createRoot(container, launchRootOptions(launch));
      root.render(
        <StrictMode>
          <Broken />
          <FirstRender onRendered={launch.rendered} />
        </StrictMode>,
      );
      await vi.waitFor(() => {
        expect(reported).toEqual([failure]);
      });
    } finally {
      vi.unstubAllGlobals();
      environment.IS_REACT_ACT_ENVIRONMENT = true;
    }
    // Before any frame: nothing will paint, so nothing is waited for.
    expect(port.seen).toEqual(['']);
    clock.next();
    clock.next();
    expect(port.seen).toEqual(['']);
  });

  it('swallows a refusal from the shell, whose own timeout releases the splash', async () => {
    const clock = frames();
    const ready = vi.fn<LaunchPort['releaseSplash']>(() =>
      Promise.reject(new Error('not implemented')),
    );
    const launch = launchRelease({ releaseSplash: ready }, clock.frame);
    launch.failed();
    launch.failed();
    expect(ready).toHaveBeenCalledTimes(1);
    // An unhandled rejection would fail the run; let it settle.
    await Promise.resolve();
  });

  it('tells the intro the moment it releases the splash, once, and whether the render failed (#2053)', () => {
    const clock = frames();
    const port = fakePort(container);
    const told: { failed: boolean; splash: readonly string[] }[] = [];
    const launch = launchRelease(port, clock.frame, (failed) => {
      told.push({ failed, splash: [...port.seen] });
    });
    root = createRoot(container, launchRootOptions(launch));
    act(() => {
      root?.render(
        <StrictMode>
          <Home />
          <FirstRender onRendered={launch.rendered} />
        </StrictMode>,
      );
    });
    clock.next();
    expect(told).toEqual([]);
    clock.next();
    // In the same frame as the release, after the shell was asked.
    expect(told).toEqual([{ failed: false, splash: ['Home'] }]);
    launch.failed();
    clock.next();
    expect(told).toHaveLength(1);

    const failing = launchRelease(fakePort(container), clock.frame, (failed) => {
      told.push({ failed, splash: [] });
    });
    failing.failed();
    expect(told.at(-1)).toEqual({ failed: true, splash: [] });
  });

  it('is a no-op in a browser', async () => {
    await expect(NO_LAUNCH.releaseSplash()).resolves.toBeUndefined();
  });
});
