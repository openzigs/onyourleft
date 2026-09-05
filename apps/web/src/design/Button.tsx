// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX, ReactNode } from 'react';

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
}: ButtonProps): JSX.Element {
  const className = variant === 'primary' ? 'oyl-button' : 'oyl-button oyl-button--secondary';
  // `type` is passed straight through. It used to go through a ternary that
  // returned its own argument (#143) — which read like a guard against a third
  // value and was not one, because the prop is `'button' | 'submit'` and is
  // defaulted above, so no third value can reach here.
  return (
    <button
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
