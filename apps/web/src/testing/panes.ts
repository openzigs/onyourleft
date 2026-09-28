// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Answer `shell/ListDetail.tsx` §`useTwoPanes` in jsdom — #670.
 *
 * jsdom has no `matchMedia` and loads no stylesheet, so the list–detail layout
 * is always one pane here. This installs both halves the hook reads: the
 * breakpoint custom property on `:root` — as `theme.css` declares it, read out
 * of that file rather than retyped — and a `matchMedia` that answers ONLY the
 * query built from it. A hook that stopped reading the property, or built a
 * different query, gets `false` and one pane.
 *
 * Test support: imported only by tests. Returns the function that undoes it.
 */

import { LIST_DETAIL_FROM_PROPERTY } from '../shell/ListDetail';

/**
 * The breakpoint `theme.css` declares, e.g. `52.5rem`, out of the file's text
 * — which the caller reads, because a test file's `import.meta.url` is a file
 * URL and this module's is not.
 */
export function declaredBreakpoint(themeCss: string): string {
  const found = new RegExp(`${LIST_DETAIL_FROM_PROPERTY}:\\s*([^;]+);`).exec(themeCss);
  if (found?.[1] === undefined) {
    throw new Error(`theme.css declares no ${LIST_DETAIL_FROM_PROPERTY}`);
  }
  return found[1].trim();
}

/** Make this window `wide` (two panes) or not, until the returned function is called. */
export function answerTwoPanes(wide: boolean, themeCss: string): () => void {
  const breakpoint = declaredBreakpoint(themeCss);
  const style = document.createElement('style');
  style.textContent = `:root { ${LIST_DETAIL_FROM_PROPERTY}: ${breakpoint}; }`;
  document.head.append(style);
  const previous = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  const expected = `(min-width: ${breakpoint})`;
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: wide && query === expected,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
  return () => {
    style.remove();
    if (previous === undefined) {
      delete (window as { matchMedia?: unknown }).matchMedia;
    } else {
      Object.defineProperty(window, 'matchMedia', previous);
    }
  };
}

/** A window whose width can change under a mounted layout — #670's rotation. */
export interface RotatablePanes {
  /** Answer the breakpoint query with `wide` from now on, and tell every listener. */
  readonly rotate: (wide: boolean) => void;
  /** Undo the stub, as {@link answerTwoPanes}'s return does. */
  readonly restore: () => void;
}

/**
 * {@link answerTwoPanes}, but the answer can change after mounting: its
 * `MediaQueryList` keeps its `change` listeners and {@link RotatablePanes.rotate}
 * calls them, which is what a browser does when a tablet is turned.
 */
export function rotatablePanes(wide: boolean, themeCss: string): RotatablePanes {
  const restore = answerTwoPanes(false, themeCss);
  const expected = `(min-width: ${declaredBreakpoint(themeCss)})`;
  let now = wide;
  const listeners = new Set<() => void>();
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      get matches() {
        return now && query === expected;
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  return {
    rotate: (next) => {
      now = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    restore,
  };
}
