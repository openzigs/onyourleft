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
  more,
}: StatusMessageProps): JSX.Element {
  if (more !== undefined) {
    return (
      <div
        className={`oyl-status oyl-status--${tone}`}
        id={id}
        {...(live ? { role: 'status' } : {})}
      >
        <span className="oyl-status__glyph" aria-hidden="true">
          {GLYPH[tone]}
        </span>
        <div>
          <p className="oyl-status__sentence">
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
    <p className={`oyl-status oyl-status--${tone}`} id={id} {...(live ? { role: 'status' } : {})}>
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
