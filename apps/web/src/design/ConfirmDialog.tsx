// SPDX-License-Identifier: AGPL-3.0-or-later

import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import { Button } from './Button';
import { StatusMessage } from './StatusMessage';

/** Said in the dialog when an asynchronous confirmation fails and the caller gave no sentence. */
export const CONFIRM_FAILED_TEXT = 'That did not work. Try again, or close this.';

/**
 * A question that has to be answered before something that cannot be undone —
 * #950, ADR 0042. Built on Radix's `AlertDialog`, and styled with the token
 * utilities of `tailwind.css`.
 *
 * ## Why Radix here and hand-written nowhere else
 *
 * A modal dialog is the one control in this client whose accessibility is
 * BEHAVIOUR rather than markup: focus moves into it when it opens, Tab and
 * Shift+Tab stay inside it while it is open (WCAG 2.2 SC 2.4.3 and the
 * APG's dialog pattern), Escape closes it, the page behind is `aria-hidden`
 * and cannot be scrolled, and focus goes back to the control that opened it.
 * The platform's `<dialog>` does most of that, and not the page's
 * `aria-hidden` or the scroll lock. Radix does all of it, and it is what the
 * owner chose for the menus (#950). `ConfirmDialog.test.tsx` holds the trap.
 *
 * ## What it is for, and what it is not
 *
 * **Only for a destructive action the rider asked for**, which is why it is an
 * `alertdialog`: its first focus is the choice that keeps things as they are
 * (Radix focuses `Cancel`), so a rider who presses Enter twice has lost
 * nothing. That choice is also the FILLED button, and the destructive one is
 * `danger` — red, and lighter than it (#1002). It is never opened by anything
 * but a press, and it never carries a safety or privacy sentence a screen must
 * keep visible (#666): it is closed until asked for, and a closed dialog
 * renders nothing at all.
 *
 * ⚠️ **Never on a ride-time screen.** While it is open the page behind it is
 * inert, and nothing may stand between a rider and *Pause* or *End*
 * (`design/ride-time-controls.ts`). The Ride screen's stop confirmation stays
 * the two in-place buttons it is.
 */
export interface ConfirmDialogProps {
  /** Open or not. The caller owns it, because the caller knows which item. */
  readonly open: boolean;
  /** Called with `false` when the rider cancels, presses Escape, or confirms. */
  readonly onOpenChange: (open: boolean) => void;
  /** The question, as a heading: "Delete “Tuesday hills”?" */
  readonly title: string;
  /** What happens, and what cannot be got back. Read as the dialog's description. */
  readonly children: ReactNode;
  /** The destructive action's own words — "Delete the ride", never "OK". */
  readonly confirmLabel: string;
  /** The way out — "Keep the ride", never "Cancel" alone where it can be said. */
  readonly cancelLabel: string;
  /**
   * The confirmation. A caller that returns nothing has the dialog close at
   * once, as it always did. A caller that returns a PROMISE keeps it open,
   * both answers busy, until the promise settles (#959): it closes when the
   * promise resolves, and when it rejects it stays open, focus where it was,
   * and says {@link failureText} in a `role="alert"` inside it — because
   * closing would tell the rider it was done.
   */
  readonly onConfirm: () => void | Promise<void>;
  /**
   * The rider-facing sentence for a confirmation whose promise rejected — what
   * did not happen, and what is still as it was. Never the error's own text.
   * {@link CONFIRM_FAILED_TEXT} when left out.
   */
  readonly failureText?: string;
  /**
   * Where focus goes when the dialog closes. By default it goes back to the
   * control that was focused when it opened; a caller whose confirmation
   * REMOVES that control says where to go instead, and returns `true` to say
   * it did.
   */
  readonly onClosed?: () => boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  children,
  confirmLabel,
  cancelLabel,
  onConfirm,
  failureText = CONFIRM_FAILED_TEXT,
  onClosed,
}: ConfirmDialogProps): JSX.Element {
  /** An asynchronous confirmation under way: neither answer acts, and Escape does nothing. */
  const [pending, setPending] = useState(false);
  /** The last asynchronous confirmation failed, and the dialog says so. */
  const [failed, setFailed] = useState(false);
  // A dialog opened again starts clean: last time's failure is not this time's.
  useEffect(() => {
    if (open) {
      setFailed(false);
      setPending(false);
    }
  }, [open]);
  const changeOpen = (next: boolean): void => {
    // While a confirmation is under way the dialog is not closed by a cancel
    // or by Escape: the rider would be told nothing of how it ended.
    if (!next && pending) {
      return;
    }
    onOpenChange(next);
  };
  const confirm = (): void => {
    if (pending) {
      return;
    }
    const result = onConfirm();
    if (!(result instanceof Promise)) {
      onOpenChange(false);
      return;
    }
    setPending(true);
    setFailed(false);
    result.then(
      () => {
        setPending(false);
        onOpenChange(false);
      },
      () => {
        setPending(false);
        setFailed(true);
      },
    );
  };
  /*
   * ⚠️ Radix's dialog hands focus back to its `Trigger` on close, and to
   * nothing at all without one — measured: an Escape left focus on the page's
   * `body`. This dialog is opened by a caller's own button (which row's Delete
   * was pressed is the caller's state), so it keeps the opener itself.
   */
  const opener = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={changeOpen}>
      <AlertDialog.Portal>
        {/*
          The overlay is OPAQUE, `surface-overlay`: a scrim of a token at an
          alpha has no fixed colour, so nothing on it could be held to a
          contrast pair — the reason `tokens.ts` §`hudSurface` is opaque too.
          The dialog is laid out inside it rather than beside it, so a phone
          at 320 × 256 scrolls the overlay rather than clipping the buttons
          (WCAG 2.2 SC 1.4.10).
        */}
        <AlertDialog.Overlay className="oyl-confirm-overlay tw:fixed tw:inset-0 tw:z-30 tw:grid tw:place-items-center tw:overflow-y-auto tw:p-md tw:bg-surface-overlay">
          {/*
            `aria-modal`, which Radix does not set: it is what tells a screen
            reader the page behind is inert, and what `a11y/audit.ts`
            §`openModal` reads to audit the dialog rather than the page it
            hides.
          */}
          <AlertDialog.Content
            aria-modal="true"
            aria-busy={pending ? true : undefined}
            className="oyl-confirm tw:w-full tw:max-w-(--oyl-measure) tw:rounded tw:border-2 tw:border-border tw:p-lg tw:bg-canvas tw:text-ink"
            onEscapeKeyDown={(event) => {
              if (pending) {
                event.preventDefault();
              }
            }}
            onOpenAutoFocus={() => {
              // Before Radix moves focus in, so this is still the control that
              // opened it.
              opener.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const returnTo = opener.current;
              opener.current = null;
              if (onClosed?.() === true) {
                return;
              }
              if (returnTo?.isConnected === true) {
                returnTo.focus();
              }
            }}
          >
            <AlertDialog.Title className="tw:mt-0 tw:mb-md tw:text-xl">{title}</AlertDialog.Title>
            <AlertDialog.Description asChild>
              <div className="tw:mb-lg">{children}</div>
            </AlertDialog.Description>
            {failed ? (
              <div role="alert" className="tw:mb-lg">
                <StatusMessage tone="danger" label="Not done">
                  {failureText}
                </StatusMessage>
              </div>
            ) : null}
            <div className="tw:flex tw:flex-wrap tw:gap-sm">
              {/*
                #1002, the owner's ruling of 2026-10-02: the SAFE answer is the
                filled primary and takes focus (Radix focuses `Cancel`); the
                destructive one is `danger`, red and lighter than it. #996 had
                them the other way round, and the irreversible answer was the
                heaviest thing on the screen.
              */}
              {/*
                Busy is `unavailable` (`aria-disabled`), never `disabled`: the
                confirm button the rider just pressed keeps focus, where a
                disabled one would drop it to the page behind the trap.
                ⚠️ The confirm is NOT Radix's `Action`, which closes the dialog
                on every press — an asynchronous one closes only once it has
                worked (#959).
              */}
              <AlertDialog.Cancel asChild>
                <Button unavailable={pending}>{cancelLabel}</Button>
              </AlertDialog.Cancel>
              <Button variant="danger" unavailable={pending} onClick={confirm}>
                {confirmLabel}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
