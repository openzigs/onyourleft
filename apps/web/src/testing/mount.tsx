// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Mounting the shell into a real DOM, for the tests that need one.
 *
 * Everything here is React 19's own API plus jsdom. There is no component
 * testing library, for the reason the rest of #48 gives for its other
 * dependency decisions: `createRoot`, `act` and `document.querySelector` do the
 * whole job in forty lines, and a library would be another dependency, another
 * licence check and another lockfile entry to carry.
 *
 * ## What jsdom does and does not do, so the tests do not claim more
 *
 * jsdom implements the DOM, events and same-document fragment navigation. It
 * does **not** implement:
 *
 * - **Layout.** Nothing has a size or a position, so no test here can assert
 *   anything about what is visible. Contrast is checked at the tokens instead
 *   (`design/contrast.ts`).
 * - **Stylesheets.** This suite loads none. An element hidden only by CSS looks
 *   focusable to `tabbableElements`, which is why the shell hides nothing that
 *   way.
 * - **Default activation from a key press.** Pressing Enter on a focused link
 *   dispatches a click in a browser; in jsdom it dispatches a keydown and
 *   stops. {@link activateWithKeyboard} bridges that gap explicitly and asserts
 *   the part that *is* real — that the element can take focus at all, which is
 *   the half a mouse-only control fails.
 * - **`hashchange` after following a fragment link.** ⚠️ This one is not
 *   obvious and it cost a debugging round to find. jsdom *does* update
 *   `location.hash` when an `<a href="#/devices">` is clicked — and then does
 *   **not** dispatch `hashchange`, which the HTML standard requires of a
 *   fragment navigation and which every browser does. A router subscribed to
 *   the event therefore never hears about a navigation that visibly happened,
 *   and every navigation assertion would read the previous route. The
 *   temptation at that point is to "fix" the router by adding a click handler
 *   that sets the hash itself; that would be changing shipping behaviour to
 *   suit a test double, and it would cost the browser's own handling of
 *   middle-click and "open in new tab". {@link activateWithKeyboard} supplies
 *   the missing event instead, and only when the hash actually moved.
 */

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// React refuses to run `act` outside an environment that has declared itself
// one, and the refusal is a warning rather than a failure — so without this the
// suite would render, miss every effect, and report passes. Set here rather
// than in a Vitest setup file so that importing this module is the whole of the
// arrangement.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A mounted tree, and what React reported while rendering it. */
export interface Mounted {
  readonly container: HTMLElement;
  /**
   * Errors a `RenderBoundary` caught, in order.
   *
   * Collected rather than logged: React writes a caught error to
   * `console.error`, and a suite that prints a stack trace on a passing test
   * trains everyone reading it to ignore stack traces.
   */
  readonly caughtErrors: readonly Error[];
  unmount(): void;
}

/**
 * Run something inside an **async** `act` scope.
 *
 * The trailing `await` is doing work rather than satisfying a linter: React
 * treats a synchronous `act` callback and an asynchronous one differently, and
 * only the asynchronous scope drains the microtask queue before it closes. The
 * shell's effects resolve a promise — the Bluetooth probe — so the synchronous
 * form would return with the state update still queued and every assertion
 * would read the pre-effect render.
 */
async function inAct(work: () => void): Promise<void> {
  await act(async () => {
    work();
    await Promise.resolve();
  });
}

/**
 * Mount an element into a fresh container attached to `document.body`.
 *
 * Attached rather than detached because focus is the thing under test here, and
 * an element outside the document cannot receive focus at all — `.focus()` on a
 * detached node is a silent no-op, so every focus assertion would pass or fail
 * for the wrong reason.
 */
export async function mount(element: ReactElement): Promise<Mounted> {
  // `index.html` declares this. The suite's own document does not inherit it,
  // and the `html-has-lang` rule is checked against the real file by
  // `index-html.a11y.test.ts` rather than against this line.
  document.documentElement.lang = 'en';

  const container = document.createElement('div');
  document.body.append(container);

  const caughtErrors: Error[] = [];
  const record = (error: unknown): void => {
    caughtErrors.push(error instanceof Error ? error : new Error(String(error)));
  };

  const root: Root = createRoot(container, {
    onCaughtError: record,
    onUncaughtError: record,
  });

  await inAct(() => {
    root.render(element);
  });

  return {
    container,
    caughtErrors,
    unmount() {
      root.unmount();
      container.remove();
    },
  };
}

/**
 * Let React flush effects, and let the event loop deliver a queued task.
 *
 * A macrotask rather than `Promise.resolve()`: `hashchange` is dispatched as a
 * task, not a microtask, so a router subscribed to it has not heard about a
 * navigation yet when the microtask queue drains. A `settle` that only awaited
 * a promise would leave every navigation assertion reading the previous route
 * and would have to be "fixed" by asserting the old value.
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

/**
 * Focus an element and activate it the way a keyboard would.
 *
 * The `focus()` and the check after it are the real assertion: a `div` with a
 * click handler, a disabled control and an `<a>` without an `href` all fail it,
 * and those are the three ways a control ends up working for a mouse and for
 * nothing else. The `click()` afterwards stands in for the default action jsdom
 * does not perform.
 *
 * @throws if the element cannot take focus, naming it — a failure here means
 * the control is unreachable by keyboard, not that the test is wrong.
 */
export async function activateWithKeyboard(element: HTMLElement): Promise<void> {
  element.focus();
  if (element.ownerDocument.activeElement !== element) {
    throw new Error(
      `Cannot focus ${element.outerHTML.slice(0, 120)} — it is not reachable by keyboard, so ` +
        'activating it is something only a pointer can do.',
    );
  }
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  const view = element.ownerDocument.defaultView;
  const urlBefore = view?.location.href ?? '';

  await inAct(() => {
    element.click();
  });
  // The URL is updated on a queued task, not synchronously in the click, so the
  // comparison below has to happen after the loop has turned. Reading it
  // immediately after `click()` sees the old value and silently skips the
  // event, which looks exactly like a router that does not work.
  await settle();

  // The `hashchange` jsdom owes us. Conditional on the URL having moved, so a
  // link whose handler called `preventDefault` — the skip link — produces no
  // event here either, exactly as in a browser.
  const urlAfter = view?.location.href ?? '';
  if (view !== null && view !== undefined && urlAfter !== urlBefore) {
    await inAct(() => {
      view.dispatchEvent(
        new HashChangeEvent('hashchange', { oldURL: urlBefore, newURL: urlAfter }),
      );
    });
    await settle();
  }
}

/** Every element matching a selector, as an array, typed. */
export function queryAll<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}
