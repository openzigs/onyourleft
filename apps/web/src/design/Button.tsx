// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  useCallback,
  useEffect,
  useRef,
  type JSX,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';

/**
 * The kinds of button — #668, and #992's tertiary. A rider tells the action
 * from the setting by weight, so each kind has one job:
 *
 * - **`primary`** — the one action a view exists for, filled with the accent.
 *   **At most one per view**, and that is a gate:
 *   `a11y/button-hierarchy.a11y.test.tsx` renders every route over a populated
 *   and an empty fixture and fails a `main` that holds two.
 * - **`secondary`** — every other action, TONAL since #992: a filled surface
 *   step, not an outline.
 * - **`tertiary`** — text (#992): the lowest action beside a primary.
 * - **`danger`** — the destructive answer to a confirmation (#1002): red-toned,
 *   and LIGHTER than the filled safe answer beside it, which takes focus
 *   (`ConfirmDialog.tsx`). **Only inside a modal dialog**, and that is a gate:
 *   `a11y/button-hierarchy.ts` §`dangerOutsideModalViolations`. It does not
 *   count toward the one primary, because it is not one.
 * - **`toggle`** — a single on/off that changes how something is shown or
 *   heard rather than what happens, such as *Mute sounds*. It carries
 *   `aria-pressed`, and it cannot be written without saying which way it
 *   stands: {@link ButtonProps} makes `pressed` required for it and forbidden
 *   for the other two. An exclusive choice of two or more is not a toggle
 *   button at all but a native radio group styled `.oyl-segmented` (or, for
 *   four or more options, a native `<select>` — Activities' sort, #660).
 */
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'toggle';

/**
 * Which way a toggle stands, required exactly when the variant is `toggle`.
 *
 * ⚠️ A union rather than an optional `pressed`: an optional one would let a
 * toggle be written without it, and a toggle whose state is not said renders
 * no `aria-pressed` — a screen reader then announces a plain button and the
 * rider cannot hear whether sound is on. `Button.test.tsx` holds this with a
 * `@ts-expect-error`, which goes red (TS2578) the day it compiles.
 */
export type ButtonKind =
  | {
      readonly variant?: 'primary' | 'secondary' | 'tertiary' | 'danger';
      readonly pressed?: never;
    }
  | { readonly variant: 'toggle'; readonly pressed: boolean };

interface ButtonCommonProps {
  readonly children: ReactNode;
  readonly onClick?: () => void;
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
  /**
   * `aria-disabled`, for a button that cannot act just now and must stay in
   * the tab order — #805's ask control while a write-up runs, the way
   * `GameView.tsx`'s *Ride* is while a pacer is refused. ⚠️ **It stops no
   * press**: a click still reaches `onClick`, and the caller refuses it there.
   */
  readonly unavailable?: boolean;
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
  /**
   * A class of the caller's own, added after the variant's — for layout only
   * (the HUD's mute keeps its one line with `oyl-sound__mute`). Never a colour:
   * a caller that repaints a button has made a fourth kind nobody declared.
   */
  readonly className?: string;
  /**
   * `ride` for a control a rider presses DURING a ride — #669, the owner's
   * ruling of 2026-09-27: *Start*, *Pause*, *End* and *Set target* get a
   * **48 px** target, and everything else stays at `.oyl-button`'s 44.
   *
   * Declared, not arrived at: it adds `oyl-button--ride`, whose `min-height`
   * and `min-width` are 3rem (`theme.css` §`.oyl-button--ride`). 48 × 48 is
   * Android's own accessibility guidance (48 dp, and one CSS px is one dp in a
   * WebView), above WCAG 2.2 SC 2.5.5's 44 (AAA). Which controls carry it is
   * ONE list, `design/ride-time-controls.ts` §`RIDE_TIME_CONTROLS`, and
   * `browser/ride-targets.browser.spec.ts` walks it. A control not on that list
   * does not get this size — the list, not a caller's taste, is the ruling.
   */
  readonly size?: 'ride';
}

export type ButtonProps = ButtonCommonProps & ButtonKind;

/** The classes each kind is drawn with. */
const VARIANT_CLASS: Readonly<Record<ButtonVariant, string>> = {
  primary: 'oyl-button',
  secondary: 'oyl-button oyl-button--secondary',
  tertiary: 'oyl-button oyl-button--tertiary',
  danger: 'oyl-button oyl-button--danger',
  toggle: 'oyl-button oyl-button--toggle',
};

/**
 * The ride-time size's class — #669. Exported because the ride HUD's own
 * *Pause* and *End ride* are not `Button`s (they are drawn in the HUD's
 * colours, at `game/hud/HudPanel.tsx` §`CONTROL_MINIMUM_PIXELS`) and
 * carry it too, so every control on the list wears the one declaration.
 */
export const RIDE_SIZE_CLASS = 'oyl-button--ride';

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
  pressed,
  type = 'button',
  disabled = false,
  unavailable = false,
  describedBy,
  focusOnMount = false,
  ref,
  className,
  size,
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
  const sized =
    size === 'ride' ? `${VARIANT_CLASS[variant]} ${RIDE_SIZE_CLASS}` : VARIANT_CLASS[variant];
  const classes = className === undefined ? sized : `${sized} ${className}`;
  // `type` is passed straight through. It used to go through a ternary that
  // returned its own argument (#143) — which read like a guard against a third
  // value and was not one, because the prop is `'button' | 'submit'` and is
  // defaulted above, so no third value can reach here.
  return (
    <button
      ref={setElement}
      className={classes}
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={unavailable ? true : undefined}
      aria-describedby={describedBy}
      // Only a toggle says which way it stands. `undefined` renders nothing,
      // so a primary or secondary is never announced as "not pressed".
      aria-pressed={variant === 'toggle' ? pressed : undefined}
    >
      {children}
    </button>
  );
}

export interface ButtonLinkProps {
  readonly children: ReactNode;
  /** Where it goes — a hash route from `shell/routes.ts` §`hrefFor`. */
  readonly href: string;
  /** `primary` or `secondary`: a toggle changes a setting, and a link changes the page. */
  readonly variant?: 'primary' | 'secondary';
  readonly onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** `ListDetail.tsx` §`CreateLink`'s marker, which its tests and the panes' skip link find it by. */
  readonly create?: boolean;
}

/**
 * A link drawn as one of {@link Button}'s kinds — #943.
 *
 * An action that goes somewhere (*Start a ride*, *Import a route*) is a link,
 * not a `<button>` with a click handler that sets the hash: a link keeps the
 * browser's own open-in-new-tab and its status-bar preview, and it is what a
 * screen reader announces as one. It wears exactly the classes a `Button` of
 * the same variant wears, from the one table, so the one-primary walk
 * (`a11y/button-hierarchy.ts`) counts it the same way.
 */
export function ButtonLink({
  children,
  href,
  variant = 'primary',
  onClick,
  create = false,
}: ButtonLinkProps): JSX.Element {
  return (
    <a
      className={VARIANT_CLASS[variant]}
      href={href}
      onClick={onClick}
      data-oyl-create={create ? '' : undefined}
    >
      {children}
    </a>
  );
}
