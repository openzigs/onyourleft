// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A view in a chunk of its own — #674. `testing/mount.tsx` waits for every
 * view load to settle, which is right for every other test and wrong here: a
 * load held open is the thing under test. So this file drives React's root
 * directly.
 */

import { act, Component, Suspense, type ElementType, type JSX, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  lazyView,
  preloadViewGroups,
  viewGroup,
  ViewBoundary,
  ViewChunkError,
  ViewLoading,
} from './lazy-view';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

async function render(element: JSX.Element, onError?: (error: unknown) => void): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container, {
    ...(onError === undefined ? {} : { onUncaughtError: onError, onCaughtError: onError }),
  });
  await act(async () => {
    root?.render(element);
    await Promise.resolve();
  });
}

interface Views {
  readonly First: () => JSX.Element;
  readonly Second: () => JSX.Element;
}

const VIEWS: Views = {
  First: () => <p>The view</p>,
  Second: () => <p>The second view</p>,
};

/** A group whose module the test resolves or rejects by hand, counting the imports. */
function held(): {
  readonly load: () => Promise<Views>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  readonly imports: () => number;
} {
  let resolve: (views: Views) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  let imports = 0;
  return {
    load: async () => {
      imports += 1;
      return new Promise<Views>((yes, no) => {
        resolve = yes;
        reject = no;
      });
    },
    resolve: () => {
      resolve(VIEWS);
    },
    reject: (error) => {
      reject(error);
    },
    imports: () => imports,
  };
}

function shell(View: ElementType, reload?: () => void): JSX.Element {
  return (
    <ViewBoundary {...(reload === undefined ? {} : { reload })}>
      <Suspense fallback={<ViewLoading />}>
        <View />
      </Suspense>
    </ViewBoundary>
  );
}

describe('a lazily loaded view — #674', () => {
  it('says it is loading, in a status region, until its chunk arrives', async () => {
    const chunk = held();
    await render(shell(lazyView(viewGroup(chunk.load), (views) => views.First)));
    const status = container?.querySelector('[role="status"]');
    expect(status?.textContent).toBe('Loading this page…');
    // Nothing in the fallback can take focus, so nothing is lost when it goes.
    expect(container?.querySelector('a, button, [tabindex]')).toBeNull();

    await act(async () => {
      chunk.resolve();
      await Promise.resolve();
    });
    expect(container?.textContent).toBe('The view');
    expect(container?.querySelector('[data-oyl-view-loading]')).toBeNull();
  });

  it('says a chunk that could not be fetched could not be loaded, with a reload — not a blank page', async () => {
    const chunk = held();
    const reload = vi.fn();
    await render(
      shell(
        lazyView(viewGroup(chunk.load), (views) => views.First),
        reload,
      ),
      () => undefined,
    );
    await act(async () => {
      chunk.reject(new TypeError('Failed to fetch dynamically imported module'));
      await Promise.resolve();
    });
    expect(container?.textContent).toContain('Could not load this page');
    const button = container?.querySelector('button');
    expect(button?.textContent).toBe('Reload the app');
    act(() => {
      button?.click();
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('wraps the failure so the boundary can tell it from a view that threw', async () => {
    const chunk = held();
    const View = lazyView(viewGroup(chunk.load), (views) => views.First);
    const errors: unknown[] = [];
    await render(shell(View), (error) => errors.push(error));
    const cause = new TypeError('Failed to fetch');
    await act(async () => {
      chunk.reject(cause);
      await Promise.resolve();
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(ViewChunkError);
    expect((errors[0] as Error).cause).toBe(cause);
  });

  it('throws on any other error rather than blaming the network for it', async () => {
    function Broken(): JSX.Element {
      throw new RangeError('a bug in the view');
    }
    class Outer extends Component<{ readonly children: ReactNode }, { readonly caught?: Error }> {
      override state: { readonly caught?: Error } = {};
      static getDerivedStateFromError(error: Error): { readonly caught: Error } {
        return { caught: error };
      }
      override render(): ReactNode {
        return this.state.caught === undefined ? (
          this.props.children
        ) : (
          <p>outer caught {this.state.caught.message}</p>
        );
      }
    }
    await render(<Outer>{shell(Broken)}</Outer>, () => undefined);
    expect(container?.textContent).toBe('outer caught a bug in the view');
  });

  it('renders a second view of an arrived group without suspending at all', async () => {
    // React holds a fallback on screen for about 300 ms once it has shown one,
    // so a view whose group is already in memory must not show one.
    const chunk = held();
    const group = viewGroup(chunk.load);
    const First = lazyView(group, (views) => views.First);
    const Second = lazyView(group, (views) => views.Second);
    await render(shell(First));
    await act(async () => {
      chunk.resolve();
      await Promise.resolve();
    });
    let fallbacks = 0;
    const observer = new MutationObserver(() => {
      if (container?.querySelector('[data-oyl-view-loading]') !== null) {
        fallbacks += 1;
      }
    });
    observer.observe(container as HTMLElement, { subtree: true, childList: true });
    act(() => {
      root?.render(shell(Second));
    });
    await Promise.resolve();
    observer.disconnect();
    expect(container?.textContent).toBe('The second view');
    expect(fallbacks).toBe(0);
    expect(chunk.imports()).toBe(1);
  });

  it('asks again after a failed load, rather than remembering the failure', async () => {
    const chunk = held();
    const group = viewGroup(chunk.load);
    const first = group.load();
    chunk.reject(new TypeError('offline'));
    await expect(first).rejects.toBeInstanceOf(ViewChunkError);
    expect(group.loaded()).toBeUndefined();
    const second = group.load();
    expect(chunk.imports()).toBe(2);
    chunk.resolve();
    await expect(second).resolves.toBe(VIEWS);
    expect(group.loaded()).toBe(VIEWS);
    // And once it has arrived, it is not imported again.
    await group.load();
    expect(chunk.imports()).toBe(2);
  });

  describe('a view that failed once — #871', () => {
    /** Leave the view, as a route change does (`AppShell` keys the boundary by route). */
    function away(): void {
      act(() => {
        root?.render(<p>Elsewhere</p>);
      });
    }

    async function back(View: ElementType): Promise<void> {
      await act(async () => {
        root?.render(shell(View));
        await Promise.resolve();
      });
    }

    async function failed(): Promise<{
      readonly chunk: ReturnType<typeof held>;
      readonly group: ReturnType<typeof viewGroup<Views>>;
      readonly View: ElementType;
    }> {
      const chunk = held();
      const group = viewGroup(chunk.load);
      const View = lazyView(group, (views) => views.First);
      await render(shell(View), () => undefined);
      await act(async () => {
        chunk.reject(new TypeError('Failed to fetch dynamically imported module'));
        await Promise.resolve();
      });
      expect(container?.textContent).toContain('Could not load this page');
      return { chunk, group, View };
    }

    it('renders on a later visit once its group has arrived some other way', async () => {
      const { chunk, group, View } = await failed();
      // The idle preload, or a sibling view of the same group, succeeds.
      const arriving = group.load();
      chunk.resolve();
      await arriving;
      away();
      await back(View);
      expect(container?.textContent).toBe('The view');
      expect(chunk.imports()).toBe(2);
    });

    it('asks again on a later visit when the network has come back', async () => {
      const { chunk, View } = await failed();
      away();
      await back(View);
      expect(chunk.imports()).toBe(2);
      expect(container?.textContent).toBe('Loading this page…');
      await act(async () => {
        chunk.resolve();
        await Promise.resolve();
      });
      expect(container?.textContent).toBe('The view');
    });

    it('does not ask again by itself while the failure is on screen', async () => {
      // Rebuilding the view as soon as it rejected would have React's own retry
      // of the errored render import it again, and again, for as long as the
      // network stayed off. Only a later visit asks.
      const { chunk } = await failed();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(chunk.imports()).toBe(1);
      expect(container?.textContent).toContain('Could not load this page');
    });

    it('says so again on a later visit that fails too', async () => {
      const { chunk, View } = await failed();
      away();
      await back(View);
      await act(async () => {
        chunk.reject(new TypeError('still offline'));
        await Promise.resolve();
      });
      expect(container?.textContent).toContain('Could not load this page');
      expect(chunk.imports()).toBe(2);
    });
  });

  it('preloads every group, and a group that fails to preload raises nothing', async () => {
    const good = held();
    const bad = held();
    const rejections: unknown[] = [];
    const listener = (event: PromiseRejectionEvent): void => {
      rejections.push(event.reason);
    };
    window.addEventListener('unhandledrejection', listener);
    const groups = [viewGroup(good.load), viewGroup(bad.load)];
    preloadViewGroups(groups);
    expect(good.imports()).toBe(1);
    expect(bad.imports()).toBe(1);
    good.resolve();
    bad.reject(new TypeError('offline'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener('unhandledrejection', listener);
    expect(groups[0]?.loaded()).toBe(VIEWS);
    expect(groups[1]?.loaded()).toBeUndefined();
    expect(rejections).toEqual([]);
  });
});
