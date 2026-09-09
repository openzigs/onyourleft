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
  /**
   * Render again into the same root, with different props.
   *
   * A *re-render*, not a second mount: the tree keeps its state, its refs and
   * its effects, and only the changed dependencies re-run. That distinction is
   * the thing under test wherever a component is supposed to update something
   * in place rather than rebuild it — `map/MapPanel.test.tsx` uses it to prove
   * a changed track does not tear the map down, which a fresh `mount` could not
   * tell apart from a rebuild.
   */
  rerender(element: ReactElement): Promise<void>;
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
    async rerender(next: ReactElement): Promise<void> {
      await inAct(() => {
        root.render(next);
      });
    },
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

/**
 * Type a value into a **controlled** input, the way a person would.
 *
 * ⚠️ Setting `input.value` directly and dispatching `input` does not work in
 * React 19 and looks as though it does: React tracks the last value it wrote on
 * the node, sees the assignment as a no-op, and skips the `onChange` — so the
 * component keeps its old state and the test reads the *default* value back out
 * of the handler. That is a green-looking assertion about the wrong number,
 * which on this screen would be the wrong ERG target.
 *
 * The native setter on the prototype bypasses React's own descriptor, which is
 * what makes the subsequent event carry the new value.
 */
export async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (descriptor?.set === undefined) {
    throw new Error('this DOM implementation has no HTMLInputElement value setter');
  }
  await inAct(() => {
    descriptor.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/**
 * Choose an option in a `<select>`, the way a rider would.
 *
 * The same native-setter trick {@link typeInto} uses and for the same reason:
 * React installs its own `value` descriptor on the element, so assigning
 * through it looks like a no-op and the `change` handler never runs. Without
 * this the component keeps its previous state and the test reads the *default*
 * selection back — which on the workouts screen would silently assert against a
 * steady block while claiming to build an intervals one.
 */
export async function chooseOption(select: HTMLSelectElement, value: string): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  if (descriptor?.set === undefined) {
    throw new Error('this DOM implementation has no HTMLSelectElement value setter');
  }
  await inAct(() => {
    descriptor.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/**
 * Submit a form the way pressing its submit button does.
 *
 * `form.submit()` deliberately does NOT fire a submit event — that is the
 * specification, not a jsdom gap — so a test using it would exercise nothing.
 *
 * ⚠️ **There is no companion that attaches a file to a `<input type="file">`,
 * and one was written and deleted rather than shipped.** jsdom implements no
 * `DataTransfer`, refuses `input.files = anything-but-a-FileList`, and hands
 * out a `FileList` that is a Proxy rejecting index writes — so no public API
 * reaches it. The version that looked like it worked used
 * `Object.defineProperty(input, 'files', …)`, which `FormData` ignores: the
 * probe asserted `instanceof File` and passed against the **empty** file the
 * HTML specification appends for an input with no selection. That is a false
 * pass of exactly the shape this repository keeps closing, so the helper is
 * absent on purpose. A screen's file *decoding* is asserted against its pure
 * function; only the picker step is out of reach.
 */
export async function submitForm(form: HTMLFormElement): Promise<void> {
  await inAct(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Every element matching a selector, as an array, typed. */
export function queryAll<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}
