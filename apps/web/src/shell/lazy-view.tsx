// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A view that arrives in a chunk of its own — #674.
 *
 * Every non-home view used to be imported statically by `AppShell`, so the
 * entry chunk carried all of them and a phone parsed and compiled every screen
 * of the app before Home painted. Each navigation group is now one module under
 * `shell/lazy/` that `AppShell` loads with a literal `import()` — literal
 * because `check:wiring` follows a literal specifier and cannot follow any
 * other (CLAUDE.md §4j) — and this file is what turns one of its exports into a
 * component.
 *
 * ## What a rider sees while it loads, and when it cannot
 *
 * {@link ViewLoading} is the `Suspense` fallback: a sentence in a polite
 * status region, inside `main` and under the route's own `h1`, so the page is
 * never a bare heading and focus — which the shell moves to `main` on a route
 * change (#48) — has nothing to be taken from when the view replaces it.
 *
 * A chunk that cannot be fetched is {@link ViewChunkError}, and
 * {@link ViewBoundary} says so with a Reload control rather than leaving
 * `main` empty. The case that matters is not a flaky network (the worker
 * serves every chunk offline, #406) but ADR 0027's tab left behind: an old
 * bundle asking for a chunk the new worker's cache no longer holds. A reload
 * is the repair ADR 0027 D-2 already gives that tab, and it is the rider's
 * press, never automatic.
 *
 * ⚠️ **Only a chunk failure is caught.** Any other error a view throws is
 * thrown on, exactly as it was before this boundary existed; turning every
 * render error into "this page could not be loaded" would tell a rider the
 * network was at fault when the code was.
 */

import {
  Component,
  lazy,
  type ComponentType,
  type JSX,
  type LazyExoticComponent,
  type ReactNode,
} from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';

/** A view's chunk could not be fetched or evaluated. */
export class ViewChunkError extends Error {
  constructor(cause: unknown) {
    super('A page of the app could not be loaded.', { cause });
    this.name = 'ViewChunkError';
  }
}

/** Every chunk load started, so a test can wait for the ones in flight. */
const started = new Set<Promise<unknown>>();

/**
 * Resolves once every view load started so far has settled — for the jsdom
 * suite, whose `mount` and `settle` wait on it (`testing/mount.tsx`), because
 * a lazily loaded view is not in the DOM on the render that requested it.
 */
export async function viewLoadsSettled(): Promise<void> {
  await Promise.allSettled([...started]);
}

/** How many view loads have started — so a waiter can tell whether it has seen them all. */
export function startedViewLoads(): number {
  return started.size;
}

/**
 * One navigation group's module, loaded at most once and remembered.
 *
 * ⚠️ **A failure is not remembered**, a success is. A preload that failed on a
 * flaky connection must not leave the group broken until a reload: the next
 * visit asks again. What IS remembered is the module, so a second view of the
 * same group renders without suspending at all — see {@link lazyView}.
 */
export interface ViewGroup<M> {
  /** Load the group's module, or return the load already under way. */
  load(): Promise<M>;
  /** The module, once it has arrived. */
  loaded(): M | undefined;
}

export function viewGroup<M>(importer: () => Promise<M>): ViewGroup<M> {
  let pending: Promise<M> | undefined;
  let module: M | undefined;
  return {
    load() {
      if (pending === undefined) {
        const loading = importer().then(
          (arrived) => {
            module = arrived;
            return arrived;
          },
          (cause: unknown) => {
            pending = undefined;
            throw new ViewChunkError(cause);
          },
        );
        pending = loading;
        started.add(loading);
      }
      return pending;
    },
    loaded: () => module,
  };
}

/**
 * Start loading every group, and swallow a failure — the visit that needs the
 * group asks again and says so if it fails then (`main.tsx` calls this once
 * the browser is idle after Home has painted).
 */
export function preloadViewGroups(groups: readonly ViewGroup<unknown>[]): void {
  for (const group of groups) {
    group.load().catch(() => undefined);
  }
}

/**
 * A component whose code arrives with its group, picked out of the group's
 * module by `pick`.
 *
 * ## Why an arrived group does not suspend
 *
 * React holds a Suspense fallback on screen for at least about 300 ms once it
 * has shown one (its reveal throttle), so a view that suspended on a module
 * already in memory would still flash "Loading this page…" for a third of a
 * second — on every first visit to every view, measured in the browser gate.
 * `lazy` calls `then` on what its loader returns and reads the result
 * synchronously when the callback runs synchronously, so a group that has
 * arrived is handed over as a thenable that does exactly that, and the view
 * renders on the render that asked for it.
 */
export function lazyView<M, P extends object>(
  group: ViewGroup<M>,
  pick: (module: M) => ComponentType<P>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => {
    const arrived = group.loaded();
    if (arrived !== undefined) {
      const settled = { default: pick(arrived) };
      const now: PromiseLike<typeof settled> = {
        then: (onFulfilled) => {
          onFulfilled?.(settled);
          return now as never;
        },
      };
      return now as Promise<typeof settled>;
    }
    return group.load().then((module) => ({ default: pick(module) }));
  });
}

/** What `main` holds while a view's chunk is on its way. */
export function ViewLoading(): JSX.Element {
  return (
    <p className="oyl-muted" role="status" data-oyl-view-loading="">
      Loading this page…
    </p>
  );
}

/** What `main` holds when a view's chunk could not be loaded. */
function ViewLoadFailed({ reload }: { readonly reload: () => void }): JSX.Element {
  return (
    <>
      <StatusMessage tone="danger" label="Could not load this page">
        This part of the app did not download. If you updated the app in another tab, or the network
        is off and this page was never saved on this device, reloading fetches it again.
      </StatusMessage>
      <Button onClick={reload}>Reload the app</Button>
    </>
  );
}

interface ViewBoundaryProps {
  readonly children: ReactNode;
  /** Called by the Reload control. `location.reload()` unless a test supplies one. */
  readonly reload?: () => void;
}

interface ViewBoundaryState {
  readonly error: Error | undefined;
}

/**
 * Catches a {@link ViewChunkError} below it and says so; throws anything else
 * on. A class for `RenderBoundary`'s reason (`design/ChartSlot.tsx`): React
 * has no hook for this.
 */
export class ViewBoundary extends Component<ViewBoundaryProps, ViewBoundaryState> {
  override state: ViewBoundaryState = { error: undefined };

  static getDerivedStateFromError(error: unknown): ViewBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) {
      return this.props.children;
    }
    if (!(error instanceof ViewChunkError)) {
      // Not ours to explain: thrown on to the next boundary up, or to the root,
      // as it would have been before this one existed.
      throw error;
    }
    return (
      <ViewLoadFailed
        reload={
          this.props.reload ??
          (() => {
            window.location.reload();
          })
        }
      />
    );
  }
}
