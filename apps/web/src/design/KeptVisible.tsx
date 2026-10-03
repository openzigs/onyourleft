// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX, ReactNode } from 'react';

/**
 * A sentence that must stay on the screen — #666. It renders its children in
 * a `div` carrying `data-oyl-kept-visible`, which is what the browser gate's
 * fold rule and `a11y/kept-visible.a11y.test.tsx` both look for: the first
 * lets a view put a consent or safety sentence before its first control
 * without that counting as prose left in the way, and the second fails the
 * mark if it ever lands inside a closed disclosure.
 *
 * ## Where the longer explanation goes instead
 *
 * The owner's ruling on #654 (2026-09-27) is **controls first, detail
 * tucked**, and **nothing is deleted** — `a11y/route-sentences.a11y.test.tsx`
 * holds every route to the sentences it rendered. A screen's explanation is
 * behind its title's ⓘ (`ScreenHelp.tsx`, #993) and a section's behind its
 * heading's ⓘ (`SectionHelp.tsx`, #1013). ⚠️ **Since #1031 that is the one
 * pattern**: this file used to be `MoreAbout.tsx`, whose "More about …"
 * disclosure closed a section beneath its controls, and every one of them is
 * now the section's ⓘ. A reviewer who remembers `MoreAbout` is reading the old
 * file.
 *
 * **Safety and privacy sentences never go behind an ⓘ.** Trainer control, the
 * stall rescue, what leaves the device and to whom, what an erase cannot
 * reach, the camera and anyone else in the room, and Web Bluetooth's limits
 * stay on the screen — each view lists its own in a `*_KEPT_VISIBLE` constant
 * and marks them with this, and `a11y/kept-visible.a11y.test.tsx` fails a
 * route that tucks one. A closed `<details>` is one press from hidden.
 */
export function KeptVisible({ children }: { readonly children: ReactNode }): JSX.Element {
  return <div data-oyl-kept-visible="">{children}</div>;
}
