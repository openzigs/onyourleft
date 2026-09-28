// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX, ReactNode } from 'react';

/**
 * The longer explanation, beneath the controls it explains — #666.
 *
 * The owner's ruling on #654 (2026-09-27): **controls first, detail tucked.**
 * A screen keeps its heading and one short sentence, then the thing a rider
 * came to do, then this: a native `<details>` whose summary says what it holds.
 * **Nothing is deleted** — `a11y/route-sentences.a11y.test.tsx` holds every
 * route to the sentences it rendered before this existed.
 *
 * ## What it is not for
 *
 * **Safety and privacy sentences never go in here.** Trainer control, the
 * stall rescue, what leaves the device and to whom, what an erase cannot
 * reach, the camera and anyone else in the room, and Web Bluetooth's limits
 * stay on the screen — each view lists its own in a `*_KEPT_VISIBLE` constant
 * and marks them with {@link KeptVisible}, and `a11y/kept-visible.a11y.test.tsx`
 * fails a route that tucks one. A closed `<details>` is one press from hidden.
 *
 * ## Why it is shaped like this
 *
 * - **Native.** The platform gives the disclosure its role, its state, its
 *   keyboard handling and — since #665 — a tab order `a11y/audit.ts` models:
 *   a link in here is not reached until the summary is opened.
 * - **The summary is plain text.** A heading inside `<summary>` is exposed
 *   differently by different browser and screen-reader pairings (#654's
 *   re-review §5, scottohara.me 2022), so there is no slot for one.
 * - **"More about …"** rather than "Why?": the rider can tell from the words
 *   alone what opening it will give them, which a list of summaries read out
 *   of context needs (WCAG 2.2 SC 2.4.6).
 * - **The marker and the target are `theme.css` §`.oyl-details`'s**, shared
 *   with the Devices screen's disclosure: a token-painted glyph, and a 44 px
 *   row declared rather than arrived at, which the browser gate measures the
 *   three ways #316 measures a button.
 */
export function MoreAbout({
  about,
  children,
}: {
  /** What the explanation is about, as it completes "More about …". */
  readonly about: string;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <details className="oyl-details oyl-more">
      <summary>More about {about}</summary>
      {children}
    </details>
  );
}

/**
 * A sentence that must stay on the screen — #666. It renders its children in
 * a `div` carrying `data-oyl-kept-visible`, which is what the browser gate's
 * fold rule and `a11y/kept-visible.a11y.test.tsx` both look for: the first
 * lets a view put a consent or safety sentence before its first control
 * without that counting as prose left in the way, and the second fails the
 * mark if it ever lands inside a closed disclosure.
 */
export function KeptVisible({ children }: { readonly children: ReactNode }): JSX.Element {
  return <div data-oyl-kept-visible="">{children}</div>;
}
