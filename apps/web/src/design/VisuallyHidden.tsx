// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX, ReactNode } from 'react';

/**
 * Text for a screen reader, off-screen for everyone else.
 *
 * Clipped rather than `display: none` or `visibility: hidden`, because both of
 * those remove the text from the accessibility tree as well as from the page —
 * which is the opposite of what this is for.
 *
 * Use it to complete a label a sighted user reads from context. Do **not** use
 * it to carry the whole of a control's meaning: a control whose only name is
 * invisible cannot be described out loud by one person to another, and speech
 * control users have to guess what to say.
 */
export function VisuallyHidden({ children }: { readonly children: ReactNode }): JSX.Element {
  return <span className="oyl-visually-hidden">{children}</span>;
}
