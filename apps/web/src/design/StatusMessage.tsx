// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX, ReactNode } from 'react';

/**
 * How serious a message is, and therefore which colour it carries.
 *
 * The tone is **never** the only carrier — see the module note below.
 */
export type StatusTone = 'info' | 'success' | 'warning' | 'danger';

/**
 * The default word a tone announces itself with.
 *
 * A word, not an icon, and visible rather than `aria-label`-only: this is what
 * survives greyscale, a colour-vision deficiency, a monochrome printout and a
 * screen reader, all at once. #48's sixth criterion says colour must never be
 * the sole carrier of meaning in any design-system primitive, and this constant
 * is where that is true or not for the whole shell.
 */
const DEFAULT_LABEL: Record<StatusTone, string> = {
  info: 'Note',
  success: 'Done',
  warning: 'Heads up',
  danger: 'Not available',
};

/**
 * The message's box — #950, the token utilities of `tailwind.css` rather than
 * a `theme.css` rule. `oyl-status` stays on it as the name other rules and the
 * gates find it by (`.oyl-ride__heading > .oyl-status`, the HUD's notices,
 * `rideview-harness.tsx`); it styles nothing of its own any more.
 *
 * ⚠️ A more specific `theme.css` rule still wins over these, which is what the
 * Ride screen's heading and the HUD's notice cell rely on to take the margin
 * and padding away — a utility is one class, and they are two.
 */
const BOX_CLASS =
  'oyl-status tw:flex tw:gap-sm tw:items-start tw:p-md tw:rounded tw:border-l-4 tw:mx-0 tw:mt-0 tw:mb-md';

/**
 * Each tone's colours: its surface, its ink and its edge, one declared
 * contrast pair apiece (`tokens.ts` §`CONTRAST_REQUIREMENTS`), all three in
 * ONE string so `a11y/tailwind.a11y.test.ts` reads the surface and the ink as
 * the pair they are. `oyl-status--<tone>` stays as the name a gate finds a tone
 * by (`theme.browser.spec.ts`, `keep-alive-notice.a11y.test.tsx`).
 */
const TONE_CLASS: Record<StatusTone, string> = {
  info: 'oyl-status--info tw:bg-info-surface tw:text-info-ink tw:border-info-border',
  success: 'oyl-status--success tw:bg-success-surface tw:text-success-ink tw:border-success-border',
  warning: 'oyl-status--warning tw:bg-warning-surface tw:text-warning-ink tw:border-warning-border',
  danger: 'oyl-status--danger tw:bg-danger-surface tw:text-danger-ink tw:border-danger-border',
};

/**
 * The box and a tone's colours as one class list, for the one surface that is
 * drawn as a status message without being one: `transfer/TransferView.tsx`'s
 * import progress, a live sentence with no glyph and no leading word.
 */
export function statusSurfaceClass(tone: StatusTone): string {
  return `${BOX_CLASS} ${TONE_CLASS[tone]}`;
}

/**
 * A second, redundant signal in the shape of the glyph.
 *
 * `aria-hidden`, because the word beside it already says the same thing and a
 * reader announcing "asterisk warning" is worse than either alone. Plain text
 * characters rather than an icon set: ADR 0009 rule L1 bars reproducing another
 * product's icon set, and an icon font would be a dependency and a licence
 * question for four glyphs.
 */
const GLYPH: Record<StatusTone, string> = {
  info: 'i',
  success: '✓',
  warning: '!',
  danger: '✕',
};

export interface StatusMessageProps {
  readonly tone: StatusTone;
  readonly children: ReactNode;
  /** Overrides {@link DEFAULT_LABEL} where the tone's default word is too blunt. */
  readonly label?: string;
  /**
   * Announce this message when it appears, for one that appears in response to
   * something the athlete did.
   *
   * Off by default. A live region on a message rendered at load is announced
   * twice — once as part of the page, once as an update — and the second one
   * interrupts.
   */
  readonly live?: boolean;
  readonly id?: string;
  /**
   * A safety or privacy sentence that must stay on the screen — #666, #1048.
   * Marks the message's sentence `data-oyl-kept-visible`, as `KeptVisible.tsx`
   * does, without a wrapper box around the message: the mark the browser
   * gate's fold rule and `a11y/kept-visible.a11y.test.tsx` read. With
   * {@link more} the mark is on the sentence only, never on the disclosure
   * under it, which is not kept.
   */
  readonly kept?: boolean;
  /**
   * What a rider may open to read the rest — #605. The sentence in
   * `children` stays on the screen; this is a `<details>` inside the same
   * surface, under it, closed until pressed.
   *
   * ⚠️ **For what FOLLOWS a message, never for the message.** The owner's
   * ruling on #605 is that safety text is not tucked away: a message whose
   * point is "this is why the trainer is not holding your target" says that in
   * `children`, and only its explanation may be here.
   *
   * With it the root is a `<div>` rather than a `<p>`, because a `<details>`
   * is flow content and a paragraph may not hold one.
   */
  readonly more?: { readonly summary: string; readonly detail: ReactNode };
}

/**
 * A message whose meaning survives its colour being removed.
 *
 * Three carriers, and only one of them is colour: the glyph, the leading word,
 * and the tone's palette. `StatusMessage.test.tsx` asserts that two different
 * tones differ in **text**, which is the assertion that would fail if somebody
 * later made the label uniform and left the colour to do the work.
 */
export function StatusMessage({
  tone,
  children,
  label,
  live = false,
  id,
  kept = false,
  more,
}: StatusMessageProps): JSX.Element {
  const mark = kept ? { 'data-oyl-kept-visible': '' } : {};
  if (more !== undefined) {
    return (
      <div className={statusSurfaceClass(tone)} id={id} {...(live ? { role: 'status' } : {})}>
        <span className="oyl-status__glyph" aria-hidden="true">
          {GLYPH[tone]}
        </span>
        <div>
          <p className="oyl-status__sentence" {...mark}>
            <span className="oyl-status__label">{label ?? DEFAULT_LABEL[tone]}: </span>
            {children}
          </p>
          <details className="oyl-status__more">
            <summary>{more.summary}</summary>
            <p>{more.detail}</p>
          </details>
        </div>
      </div>
    );
  }
  return (
    <p className={statusSurfaceClass(tone)} id={id} {...(live ? { role: 'status' } : {})} {...mark}>
      <span className="oyl-status__glyph" aria-hidden="true">
        {GLYPH[tone]}
      </span>
      <span>
        <span className="oyl-status__label">{label ?? DEFAULT_LABEL[tone]}: </span>
        {children}
      </span>
    </p>
  );
}
