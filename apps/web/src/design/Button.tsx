// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, useEffect, useRef, type JSX, type ReactNode, type Ref } from 'react';

/** Primary for the one action a view is for; secondary for everything else. */
export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
  readonly variant?: ButtonVariant;
  /**
   * Always `button` unless a form genuinely needs a submit.
   *
   * Defaulted rather than left to HTML, whose default is `submit`: a
   * type-less button inside a form submits it, which in a client with no server
   * (owner decision D6) is a full page reload that loses whatever was on screen.
   */
  readonly type?: 'button' | 'submit';
  /**
   * ⚠️ A disabled button is **not** how this shell reports "you cannot do this
   * here".
   *
   * It is removed from the tab order, so a keyboard user never reaches it and
   * never hears why, and #48's first criterion rejects exactly that. Where an
   * action is impossible in this browser the control is not rendered at all and
   * a `StatusMessage` explains instead — see `views/DevicesView.tsx`. This prop
   * is for the ordinary transient case: a button that is busy, or waiting on
   * something the same screen is about to supply.
   */
  readonly disabled?: boolean;
  /** The id of an element that explains this button, for `aria-describedby`. */
  readonly describedBy?: string;
  /**
   * Move focus here when the button first appears — #557.
   *
   * ⚠️ **Only for a button that REPLACES the control the rider just pressed**,
   * such as the next step of a flow that the press revealed. That control is
   * gone, so focus would otherwise fall back to the page and a keyboard or
   * screen-reader user would have to hunt for where they are. Never on a
   * button that appears on its own: focus that moves without a press is a
   * page that moves under the rider.
   */
  readonly focusOnMount?: boolean;
  /**
   * The underlying `<button>`, for a screen that has to put focus back on it
   * after the control a rider pressed unmounts (WCAG 2.2 SC 2.4.3) — #548's
   * *Start a new ride* hands focus to *Start recording* this way.
   */
  readonly ref?: Ref<HTMLButtonElement>;
}

/**
 * A real `<button>`, with the project's styling and nothing else.
 *
 * Not a `div` with a click handler and not an `<a>` without an `href`: both are
 * unreachable by keyboard, and `a11y/audit.ts` fails the build on either.
 */
export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled = false,
  describedBy,
  focusOnMount = false,
  ref,
}: ButtonProps): JSX.Element {
  const element = useRef<HTMLButtonElement>(null);
  // Both #557's `focusOnMount` (which needs the element here) and #548's `ref`
  // (which hands it to a caller) point at the one `<button>`.
  const setElement = useCallback(
    (node: HTMLButtonElement | null): void => {
      element.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref !== undefined && ref !== null) {
        ref.current = node;
      }
    },
    [ref],
  );
  useEffect(() => {
    if (focusOnMount) {
      element.current?.focus();
    }
    // On mount only: a prop that turns on later has not replaced anything.
  }, []);
  const className = variant === 'primary' ? 'oyl-button' : 'oyl-button oyl-button--secondary';
  // `type` is passed straight through. It used to go through a ternary that
  // returned its own argument (#143) — which read like a guard against a third
  // value and was not one, because the prop is `'button' | 'submit'` and is
  // defaulted above, so no third value can reach here.
  return (
    <button
      ref={setElement}
      className={className}
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-describedby={describedBy}
    >
      {children}
    </button>
  );
}
